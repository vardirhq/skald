import { describe, expect, it } from 'vitest';
import type { FolderNode } from '../src-shared/types';
import {
  allFolders,
  ancestorFolderPaths,
  countNotes,
  descendantFolderPaths,
  expansionPatch,
  findFolder,
  folderNotePaths,
  isFolderOpen,
  isolatePatch,
  parentFolderPath,
  someCollapsed,
  someExpanded,
  visibleTreeItems,
} from '../src/chrome/tree';

function folder(path: string, folders: FolderNode[] = [], notes: string[] = []): FolderNode {
  return { name: path.split('/').pop() ?? '', path, folders, notes };
}

//   (root)
//   ├── Work            Work/plan.md
//   │   ├── Q3          Work/Q3/goals.md, Work/Q3/notes.md
//   │   └── Archive
//   ├── Personal        Personal/gym.md
//   └── inbox.md
const tree: FolderNode = {
  name: '',
  path: '',
  notes: ['inbox.md'],
  folders: [
    folder(
      'Work',
      [folder('Work/Q3', [], ['Work/Q3/goals.md', 'Work/Q3/notes.md']), folder('Work/Archive')],
      ['Work/plan.md']
    ),
    folder('Personal', [], ['Personal/gym.md']),
  ],
};

describe('tree walking', () => {
  it('lists every folder below the root, root excluded', () => {
    expect(allFolders(tree).map((f) => f.path)).toEqual([
      'Work',
      'Work/Q3',
      'Work/Archive',
      'Personal',
    ]);
  });

  it('finds a folder by path and reports a miss', () => {
    expect(findFolder(tree, 'Work/Q3')?.name).toBe('Q3');
    expect(findFolder(tree, 'Work/Q4')).toBeNull();
  });

  it('lists descendants without the folder itself', () => {
    expect(descendantFolderPaths(findFolder(tree, 'Work')!)).toEqual(['Work/Q3', 'Work/Archive']);
    expect(descendantFolderPaths(findFolder(tree, 'Personal')!)).toEqual([]);
  });

  it('collects notes depth first, subfolders included', () => {
    expect(folderNotePaths(findFolder(tree, 'Work')!)).toEqual([
      'Work/plan.md',
      'Work/Q3/goals.md',
      'Work/Q3/notes.md',
    ]);
    expect(countNotes(findFolder(tree, 'Work')!)).toBe(3);
    expect(countNotes(tree)).toBe(5);
  });
});

describe('visible keyboard rows', () => {
  const labels = new Map([
    ['inbox.md', 'Inbox'],
    ['Work/plan.md', 'Plan'],
    ['Work/Q3/goals.md', 'Goals'],
    ['Work/Q3/notes.md', 'Notes'],
    ['Personal/gym.md', 'Gym'],
  ]);

  it('follows rendered order and skips descendants of collapsed folders', () => {
    expect(visibleTreeItems(tree, { 'Work/Q3': false }, labels).map((item) => item.path)).toEqual([
      'Work',
      'Work/Q3',
      'Work/Archive',
      'Work/plan.md',
      'Personal',
      'Personal/gym.md',
      'inbox.md',
    ]);
  });
});

describe('paths', () => {
  it('derives ancestors, itself excluded', () => {
    expect(ancestorFolderPaths('Work/Q3/goals.md')).toEqual(['Work', 'Work/Q3']);
    expect(ancestorFolderPaths('Work')).toEqual([]);
    expect(ancestorFolderPaths('inbox.md')).toEqual([]);
  });

  it('derives the parent folder, empty at the vault root', () => {
    expect(parentFolderPath('Work/Q3/goals.md')).toBe('Work/Q3');
    expect(parentFolderPath('inbox.md')).toBe('');
  });
});

describe('expansion state', () => {
  it('treats unknown folders as open', () => {
    expect(isFolderOpen({}, 'Work')).toBe(true);
    expect(isFolderOpen({ Work: false }, 'Work')).toBe(false);
  });

  it('builds a patch over the given paths only', () => {
    expect(expansionPatch(['Work', 'Work/Q3'], false)).toEqual({
      Work: false,
      'Work/Q3': false,
    });
    expect(expansionPatch([], true)).toEqual({});
  });

  it('reports whether any of the paths are collapsed or expanded', () => {
    const state = { Work: false };
    expect(someCollapsed(state, ['Work', 'Personal'])).toBe(true);
    expect(someExpanded(state, ['Work', 'Personal'])).toBe(true);
    expect(someCollapsed(state, ['Personal'])).toBe(false);
    expect(someExpanded(state, ['Work'])).toBe(false);
    expect(someExpanded({}, [])).toBe(false);
  });

  it('isolates a branch by collapsing everything outside its chain', () => {
    expect(isolatePatch(tree, 'Work/Q3')).toEqual({
      Work: true,
      'Work/Q3': true,
      'Work/Archive': false,
      Personal: false,
    });
  });

  it('isolating a top level folder collapses its own subfolders too', () => {
    expect(isolatePatch(tree, 'Work')).toEqual({
      Work: true,
      'Work/Q3': false,
      'Work/Archive': false,
      Personal: false,
    });
  });
});
