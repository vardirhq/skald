// What Skald actually puts inside a GESH event, and the validation that runs on
// everything that comes back out.
//
// GESH orders events; it does not merge them and it cannot vouch for them. A
// compromised or merely buggy relay can withhold, reorder or replay, so a
// decrypted payload is treated as hostile input until every field has been
// checked — including the paths, which become filenames inside someone's vault.

import { utf8Decode, utf8Encode } from '../gesh/bytes';

export const SYNC_PAYLOAD_VERSION = 1;

/** A `delta` carries what changed; a `snapshot` carries the whole vault. */
export type SyncEventKind = 'delta' | 'snapshot';

export interface PutOp {
  op: 'put';
  path: string;
  /** Logical clock for the path — monotonic per path, not a wall clock. */
  rev: number;
  /** The writing device's own clock, for display only. Never used for ordering. */
  ts: number;
  content: string;
  /** SHA-256 of the UTF-8 content, so a receiver can detect a mangled payload. */
  hash: string;
}

export interface DeleteOp {
  op: 'del';
  path: string;
  rev: number;
  ts: number;
}

export type FileOp = PutOp | DeleteOp;

export interface SyncPayload {
  v: typeof SYNC_PAYLOAD_VERSION;
  kind: SyncEventKind;
  /** The device that wrote this event; also the tiebreak in conflict resolution. */
  device: string;
  ts: number;
  ops: FileOp[];
}

export class PayloadError extends Error {}

const CONTROL_OR_RESERVED = /[\u0000-\u001f<>:"|?*]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/**
 * A path is only acceptable if it is a plain vault-relative Markdown path.
 * Anything that could escape the vault, hide inside `.skald/`, or land on a
 * reserved Windows name is refused before it can reach the filesystem.
 */
export function isSyncablePath(path: string): boolean {
  if (typeof path !== 'string' || !path || path.length > 400) return false;
  if (path !== path.normalize('NFC')) return false;
  if (path.includes('\\') || path.startsWith('/') || path.includes('//')) return false;
  if (CONTROL_OR_RESERVED.test(path)) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  if (!/\.md$/i.test(path)) return false;
  const segments = path.split('/');
  return segments.every(
    (seg) =>
      seg.length > 0 &&
      seg !== '.' &&
      seg !== '..' &&
      !seg.startsWith('.') &&
      seg === seg.trim() &&
      !seg.endsWith('.') &&
      !WINDOWS_RESERVED.test(seg)
  );
}

function isRev(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseOp(raw: unknown, index: number): FileOp {
  const o = (raw ?? {}) as Record<string, unknown>;
  const where = `operation ${index + 1}`;
  if (!isSyncablePath(o['path'] as string)) throw new PayloadError(`${where} names a path Skald will not write`);
  if (!isRev(o['rev'])) throw new PayloadError(`${where} has no usable revision`);
  if (!isTimestamp(o['ts'])) throw new PayloadError(`${where} has no usable timestamp`);
  const path = o['path'] as string;

  if (o['op'] === 'del') return { op: 'del', path, rev: o['rev'], ts: o['ts'] };
  if (o['op'] === 'put') {
    if (typeof o['content'] !== 'string') throw new PayloadError(`${where} carries no content`);
    if (typeof o['hash'] !== 'string' || !/^[0-9a-f]{64}$/.test(o['hash'])) {
      throw new PayloadError(`${where} carries no usable content hash`);
    }
    return { op: 'put', path, rev: o['rev'], ts: o['ts'], content: o['content'], hash: o['hash'] };
  }
  throw new PayloadError(`${where} has an unknown kind`);
}

export function encodePayload(payload: SyncPayload): Uint8Array {
  return utf8Encode(JSON.stringify(payload));
}

/** Parses and fully validates a decrypted event body. Throws `PayloadError` on anything off. */
export function decodePayload(bytes: Uint8Array): SyncPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(utf8Decode(bytes));
  } catch {
    throw new PayloadError('The event did not contain readable Skald data');
  }
  const p = (raw ?? {}) as Record<string, unknown>;
  if (p['v'] !== SYNC_PAYLOAD_VERSION) {
    throw new PayloadError(`This event was written by a different version of Skald (v${String(p['v'])})`);
  }
  if (p['kind'] !== 'delta' && p['kind'] !== 'snapshot') throw new PayloadError('The event has an unknown kind');
  if (typeof p['device'] !== 'string' || !p['device']) throw new PayloadError('The event names no device');
  if (!isTimestamp(p['ts'])) throw new PayloadError('The event has no usable timestamp');
  if (!Array.isArray(p['ops'])) throw new PayloadError('The event carries no operations');
  if (p['ops'].length > 20_000) throw new PayloadError('The event carries implausibly many operations');

  return {
    v: SYNC_PAYLOAD_VERSION,
    kind: p['kind'],
    device: p['device'],
    ts: p['ts'],
    ops: (p['ops'] as unknown[]).map(parseOp),
  };
}
