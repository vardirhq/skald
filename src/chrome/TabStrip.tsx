import { useMemo, useState } from 'react';
import { Rune, schemaTone } from '../ui/runes';
import { useStore, type View } from '../store';
import { titleFromPath } from '../../src-shared/notes';
import { ContextMenu, ctxItems, useContextMenu, CTX_SEP, type CtxItem } from '../ui/contextMenu';
import { idsToCloseOthers, idsToCloseRight, type Tab } from './tabs';

export function TabStrip() {
  const snapshot = useStore((s) => s.snapshot);
  const tabs = useStore((s) => s.tabs);
  const view = useStore((s) => s.view);
  const selectedPath = useStore((s) => s.selectedPath);
  const openNote = useStore((s) => s.openNote);
  const openLogbook = useStore((s) => s.openLogbook);
  const closeTab = useStore((s) => s.closeTab);
  const closeOtherTabs = useStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useStore((s) => s.closeTabsToRight);
  const setTabPinned = useStore((s) => s.setTabPinned);
  const reorderTab = useStore((s) => s.reorderTab);
  const dirtyPaths = useStore((s) => s.dirtyPaths);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const { ctx, open, close } = useContextMenu();

  const notesByPath = useMemo(
    () => new Map((snapshot?.notes ?? []).map((n) => [n.path, n])),
    [snapshot?.notes]
  );

  const special = specialFor(view);

  const menuFor = (tab: Tab): CtxItem[] =>
    ctxItems(
      {
        label: tab.pinned ? 'Unpin tab' : 'Pin tab',
        icon: 'pin',
        onClick: () => setTabPinned(tab.id, !tab.pinned),
      },
      CTX_SEP,
      { label: 'Close', hint: '⌘W', onClick: () => closeTab(tab.id) },
      idsToCloseOthers(tabs, tab.id).length > 0 && {
        label: 'Close others',
        onClick: () => closeOtherTabs(tab.id),
      },
      idsToCloseRight(tabs, tab.id).length > 0 && {
        label: 'Close to the right',
        onClick: () => closeTabsToRight(tab.id),
      }
    );

  const tabEvents = (tab: Tab) => ({
    draggable: true,
    onAuxClick: (event: React.MouseEvent) => {
      if (event.button === 1) closeTab(tab.id);
    },
    onContextMenu: (event: React.MouseEvent) => open(event, menuFor(tab)),
    onDragStart: (event: React.DragEvent) => {
      setDragging(tab.id);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', tab.id);
    },
    onDragOver: (event: React.DragEvent) => {
      if (!dragging || dragging === tab.id) return;
      event.preventDefault();
      setDropTarget(tab.id);
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      if (dragging) reorderTab(dragging, tab.id);
      setDragging(null);
      setDropTarget(null);
    },
    onDragEnd: () => {
      setDragging(null);
      setDropTarget(null);
    },
  });

  return (
    <div className="tabstrip">
      <div className="tabstrip__tabs">
        {tabs.map((tab) => {
          if (tab.kind === 'logbook') {
            const active = view === 'logbook';
            return (
              <div
                key={tab.id}
                className={'tab' + (active ? ' is-active' : '') + (tab.pinned ? ' is-pinned' : '') + (dropTarget === tab.id ? ' is-drop' : '')}
                onClick={openLogbook}
                {...tabEvents(tab)}
              >
                <span className="tab__rune" style={{ color: schemaTone('Daily') }}>
                  <Rune schema="Daily" size={13} />
                </span>
                <span className="tab__label">Today</span>
                {tab.pinned ? <span className="tab__pin" title="Pinned">◆</span> : <CloseBtn onClose={() => closeTab(tab.id)} />}
              </div>
            );
          }
          const note = notesByPath.get(tab.id);
          const active = view === 'editor' && selectedPath === tab.id;
          return (
            <div
              key={tab.id}
              className={
                'tab' +
                (active ? ' is-active' : '') +
                (tab.pinned ? ' is-pinned' : '') +
                (dropTarget === tab.id ? ' is-drop' : '')
              }
              onClick={() => openNote(tab.id)}
              title={tab.id}
              {...tabEvents(tab)}
            >
              <span className="tab__rune" style={{ color: schemaTone(note?.schema) }}>
                <Rune schema={note?.schema ?? 'Note'} size={13} />
              </span>
              <span className="tab__label">{(note?.title ?? titleFromPath(tab.id)) + '.md'}</span>
              {dirtyPaths[tab.id] && <span className="tab__dirty" />}
              {tab.pinned ? <span className="tab__pin" title="Pinned">◆</span> : <CloseBtn onClose={() => closeTab(tab.id)} />}
            </div>
          );
        })}
        {special && (
          <div className="tab is-active is-special">
            <span className="tab__glyph">{special.glyph}</span>
            <span className="tab__label">{special.label}</span>
          </div>
        )}
      </div>
      {ctx && <ContextMenu ctx={ctx} onClose={close} />}
    </div>
  );
}

function CloseBtn({ onClose }: { onClose: () => void }) {
  return (
    <button
      className="tab__close"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    </button>
  );
}

function specialFor(view: View): { glyph: string; label: string } | null {
  if (view.startsWith('tasks')) return { glyph: '▦', label: 'Tasks' };
  if (view === 'graph') return { glyph: '✦', label: 'Graph' };
  if (view === 'settings') return { glyph: '⚙', label: 'Settings' };
  if (view === 'trash') return { glyph: '↶', label: 'Recently deleted' };
  if (view === 'tags') return { glyph: '#', label: 'Tags' };
  return null;
}
