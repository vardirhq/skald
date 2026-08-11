export interface Tab {
  kind: 'logbook' | 'editor';
  /** 'today' for the logbook tab, note path for editor tabs */
  id: string;
  /** Pinned tabs stay left and survive bulk close operations. */
  pinned?: boolean;
}

export function pinTab(tabs: Tab[], id: string, pinned: boolean): Tab[] {
  const tab = tabs.find((item) => item.id === id);
  if (!tab || !!tab.pinned === pinned) return tabs;
  const rest = tabs.filter((item) => item.id !== id);
  const updated = { ...tab, pinned };
  if (pinned) {
    let lastPinned = -1;
    for (let i = rest.length - 1; i >= 0; i--) {
      if (rest[i].pinned) {
        lastPinned = i;
        break;
      }
    }
    return [...rest.slice(0, lastPinned + 1), updated, ...rest.slice(lastPinned + 1)];
  }
  const pinnedCount = rest.filter((item) => item.pinned).length;
  return [...rest.slice(0, pinnedCount), updated, ...rest.slice(pinnedCount)];
}

export function reorderTabs(tabs: Tab[], draggedId: string, targetId: string): Tab[] {
  const from = tabs.findIndex((tab) => tab.id === draggedId);
  const target = tabs.findIndex((tab) => tab.id === targetId);
  if (from === -1 || target === -1 || from === target) return tabs;
  const dragged = tabs[from];
  const sameGroup = tabs[target].pinned === dragged.pinned;
  if (!sameGroup) return tabs;
  const next = [...tabs];
  next.splice(from, 1);
  const adjusted = from < target ? target - 1 : target;
  next.splice(adjusted, 0, dragged);
  return next;
}

export function idsToCloseOthers(tabs: Tab[], id: string): string[] {
  return tabs.filter((tab) => tab.id !== id && !tab.pinned).map((tab) => tab.id);
}

export function idsToCloseRight(tabs: Tab[], id: string): string[] {
  const index = tabs.findIndex((tab) => tab.id === id);
  return index === -1
    ? []
    : tabs.slice(index + 1).filter((tab) => !tab.pinned).map((tab) => tab.id);
}
