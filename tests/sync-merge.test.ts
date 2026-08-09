import { describe, it, expect } from 'vitest';
import { ABSENT, beats, decideMerge, nextRev, type FileState } from '../src-shared/sync/merge';
import {
  decodeEvent,
  encodeEvent,
  isAttachmentPath,
  isNotePath,
  isSafeVaultPath,
  MAX_ATTACHMENT_BYTES,
  PayloadError,
  type FileOp,
  type SyncPayload,
} from '../src-shared/sync/payload';
import { utf8Encode } from '../src-shared/gesh/bytes';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function put(hash: string, rev: number): FileOp {
  return { op: 'put', path: 'Notes/Saga.md', rev, ts: 1, content: 'body', hash };
}

function del(rev: number): FileOp {
  return { op: 'del', path: 'Notes/Saga.md', rev, ts: 1 };
}

function known(hash: string, rev: number, writer = 'phone'): FileState {
  return { hash, rev, writer };
}

describe('clock comparison', () => {
  it('prefers the higher revision, then the higher device id', () => {
    expect(beats({ rev: 2, writer: 'a' }, { rev: 1, writer: 'z' })).toBe(true);
    expect(beats({ rev: 1, writer: 'a' }, { rev: 2, writer: 'a' })).toBe(false);
    expect(beats({ rev: 1, writer: 'z' }, { rev: 1, writer: 'a' })).toBe(true);
    expect(beats({ rev: 1, writer: 'a' }, { rev: 1, writer: 'z' })).toBe(false);
  });

  it('is antisymmetric, so two devices never both think they won', () => {
    const claims = [
      { rev: 1, writer: 'desktop' },
      { rev: 1, writer: 'phone' },
      { rev: 2, writer: 'desktop' },
    ];
    for (const a of claims) {
      for (const b of claims) {
        if (a === b) continue;
        expect(beats(a, b)).toBe(!beats(b, a));
      }
    }
  });

  it('counts from zero for a path this device has never seen', () => {
    expect(nextRev(null)).toBe(1);
    expect(nextRev(known(HASH_A, 4))).toBe(5);
  });
});

describe('decideMerge', () => {
  it('writes a note this device has never seen', () => {
    expect(
      decideMerge({
        incoming: put(HASH_A, 1),
        incomingWriter: 'phone',
        known: null,
        localHash: ABSENT,
        localDeviceId: 'desktop',
      })
    ).toEqual({ action: 'apply', preserveLocal: false, record: known(HASH_A, 1) });
  });

  it('applies a remote edit on top of a clean local copy', () => {
    const result = decideMerge({
      incoming: put(HASH_B, 2),
      incomingWriter: 'phone',
      known: known(HASH_A, 1),
      localHash: HASH_A,
      localDeviceId: 'desktop',
    });
    expect(result.action).toBe('apply');
    expect(result.preserveLocal).toBe(false);
  });

  it('does nothing when disk already says what the event says', () => {
    const result = decideMerge({
      incoming: put(HASH_B, 2),
      incomingWriter: 'phone',
      known: known(HASH_A, 1),
      localHash: HASH_B,
      localDeviceId: 'desktop',
    });
    expect(result.action).toBe('noop');
    // The clock still moves, or this device would republish the same bytes.
    expect(result.record).toEqual(known(HASH_B, 2));
  });

  it('ignores a replayed event older than what it already applied', () => {
    const result = decideMerge({
      incoming: put(HASH_A, 1),
      incomingWriter: 'phone',
      known: known(HASH_B, 3),
      localHash: HASH_B,
      localDeviceId: 'desktop',
    });
    expect(result.action).toBe('noop');
    expect(result.record).toBeUndefined();
  });

  it('keeps an unpublished local edit that outranks the incoming one', () => {
    // Local edited from rev 2, so it will publish at rev 3 and beat this rev 2.
    const result = decideMerge({
      incoming: put(HASH_B, 2),
      incomingWriter: 'phone',
      known: known(HASH_A, 2),
      localHash: HASH_C,
      localDeviceId: 'desktop',
    });
    expect(result.action).toBe('keep-local');
  });

  it('preserves the local copy when a remote edit outranks it', () => {
    const result = decideMerge({
      incoming: put(HASH_B, 9),
      incomingWriter: 'phone',
      known: known(HASH_A, 2),
      localHash: HASH_C,
      localDeviceId: 'desktop',
    });
    expect(result).toEqual({ action: 'apply', preserveLocal: true, record: known(HASH_B, 9) });
  });

  it('breaks a true tie by device id, and both devices agree on the winner', () => {
    // Both edited from rev 1, so both claim rev 2. "phone" > "desktop".
    const onDesktop = decideMerge({
      incoming: put(HASH_B, 2),
      incomingWriter: 'phone',
      known: known(HASH_A, 1),
      localHash: HASH_C,
      localDeviceId: 'desktop',
    });
    const onPhone = decideMerge({
      incoming: put(HASH_C, 2),
      incomingWriter: 'desktop',
      known: known(HASH_A, 1),
      localHash: HASH_B,
      localDeviceId: 'phone',
    });
    expect(onDesktop.action).toBe('apply');
    expect(onDesktop.preserveLocal).toBe(true);
    expect(onPhone.action).toBe('keep-local');
  });

  it('treats two devices typing the same bytes as no conflict at all', () => {
    const result = decideMerge({
      incoming: put(HASH_B, 2),
      incomingWriter: 'phone',
      known: known(HASH_A, 1),
      localHash: HASH_B,
      localDeviceId: 'desktop',
    });
    expect(result.action).toBe('noop');
  });

  it('applies a remote delete to a clean local copy and leaves a tombstone', () => {
    const result = decideMerge({
      incoming: del(2),
      incomingWriter: 'phone',
      known: known(HASH_A, 1),
      localHash: HASH_A,
      localDeviceId: 'desktop',
    });
    expect(result.action).toBe('apply');
    expect(result.record).toEqual({ hash: ABSENT, rev: 2, writer: 'phone' });
  });

  it('does not resurrect a note that is already gone', () => {
    const result = decideMerge({
      incoming: del(2),
      incomingWriter: 'phone',
      known: { hash: ABSENT, rev: 2, writer: 'phone' },
      localHash: ABSENT,
      localDeviceId: 'desktop',
    });
    expect(result.action).toBe('noop');
  });

  it('lets a local edit beat a remote delete of the same generation', () => {
    // "phone" deletes at rev 2; "zdesktop" edited locally and claims rev 2 too.
    const result = decideMerge({
      incoming: del(2),
      incomingWriter: 'phone',
      known: known(HASH_A, 1),
      localHash: HASH_B,
      localDeviceId: 'zdesktop',
    });
    expect(result.action).toBe('keep-local');
  });

  it('preserves a local edit that loses to a remote delete', () => {
    const result = decideMerge({
      incoming: del(7),
      incomingWriter: 'phone',
      known: known(HASH_A, 1),
      localHash: HASH_B,
      localDeviceId: 'desktop',
    });
    expect(result).toEqual({
      action: 'apply',
      preserveLocal: true,
      record: { hash: ABSENT, rev: 7, writer: 'phone' },
    });
  });

  it('publishes a local-only note rather than deleting it on a stale tombstone', () => {
    // Recreated locally after a delete: disk differs from the tombstone.
    const result = decideMerge({
      incoming: del(2),
      incomingWriter: 'phone',
      known: { hash: ABSENT, rev: 2, writer: 'phone' },
      localHash: HASH_A,
      localDeviceId: 'desktop',
    });
    expect(result.action).toBe('keep-local');
  });
});

describe('payload paths', () => {
  it('accepts ordinary vault paths', () => {
    for (const path of ['Note.md', 'Projects/Jörmungandr.md', 'a/b/c/Deep note.md', 'Daily/2026-08-09.md']) {
      expect(isNotePath(path)).toBe(true);
      expect(isAttachmentPath(path)).toBe(false);
    }
  });

  it('sorts attachments from notes by extension alone', () => {
    for (const path of ['Attachments/diagram.png', 'a/b/report.pdf', 'Attachments/no-extension']) {
      expect(isAttachmentPath(path)).toBe(true);
      expect(isNotePath(path)).toBe(false);
    }
  });

  it('refuses anything that could escape or hide, whatever its extension', () => {
    for (const path of [
      '../outside.md',
      '../outside.png',
      '/etc/passwd.md',
      '/etc/shadow',
      'C:/Windows/system.md',
      'a//b.md',
      'a\\b.png',
      '.skald/settings.md',
      '.skald/sync.json',
      'folder/.hidden.png',
      '',
      'trailing .md ',
      'CON.md',
      'com1.png',
      'a/../../b.md',
      `bad${String.fromCharCode(0)}.png`,
    ]) {
      expect(isSafeVaultPath(path), path).toBe(false);
      expect(isNotePath(path), path).toBe(false);
      expect(isAttachmentPath(path), path).toBe(false);
    }
  });
});

describe('event encoding', () => {
  const payload: SyncPayload = {
    v: 1,
    kind: 'delta',
    device: 'desktop_a',
    ts: 1786270000000,
    ops: [put(HASH_A, 1), del(2)],
  };

  it('round-trips a note event', () => {
    const decoded = decodeEvent(encodeEvent(payload));
    expect(decoded.payload).toEqual(payload);
    expect(decoded.body).toHaveLength(0);
  });

  it('round-trips an attachment with its bytes untouched', () => {
    const bytes = new Uint8Array(512).map((_, i) => (i * 7) % 256);
    const blob: SyncPayload = {
      v: 1,
      kind: 'blob',
      device: 'desktop_a',
      ts: 1786270000000,
      ops: [{ op: 'putBin', path: 'Attachments/photo.png', rev: 1, ts: 1, hash: HASH_A, size: bytes.length }],
    };
    const decoded = decodeEvent(encodeEvent(blob, bytes));
    expect(decoded.payload).toEqual(blob);
    expect(Array.from(decoded.body)).toEqual(Array.from(bytes));
  });

  it('finds the header boundary even when the body starts with a newline', () => {
    const bytes = new Uint8Array([0x0a, 0x0a, 0x00, 0xff]);
    const blob: SyncPayload = {
      v: 1,
      kind: 'blob',
      device: 'd',
      ts: 1,
      ops: [{ op: 'putBin', path: 'a.bin', rev: 1, ts: 1, hash: HASH_A, size: 4 }],
    };
    expect(Array.from(decodeEvent(encodeEvent(blob, bytes)).body)).toEqual([0x0a, 0x0a, 0x00, 0xff]);
  });

  function decodeRaw(value: unknown, body = new Uint8Array(0)): SyncPayload {
    const header = utf8Encode(JSON.stringify(value));
    const framed = new Uint8Array(header.length + 1 + body.length);
    framed.set(header, 0);
    framed[header.length] = 0x0a;
    framed.set(body, header.length + 1);
    return decodeEvent(framed).payload;
  }

  it('refuses a payload from a future version rather than guessing', () => {
    expect(() => decodeRaw({ ...payload, v: 2 })).toThrow(PayloadError);
  });

  it('refuses an op naming a path outside the vault', () => {
    expect(() => decodeRaw({ ...payload, ops: [{ ...put(HASH_A, 1), path: '../escape.md' }] })).toThrow(
      /will not write/
    );
  });

  it('refuses a put with no usable content hash', () => {
    expect(() => decodeRaw({ ...payload, ops: [{ ...put(HASH_A, 1), hash: 'nope' }] })).toThrow(/content hash/);
  });

  it('refuses a negative or fractional revision', () => {
    expect(() => decodeRaw({ ...payload, ops: [{ ...put(HASH_A, 1), rev: -1 }] })).toThrow(/revision/);
    expect(() => decodeRaw({ ...payload, ops: [{ ...put(HASH_A, 1), rev: 1.5 }] })).toThrow(/revision/);
  });

  it('refuses an unknown operation instead of ignoring it', () => {
    expect(() => decodeRaw({ ...payload, ops: [{ op: 'chmod', path: 'a.md', rev: 1, ts: 1 }] })).toThrow(
      /unknown kind/
    );
  });

  it('refuses a note sent as an attachment, and an attachment sent as a note', () => {
    expect(() =>
      decodeRaw({ ...payload, kind: 'blob', ops: [{ op: 'putBin', path: 'Note.md', rev: 1, ts: 1, hash: HASH_A, size: 0 }] })
    ).toThrow(/Markdown file as an attachment/);
    expect(() => decodeRaw({ ...payload, ops: [{ ...put(HASH_A, 1), path: 'photo.png' }] })).toThrow(
      /not Markdown/
    );
  });

  it('refuses a body that is not the length the header promised', () => {
    const op = { op: 'putBin', path: 'a.png', rev: 1, ts: 1, hash: HASH_A, size: 10 };
    expect(() => decodeRaw({ ...payload, kind: 'blob', ops: [op] }, new Uint8Array(9))).toThrow(
      /not the length/
    );
  });

  it('refuses an attachment larger than Skald will carry', () => {
    const op = { op: 'putBin', path: 'a.png', rev: 1, ts: 1, hash: HASH_A, size: MAX_ATTACHMENT_BYTES + 1 };
    expect(() => decodeRaw({ ...payload, kind: 'blob', ops: [op] })).toThrow(/implausible attachment size/);
  });

  it('keeps attachments out of shared events and bodies off note events', () => {
    const op = { op: 'putBin', path: 'a.png', rev: 1, ts: 1, hash: HASH_A, size: 0 };
    expect(() => decodeRaw({ ...payload, ops: [put(HASH_A, 1), op] })).toThrow(/its own event/);
    expect(() => decodeRaw(payload, new Uint8Array([1]))).toThrow(/must not carry a body/);
  });

  it('refuses more than one attachment in a blob event', () => {
    const op = { op: 'putBin', path: 'a.png', rev: 1, ts: 1, hash: HASH_A, size: 0 };
    expect(() => decodeRaw({ ...payload, kind: 'blob', ops: [op, { ...op, path: 'b.png' }] })).toThrow(
      /exactly one attachment/
    );
  });

  it('refuses bytes that are not an event at all', () => {
    expect(() => decodeEvent(utf8Encode('not json\n'))).toThrow(PayloadError);
    expect(() => decodeEvent(utf8Encode('{"v":1}'))).toThrow(/no header/);
    expect(() => decodeRaw(null)).toThrow(PayloadError);
    expect(() => decodeRaw([1, 2, 3])).toThrow(PayloadError);
  });
});
