// Pure helpers for reasoning about the explorer tree and its expansion state.
//
// Folders are open unless the state map says otherwise, so a fresh vault shows
// itself in full and only deliberate collapsing is remembered.

import type { FolderNode } from '../../src-shared/types';

export type FolderOpenState = Record<string, boolean>;

export function isFolderOpen(state: FolderOpenState, path: string): boolean {
  return state[path] ?? true;
}

/** Every folder below `root`, depth first. The root itself is not a folder. */
export function allFolders(root: FolderNode): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (n: FolderNode) => {
    for (const f of n.folders) {
      out.push(f);
      walk(f);
    }
  };
  walk(root);
  return out;
}

export function findFolder(root: FolderNode, path: string): FolderNode | null {
  if (root.path === path) return root;
  for (const f of root.folders) {
    const hit = findFolder(f, path);
    if (hit) return hit;
  }
  return null;
}

/** Paths of every folder inside `node`, excluding `node` itself. */
export function descendantFolderPaths(node: FolderNode): string[] {
  return allFolders(node).map((f) => f.path);
}

/** Note paths inside `node`, subfolders included, in tree order. */
export function folderNotePaths(node: FolderNode): string[] {
  const out = [...node.notes];
  for (const f of node.folders) out.push(...folderNotePaths(f));
  return out;
}

export function countNotes(node: FolderNode): number {
  return node.notes.length + node.folders.reduce((a, f) => a + countNotes(f), 0);
}

/** 'a/b/c' → ['a', 'a/b']. The path itself is not an ancestor of itself. */
export function ancestorFolderPaths(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** The folder a vault-relative path sits in ('' for the vault root). */
export function parentFolderPath(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

export function expansionPatch(paths: string[], open: boolean): FolderOpenState {
  const patch: FolderOpenState = {};
  for (const p of paths) patch[p] = open;
  return patch;
}

/**
 * Collapse the whole tree except the chain leading to `path`, which stays open.
 * Subfolders of `path` are collapsed too — the point is to see one branch
 * without the rest of the vault around it.
 */
export function isolatePatch(root: FolderNode, path: string): FolderOpenState {
  const keepOpen = new Set([...ancestorFolderPaths(path), path]);
  const patch: FolderOpenState = {};
  for (const f of allFolders(root)) patch[f.path] = keepOpen.has(f.path);
  return patch;
}

/** True when at least one of `paths` is currently collapsed. */
export function someCollapsed(state: FolderOpenState, paths: string[]): boolean {
  return paths.some((p) => !isFolderOpen(state, p));
}

/** True when at least one of `paths` is currently expanded. */
export function someExpanded(state: FolderOpenState, paths: string[]): boolean {
  return paths.some((p) => isFolderOpen(state, p));
}
