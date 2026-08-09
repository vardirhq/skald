// The sync engine: everything that knows both what a Skald vault is and what a
// GESH relay is. The protocol client below it knows nothing about notes; the
// vault above it knows nothing about sync.
//
// One pass is always pull → apply → acknowledge → push, in that order. Pulling
// first means a conflict is resolved before this device publishes, so the
// revision it publishes already reflects the merge. Acknowledging is what tells
// the relay it may erase an event, so it happens only after the change is on
// disk — never after download, never after decrypt.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Vault } from './vault';
import {
  deviceKey,
  forgetSecrets,
  loadSecrets,
  requireSecretStore,
  saveSecrets,
  secretsProtected,
  type RootSecrets,
} from './secrets';
import { GeshClient, GeshError, type RootRef } from '../src-shared/gesh/protocol';
import { newDeviceId, newEventId } from '../src-shared/gesh/ids';
import {
  contentKeyFromBase64Url,
  contentKeyToBase64Url,
  generateContentKey,
  openEvent,
  sealEvent,
  sha256Hex,
} from '../src-shared/gesh/crypto';
import { utf8Encode } from '../src-shared/gesh/bytes';
import { buildPairingUri, formatEnrollmentCode, parsePairingUri, withContentKey } from '../src-shared/gesh/pairing';
import {
  decodeEvent,
  encodeEvent,
  isAttachmentPath,
  isNotePath,
  MAX_ATTACHMENT_BYTES,
  PayloadError,
  type FileOp,
  type PutBinOp,
  type SyncEvent,
} from '../src-shared/sync/payload';
import { ABSENT, decideMerge, nextRev, type FileState } from '../src-shared/sync/merge';
import {
  SYNC_APP_ID,
  type PairingTicket,
  type SyncDeviceInfo,
  type SyncPhase,
  type SyncStatus,
} from '../src-shared/sync/types';

/** Roughly a quarter of the 32 MiB default upload limit, leaving room for JSON overhead. */
const MAX_EVENT_BYTES = 6 * 1024 * 1024;
const PAGE_LIMIT = 100;
const TOMBSTONE_KEEP_MS = 90 * 24 * 60 * 60_000;

interface SyncStateFile {
  version: 1;
  serverUrl: string;
  appId: string;
  rootId: string;
  deviceId: string;
  handle: string | null;
  /** This device provisioned the root and holds the authority credential. */
  isRoot: boolean;
  enabled: boolean;
  cursor: number;
  lastSyncMs: number | null;
  /** Per-path state this device has agreed on with the root. */
  files: Record<string, FileState>;
  /** Paths deleted locally and not yet published, with the clock to publish them at. */
  tombstonedAtMs: Record<string, number>;
  /** size+mtime of each attachment when it was last hashed, to avoid re-reading it. */
  assetStamps: Record<string, { size: number; mtimeMs: number; hash: string }>;
}

export interface SyncEngineOptions {
  vault: Vault;
  onStatus: (status: SyncStatus) => void;
  /** Injected in tests. */
  makeClient?: (baseUrl: string) => GeshClient;
}

export class SyncEngine {
  private readonly vault: Vault;
  private readonly onStatus: (status: SyncStatus) => void;
  private readonly makeClient: (baseUrl: string) => GeshClient;

  private state: SyncStateFile | null = null;
  private phase: SyncPhase = 'off';
  private lastError: string | null = null;
  /** Set when a pass completed but had to skip something the user should know about. */
  private passWarning: string | null = null;
  private retryAtMs: number | null = null;
  private pendingPaths = 0;
  /** Attachments too large for the relay to accept, reported rather than hidden. */
  private oversize: string[] = [];
  /**
   * Attachments this relay refused with a 413. Only an upload can discover
   * these — its limit may be lower than the one Skald assumes — so they are
   * remembered across passes rather than recomputed from the vault each time.
   */
  private relayRejected = new Set<string>();

  private running = false;
  private rerun = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(options: SyncEngineOptions) {
    this.vault = options.vault;
    this.onStatus = options.onStatus;
    this.makeClient = options.makeClient ?? ((baseUrl) => new GeshClient({ baseUrl }));
    this.state = this.readState();
    this.phase = this.state ? 'idle' : 'off';
    if (this.state?.enabled) this.startTimers();
    void this.refreshPending();
  }

  // ---------- state on disk ----------

  private stateFile(): string {
    return join(this.vault.path, '.skald', 'sync.json');
  }

  private readState(): SyncStateFile | null {
    try {
      const parsed = JSON.parse(readFileSync(this.stateFile(), 'utf-8')) as Partial<SyncStateFile>;
      if (parsed?.version !== 1 || !parsed.rootId || !parsed.deviceId || !parsed.serverUrl) return null;
      return {
        version: 1,
        serverUrl: parsed.serverUrl,
        appId: parsed.appId || SYNC_APP_ID,
        rootId: parsed.rootId,
        deviceId: parsed.deviceId,
        handle: parsed.handle ?? null,
        isRoot: parsed.isRoot === true,
        enabled: parsed.enabled !== false,
        cursor: Number.isInteger(parsed.cursor) ? (parsed.cursor as number) : 0,
        lastSyncMs: typeof parsed.lastSyncMs === 'number' ? parsed.lastSyncMs : null,
        files: (parsed.files ?? {}) as Record<string, FileState>,
        tombstonedAtMs: (parsed.tombstonedAtMs ?? {}) as Record<string, number>,
        assetStamps: (parsed.assetStamps ?? {}) as SyncStateFile['assetStamps'],
      };
    } catch {
      return null;
    }
  }

  private writeState(): void {
    if (!this.state) return;
    // Tombstones keep a deleted path's clock so a stale re-upload cannot
    // resurrect it. They are only useful for as long as peers can still be
    // carrying that old revision.
    const cutoff = Date.now() - TOMBSTONE_KEEP_MS;
    for (const [path, at] of Object.entries(this.state.tombstonedAtMs)) {
      if (at < cutoff) {
        delete this.state.tombstonedAtMs[path];
        if (this.state.files[path]?.hash === ABSENT) delete this.state.files[path];
      }
    }
    for (const path of Object.keys(this.state.assetStamps)) {
      if (!(path in this.state.files)) delete this.state.assetStamps[path];
    }
    try {
      mkdirSync(join(this.vault.path, '.skald'), { recursive: true });
      writeFileSync(this.stateFile(), JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.error('skald: failed to write sync state', err);
    }
  }

  // ---------- status ----------

  status(): SyncStatus {
    const s = this.state;
    return {
      configured: !!s,
      enabled: s?.enabled ?? false,
      serverUrl: s?.serverUrl ?? null,
      appId: s?.appId ?? SYNC_APP_ID,
      rootId: s?.rootId ?? null,
      handle: s?.handle ?? null,
      deviceId: s?.deviceId ?? null,
      isRoot: s?.isRoot ?? false,
      phase: this.phase,
      lastSyncMs: s?.lastSyncMs ?? null,
      lastError: this.lastError,
      pending: this.pendingPaths,
      tracked: s ? Object.values(s.files).filter((f) => f.hash !== ABSENT).length : 0,
      secretsProtected: secretsProtected(),
      retryAtMs: this.retryAtMs,
      oversize: this.oversize,
    };
  }

  private emit(): void {
    this.onStatus(this.status());
  }

  private fail(err: unknown): never {
    this.lastError = err instanceof Error ? err.message : String(err);
    this.phase = 'error';
    if (err instanceof GeshError && err.retryAfterMs !== null) {
      this.retryAtMs = Date.now() + err.retryAfterMs;
    }
    this.emit();
    throw err;
  }

  // ---------- credentials ----------

  private secrets(): RootSecrets {
    const s = this.requireState();
    const found = loadSecrets(deviceKey(s.appId, s.rootId, s.deviceId));
    if (!found) {
      throw new Error(
        'Skald cannot read this vault’s sync credentials. Pair this device again, or disconnect the vault from sync.'
      );
    }
    return found;
  }

  private requireState(): SyncStateFile {
    if (!this.state) throw new Error('This vault is not connected to a sync server');
    return this.state;
  }

  private ref(): RootRef {
    const s = this.requireState();
    return { appId: s.appId, rootId: s.rootId };
  }

  private client(): GeshClient {
    return this.makeClient(this.requireState().serverUrl);
  }

  // ---------- setup ----------

  /** Provisions a brand-new root. The device that does this becomes the authority. */
  async connect(input: { serverUrl: string; handle?: string; provisioningSecret?: string }): Promise<SyncStatus> {
    if (this.state) throw new Error('This vault is already connected to a sync server');
    // Check this before provisioning: a root we cannot keep the credentials for
    // is a root nobody can ever use again, and GESH has no way to delete one.
    requireSecretStore();
    const client = this.makeClient(input.serverUrl);
    const deviceId = newDeviceId('desktop');
    try {
      const root = await client.provisionRoot({
        appId: SYNC_APP_ID,
        deviceId,
        ...(input.handle ? { handle: input.handle } : {}),
        ...(input.provisioningSecret ? { provisioningSecret: input.provisioningSecret } : {}),
      });
      const contentKey = await contentKeyToBase64Url(await generateContentKey());
      saveSecrets(deviceKey(root.appId, root.rootId, root.deviceId), {
        deviceToken: root.deviceToken,
        rootToken: root.rootToken,
        contentKey,
      });
      this.state = {
        version: 1,
        serverUrl: client.baseUrl,
        appId: root.appId,
        rootId: root.rootId,
        deviceId: root.deviceId,
        handle: root.handle,
        isRoot: true,
        enabled: true,
        cursor: 0,
        lastSyncMs: null,
        files: {},
        tombstonedAtMs: {},
        assetStamps: {},
      };
      this.lastError = null;
      this.phase = 'idle';
      this.writeState();
      this.startTimers();
      this.emit();
    } catch (err) {
      this.fail(err);
    }
    // A fresh root has nothing on it; publish the vault so the next device to
    // pair has something to receive.
    await this.syncNow({ snapshot: true });
    return this.status();
  }

  /** Redeems a pairing link minted by another device, and adopts its content key. */
  async pair(pairingUri: string): Promise<SyncStatus> {
    if (this.state) throw new Error('This vault is already connected to a sync server');
    const invite = parsePairingUri(pairingUri);
    if (!invite.contentKey) {
      throw new Error('That pairing link carries no content key, so this device could not read anything it synced');
    }
    // Fail before anything is stored if the key is not a usable one, or if
    // there is nowhere safe to put it — redeeming burns a single-use code.
    await contentKeyFromBase64Url(invite.contentKey);
    requireSecretStore();

    const client = this.makeClient(invite.server);
    const deviceId = newDeviceId('desktop');
    try {
      const enrolled = await client.redeemEnrollment({ code: invite.code, deviceId });
      if (enrolled.appId !== SYNC_APP_ID) {
        throw new Error(`That pairing link belongs to a different app (${enrolled.appId})`);
      }
      saveSecrets(deviceKey(enrolled.appId, enrolled.rootId, enrolled.deviceId), {
        deviceToken: enrolled.token,
        contentKey: invite.contentKey,
      });
      this.state = {
        version: 1,
        serverUrl: client.baseUrl,
        appId: enrolled.appId,
        rootId: enrolled.rootId,
        deviceId: enrolled.deviceId,
        handle: null,
        isRoot: false,
        enabled: true,
        cursor: 0,
        lastSyncMs: null,
        files: {},
        tombstonedAtMs: {},
        assetStamps: {},
      };
      this.lastError = null;
      this.phase = 'idle';
      this.writeState();
      this.startTimers();
      this.emit();
    } catch (err) {
      this.fail(err);
    }
    await this.syncNow();
    return this.status();
  }

  /**
   * Mints a one-time code and returns the URI to put in a QR code, with the
   * content key appended as a fragment. A fragment is never transmitted, which
   * is what lets one code carry both halves while the relay only receives one.
   */
  async mintPairing(): Promise<PairingTicket> {
    const s = this.requireState();
    const secrets = this.secrets();
    if (!secrets.rootToken) {
      throw new Error('Only the device that created this sync root can pair another device');
    }
    try {
      const minted = await this.client().mintEnrollment(this.ref(), secrets.rootToken);
      const base = minted.pairingUri ?? buildPairingUri(s.serverUrl, minted.code);
      // A new peer starts with an empty vault and cannot rebuild state from a
      // feed it was not present for, so the vault has to be on the relay before
      // the code is in anyone's hands. A failure here is not worth withholding
      // the code over — the snapshot can be republished from Settings.
      await this.syncNow({ snapshot: true }).catch(() => {});
      return {
        code: minted.code,
        displayCode: formatEnrollmentCode(minted.code),
        expiresAtMs: minted.expiresAtMs,
        uri: withContentKey(base, secrets.contentKey),
        uriIsLocal: minted.pairingUri === null,
      };
    } catch (err) {
      this.fail(err);
    }
  }

  async listDevices(): Promise<SyncDeviceInfo[]> {
    const s = this.requireState();
    const secrets = this.secrets();
    if (!secrets.rootToken) throw new Error('Only the device that created this sync root can list its devices');
    try {
      const devices = await this.client().listDevices(this.ref(), secrets.rootToken);
      return devices.map((d) => ({ ...d, isThisDevice: d.deviceId === s.deviceId }));
    } catch (err) {
      this.fail(err);
    }
  }

  async revokeDevice(deviceId: string): Promise<SyncDeviceInfo[]> {
    const s = this.requireState();
    const secrets = this.secrets();
    if (!secrets.rootToken) throw new Error('Only the device that created this sync root can revoke a device');
    if (deviceId === s.deviceId) throw new Error('A device cannot revoke itself');
    try {
      await this.client().revokeDevice(this.ref(), secrets.rootToken, deviceId);
    } catch (err) {
      this.fail(err);
    }
    return this.listDevices();
  }

  /**
   * Forgets the root locally. Notes are untouched; other devices keep syncing
   * with each other. Revoking this device from another one is a separate act,
   * and the one that actually stops it talking to the relay.
   */
  disconnect(): SyncStatus {
    const s = this.state;
    this.stopTimers();
    if (s) {
      forgetSecrets(deviceKey(s.appId, s.rootId, s.deviceId));
      try {
        rmSync(this.stateFile(), { force: true });
      } catch {
        // A leftover state file is harmless: without credentials it cannot sync.
      }
    }
    this.state = null;
    this.phase = 'off';
    this.lastError = null;
    this.retryAtMs = null;
    this.pendingPaths = 0;
    this.oversize = [];
    this.relayRejected.clear();
    this.emit();
    return this.status();
  }

  setEnabled(enabled: boolean): SyncStatus {
    const s = this.requireState();
    s.enabled = enabled;
    this.writeState();
    if (enabled) {
      this.startTimers();
      void this.syncNow().catch(() => {});
    } else {
      this.stopTimers();
      this.phase = 'idle';
    }
    this.emit();
    return this.status();
  }

  // ---------- scheduling ----------

  private startTimers(): void {
    this.stopTimers();
    this.pollTimer = setInterval(() => void this.syncNow().catch(() => {}), 60_000);
  }

  private stopTimers(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.pollTimer = null;
    this.debounceTimer = null;
  }

  /**
   * Called whenever the vault changes. Counting what is pending means hashing
   * every note, so it waits for the burst of edits to settle rather than
   * running on each one.
   */
  scheduleSync(): void {
    if (!this.state) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      if (this.state?.enabled) {
        void this.syncNow().catch(() => {});
      } else {
        void this.refreshPending().then(() => this.emit());
      }
    }, 4000);
  }

  dispose(): void {
    this.stopTimers();
  }

  // ---------- the pass ----------

  async syncNow(opts: { snapshot?: boolean } = {}): Promise<SyncStatus> {
    if (!this.state) return this.status();
    if (this.running) {
      this.rerun = true;
      return this.status();
    }
    if (this.retryAtMs && Date.now() < this.retryAtMs && !opts.snapshot) return this.status();

    this.running = true;
    this.phase = 'syncing';
    this.emit();
    try {
      this.passWarning = null;
      await this.pull();
      await this.push(opts.snapshot === true);
      this.state.lastSyncMs = Date.now();
      this.lastError = this.passWarning;
      this.retryAtMs = null;
      this.phase = 'idle';
      this.writeState();
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.phase = 'error';
      if (err instanceof GeshError) {
        if (err.retryAfterMs !== null) this.retryAtMs = Date.now() + err.retryAfterMs;
        // A rejected credential will not start working on a timer, and retrying
        // it every minute only earns a lockout.
        if (err.status === 401 && this.state) {
          this.state.enabled = false;
          this.stopTimers();
          this.writeState();
        }
      }
      this.writeState();
    } finally {
      this.running = false;
      await this.refreshPending();
      this.emit();
    }

    if (this.rerun) {
      this.rerun = false;
      return this.syncNow();
    }
    return this.status();
  }

  // ---------- pulling ----------

  private async pull(): Promise<void> {
    const s = this.requireState();
    const secrets = this.secrets();
    const key = await contentKeyFromBase64Url(secrets.contentKey);
    const client = this.client();

    for (;;) {
      const page = await client.listEvents(this.ref(), secrets.deviceToken, {
        after: s.cursor,
        limit: PAGE_LIMIT,
      });
      if (page.events.length === 0) return;

      let applied = s.cursor;
      for (const meta of page.events) {
        if (meta.deviceId === s.deviceId) {
          // Our own upload coming back around. Nothing to apply, and the relay
          // never requires a device to acknowledge its own events — but the
          // cursor still has to move past it.
          applied = meta.cursor;
          continue;
        }
        const blob = await client.getEvent(this.ref(), meta.deviceId, meta.eventId, secrets.deviceToken);
        if (blob === null) {
          // Already erased between listing and fetching. Nothing to recover.
          applied = meta.cursor;
          continue;
        }
        let event: SyncEvent;
        try {
          event = decodeEvent(await openEvent(key, blob));
        } catch (err) {
          // One unreadable event must not wedge the feed forever: record it and
          // carry on, or this device never catches up.
          console.error(`skald: skipping unreadable sync event ${meta.eventId}`, err);
          this.passWarning =
            err instanceof PayloadError
              ? `Skipped an event Skald could not read: ${err.message}`
              : 'Skipped an event Skald could not decrypt — check that both devices share a content key';
          applied = meta.cursor;
          continue;
        }
        await this.applyEvent(event, meta.deviceId);
        applied = meta.cursor;
      }

      if (applied <= s.cursor) {
        // The relay handed back a page that does not move the cursor forward.
        // Continuing would loop on the same page for as long as the app runs.
        this.passWarning = 'The sync server returned a feed page that did not advance';
        return;
      }
      s.cursor = applied;
      this.writeState();
      // Acknowledge only now: every op in this page is on disk, so the relay is
      // free to erase what it was holding for us.
      await client.ack(this.ref(), s.deviceId, secrets.deviceToken, s.cursor);

      if (page.nextCursor === null || page.events.length < PAGE_LIMIT) return;
    }
  }

  private async applyEvent(event: SyncEvent, sender: string): Promise<void> {
    const s = this.requireState();
    for (const op of event.payload.ops) {
      const isNote = isNotePath(op.path);
      const localRaw = isNote ? this.vault.syncRead(op.path) : null;
      const localHash = await this.localHashOf(op.path);
      const decision = decideMerge({
        incoming: op,
        incomingWriter: event.payload.device || sender,
        known: s.files[op.path] ?? null,
        localHash,
        localDeviceId: s.deviceId,
      });

      if (decision.action === 'apply') {
        if (decision.preserveLocal && isNote && localRaw !== null) {
          // The local edit is about to lose. Park it in the note's own history
          // so it is recoverable from the editor rather than gone.
          await this.vault.captureVersion(op.path, 'sync');
        }
        if (op.op === 'put') {
          if ((await sha256Hex(utf8Encode(op.content))) !== op.hash) {
            this.passWarning = `Skipped ${op.path}: it did not match the hash the sending device gave it`;
            continue;
          }
          await this.vault.syncWrite(op.path, op.content);
        } else if (op.op === 'putBin') {
          if ((await sha256Hex(event.body)) !== op.hash) {
            this.passWarning = `Skipped ${op.path}: it did not match the hash the sending device gave it`;
            continue;
          }
          await this.vault.syncWriteAsset(op.path, event.body);
          // Force the next diff to re-stat this file rather than trust a stamp
          // taken before the write.
          delete s.assetStamps[op.path];
        } else if (isNote) {
          await this.vault.syncDelete(op.path);
        } else {
          await this.vault.syncDeleteAsset(op.path);
          delete s.assetStamps[op.path];
        }
      }
      if (decision.record) {
        s.files[op.path] = decision.record;
        if (decision.record.hash === ABSENT) s.tombstonedAtMs[op.path] = Date.now();
        else delete s.tombstonedAtMs[op.path];
      }
    }
    this.writeState();
  }

  /** Hash of whatever is on disk at that path right now, notes and attachments alike. */
  private async localHashOf(path: string): Promise<string> {
    if (isNotePath(path)) {
      const raw = this.vault.syncRead(path);
      return raw === null ? ABSENT : sha256Hex(utf8Encode(raw));
    }
    const bytes = await this.vault.syncReadAsset(path);
    return bytes === null ? ABSENT : sha256Hex(bytes);
  }

  // ---------- pushing ----------

  /**
   * Hashing an attachment means reading all of it, so a file whose size and
   * modification time are unchanged is taken at its recorded word. This is the
   * difference between a vault with photographs in it syncing quietly and
   * re-reading every one of them on each pass.
   */
  private async assetHash(path: string, size: number, mtimeMs: number): Promise<string | null> {
    const s = this.requireState();
    const stamp = s.assetStamps[path];
    if (stamp && stamp.size === size && stamp.mtimeMs === mtimeMs) return stamp.hash;
    const bytes = await this.vault.syncReadAsset(path);
    if (!bytes) return null;
    const hash = await sha256Hex(bytes);
    s.assetStamps[path] = { size, mtimeMs, hash };
    return hash;
  }

  /**
   * What this device would publish right now. Notes and deletions batch into
   * shared events; attachments get one event each, because their bytes are the
   * event body rather than a field in it.
   */
  private async localOps(full: boolean): Promise<{ text: FileOp[]; assets: PutBinOp[]; oversize: string[] }> {
    const s = this.requireState();
    const now = Date.now();
    const text: FileOp[] = [];
    const assets: PutBinOp[] = [];
    const oversize: string[] = [];
    const seen = new Set<string>();

    for (const file of this.vault.syncFiles()) {
      seen.add(file.path);
      const hash = await sha256Hex(utf8Encode(file.raw));
      const known = s.files[file.path] ?? null;
      if (!full && known?.hash === hash) continue;
      text.push({
        op: 'put',
        path: file.path,
        rev: known?.hash === hash ? known.rev : nextRev(known),
        ts: now,
        content: file.raw,
        hash,
      });
    }

    for (const asset of await this.vault.syncAssets()) {
      if (!isAttachmentPath(asset.path)) continue;
      // Counted as seen either way: a file too large to send has not been
      // deleted, and must not be published as one.
      seen.add(asset.path);
      if (asset.size > MAX_ATTACHMENT_BYTES) {
        oversize.push(asset.path);
        continue;
      }
      const hash = await this.assetHash(asset.path, asset.size, asset.mtimeMs);
      if (hash === null) continue;
      const known = s.files[asset.path] ?? null;
      if (!full && known?.hash === hash) continue;
      assets.push({
        op: 'putBin',
        path: asset.path,
        rev: known?.hash === hash ? known.rev : nextRev(known),
        ts: now,
        hash,
        size: asset.size,
      });
    }

    // Anything we had agreed on that is no longer on disk has been deleted here.
    for (const [path, state] of Object.entries(s.files)) {
      if (seen.has(path) || state.hash === ABSENT) continue;
      text.push({ op: 'del', path, rev: nextRev(state), ts: now });
    }
    return { text, assets, oversize };
  }

  private async push(full: boolean): Promise<void> {
    const s = this.requireState();
    const { text, assets, oversize } = await this.localOps(full);
    this.oversize = this.composeOversize(oversize);
    if (text.length === 0 && assets.length === 0) return;

    const secrets = this.secrets();
    const key = await contentKeyFromBase64Url(secrets.contentKey);
    const client = this.client();

    /** A snapshot republishes unchanged files at the revision they already hold.
     *  Claiming authorship of those would change the tiebreak this device
     *  applies without changing it anywhere else, and two devices would stop
     *  agreeing on who wins. */
    const record = (path: string, hash: string, rev: number): void => {
      const known = s.files[path];
      const unchanged = known?.hash === hash && known.rev === rev;
      s.files[path] = { hash, rev, writer: unchanged ? known.writer : s.deviceId };
      delete s.tombstonedAtMs[path];
    };

    for (const batch of batchOps(text)) {
      const sealed = await sealEvent(
        key,
        encodeEvent({ v: 1, kind: full ? 'snapshot' : 'delta', device: s.deviceId, ts: Date.now(), ops: batch })
      );
      // A 409 means this event id already landed, which on a retry is success.
      await client.putEvent(this.ref(), s.deviceId, newEventId(), sealed, secrets.deviceToken);

      // Only record what actually shipped, so a failure part-way through a large
      // vault leaves the rest to be retried rather than silently forgotten.
      for (const op of batch) {
        if (op.op === 'del') {
          s.files[op.path] = { hash: ABSENT, rev: op.rev, writer: s.deviceId };
          s.tombstonedAtMs[op.path] = Date.now();
        } else if (op.op === 'put') {
          record(op.path, op.hash, op.rev);
        }
      }
      this.writeState();
    }

    for (const op of assets) {
      const bytes = await this.vault.syncReadAsset(op.path);
      // Deleted or rewritten since it was listed. Either way the next pass sees
      // the truth; publishing this one now would publish a lie.
      if (!bytes || bytes.length !== op.size) continue;
      if ((await sha256Hex(bytes)) !== op.hash) continue;

      const sealed = await sealEvent(
        key,
        encodeEvent({ v: 1, kind: 'blob', device: s.deviceId, ts: Date.now(), ops: [op] }, bytes)
      );
      try {
        await client.putEvent(this.ref(), s.deviceId, newEventId(), sealed, secrets.deviceToken);
      } catch (err) {
        if (err instanceof GeshError && err.status === 413) {
          // This relay's limit is lower than the one Skald assumes. Report the
          // file rather than failing the whole pass over it.
          this.relayRejected.add(op.path);
          this.oversize = this.composeOversize(this.oversize);
          continue;
        }
        throw err;
      }
      this.relayRejected.delete(op.path);
      record(op.path, op.hash, op.rev);
      this.writeState();
    }
  }

  /** Publishes the whole vault, for a device that has been away past the relay's retention. */
  async pushSnapshot(): Promise<SyncStatus> {
    return this.syncNow({ snapshot: true });
  }

  /** Files Skald refused to send, plus files this relay refused to take. */
  private composeOversize(local: string[]): string[] {
    return [...new Set([...local, ...this.relayRejected])].sort();
  }

  private async refreshPending(): Promise<void> {
    if (!this.state) {
      this.pendingPaths = 0;
      return;
    }
    try {
      const { text, assets, oversize } = await this.localOps(false);
      this.pendingPaths = text.length + assets.length;
      this.oversize = this.composeOversize(oversize);
    } catch {
      this.pendingPaths = 0;
    }
  }
}

/**
 * Splits ops into events that stay under the relay's body limit. A single note
 * larger than the limit is left in its own batch: it will fail with a 413 the
 * user can act on, rather than being silently dropped.
 */
export function batchOps(ops: FileOp[], maxBytes = MAX_EVENT_BYTES): FileOp[][] {
  const batches: FileOp[][] = [];
  let current: FileOp[] = [];
  let size = 0;
  for (const op of ops) {
    const cost = op.op === 'put' ? op.content.length + op.path.length + 200 : op.path.length + 120;
    if (current.length > 0 && size + cost > maxBytes) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(op);
    size += cost;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** True when a vault folder already carries sync state, before an engine is built. */
export function vaultHasSyncState(vaultPath: string): boolean {
  return existsSync(join(vaultPath, '.skald', 'sync.json'));
}
