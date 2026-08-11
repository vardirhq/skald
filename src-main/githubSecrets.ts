// GitHub user and refresh tokens never enter a vault or renderer process.
// This deliberately mirrors GESH credential handling but uses its own file so
// disconnecting either integration cannot affect the other.

import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GitHubCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshTokenExpiresAt?: number;
  login?: string;
}

function path(): string {
  return join(app.getPath('userData'), 'skald-github-auth.json');
}

export function githubSecretsProtected(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function loadGitHubCredentials(): GitHubCredentials | null {
  if (!githubSecretsProtected()) return null;
  try {
    const file = JSON.parse(readFileSync(path(), 'utf-8')) as { version?: number; encrypted?: string };
    if (file.version !== 1 || typeof file.encrypted !== 'string') return null;
    const plain = safeStorage.decryptString(Buffer.from(file.encrypted, 'base64'));
    const value = JSON.parse(plain) as Partial<GitHubCredentials>;
    if (typeof value.accessToken !== 'string') return null;
    return {
      accessToken: value.accessToken,
      ...(typeof value.refreshToken === 'string' ? { refreshToken: value.refreshToken } : {}),
      ...(typeof value.expiresAt === 'number' ? { expiresAt: value.expiresAt } : {}),
      ...(typeof value.refreshTokenExpiresAt === 'number'
        ? { refreshTokenExpiresAt: value.refreshTokenExpiresAt }
        : {}),
      ...(typeof value.login === 'string' ? { login: value.login } : {}),
    };
  } catch {
    return null;
  }
}

export function saveGitHubCredentials(value: GitHubCredentials): void {
  if (!githubSecretsProtected()) {
    throw new Error(
      'This system has no keyring Skald can use. On Linux, install and unlock GNOME Keyring or KWallet first.'
    );
  }
  const dir = app.getPath('userData');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const encrypted = safeStorage.encryptString(JSON.stringify(value)).toString('base64');
  writeFileSync(path(), JSON.stringify({ version: 1, encrypted }), { encoding: 'utf-8', mode: 0o600 });
}

export function forgetGitHubCredentials(): void {
  rmSync(path(), { force: true });
}
