// GESH restricts every identifier that can become a path component, and rejects
// anything else with a 400 before it reaches storage. We validate on the way out
// so a bad identifier is a local error with a useful message, not a round trip.

/** `appId`, `rootId`, `deviceId`, `eventId`: 1–128 ASCII letters, digits, `-`, `_`. */
export const IDENTIFIER_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** A handle is narrower: 3–64 lowercase letters, digits, or `-`. */
export const HANDLE_RE = /^[a-z0-9-]{3,64}$/;

export function isIdentifier(value: string): boolean {
  return IDENTIFIER_RE.test(value);
}

export function isHandle(value: string): boolean {
  return HANDLE_RE.test(value);
}

export function assertIdentifier(kind: string, value: string): string {
  if (!isIdentifier(value)) {
    throw new Error(`${kind} must be 1–128 characters of letters, digits, "-" or "_"`);
  }
  return value;
}

export function assertHandle(value: string): string {
  if (!isHandle(value)) {
    throw new Error('A handle must be 3–64 characters of lowercase letters, digits or "-"');
  }
  return value;
}

/**
 * Pairing codes are meant to be read aloud, so case and the grouping dash carry
 * no meaning. GESH normalizes them server-side; we do it too so a typed code is
 * not rejected before it is ever sent.
 */
export function normalizeEnrollmentCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomToken(length: number): string {
  // Rejection-free because 36 divides evenly enough at this length that the bias
  // is irrelevant for an identifier — these are names, not secrets.
  return Array.from(randomBytes(length), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

/**
 * A device identifier is chosen by the app, never typed by a person. The prefix
 * is only there to make a device list readable; the suffix is what makes it
 * unique, and reusing one deliberately replaces that device's credential.
 */
export function newDeviceId(prefix = 'device'): string {
  const clean = prefix.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'device';
  return `${clean}_${randomToken(10)}`;
}

/** Event IDs must never repeat on a root, even across erasure. */
export function newEventId(): string {
  return `evt_${Date.now().toString(36)}_${randomToken(16)}`;
}
