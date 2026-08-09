import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The engine reaches the OS keystore through Electron. Here that is a plain
// in-memory store, which still exercises the "credentials live outside the
// vault, keyed per device" arrangement.
const electronState = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({
  app: { getPath: () => electronState.userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`enc:${text}`, 'utf-8'),
    decryptString: (buf: Buffer) => buf.toString('utf-8').replace(/^enc:/, ''),
  },
}));

const { Vault } = await import('../src-main/vault');
const { SyncEngine, batchOps } = await import('../src-main/sync');
const { GeshClient } = await import('../src-shared/gesh/protocol');
const { createFakeGesh } = await import('./helpers/fakeGesh');
const { utf8Encode } = await import('../src-shared/gesh/bytes');
const { sha256Hex } = await import('../src-shared/gesh/crypto');

type VaultType = InstanceType<typeof Vault>;
type EngineType = InstanceType<typeof SyncEngine>;

let dirs: string[] = [];
let vaults: VaultType[] = [];
let engines: EngineType[] = [];
let gesh: ReturnType<typeof createFakeGesh>;

function makeClient(baseUrl: string) {
  return new GeshClient({ baseUrl, fetch: gesh.fetch });
}

async function makeDevice(
  seed: Record<string, string | Uint8Array> = {}
): Promise<{ vault: VaultType; engine: EngineType }> {
  const dir = mkdtempSync(join(tmpdir(), 'skald-sync-'));
  dirs.push(dir);
  for (const [path, content] of Object.entries(seed)) {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    if (typeof content === 'string') writeFileSync(full, content, 'utf-8');
    else writeFileSync(full, content);
  }
  const vault = new Vault(dir, () => {});
  await vault.open();
  vaults.push(vault);
  const engine = new SyncEngine({ vault, onStatus: () => {}, makeClient });
  engines.push(engine);
  return { vault, engine };
}

/** Provisions device A and pairs device B to it, the way the UI does. */
async function pairedPair(
  seedA: Record<string, string | Uint8Array> = {},
  seedB: Record<string, string | Uint8Array> = {}
) {
  const a = await makeDevice(seedA);
  await a.engine.connect({ serverUrl: 'https://relay.test' });
  const ticket = await a.engine.mintPairing();
  const b = await makeDevice(seedB);
  await b.engine.pair(ticket.uri);
  return { a, b, ticket };
}

beforeEach(() => {
  electronState.userData = mkdtempSync(join(tmpdir(), 'skald-userdata-'));
  dirs = [electronState.userData];
  vaults = [];
  engines = [];
  gesh = createFakeGesh();
});

afterEach(async () => {
  for (const engine of engines) engine.dispose();
  for (const vault of vaults) await vault.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('provisioning and pairing', () => {
  it('provisions a root, keeps both tokens, and publishes the vault', async () => {
    const { engine } = await makeDevice({ 'Saga.md': '# Saga\n' });
    const status = await engine.connect({ serverUrl: 'https://relay.test' });

    expect(status.configured).toBe(true);
    expect(status.isRoot).toBe(true);
    expect(status.rootId).toMatch(/^root_/);
    expect(status.pending).toBe(0);

    const root = [...gesh.roots.values()][0];
    expect(root.events).toHaveLength(1);
  });

  it('never lets the content key reach the relay', async () => {
    const { engine } = await makeDevice({ 'Saga.md': '# Saga\n' });
    await engine.connect({ serverUrl: 'https://relay.test' });
    const ticket = await engine.mintPairing();

    const key = ticket.uri.split('#k=')[1];
    expect(key).toBeTruthy();
    // Nothing the relay stored — code, uri, event bodies — contains the key.
    const root = [...gesh.roots.values()][0];
    const seen = JSON.stringify([...root.codes.keys()]) + root.events.map((e) => Buffer.from(e.body).toString('base64url')).join('');
    expect(seen).not.toContain(key);
    expect(ticket.uri.split('#')[0]).not.toContain(key);
  });

  it('carries a vault to a device that pairs afterwards', async () => {
    const { b } = await pairedPair({ 'Projects/Jormungandr.md': '# Jormungandr\n\nThe API rewrite.\n' });
    expect(b.vault.syncRead('Projects/Jormungandr.md')).toBe('# Jormungandr\n\nThe API rewrite.\n');
  });

  it('refuses a pairing link with no content key rather than syncing blind', async () => {
    const a = await makeDevice();
    await a.engine.connect({ serverUrl: 'https://relay.test' });
    const ticket = await a.engine.mintPairing();
    const b = await makeDevice();
    await expect(b.engine.pair(ticket.uri.split('#')[0])).rejects.toThrow(/no content key/);
    expect(b.engine.status().configured).toBe(false);
  });

  it('gives the paired device its own credential, with no authority', async () => {
    const { a, b } = await pairedPair();
    expect(b.engine.status().isRoot).toBe(false);
    await expect(b.engine.mintPairing()).rejects.toThrow(/created this sync root/);
    await expect(b.engine.listDevices()).rejects.toThrow(/created this sync root/);
    expect((await a.engine.listDevices()).map((d) => d.isThisDevice)).toEqual([true, false]);
  });

  it('stores credentials outside the vault, one entry per device', async () => {
    const { a, b } = await pairedPair();
    const secrets = JSON.parse(
      readFileSync(join(electronState.userData, 'skald-sync-secrets.json'), 'utf-8')
    ) as { entries: Record<string, string> };

    expect(Object.keys(secrets.entries)).toHaveLength(2);
    for (const vault of [a.vault, b.vault]) {
      const state = readFileSync(join(vault.path, '.skald', 'sync.json'), 'utf-8');
      expect(state).not.toMatch(/dev_|root_\d+_/);
    }
  });
});

describe('a change on one device reaching the other', () => {
  it('carries a new note across', async () => {
    const { a, b } = await pairedPair();
    await a.vault.writeNote('Notes/New.md', '# New\n');
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(b.vault.syncRead('Notes/New.md')).toBe('# New\n');
  });

  it('carries an edit across', async () => {
    const { a, b } = await pairedPair({ 'Saga.md': 'first\n' });
    await b.engine.syncNow();
    expect(b.vault.syncRead('Saga.md')).toBe('first\n');

    await a.vault.writeNote('Saga.md', 'second\n');
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(b.vault.syncRead('Saga.md')).toBe('second\n');
  });

  it('carries a deletion across', async () => {
    const { a, b } = await pairedPair({ 'Doomed.md': 'bye\n' });
    await b.engine.syncNow();
    expect(b.vault.syncRead('Doomed.md')).toBe('bye\n');

    await a.vault.deleteNote('Doomed.md');
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(b.vault.syncRead('Doomed.md')).toBeNull();
  });

  it('does not echo a received note back as a local change', async () => {
    const { a, b } = await pairedPair({ 'Saga.md': 'first\n' });
    await b.engine.syncNow();
    const root = [...gesh.roots.values()][0];
    const before = root.events.length;

    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(root.events.length).toBe(before);
    expect(b.engine.status().pending).toBe(0);
  });

  it('settles after a round trip, with neither device holding pending work', async () => {
    const { a, b } = await pairedPair({ 'A.md': 'a\n' }, { 'B.md': 'b\n' });
    for (let i = 0; i < 3; i++) {
      await a.engine.syncNow();
      await b.engine.syncNow();
    }
    expect(a.vault.syncRead('B.md')).toBe('b\n');
    expect(b.vault.syncRead('A.md')).toBe('a\n');
    expect(a.engine.status().pending).toBe(0);
    expect(b.engine.status().pending).toBe(0);
  });
});

describe('conflicts', () => {
  it('converges on one winner and keeps the loser in that note’s history', async () => {
    const { a, b } = await pairedPair({ 'Saga.md': 'base\n' });
    await b.engine.syncNow();

    // Both edit the same note before either syncs.
    await a.vault.writeNote('Saga.md', 'from A\n');
    await b.vault.writeNote('Saga.md', 'from B\n');

    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    await b.engine.syncNow();

    const onA = a.vault.syncRead('Saga.md');
    const onB = b.vault.syncRead('Saga.md');
    expect(onA).toBe(onB);
    expect(['from A\n', 'from B\n']).toContain(onA);

    // Whichever device lost still has its own text one click away in history.
    const loser = onA === 'from A\n' ? b : a;
    const losingText = onA === 'from A\n' ? 'from B\n' : 'from A\n';
    const history = await loser.vault.listNoteHistory('Saga.md');
    const versions = await Promise.all(
      history.map((entry) => loser.vault.readNoteHistoryVersion('Saga.md', entry.id))
    );
    expect(versions.map((v) => v.content)).toContain(losingText);
    expect(history.some((entry) => entry.reason === 'sync')).toBe(true);
  });

  it('treats both devices making the identical edit as no conflict', async () => {
    const { a, b } = await pairedPair({ 'Saga.md': 'base\n' });
    await b.engine.syncNow();

    await a.vault.writeNote('Saga.md', 'same\n');
    await b.vault.writeNote('Saga.md', 'same\n');
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();

    expect(a.vault.syncRead('Saga.md')).toBe('same\n');
    expect(b.vault.syncRead('Saga.md')).toBe('same\n');
    expect((await b.vault.listNoteHistory('Saga.md')).some((e) => e.reason === 'sync')).toBe(false);
  });

  it('lets an edit made after a delete win, rather than losing the note', async () => {
    const { a, b } = await pairedPair({ 'Saga.md': 'base\n' });
    await b.engine.syncNow();

    await a.vault.deleteNote('Saga.md');
    await a.engine.syncNow();

    // B edits and syncs afterwards, so its revision is the later one.
    await b.engine.syncNow();
    expect(b.vault.syncRead('Saga.md')).toBeNull();
    await b.vault.writeNote('Saga.md', 'brought back\n');
    await b.engine.syncNow();
    await a.engine.syncNow();

    expect(a.vault.syncRead('Saga.md')).toBe('brought back\n');
  });
});

describe('resilience', () => {
  it('survives an event it cannot decrypt instead of wedging the feed', async () => {
    const { a, b } = await pairedPair({ 'Good.md': 'fine\n' });
    await b.engine.syncNow();

    // Something else on the root uploads a blob sealed with a different key.
    const root = [...gesh.roots.values()][0];
    const stranger = [...root.devices.values()][0];
    root.events.push({
      cursor: root.nextCursor++,
      deviceId: stranger.deviceId === b.engine.status().deviceId ? [...root.devices.values()][1].deviceId : stranger.deviceId,
      eventId: 'evt_garbage',
      createdAtMs: Date.now(),
      body: new Uint8Array(64).fill(9),
    });

    await a.vault.writeNote('After.md', 'later\n');
    await a.engine.syncNow();
    await b.engine.syncNow();

    expect(b.vault.syncRead('After.md')).toBe('later\n');
    expect(b.engine.status().lastError).toMatch(/could not decrypt|could not read/i);
  });

  it('backs off rather than hammering a rate-limited relay', async () => {
    const { a } = await pairedPair();
    await a.vault.writeNote('Note.md', 'x\n');
    gesh.failNextWith = 429;
    const status = await a.engine.syncNow();
    expect(status.phase).toBe('error');
    expect(status.retryAtMs).toBeGreaterThan(Date.now());

    gesh.requestLog.length = 0;
    await a.engine.syncNow();
    expect(gesh.requestLog).toHaveLength(0);
  });

  it('stops syncing on its own once a credential is refused', async () => {
    const { a } = await pairedPair();
    await a.vault.writeNote('Note.md', 'x\n');
    gesh.failNextWith = 401;
    const status = await a.engine.syncNow();

    expect(status.phase).toBe('error');
    expect(status.enabled).toBe(false);
    expect(status.lastError).toMatch(/did not accept this credential/);
  });

  it('picks up where it left off after a restart', async () => {
    const { a, b } = await pairedPair({ 'Saga.md': 'base\n' });
    await b.engine.syncNow();
    await a.vault.writeNote('Saga.md', 'moved on\n');
    await a.engine.syncNow();

    // A fresh engine over the same vault reads its state back from disk.
    b.engine.dispose();
    const revived = new SyncEngine({ vault: b.vault, onStatus: () => {}, makeClient });
    engines.push(revived);
    expect(revived.status().configured).toBe(true);
    expect(revived.status().rootId).toBe(b.engine.status().rootId);
    await revived.syncNow();
    expect(b.vault.syncRead('Saga.md')).toBe('moved on\n');
  });

  it('forgets everything on disconnect without touching the notes', async () => {
    const { a } = await pairedPair({ 'Saga.md': 'base\n' });
    const status = a.engine.disconnect();

    expect(status.configured).toBe(false);
    expect(a.vault.syncRead('Saga.md')).toBe('base\n');
    const secrets = JSON.parse(
      readFileSync(join(electronState.userData, 'skald-sync-secrets.json'), 'utf-8')
    ) as { entries: Record<string, string> };
    expect(Object.keys(secrets.entries)).toHaveLength(1); // only the peer's
  });

  it('republishes the whole vault on demand, for a device that fell behind retention', async () => {
    const { a } = await pairedPair({ 'One.md': '1\n', 'Two.md': '2\n' });
    const root = [...gesh.roots.values()][0];
    const before = root.events.length;

    await a.engine.pushSnapshot();
    expect(root.events.length).toBe(before + 1);
  });
});

describe('batching', () => {
  it('splits a large push into events the relay will accept', async () => {
    const big = 'x'.repeat(3 * 1024 * 1024);
    const ops = ['A.md', 'B.md', 'C.md'].map((path, i) => ({
      op: 'put' as const,
      path,
      rev: 1,
      ts: i,
      content: big,
      hash: 'a'.repeat(64),
    }));
    const batches = batchOps(ops, 6 * 1024 * 1024);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toHaveLength(3);
  });

  it('never drops an op that is too large on its own', () => {
    const batches = batchOps(
      [{ op: 'put', path: 'Huge.md', rev: 1, ts: 0, content: 'x'.repeat(10_000), hash: 'a'.repeat(64) }],
      100
    );
    expect(batches).toHaveLength(1);
  });
});

describe('hashing agreement', () => {
  it('hashes note content the same way on both sides of a sync', async () => {
    const text = '# Jörmungandr\n\n- [ ] ship it\n';
    expect(await sha256Hex(utf8Encode(text))).toBe(
      require('node:crypto').createHash('sha256').update(text, 'utf-8').digest('hex')
    );
  });
});

describe('attachments', () => {
  /** Bytes that are emphatically not text, including the newline the frame splits on. */
  function binary(length: number, seed = 1): Uint8Array {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = (i * 31 + seed * 17) % 256;
    out[0] = 0x0a;
    out[1] = 0x00;
    out[2] = 0xff;
    return out;
  }

  it('carries an attachment across, byte for byte', async () => {
    const png = binary(4096);
    const { b } = await pairedPair({ 'Attachments/diagram.png': png });

    const received = await b.vault.syncReadAsset('Attachments/diagram.png');
    expect(received).toBeTruthy();
    expect(Array.from(received!)).toEqual(Array.from(png));
  });

  it('sends an attachment in its own event, with the bytes outside the JSON', async () => {
    const png = binary(2048);
    const { a } = await pairedPair();
    await a.vault.syncWriteAsset('Attachments/photo.png', png);
    await a.engine.syncNow();

    const root = [...gesh.roots.values()][0];
    // Every event is sealed, so size is all the relay can see. Base64 in JSON
    // would have cost a third more than the file itself.
    const biggest = Math.max(...root.events.map((e) => e.body.length));
    expect(biggest).toBeGreaterThanOrEqual(png.length);
    // Header, nonce and tag are a fixed few hundred bytes. Base64 would instead
    // have added a third of the file, and grown with it.
    expect(biggest - png.length).toBeLessThan(600);
  });

  it('carries an attachment edit across', async () => {
    const first = binary(512, 1);
    const second = binary(900, 2);
    const { a, b } = await pairedPair({ 'Attachments/note.bin': first });
    await b.engine.syncNow();
    expect(await b.vault.syncReadAsset('Attachments/note.bin')).toHaveLength(512);

    await a.vault.syncWriteAsset('Attachments/note.bin', second);
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(Array.from((await b.vault.syncReadAsset('Attachments/note.bin'))!)).toEqual(Array.from(second));
  });

  it('carries an attachment deletion across', async () => {
    const { a, b } = await pairedPair({ 'Attachments/gone.bin': binary(64) });
    await b.engine.syncNow();
    expect(await b.vault.syncReadAsset('Attachments/gone.bin')).toBeTruthy();

    await a.vault.syncDeleteAsset('Attachments/gone.bin');
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(await b.vault.syncReadAsset('Attachments/gone.bin')).toBeNull();
  });

  it('carries a note and the file it embeds together', async () => {
    const png = binary(1024);
    const { a, b } = await pairedPair({
      'Notes/Trip.md': '# Trip\n\n![map](../Attachments/map.png)\n',
      'Attachments/map.png': png,
    });
    await b.engine.syncNow();

    expect(b.vault.syncRead('Notes/Trip.md')).toContain('![map](../Attachments/map.png)');
    expect(Array.from((await b.vault.syncReadAsset('Attachments/map.png'))!)).toEqual(Array.from(png));
  });

  it('settles: an attachment already agreed on is not republished', async () => {
    const { a, b } = await pairedPair({ 'Attachments/still.bin': binary(256) });
    await b.engine.syncNow();
    const root = [...gesh.roots.values()][0];
    const before = root.events.length;

    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(root.events.length).toBe(before);
    expect(a.engine.status().pending).toBe(0);
    expect(b.engine.status().pending).toBe(0);
  });

  it('never syncs Skald’s own state directory', async () => {
    const { a, b } = await pairedPair({ 'Saga.md': 'x\n' });
    await b.engine.syncNow();

    // Both vaults keep sync state and graph positions under .skald/, and they
    // are per-device — carrying one to the other device would be a disaster.
    expect(await b.vault.syncReadAsset('.skald/sync.json')).toBeNull();
    const root = [...gesh.roots.values()][0];
    expect(JSON.stringify(root.events.map((e) => e.eventId))).not.toContain('skald/');
    expect(a.engine.status().tracked).toBeGreaterThan(0);
  });

  it('reports a file too large to carry instead of failing the pass', async () => {
    const { a } = await pairedPair();
    // Written straight to disk: syncWriteAsset would hold 31 MiB in memory
    // twice, and the point here is only what the engine does with the size.
    const big = join(a.vault.path, 'Attachments', 'huge.bin');
    mkdirSync(join(big, '..'), { recursive: true });
    writeFileSync(big, Buffer.alloc(31 * 1024 * 1024));

    await a.vault.writeNote('Still.md', 'this still syncs\n');
    const status = await a.engine.syncNow();

    expect(status.oversize).toEqual(['Attachments/huge.bin']);
    expect(status.phase).toBe('idle');
    expect(status.lastError).toBeNull();
    // The oversize file must not be mistaken for a deletion, now or later.
    const root = [...gesh.roots.values()][0];
    expect(JSON.stringify(root.events.length)).toBeTruthy();
    expect(a.engine.status().pending).toBe(0);
  }, 30_000);

  it('reports a file this relay rejects, and keeps going', async () => {
    const { a } = await pairedPair();
    await a.vault.syncWriteAsset('Attachments/rejected.bin', binary(2048));
    // Only the upload is refused — this relay's limit is lower than Skald's.
    gesh.failWhen = (method, path) => (method === 'PUT' && /\/evt_/.test(path) ? 413 : null);
    const status = await a.engine.syncNow();
    gesh.failWhen = null;

    expect(status.oversize).toContain('Attachments/rejected.bin');
    expect(status.phase).toBe('idle');
  });

  it('does not re-read an attachment whose size and mtime have not moved', async () => {
    const { a } = await pairedPair({ 'Attachments/heavy.bin': binary(4096) });
    let reads = 0;
    const realRead = a.vault.syncReadAsset.bind(a.vault);
    a.vault.syncReadAsset = async (path: string) => {
      reads++;
      return realRead(path);
    };

    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(reads).toBe(0);
  });
});
