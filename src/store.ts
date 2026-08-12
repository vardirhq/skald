import { create } from 'zustand';
import type { PathChange, VaultSnapshot } from '../src-shared/types';
import type { FolderOpenState } from './chrome/tree';
import { ancestorFolderPaths, expansionPatch, isFolderOpen } from './chrome/tree';
import { allFolders } from './chrome/tree';
import {
  loadExplorerState,
  moveExplorerFolder,
  removeExplorerFolder,
  rendererStorage,
  saveExplorerState,
} from './chrome/explorerState';
import { idsToCloseOthers, idsToCloseRight, pinTab, reorderTabs, type Tab } from './chrome/tabs';
import { api } from './api';

export type View =
  | 'logbook'
  | 'editor'
  | 'tasks-table'
  | 'tasks-kanban'
  | 'tasks-calendar'
  | 'graph'
  | 'search'
  | 'trash'
  | 'tags'
  | 'settings';

export type { Tab } from './chrome/tabs';

export type Phase = 'boot' | 'picker' | 'ready';

interface SkaldState {
  phase: Phase;
  snapshot: VaultSnapshot | null;
  view: View;
  selectedPath: string | null;
  tabs: Tab[];
  dirtyPaths: Record<string, boolean>;
  switcherOpen: boolean;
  toast: string | null;
  searchQuery: string;
  editorLocation: { path: string; line: number; column: number; length: number } | null;
  selectedTag: string | null;
  /** Explorer folders that have been deliberately collapsed or expanded. */
  folderOpen: FolderOpenState;
  docStatus: { schema?: string; words?: number; lncol?: [number, number] | null };
  setDocStatus: (d: { schema?: string; words?: number; lncol?: [number, number] | null }) => void;

  boot: () => Promise<void>;
  openVaultAt: (path: string, create: boolean) => Promise<void>;
  switchVault: () => void;
  applySnapshot: (s: VaultSnapshot) => void;

  setView: (v: View) => void;
  openNote: (path: string) => void;
  openNoteAt: (path: string, line: number, column: number, length: number) => void;
  openNotes: (paths: string[]) => void;
  openLogbook: () => void;
  toggleFolder: (path: string) => void;
  setFoldersOpen: (patch: FolderOpenState) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToRight: (id: string) => void;
  setTabPinned: (id: string, pinned: boolean) => void;
  reorderTab: (draggedId: string, targetId: string) => void;
  setDirty: (path: string, dirty: boolean) => void;
  notePathRenamed: (oldPath: string, newPath: string) => void;
  pathsChanged: (changes: PathChange[]) => void;
  folderPathChanged: (oldPath: string, newPath: string) => void;
  folderDeleted: (path: string) => void;
  setSwitcherOpen: (open: boolean) => void;
  showToast: (msg: string) => void;
  setSearchQuery: (query: string) => void;
  clearEditorLocation: () => void;
  setSelectedTag: (tag: string | null) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<SkaldState>((set, get) => ({
  phase: 'boot',
  snapshot: null,
  view: 'logbook',
  selectedPath: null,
  tabs: [{ kind: 'logbook', id: 'today' }],
  dirtyPaths: {},
  switcherOpen: false,
  toast: null,
  searchQuery: '',
  editorLocation: null,
  selectedTag: null,
  folderOpen: {},
  docStatus: {},
  setDocStatus: (d) => set({ docStatus: d }),

  boot: async () => {
    api.onVaultChanged((s) => get().applySnapshot(s));
    const last = await api.getLastVault();
    if (!last) {
      set({ phase: 'picker' });
      return;
    }
    try {
      const snapshot = await api.openVault(last);
      set({
        phase: 'ready',
        snapshot,
        folderOpen: loadExplorerState(
          rendererStorage(),
          snapshot.vaultPath,
          allFolders(snapshot.tree).map((folder) => folder.path)
        ),
      });
    } catch {
      set({ phase: 'picker' });
    }
  },

  openVaultAt: async (path, createNew) => {
    const snapshot = createNew ? await api.createVault(path) : await api.openVault(path);
    set({
      phase: 'ready',
      snapshot,
      view: 'logbook',
      tabs: [{ kind: 'logbook', id: 'today' }],
      selectedPath: null,
      dirtyPaths: {},
      folderOpen: loadExplorerState(
        rendererStorage(),
        snapshot.vaultPath,
        allFolders(snapshot.tree).map((folder) => folder.path)
      ),
    });
  },

  switchVault: () => set({ phase: 'picker' }),

  applySnapshot: (s) => {
    const { tabs, selectedPath, view } = get();
    const alive = new Set(s.notes.map((n) => n.path));
    const nextTabs = tabs.filter((t) => t.kind === 'logbook' || alive.has(t.id));
    const patch: Partial<SkaldState> = { snapshot: s, tabs: nextTabs };
    if (selectedPath && !alive.has(selectedPath)) {
      patch.selectedPath = null;
      if (view === 'editor') patch.view = 'logbook';
    }
    set(patch);
  },

  setView: (v) => set({ view: v }),

  openNote: (path) => {
    const { tabs, folderOpen, snapshot } = get();
    const next = tabs.some((t) => t.id === path)
      ? tabs
      : [...tabs, { kind: 'editor' as const, id: path }];
    const nextFolderOpen = { ...folderOpen, ...expansionPatch(ancestorFolderPaths(path), true) };
    set({
      tabs: next,
      selectedPath: path,
      view: 'editor',
      // A note opened from search or a wikilink is worth seeing in the tree,
      // even when its folder was collapsed.
      folderOpen: nextFolderOpen,
    });
    if (snapshot) saveExplorerState(rendererStorage(), snapshot.vaultPath, nextFolderOpen);
  },

  openNoteAt: (path, line, column, length) => {
    get().openNote(path);
    set({ editorLocation: { path, line, column, length } });
  },

  openNotes: (paths) => {
    if (!paths.length) return;
    const { tabs, folderOpen, snapshot } = get();
    const known = new Set(tabs.map((t) => t.id));
    const added = paths
      .filter((p) => !known.has(p))
      .map((p) => ({ kind: 'editor' as const, id: p }));
    const nextFolderOpen = { ...folderOpen, ...expansionPatch(ancestorFolderPaths(paths[0]), true) };
    set({
      tabs: [...tabs, ...added],
      selectedPath: paths[0],
      view: 'editor',
      folderOpen: nextFolderOpen,
    });
    if (snapshot) saveExplorerState(rendererStorage(), snapshot.vaultPath, nextFolderOpen);
  },

  toggleFolder: (path) => {
    const { folderOpen, snapshot } = get();
    const next = { ...folderOpen, [path]: !isFolderOpen(folderOpen, path) };
    set({ folderOpen: next });
    if (snapshot) saveExplorerState(rendererStorage(), snapshot.vaultPath, next);
  },

  setFoldersOpen: (patch) => {
    const { folderOpen, snapshot } = get();
    const next = { ...folderOpen, ...patch };
    set({ folderOpen: next });
    if (snapshot) saveExplorerState(rendererStorage(), snapshot.vaultPath, next);
  },

  openLogbook: () => {
    const { tabs } = get();
    const next = tabs.some((t) => t.kind === 'logbook')
      ? tabs
      : [{ kind: 'logbook' as const, id: 'today' }, ...tabs];
    set({ tabs: next, view: 'logbook' });
  },

  closeTab: (id) => {
    const { tabs, view, selectedPath } = get();
    const closing = tabs.find((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    const patch: Partial<SkaldState> = { tabs: next };
    const wasActive =
      (closing?.kind === 'logbook' && view === 'logbook') ||
      (closing?.kind === 'editor' && view === 'editor' && selectedPath === id);
    if (wasActive) {
      const fallback = next[next.length - 1];
      if (!fallback) {
        patch.view = 'logbook';
        patch.tabs = [{ kind: 'logbook', id: 'today' }];
      } else if (fallback.kind === 'logbook') {
        patch.view = 'logbook';
      } else {
        patch.view = 'editor';
        patch.selectedPath = fallback.id;
      }
    }
    set(patch);
  },

  closeOtherTabs: (id) => {
    for (const closeId of idsToCloseOthers(get().tabs, id)) get().closeTab(closeId);
  },

  closeTabsToRight: (id) => {
    for (const closeId of idsToCloseRight(get().tabs, id)) get().closeTab(closeId);
  },

  setTabPinned: (id, pinned) => set((st) => ({ tabs: pinTab(st.tabs, id, pinned) })),

  reorderTab: (draggedId, targetId) =>
    set((st) => ({ tabs: reorderTabs(st.tabs, draggedId, targetId) })),

  setDirty: (path, dirty) =>
    set((st) => ({ dirtyPaths: { ...st.dirtyPaths, [path]: dirty } })),

  notePathRenamed: (oldPath, newPath) =>
    set((st) => ({
      tabs: st.tabs.map((t) => (t.id === oldPath ? { ...t, id: newPath } : t)),
      selectedPath: st.selectedPath === oldPath ? newPath : st.selectedPath,
    })),

  pathsChanged: (changes) => {
    const moved = new Map(changes.map((change) => [change.oldPath, change.newPath]));
    set((st) => {
      const dirtyPaths: Record<string, boolean> = {};
      for (const [path, dirty] of Object.entries(st.dirtyPaths)) {
        dirtyPaths[moved.get(path) ?? path] = dirty;
      }
      return {
        tabs: st.tabs.map((tab) => ({ ...tab, id: moved.get(tab.id) ?? tab.id })),
        selectedPath: st.selectedPath ? moved.get(st.selectedPath) ?? st.selectedPath : null,
        dirtyPaths,
      };
    });
  },

  folderPathChanged: (oldPath, newPath) => {
    const { folderOpen, snapshot } = get();
    const next = moveExplorerFolder(folderOpen, oldPath, newPath);
    set({ folderOpen: next });
    if (snapshot) saveExplorerState(rendererStorage(), snapshot.vaultPath, next);
  },

  folderDeleted: (path) => {
    const { folderOpen, snapshot } = get();
    const next = removeExplorerFolder(folderOpen, path);
    set({ folderOpen: next });
    if (snapshot) saveExplorerState(rendererStorage(), snapshot.vaultPath, next);
  },

  setSwitcherOpen: (open) => set({ switcherOpen: open }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  clearEditorLocation: () => set({ editorLocation: null }),
  setSelectedTag: (tag) => set({ selectedTag: tag }),

  showToast: (msg) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = setTimeout(() => set({ toast: null }), 2600);
  },
}));

// ---------- tiny date helpers used across views ----------

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function relTime(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo` : `${Math.floor(mo / 12)}y`;
}

export function relTimeLong(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dayDiff = Math.floor(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86400000
  );
  if (dayDiff <= 0) return `today · ${time}`;
  if (dayDiff === 1) return `yesterday · ${time}`;
  if (dayDiff < 7) return `${dayDiff} days ago`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
