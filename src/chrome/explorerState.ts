import type { FolderOpenState } from './tree';

const PREFIX = 'skald:explorer-folders:v1:';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function explorerStateKey(vaultPath: string): string {
  return `${PREFIX}${encodeURIComponent(vaultPath)}`;
}

export function loadExplorerState(
  storage: KeyValueStorage | null,
  vaultPath: string,
  knownFolders: Iterable<string>
): FolderOpenState {
  if (!storage) return {};
  try {
    const raw = storage.getItem(explorerStateKey(vaultPath));
    if (!raw) return {};
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return pruneExplorerState(value as FolderOpenState, knownFolders);
  } catch {
    return {};
  }
}

export function saveExplorerState(
  storage: KeyValueStorage | null,
  vaultPath: string,
  state: FolderOpenState
): void {
  if (!storage) return;
  try {
    storage.setItem(explorerStateKey(vaultPath), JSON.stringify(state));
  } catch {
    // A blocked or full renderer store must not make the explorer unusable.
  }
}

export function pruneExplorerState(
  state: FolderOpenState,
  knownFolders: Iterable<string>
): FolderOpenState {
  const known = new Set(knownFolders);
  const next: FolderOpenState = {};
  for (const [path, open] of Object.entries(state)) {
    if (known.has(path) && typeof open === 'boolean') next[path] = open;
  }
  return next;
}

export function moveExplorerFolder(
  state: FolderOpenState,
  oldPath: string,
  newPath: string
): FolderOpenState {
  const next: FolderOpenState = {};
  for (const [path, open] of Object.entries(state)) {
    const moved = path === oldPath
      ? newPath
      : path.startsWith(`${oldPath}/`)
        ? `${newPath}${path.slice(oldPath.length)}`
        : path;
    next[moved] = open;
  }
  return next;
}

export function removeExplorerFolder(state: FolderOpenState, path: string): FolderOpenState {
  const next: FolderOpenState = {};
  for (const [candidate, open] of Object.entries(state)) {
    if (candidate !== path && !candidate.startsWith(`${path}/`)) next[candidate] = open;
  }
  return next;
}

export function rendererStorage(): KeyValueStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
