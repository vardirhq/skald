// What Skald actually puts inside a GESH event, and the validation that runs on
// everything that comes back out.
//
// GESH orders events; it does not merge them and it cannot vouch for them. A
// compromised or merely buggy relay can withhold, reorder or replay, so a
// decrypted event is treated as hostile input until every field has been
// checked — including the paths, which become filenames inside someone's vault.
//
// The envelope is deliberately trivial to reimplement:
//
//     <JSON header> \n <raw body bytes>
//
// `JSON.stringify` never emits a literal newline, so the first 0x0A is always
// the boundary. Notes travel in the header, as text. An attachment travels as
// raw bytes in the body, because base64 in JSON would cost a third of every
// file for nothing.

import { utf8Decode, utf8Encode } from '../gesh/bytes';

export const SYNC_PAYLOAD_VERSION = 1;

/**
 * `delta` carries what changed and `snapshot` carries the whole vault; both are
 * header-only. `blob` carries exactly one attachment, with its bytes in the body.
 */
export type SyncEventKind = 'delta' | 'snapshot' | 'blob';

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

/** An attachment. Its bytes are the event body, not a field. */
export interface PutBinOp {
  op: 'putBin';
  path: string;
  rev: number;
  ts: number;
  /** SHA-256 of the bytes. */
  hash: string;
  /** Length of the body, checked before the bytes are trusted. */
  size: number;
}

export interface DeleteOp {
  op: 'del';
  path: string;
  rev: number;
  ts: number;
}

export type FileOp = PutOp | PutBinOp | DeleteOp;

export interface SyncPayload {
  v: typeof SYNC_PAYLOAD_VERSION;
  kind: SyncEventKind;
  /** The device that wrote this event; also the tiebreak in conflict resolution. */
  device: string;
  ts: number;
  ops: FileOp[];
}

export interface SyncEvent {
  payload: SyncPayload;
  /** The attachment bytes for a `blob` event; empty for every other kind. */
  body: Uint8Array;
}

export class PayloadError extends Error {}

const CONTROL_OR_RESERVED = /[\u0000-\u001f<>:"|?*]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
const NEWLINE = 0x0a;

/** An attachment larger than this is refused before it can earn a 413. */
export const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;

/**
 * A path is only acceptable if it is a plain vault-relative path. Anything that
 * could escape the vault, hide inside `.skald/`, or land on a reserved Windows
 * name is refused before it can reach the filesystem.
 */
export function isSafeVaultPath(path: string): boolean {
  if (typeof path !== 'string' || !path || path.length > 400) return false;
  if (path !== path.normalize('NFC')) return false;
  if (path.includes('\\') || path.startsWith('/') || path.includes('//')) return false;
  if (CONTROL_OR_RESERVED.test(path)) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
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

/** A note: a safe path that is Markdown. */
export function isNotePath(path: string): boolean {
  return isSafeVaultPath(path) && /\.md$/i.test(path);
}

/** An attachment: a safe path that is anything but Markdown. */
export function isAttachmentPath(path: string): boolean {
  return isSafeVaultPath(path) && !/\.md$/i.test(path);
}

function isRev(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function parseOp(raw: unknown, index: number): FileOp {
  const o = (raw ?? {}) as Record<string, unknown>;
  const where = `operation ${index + 1}`;
  const path = o['path'];
  if (typeof path !== 'string' || !isSafeVaultPath(path)) {
    throw new PayloadError(`${where} names a path Skald will not write`);
  }
  if (!isRev(o['rev'])) throw new PayloadError(`${where} has no usable revision`);
  if (!isTimestamp(o['ts'])) throw new PayloadError(`${where} has no usable timestamp`);

  if (o['op'] === 'del') return { op: 'del', path, rev: o['rev'], ts: o['ts'] };

  if (o['op'] === 'put') {
    if (!isNotePath(path)) throw new PayloadError(`${where} sends a note that is not Markdown`);
    if (typeof o['content'] !== 'string') throw new PayloadError(`${where} carries no content`);
    if (!isHash(o['hash'])) throw new PayloadError(`${where} carries no usable content hash`);
    return { op: 'put', path, rev: o['rev'], ts: o['ts'], content: o['content'], hash: o['hash'] };
  }

  if (o['op'] === 'putBin') {
    if (!isAttachmentPath(path)) throw new PayloadError(`${where} sends a Markdown file as an attachment`);
    if (!isHash(o['hash'])) throw new PayloadError(`${where} carries no usable content hash`);
    const size = o['size'];
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 0 || size > MAX_ATTACHMENT_BYTES) {
      throw new PayloadError(`${where} declares an implausible attachment size`);
    }
    return { op: 'putBin', path, rev: o['rev'], ts: o['ts'], hash: o['hash'], size };
  }

  throw new PayloadError(`${where} has an unknown kind`);
}

export function encodeEvent(payload: SyncPayload, body: Uint8Array = new Uint8Array(0)): Uint8Array {
  const header = utf8Encode(JSON.stringify(payload));
  const out = new Uint8Array(header.length + 1 + body.length);
  out.set(header, 0);
  out[header.length] = NEWLINE;
  out.set(body, header.length + 1);
  return out;
}

/** Parses and fully validates a decrypted event. Throws `PayloadError` on anything off. */
export function decodeEvent(bytes: Uint8Array): SyncEvent {
  const split = bytes.indexOf(NEWLINE);
  if (split === -1) throw new PayloadError('The event has no header');
  const body = bytes.subarray(split + 1);

  let raw: unknown;
  try {
    raw = JSON.parse(utf8Decode(bytes.subarray(0, split)));
  } catch {
    throw new PayloadError('The event did not contain readable Skald data');
  }
  const p = (raw ?? {}) as Record<string, unknown>;
  if (p['v'] !== SYNC_PAYLOAD_VERSION) {
    throw new PayloadError(`This event was written by a different version of Skald (v${String(p['v'])})`);
  }
  const kind = p['kind'];
  if (kind !== 'delta' && kind !== 'snapshot' && kind !== 'blob') {
    throw new PayloadError('The event has an unknown kind');
  }
  if (typeof p['device'] !== 'string' || !p['device']) throw new PayloadError('The event names no device');
  if (!isTimestamp(p['ts'])) throw new PayloadError('The event has no usable timestamp');
  if (!Array.isArray(p['ops'])) throw new PayloadError('The event carries no operations');
  if (p['ops'].length > 20_000) throw new PayloadError('The event carries implausibly many operations');

  const ops = (p['ops'] as unknown[]).map(parseOp);

  if (kind === 'blob') {
    // One attachment per event, and the body has to be exactly what the header
    // promised before a single byte of it is written anywhere.
    if (ops.length !== 1 || ops[0].op !== 'putBin') {
      throw new PayloadError('An attachment event must carry exactly one attachment');
    }
    if (body.length !== ops[0].size) {
      throw new PayloadError('The attachment is not the length the event declared');
    }
  } else {
    if (body.length !== 0) throw new PayloadError('A note event must not carry a body');
    if (ops.some((op) => op.op === 'putBin')) {
      throw new PayloadError('An attachment must travel in its own event');
    }
  }

  return { payload: { v: SYNC_PAYLOAD_VERSION, kind, device: p['device'], ts: p['ts'], ops }, body };
}
