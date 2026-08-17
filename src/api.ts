import type {
  NotePayload,
  NoteHistoryEntry,
  NoteHistoryVersion,
  PathChange,
  SearchResult,
  DeletedNoteEntry,
  AttachmentImportResult,
  SchemaName,
  VaultSettings,
  VaultSnapshot,
  GitHubAuthStatus,
  GitHubDeviceLogin,
  GitHubRepositoryCard,
} from '../src-shared/types';
import type { TaskEdits } from '../src-shared/tasks';
import type { PairingTicket, SyncDeviceInfo, SyncStatus } from '../src-shared/sync/types';

interface Bridge {
  platform?: string;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  pathForFile: (file: File) => string;
  onVaultChanged: (cb: (snapshot: unknown) => void) => () => void;
  onSyncChanged: (cb: (status: unknown) => void) => () => void;
  onWindowMaximized: (cb: (maximized: boolean) => void) => () => void;
}

declare global {
  interface Window {
    skald: Bridge;
  }
}

const bridge = () => window.skald;

/**
 * Which platform's window conventions to follow. Falls back to sniffing the
 * user agent so the renderer still looks right outside Electron.
 */
function hostPlatform(): 'darwin' | 'win32' | 'linux' {
  const reported = bridge()?.platform;
  if (reported === 'darwin' || reported === 'win32' || reported === 'linux') return reported;
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Mac|iPhone|iPad/.test(ua)) return 'darwin';
  if (/Win/.test(ua)) return 'win32';
  return 'linux';
}

export const api = {
  platform: hostPlatform,
  // vault lifecycle
  getLastVault: () => bridge().invoke('vault:getLast') as Promise<string | null>,
  selectVaultDialog: () => bridge().invoke('vault:selectDialog') as Promise<string | null>,
  openVault: (path: string) => bridge().invoke('vault:open', path) as Promise<VaultSnapshot>,
  createVault: (path: string) => bridge().invoke('vault:create', path) as Promise<VaultSnapshot>,
  snapshot: () => bridge().invoke('vault:snapshot') as Promise<VaultSnapshot>,
  revealInFolder: (sub?: string) => bridge().invoke('vault:revealInFolder', sub) as Promise<void>,
  showItemInFolder: (path: string) => bridge().invoke('vault:showItem', path) as Promise<void>,

  // notes
  readNote: (path: string) => bridge().invoke('note:read', path) as Promise<NotePayload>,
  writeNote: (path: string, content: string) =>
    bridge().invoke('note:write', path, content) as Promise<void>,
  createNote: (folder: string, title: string, schema: SchemaName) =>
    bridge().invoke('note:create', folder, title, schema) as Promise<string>,
  createDailyNote: () => bridge().invoke('note:createDaily') as Promise<string>,
  renameNote: (path: string, newTitle: string) =>
    bridge().invoke('note:rename', path, newTitle) as Promise<string>,
  moveNotes: (paths: string[], folder: string) =>
    bridge().invoke('note:moveMany', paths, folder) as Promise<PathChange[]>,
  deleteNote: (path: string) => bridge().invoke('note:delete', path) as Promise<void>,
  deleteNotes: (paths: string[]) => bridge().invoke('note:deleteMany', paths) as Promise<void>,
  listNoteHistory: (path: string) =>
    bridge().invoke('note:history:list', path) as Promise<NoteHistoryEntry[]>,
  readNoteHistoryVersion: (path: string, id: string) =>
    bridge().invoke('note:history:read', path, id) as Promise<NoteHistoryVersion>,
  restoreNoteHistoryVersion: (path: string, id: string) =>
    bridge().invoke('note:history:restore', path, id) as Promise<void>,
  createFolder: (path: string) => bridge().invoke('folder:create', path) as Promise<void>,
  moveFolder: (path: string, parent: string) =>
    bridge().invoke('folder:move', path, parent) as Promise<PathChange[]>,
  renameFolder: (path: string, name: string) =>
    bridge().invoke('folder:rename', path, name) as Promise<PathChange[]>,
  deleteFolder: (path: string) => bridge().invoke('folder:delete', path) as Promise<void>,
  search: (query: string) => bridge().invoke('search:query', query) as Promise<SearchResult[]>,
  listDeletedNotes: () => bridge().invoke('trash:list') as Promise<DeletedNoteEntry[]>,
  restoreDeletedNote: (path: string) => bridge().invoke('trash:restore', path) as Promise<void>,

  // attachments
  selectAttachments: (notePath: string) =>
    bridge().invoke('attachment:select', notePath) as Promise<AttachmentImportResult[]>,
  importAttachmentPaths: (notePath: string, paths: string[]) =>
    bridge().invoke('attachment:importPaths', notePath, paths) as Promise<AttachmentImportResult[]>,
  importAttachmentData: (notePath: string, fileName: string, mime: string, bytes: number[]) =>
    bridge().invoke('attachment:importData', notePath, fileName, mime, bytes) as Promise<AttachmentImportResult>,
  openAttachment: (path: string) => bridge().invoke('attachment:open', path) as Promise<string>,
  revealAttachment: (path: string) => bridge().invoke('attachment:reveal', path) as Promise<void>,
  pathForFile: (file: File) => bridge().pathForFile(file),
  attachmentUrl: (path: string) =>
    `skald-asset://vault/${path.split('/').map(encodeURIComponent).join('/')}`,

  // tasks
  updateTask: (id: string, edits: TaskEdits) =>
    bridge().invoke('task:update', id, edits) as Promise<void>,
  addTask: (
    notePath: string,
    content: string,
    opts?: { due?: string | null; priority?: 'low' | 'med' | 'high' }
  ) => bridge().invoke('task:add', notePath, content, opts) as Promise<void>,

  // note themes
  listThemes: () => bridge().invoke('theme:list') as Promise<string[]>,
  readTheme: (name: string) => bridge().invoke('theme:read', name) as Promise<string | null>,

  // settings / graph
  setSettings: (patch: Partial<VaultSettings>) =>
    bridge().invoke('settings:set', patch) as Promise<VaultSettings>,
  setGraphPosition: (path: string, x: number, y: number) =>
    bridge().invoke('graph:setPosition', path, x, y) as Promise<void>,
  resetGraphLayout: () => bridge().invoke('graph:resetLayout') as Promise<void>,

  // sync
  syncStatus: () => bridge().invoke('sync:status') as Promise<SyncStatus>,
  syncConnect: (input: { serverUrl: string; handle?: string; provisioningSecret?: string }) =>
    bridge().invoke('sync:connect', input) as Promise<SyncStatus>,
  syncPair: (uri: string) => bridge().invoke('sync:pair', uri) as Promise<SyncStatus>,
  syncMintPairing: () => bridge().invoke('sync:mintPairing') as Promise<PairingTicket>,
  syncDevices: () => bridge().invoke('sync:devices') as Promise<SyncDeviceInfo[]>,
  syncRevoke: (deviceId: string) => bridge().invoke('sync:revoke', deviceId) as Promise<SyncDeviceInfo[]>,
  syncNow: () => bridge().invoke('sync:now') as Promise<SyncStatus>,
  syncPushSnapshot: () => bridge().invoke('sync:snapshot') as Promise<SyncStatus>,
  syncSetEnabled: (enabled: boolean) => bridge().invoke('sync:setEnabled', enabled) as Promise<SyncStatus>,
  syncDisconnect: () => bridge().invoke('sync:disconnect') as Promise<SyncStatus>,
  onSyncChanged: (cb: (s: SyncStatus) => void) => bridge().onSyncChanged(cb as (s: unknown) => void),

  // GitHub. Credentials never cross the preload boundary.
  githubStatus: () => bridge().invoke('github:status') as Promise<GitHubAuthStatus>,
  githubBeginLogin: () => bridge().invoke('github:login:begin') as Promise<GitHubDeviceLogin>,
  githubCompleteLogin: () =>
    bridge().invoke('github:login:complete') as Promise<GitHubAuthStatus>,
  githubCancelLogin: () => bridge().invoke('github:login:cancel') as Promise<void>,
  githubDisconnect: () => bridge().invoke('github:disconnect') as Promise<GitHubAuthStatus>,
  githubRepository: (repo: string, force = false) =>
    bridge().invoke('github:repository', repo, force) as Promise<GitHubRepositoryCard>,

  // window
  minimize: () => bridge().invoke('window:minimize') as Promise<void>,
  toggleMaximize: () => bridge().invoke('window:toggleMaximize') as Promise<boolean>,
  closeWindow: () => bridge().invoke('window:close') as Promise<void>,

  onVaultChanged: (cb: (s: VaultSnapshot) => void) =>
    bridge().onVaultChanged(cb as (s: unknown) => void),
};
