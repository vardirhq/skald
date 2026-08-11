import { describe, expect, it } from 'vitest';
import { idsToCloseOthers, idsToCloseRight, pinTab, reorderTabs, type Tab } from '../src/chrome/tabs';

const tabs: Tab[] = [
  { kind: 'logbook', id: 'today' },
  { kind: 'editor', id: 'a' },
  { kind: 'editor', id: 'b' },
  { kind: 'editor', id: 'c' },
];

describe('tab operations', () => {
  it('groups pinned tabs at the left and unpins after the pinned group', () => {
    const pinned = pinTab(pinTab(tabs, 'b', true), 'today', true);
    expect(pinned.map((tab) => [tab.id, !!tab.pinned])).toEqual([
      ['b', true], ['today', true], ['a', false], ['c', false],
    ]);
    expect(pinTab(pinned, 'b', false).map((tab) => tab.id)).toEqual(['today', 'b', 'a', 'c']);
  });

  it('reorders within but not across pinned groups', () => {
    expect(reorderTabs(tabs, 'c', 'a').map((tab) => tab.id)).toEqual(['today', 'c', 'a', 'b']);
    const pinned = pinTab(tabs, 'b', true);
    expect(reorderTabs(pinned, 'b', 'a')).toBe(pinned);
  });

  it('keeps pinned tabs out of close-others and close-right batches', () => {
    const pinned = pinTab(tabs, 'b', true);
    expect(idsToCloseOthers(pinned, 'a')).toEqual(['today', 'c']);
    expect(idsToCloseRight(pinned, 'today')).toEqual(['a', 'c']);
  });
});
