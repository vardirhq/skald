import { describe, it, expect } from 'vitest';
import {
  base64Decode,
  base64Encode,
  base64UrlDecode,
  base64UrlEncode,
  concatBytes,
  utf8Decode,
  utf8Encode,
} from '../src-shared/gesh/bytes';
import {
  NONCE_BYTES,
  contentKeyFromBase64Url,
  contentKeyToBase64Url,
  generateContentKey,
  openEvent,
  sealEvent,
  sha256Hex,
} from '../src-shared/gesh/crypto';
import {
  buildPairingUri,
  formatEnrollmentCode,
  parsePairingUri,
  withContentKey,
} from '../src-shared/gesh/pairing';

describe('bytes', () => {
  it('round-trips base64 at every padding length', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + n) % 256);
      expect(Array.from(base64Decode(base64Encode(bytes)))).toEqual(Array.from(bytes));
      expect(Array.from(base64UrlDecode(base64UrlEncode(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('agrees with Buffer, so a mobile client and Node read the same string', () => {
    const bytes = new Uint8Array([0, 1, 250, 255, 128, 64]);
    expect(base64Encode(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    expect(base64UrlEncode(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
  });

  it('produces base64url with no padding and no URL-hostile characters', () => {
    const encoded = base64UrlEncode(new Uint8Array([255, 254, 253, 252]));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('round-trips UTF-8 including characters a vault really contains', () => {
    const text = 'Jörmungandr — “sagaen” 🐍\n- [ ] skriv';
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it('concatenates without copying the wrong bounds', () => {
    expect(Array.from(concatBytes(new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3])))).toEqual([1, 2, 3]);
  });
});

describe('event sealing', () => {
  it('round-trips a payload', async () => {
    const key = await generateContentKey();
    const plaintext = utf8Encode('# Note\n\nBody with an ø in it.');
    const sealed = await sealEvent(key, plaintext);
    expect(utf8Decode(await openEvent(key, sealed))).toBe('# Note\n\nBody with an ø in it.');
  });

  it('prepends a fresh nonce to every event', async () => {
    const key = await generateContentKey();
    const plaintext = utf8Encode('same bytes every time');
    const a = await sealEvent(key, plaintext);
    const b = await sealEvent(key, plaintext);

    expect(a.length).toBe(NONCE_BYTES + plaintext.length + 16);
    expect(Array.from(a.subarray(0, NONCE_BYTES))).not.toEqual(Array.from(b.subarray(0, NONCE_BYTES)));
    // Reused nonces are the failure mode that breaks GCM outright.
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('refuses another root’s key', async () => {
    const sealed = await sealEvent(await generateContentKey(), utf8Encode('secret'));
    await expect(openEvent(await generateContentKey(), sealed)).rejects.toThrow(/Could not decrypt/);
  });

  it('refuses a tampered tag', async () => {
    const key = await generateContentKey();
    const sealed = await sealEvent(key, utf8Encode('secret'));
    sealed[sealed.length - 1] ^= 0x01;
    await expect(openEvent(key, sealed)).rejects.toThrow(/Could not decrypt/);
  });

  it('refuses a blob too short to contain a nonce', async () => {
    const key = await generateContentKey();
    await expect(openEvent(key, new Uint8Array(NONCE_BYTES))).rejects.toThrow(/too short/);
  });

  it('exports and re-imports a content key, which is what pairing does', async () => {
    const key = await generateContentKey();
    const exported = await contentKeyToBase64Url(key);
    const sealed = await sealEvent(key, utf8Encode('across devices'));
    const reimported = await contentKeyFromBase64Url(exported);
    expect(utf8Decode(await openEvent(reimported, sealed))).toBe('across devices');
  });

  it('rejects a key of the wrong length rather than silently padding it', async () => {
    await expect(contentKeyFromBase64Url(base64UrlEncode(new Uint8Array(16)))).rejects.toThrow(/32 bytes/);
  });

  it('hashes to a stable lowercase hex digest', async () => {
    expect(await sha256Hex(utf8Encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});

describe('pairing URIs', () => {
  it('keeps the content key in the fragment, where no server sees it', () => {
    const uri = withContentKey(buildPairingUri('https://gesh.vardir.no', '79T54-26AJX'), 'AAAA-key_');
    const [beforeFragment, fragment] = uri.split('#');
    expect(beforeFragment).not.toContain('AAAA-key_');
    expect(fragment).toBe('k=AAAA-key_');
  });

  it('parses what it builds', () => {
    const uri = withContentKey(buildPairingUri('https://gesh.vardir.no/', '79T54-26AJX'), 'k3y');
    expect(parsePairingUri(uri)).toEqual({
      server: 'https://gesh.vardir.no',
      code: '79t5426ajx',
      contentKey: 'k3y',
    });
  });

  it('parses the shape the relay documents', () => {
    const invite = parsePairingUri(
      'gesh://pair?s=https%3A%2F%2Fsync.example.com&c=79T54-26AJX#k=Zm9vYmFy'
    );
    expect(invite.server).toBe('https://sync.example.com');
    expect(invite.code).toBe('79t5426ajx');
    expect(invite.contentKey).toBe('Zm9vYmFy');
  });

  it('reports a link with no key rather than pairing half-blind', () => {
    const invite = parsePairingUri('gesh://pair?s=https%3A%2F%2Fsync.example.com&c=ABCDE-FGHJK');
    expect(invite.contentKey).toBeNull();
  });

  it('refuses anything that is not a pairing link', () => {
    for (const bad of [
      'https://gesh.vardir.no/pair?c=ABCDE',
      'gesh://pair?c=ABCDE',
      'gesh://pair?s=not-a-url&c=ABCDE',
      'gesh://pair?s=https%3A%2F%2Fx.test',
      'nonsense',
    ]) {
      expect(() => parsePairingUri(bad)).toThrow();
    }
  });

  it('replaces an existing fragment rather than stacking one', () => {
    const once = withContentKey('gesh://pair?s=https%3A%2F%2Fx.test&c=A', 'one');
    expect(withContentKey(once, 'two')).toBe('gesh://pair?s=https%3A%2F%2Fx.test&c=A#k=two');
  });

  it('groups a code the way it is meant to be read aloud', () => {
    expect(formatEnrollmentCode('79t5426ajx')).toBe('79T54-26AJX');
    expect(formatEnrollmentCode('79T54-26AJX')).toBe('79T54-26AJX');
  });
});
