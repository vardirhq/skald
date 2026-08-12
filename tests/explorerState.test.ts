import { describe, expect, it } from 'vitest';
import {
  explorerStateKey,
  loadExplorerState,
  moveExplorerFolder,
  pruneExplorerState,
  removeExplorerFolder,
  saveExplorerState,
  type KeyValueStorage,
} from '../src/chrome/explorerState';

class MemoryStorage implements KeyValueStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('explorer persistence', () => {
  it('keeps independent state for each vault and restores booleans only', () => {
    const storage = new MemoryStorage();
    saveExplorerState(storage, '/vault/one', { Work: false, Personal: true });
    saveExplorerState(storage, '/vault/two', { Archive: false });

    expect(loadExplorerState(storage, '/vault/one', ['Work', 'Personal'])).toEqual({
      Work: false,
      Personal: true,
    });
    expect(loadExplorerState(storage, '/vault/two', ['Archive'])).toEqual({ Archive: false });
    expect(explorerStateKey('/vault/one')).not.toBe(explorerStateKey('/vault/two'));
  });

  it('ignores corrupt storage and folders that no longer exist', () => {
    const storage = new MemoryStorage();
    storage.setItem(explorerStateKey('/vault'), '{broken');
    expect(loadExplorerState(storage, '/vault', ['Work'])).toEqual({});

    expect(pruneExplorerState({ Work: false, Gone: true }, ['Work'])).toEqual({ Work: false });
  });

  it('moves expansion state for a folder and all descendants', () => {
    expect(moveExplorerFolder(
      { Projects: false, 'Projects/Skald': true, Personal: false },
      'Projects',
      'Archive/Projects'
    )).toEqual({
      'Archive/Projects': false,
      'Archive/Projects/Skald': true,
      Personal: false,
    });
  });

  it('removes deleted folder state and descendants without touching siblings', () => {
    expect(removeExplorerFolder(
      { Projects: false, 'Projects/Skald': true, Personal: false },
      'Projects'
    )).toEqual({ Personal: false });
  });

  it('fails open when browser storage is unavailable', () => {
    expect(loadExplorerState(null, '/vault', ['Work'])).toEqual({});
    expect(() => saveExplorerState(null, '/vault', { Work: false })).not.toThrow();
  });
});
