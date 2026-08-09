// Sync types shared between the Electron main process and the renderer.

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'error';

export interface SyncStatus {
  /** This vault is bound to a root on a relay. */
  configured: boolean;
  /** Automatic syncing is switched on. */
  enabled: boolean;
  serverUrl: string | null;
  appId: string;
  rootId: string | null;
  handle: string | null;
  deviceId: string | null;
  /** This device provisioned the root, so it holds the authority credential. */
  isRoot: boolean;
  phase: SyncPhase;
  lastSyncMs: number | null;
  lastError: string | null;
  /** Notes changed locally since the last successful push. */
  pending: number;
  /** Notes this vault has agreed on with the root. */
  tracked: number;
  /** Credentials are held in the OS keystore rather than a plain file. */
  secretsProtected: boolean;
  /** When rate limited, the moment it is worth trying again. */
  retryAtMs: number | null;
}

export interface SyncDeviceInfo {
  deviceId: string;
  enrolledAtMs: number;
  lastSeenMs: number | null;
  ackCursor: number | null;
  isThisDevice: boolean;
}

export interface PairingTicket {
  /** Normalized code, as GESH stores it. */
  code: string;
  /** Grouped and upper-cased, the way it is meant to be read aloud. */
  displayCode: string;
  expiresAtMs: number;
  /** The full `gesh://pair?…#k=…` string, content key included. */
  uri: string;
  /** True when the relay had no public URL configured and Skald built the URI itself. */
  uriIsLocal: boolean;
}

export const SYNC_APP_ID = 'skald';
