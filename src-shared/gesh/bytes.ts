// Byte helpers shared by the GESH client. Nothing here touches Node or the DOM,
// so the same code runs in Electron's main process, a browser, and React Native.

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64, implemented directly so we do not depend on atob or Buffer. */
export function base64Encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64_ALPHABET[a >> 2];
    out += B64_ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64_ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64_ALPHABET[c & 0x3f];
  }
  return out;
}

export function base64Decode(text: string): Uint8Array {
  const clean = text.replace(/[\r\n\t ]+/g, '').replace(/=+$/, '');
  if (/[^A-Za-z0-9+/]/.test(clean)) throw new Error('Not base64');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let at = 0;
  let acc = 0;
  let bits = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64_ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, at);
}

/** base64url without padding — the shape GESH pairing URIs carry a key in. */
export function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(text: string): Uint8Array {
  return base64Decode(text.replace(/-/g, '+').replace(/_/g, '/'));
}

/**
 * TypeScript models a `Uint8Array`'s backing store as possibly shared, while
 * WebCrypto's signatures insist on a plain `ArrayBuffer`. Nothing here ever
 * allocates a `SharedArrayBuffer`, so this narrows what the compiler cannot.
 */
export function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
