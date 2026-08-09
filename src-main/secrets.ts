// Sync credentials live here and nowhere else.
//
// GESH shows a root's two tokens exactly once, at provisioning, and cannot
// reissue them; the content key it never sees at all. All three go into the
// platform keystore through Electron's safeStorage, in the app's userData
// directory rather than the vault — a vault folder is the thing most likely to
// end up in someone's Dropbox or a git repository.

import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export interface RootSecrets {
  /** This device's own sync credential. Used for every upload, list, download and ack. */
  deviceToken: string;
  /** The authority, held only by the device that provisioned the root. */
  rootToken?: string;
  /** base64url AES-256 content key. Never sent to the relay. */
  contentKey: string;
}

interface SecretsFile {
  version: 1;
  /** `${appId}:${rootId}:${deviceId}` → safeStorage ciphertext, base64. */
  entries: Record<string, string>;
}

function emptyFile(): SecretsFile {
  // A fresh object every time: a shared one would let an in-memory entries map
  // survive across reads of a file that does not exist.
  return { version: 1, entries: {} };
}

function secretsPath(): string {
  return join(app.getPath('userData'), 'skald-sync-secrets.json');
}

/**
 * Keyed by device as well as root, because one machine can hold two vaults
 * enrolled on the same root — each is its own device with its own credential,
 * and a root-only key would have them overwrite each other.
 */
export function deviceKey(appId: string, rootId: string, deviceId: string): string {
  return `${appId}:${rootId}:${deviceId}`;
}

/** False when no OS keystore backend is available, in which case nothing is stored. */
export function secretsProtected(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function readFile(): SecretsFile {
  try {
    const parsed = JSON.parse(readFileSync(secretsPath(), 'utf-8')) as Partial<SecretsFile>;
    if (parsed?.version !== 1 || typeof parsed.entries !== 'object' || !parsed.entries) return emptyFile();
    return { version: 1, entries: parsed.entries as Record<string, string> };
  } catch {
    return emptyFile();
  }
}

function writeFileAtomically(value: SecretsFile): void {
  const dir = app.getPath('userData');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(secretsPath(), JSON.stringify(value), { encoding: 'utf-8', mode: 0o600 });
}

export function loadSecrets(key: string): RootSecrets | null {
  const entry = readFile().entries[key];
  if (!entry) return null;
  if (!secretsProtected()) return null;
  try {
    const plain = safeStorage.decryptString(Buffer.from(entry, 'base64'));
    const parsed = JSON.parse(plain) as Partial<RootSecrets>;
    if (typeof parsed?.deviceToken !== 'string' || typeof parsed?.contentKey !== 'string') return null;
    return {
      deviceToken: parsed.deviceToken,
      contentKey: parsed.contentKey,
      ...(typeof parsed.rootToken === 'string' ? { rootToken: parsed.rootToken } : {}),
    };
  } catch {
    return null;
  }
}

/** Throws unless there is somewhere safe to keep a credential. */
export function requireSecretStore(): void {
  if (secretsProtected()) return;
  throw new Error(
    'This system has no keystore Skald can use, so sync credentials cannot be stored safely. ' +
      'On Linux, install and unlock a secret service (GNOME Keyring or KWallet) and try again.'
  );
}

export function saveSecrets(key: string, secrets: RootSecrets): void {
  requireSecretStore();
  const file = readFile();
  file.entries[key] = safeStorage.encryptString(JSON.stringify(secrets)).toString('base64');
  writeFileAtomically(file);
}

export function forgetSecrets(key: string): void {
  const file = readFile();
  if (!(key in file.entries)) return;
  delete file.entries[key];
  if (Object.keys(file.entries).length === 0) {
    rmSync(secretsPath(), { force: true });
    return;
  }
  writeFileAtomically(file);
}
