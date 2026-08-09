// The half of GESH the relay is designed never to learn.
//
// Everything an app uploads is sealed here first: AES-256-GCM with a fresh
// 96-bit nonce per event, the nonce prepended to the ciphertext so the blob is
// self-describing. The content key is generated on the first device and only
// ever leaves it through the `#k=` fragment of a pairing URI.

import { asBufferSource, base64UrlDecode, base64UrlEncode, bytesToHex, concatBytes } from './bytes';

export const NONCE_BYTES = 12;
export const KEY_BYTES = 32;

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error('WebCrypto is unavailable — Skald cannot encrypt sync events here.');
  }
  return c.subtle;
}

export async function generateContentKey(): Promise<CryptoKey> {
  // Extractable on purpose: pairing has to export it into the QR fragment.
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function importContentKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== KEY_BYTES) throw new Error('A content key must be 32 bytes');
  return subtle().importKey('raw', asBufferSource(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export async function exportContentKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await subtle().exportKey('raw', key));
}

export async function contentKeyToBase64Url(key: CryptoKey): Promise<string> {
  return base64UrlEncode(await exportContentKey(key));
}

export async function contentKeyFromBase64Url(text: string): Promise<CryptoKey> {
  return importContentKey(base64UrlDecode(text));
}

/** Seal a payload into the exact bytes GESH will store: nonce ‖ ciphertext ‖ tag. */
export async function sealEvent(key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = new Uint8Array(NONCE_BYTES);
  globalThis.crypto.getRandomValues(iv);
  const sealed = await subtle().encrypt({ name: 'AES-GCM', iv: asBufferSource(iv) }, key, asBufferSource(plaintext));
  return concatBytes(iv, new Uint8Array(sealed));
}

/**
 * Open a blob downloaded from the relay. A wrong key, a truncated body or a
 * tampered tag all surface as the same failure — the caller must treat the
 * result as untrusted input either way.
 */
export async function openEvent(key: CryptoKey, blob: Uint8Array): Promise<Uint8Array> {
  if (blob.length <= NONCE_BYTES) throw new Error('Event blob is too short to be sealed');
  const iv = blob.subarray(0, NONCE_BYTES);
  const body = blob.subarray(NONCE_BYTES);
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: asBufferSource(iv) }, key, asBufferSource(body)));
  } catch {
    throw new Error('Could not decrypt event — wrong content key or damaged data');
  }
}

/** Content digest used for change detection and conflict comparison. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await subtle().digest('SHA-256', asBufferSource(bytes))));
}
