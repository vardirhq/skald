import { useEffect, useMemo, useRef, useState } from 'react';
import type { FolderNode, NoteMeta, VaultSnapshot } from '../../src-shared/types';
import { Icon } from '../ui/icons';
import { Rune, schemaTone } from '../ui/runes';
import { ContextMenu, ctxItems, useContextMenu, CTX_SEP, type CtxItem } from '../ui/contextMenu';
import { NewNoteDialog, TextDialog, ConfirmDialog, FolderDialog } from '../ui/dialogs';
import { copyText } from '../ui/clipboard';
import { api } from '../api';
import { useStore, todayISO } from '../store';
import { activityFor } from './ActivityBar';
import {
  allFolders,
  countNotes,
  descendantFolderPaths,
  expansionPatch,
  folderNotePaths,
  isFolderOpen,
  isolatePatch,
  parentFolderPath,
  someCollapsed,
  someExpanded,
  visibleTreeItems,
} from './tree';

type DialogState =
  | { kind: 'new-note'; folder?: string }
  | { kind: 'new-folder'; parent?: string }
  | { kind: 'rename'; path: string; title: string }
  | { kind: 'delete'; path: string; title: string }
  | { kind: 'delete-many'; paths: string[] }
  | { kind: 'move-notes'; paths: string[] }
  | { kind: 'rename-folder'; path: string; name: string }
  | { kind: 'move-folder'; path: string }
  | { kind: 'delete-folder'; path: string; name: string; notes: number }
  | { kind: 'open-many'; paths: string[]; where: string }
  | null;

/** Above this many notes, opening a whole folder asks first. */
const BULK_OPEN_PROMPT = 12;

export function Sidebar() {
  const snapshot = useStore((s) => s.snapshot);
  const view = useStore((s) => s.view);
  if (!snapshot) return null;
  const activity = activityFor(view);
  const titles: Record<string, string> = {
    explorer: 'Explorer',
    tasks: 'Tasks',
    graph: 'Graph',
    search: 'Search',
    settings: 'Settings',
  };
  return (
    <aside className="sidebar">
      <SidebarHead snapshot={snapshot} />
      <div className="sidebar__title">{titles[activity] ?? 'Explorer'}</div>
      <div className="sidebar__body">
        {activity === 'explorer' && <ExplorerTree snapshot={snapshot} />}
        {activity === 'tasks' && <TaskSidebar snapshot={snapshot} />}
        {activity === 'graph' && <GraphSidebar snapshot={snapshot} />}
        {activity === 'search' && <SearchSidebar snapshot={snapshot} />}
        {activity === 'settings' && (
          <div className="sidebar__hint">Settings open in the main view.</div>
        )}
      </div>
    </aside>
  );
}

function SidebarHead({ snapshot }: { snapshot: VaultSnapshot }) {
  const switchVault = useStore((s) => s.switchVault);
  const openNote = useStore((s) => s.openNote);
  const folderOpen = useStore((s) => s.folderOpen);
  const setFoldersOpen = useStore((s) => s.setFoldersOpen);
  const [dialog, setDialog] = useState<DialogState>(null);
  const { ctx, open, close } = useContextMenu();
  const everyFolderPath = useMemo(
    () => allFolders(snapshot.tree).map((f) => f.path),
    [snapshot.tree]
  );

  const vaultMenu: CtxItem[] = ctxItems(
    { label: 'Reveal vault in file manager', icon: 'external', onClick: () => void api.revealInFolder() },
    { label: 'New folder', icon: 'folder', onClick: () => setDialog({ kind: 'new-folder' }) },
    CTX_SEP,
    someCollapsed(folderOpen, everyFolderPath) && {
      label: 'Expand all folders',
      icon: 'expand',
      onClick: () => setFoldersOpen(expansionPatch(everyFolderPath, true)),
    },
    someExpanded(folderOpen, everyFolderPath) && {
      label: 'Collapse all folders',
      icon: 'collapse',
      onClick: () => setFoldersOpen(expansionPatch(everyFolderPath, false)),
    },
    CTX_SEP,
    { label: 'Switch vault…', icon: 'sync', onClick: switchVault }
  );

  return (
    <div className="sidebar__head">
      <button className="vault" onClick={(e) => open(e, vaultMenu)} title={snapshot.vaultPath}>
        <span className="vault__name">{snapshot.vaultName}</span>
        <Icon name="chevron" size={13} />
      </button>
      <div className="sidebar__head-actions">
        <button className="ic-btn sm" title="New note — ⌘N" onClick={() => setDialog({ kind: 'new-note' })}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      {ctx && <ContextMenu ctx={ctx} onClose={close} />}
      {dialog?.kind === 'new-note' && (
        <NewNoteDialog
          folders={allFolderPaths(snapshot.tree)}
          onCreate={async (title, folder, schema) => {
            const path = await api.createNote(folder, title, schema);
            openNote(path);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'new-folder' && (
        <TextDialog
          title="New folder"
          lede="A real directory inside the vault."
          label="Folder name"
          submitLabel="Create"
          onSubmit={(name) => api.createFolder(name)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

export function ExplorerTree({ snapshot }: { snapshot: VaultSnapshot }) {
  const view = useStore((s) => s.view);
  const selectedPath = useStore((s) => s.selectedPath);
  const openNote = useStore((s) => s.openNote);
  const openNotes = useStore((s) => s.openNotes);
  const openLogbook = useStore((s) => s.openLogbook);
  const folderOpen = useStore((s) => s.folderOpen);
  const toggleFolder = useStore((s) => s.toggleFolder);
  const setFoldersOpen = useStore((s) => s.setFoldersOpen);
  const notesByPath = useMemo(
    () => new Map(snapshot.notes.map((n) => [n.path, n])),
    [snapshot.notes]
  );
  const everyFolderPath = useMemo(
    () => allFolders(snapshot.tree).map((f) => f.path),
    [snapshot.tree]
  );
  const [dialog, setDialog] = useState<DialogState>(null);
  const [menuTarget, setMenuTarget] = useState<string | null>(null);
  const { ctx, open, close } = useContextMenu();
  const notePathRenamed = useStore((s) => s.notePathRenamed);
  const showToast = useStore((s) => s.showToast);
  const pinned = snapshot.settings.pinnedNote;
  const pathsChanged = useStore((s) => s.pathsChanged);
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(() => new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [cursorKey, setCursorKey] = useState<string | null>(selectedPath);
  const [dragging, setDragging] = useState<{ kind: 'note' | 'folder'; path: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ value: '', at: 0 });

  const visibleItems = useMemo(
    () => visibleTreeItems(snapshot.tree, folderOpen, new Map(snapshot.notes.map((n) => [n.path, n.title]))),
    [snapshot.tree, snapshot.notes, folderOpen]
  );
  const visibleNotePaths = useMemo(
    () => visibleItems.filter((item) => item.kind === 'note').map((item) => item.path),
    [visibleItems]
  );

  useEffect(() => {
    const alive = new Set(snapshot.notes.map((note) => note.path));
    setSelectedNotes((current) => {
      const next = new Set([...current].filter((path) => alive.has(path)));
      return next.size === current.size ? current : next;
    });
  }, [snapshot.notes]);

  const isOpen = (path: string) => isFolderOpen(folderOpen, path);

  /** Opens a menu and marks its row, so you can see what it belongs to. */
  const openMenu = (e: React.MouseEvent, target: string | null, items: CtxItem[]) => {
    setMenuTarget(target);
    open(e, items);
  };
  const closeMenu = () => {
    setMenuTarget(null);
    close();
  };

  const selectNote = (path: string, event: Pick<React.MouseEvent, 'shiftKey' | 'metaKey' | 'ctrlKey'>) => {
    if (event.shiftKey && selectionAnchor) {
      const a = visibleNotePaths.indexOf(selectionAnchor);
      const b = visibleNotePaths.indexOf(path);
      if (a !== -1 && b !== -1) {
        const [from, to] = a < b ? [a, b] : [b, a];
        setSelectedNotes(new Set(visibleNotePaths.slice(from, to + 1)));
      }
    } else if (event.metaKey || event.ctrlKey) {
      setSelectedNotes((current) => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      setSelectionAnchor(path);
    } else {
      setSelectedNotes(new Set([path]));
      setSelectionAnchor(path);
      openNote(path);
    }
    setCursorKey(path);
  };

  const selectionFor = (path: string): string[] =>
    selectedNotes.has(path) && selectedNotes.size > 1 ? [...selectedNotes] : [path];

  const focusTreeRow = (path: string) => {
    setCursorKey(path);
    requestAnimationFrame(() => {
      const rows = treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-key]');
      [...(rows ?? [])].find((row) => row.dataset.treeKey === path)?.focus();
    });
  };

  const onTreeKeyDown = (event: React.KeyboardEvent) => {
    if (!visibleItems.length || event.altKey || event.metaKey || event.ctrlKey) return;
    const current = Math.max(0, visibleItems.findIndex((item) => item.path === cursorKey));
    const item = visibleItems[current];
    let next = current;
    if (event.key === 'ArrowDown') next = Math.min(visibleItems.length - 1, current + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = visibleItems.length - 1;
    else if (event.key === 'ArrowRight' && item.kind === 'folder') {
      if (!isOpen(item.path)) toggleFolder(item.path);
      else next = Math.min(visibleItems.length - 1, current + 1);
    } else if (event.key === 'ArrowLeft') {
      if (item.kind === 'folder' && isOpen(item.path)) toggleFolder(item.path);
      else {
        const parent = parentFolderPath(item.path);
        const parentIndex = visibleItems.findIndex((candidate) => candidate.path === parent);
        if (parentIndex !== -1) next = parentIndex;
      }
    } else if (event.key === 'Enter') {
      if (item.kind === 'folder') toggleFolder(item.path);
      else openNote(item.path);
    } else if (event.key === ' ' && item.kind === 'note') {
      setSelectedNotes((currentSelection) => {
        const selected = new Set(currentSelection);
        if (selected.has(item.path)) selected.delete(item.path);
        else selected.add(item.path);
        return selected;
      });
      setSelectionAnchor(item.path);
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      const now = Date.now();
      typeahead.current.value =
        now - typeahead.current.at < 700
          ? typeahead.current.value + event.key.toLocaleLowerCase()
          : event.key.toLocaleLowerCase();
      typeahead.current.at = now;
      const query = typeahead.current.value;
      const ordered = [...visibleItems.slice(current + 1), ...visibleItems.slice(0, current + 1)];
      const hit = ordered.find((candidate) => candidate.label.toLocaleLowerCase().startsWith(query));
      if (hit) focusTreeRow(hit.path);
      event.preventDefault();
      return;
    } else return;
    event.preventDefault();
    if (next !== current) focusTreeRow(visibleItems[next].path);
  };

  const dropInto = async (folder: string) => {
    if (!dragging) return;
    try {
      if (dragging.kind === 'folder') {
        const changes = await api.moveFolder(dragging.path, folder);
        pathsChanged(changes);
      } else {
        const paths = selectedNotes.has(dragging.path) ? [...selectedNotes] : [dragging.path];
        const changes = await api.moveNotes(paths, folder);
        pathsChanged(changes);
        const moved = new Map(changes.map((change) => [change.oldPath, change.newPath]));
        setSelectedNotes(new Set(paths.map((path) => moved.get(path) ?? path)));
      }
      showToast(`Moved to ${folder || 'vault root'}`);
    } catch (err) {
      showToast(String((err as Error).message ?? err));
    } finally {
      setDragging(null);
      setDropTarget(null);
    }
  };

  /** Opens a folder's notes, asking first when that would flood the tab strip. */
  const openFolderNotes = (node: FolderNode) => {
    const paths = folderNotePaths(node);
    if (paths.length > BULK_OPEN_PROMPT) {
      setDialog({ kind: 'open-many', paths, where: node.name });
    } else {
      openNotes(paths);
    }
  };

  const noteMenu = (n: NoteMeta, forceSingle = false): CtxItem[] => {
    const paths = forceSingle ? [n.path] : selectionFor(n.path);
    const selected = paths.map((path) => notesByPath.get(path)).filter((note): note is NoteMeta => !!note);
    const many = paths.length > 1;
    return ctxItems(
      {
        label: many ? `Open ${paths.length} selected` : 'Open',
        icon: 'files',
        onClick: () => (many ? openNotes(paths) : openNote(n.path)),
      },
      {
        label: 'Reveal in file manager',
        icon: 'external',
        disabled: many,
        onClick: () => void api.showItemInFolder(n.path),
      },
      CTX_SEP,
      {
        label: many ? `Copy ${paths.length} wikilinks` : 'Copy wikilink',
        icon: 'copy',
        onClick: () =>
          copyText(
            selected.map((note) => `[[${note.title}]]`).join('\n'),
            many ? `${paths.length} wikilinks` : 'Wikilink',
            showToast
          ),
      },
      {
        label: many ? `Copy ${paths.length} paths` : 'Copy path',
        icon: 'copy',
        onClick: () => copyText(paths.join('\n'), many ? `${paths.length} paths` : 'Path', showToast),
      },
      CTX_SEP,
      {
        label: 'Rename…',
        icon: 'edit',
        disabled: many,
        onClick: () => setDialog({ kind: 'rename', path: n.path, title: n.title }),
      },
      {
        label: many ? `Move ${paths.length} notes…` : 'Move to…',
        icon: 'folder',
        onClick: () => setDialog({ kind: 'move-notes', paths }),
      },
      {
        label: pinned === n.path ? 'Unpin from logbook' : 'Pin to logbook',
        icon: 'pin',
        disabled: many,
        onClick: () => void api.setSettings({ pinnedNote: pinned === n.path ? null : n.path }),
      },
      CTX_SEP,
      {
        label: many ? `Delete ${paths.length} notes…` : 'Delete…',
        icon: 'trash',
        danger: true,
        onClick: () =>
          setDialog(
            many
              ? { kind: 'delete-many', paths }
              : { kind: 'delete', path: n.path, title: n.title }
          ),
      }
    );
  };

  const folderMenu = (node: FolderNode): CtxItem[] => {
    const subfolders = descendantFolderPaths(node);
    const branch = [node.path, ...subfolders];
    const notes = countNotes(node);
    // Everything outside this folder's own chain — what "collapse the rest" acts on.
    const elsewhere = everyFolderPath.filter(
      (p) => !branch.includes(p) && !node.path.startsWith(`${p}/`)
    );
    return ctxItems(
      {
        label: 'New note here…',
        icon: 'plus',
        onClick: () => setDialog({ kind: 'new-note', folder: node.path }),
      },
      {
        label: 'New subfolder…',
        icon: 'folder',
        onClick: () => setDialog({ kind: 'new-folder', parent: node.path }),
      },
      CTX_SEP,
      subfolders.length > 0 &&
        someCollapsed(folderOpen, branch) && {
          label: 'Expand subfolders',
          icon: 'expand',
          hint: String(subfolders.length),
          onClick: () => setFoldersOpen(expansionPatch(branch, true)),
        },
      subfolders.length > 0 &&
        someExpanded(folderOpen, subfolders) && {
          label: 'Collapse subfolders',
          icon: 'collapse',
          hint: String(subfolders.length),
          onClick: () => setFoldersOpen(expansionPatch(subfolders, false)),
        },
      someExpanded(folderOpen, elsewhere) && {
        label: 'Collapse everything else',
        icon: 'focus',
        onClick: () => setFoldersOpen(isolatePatch(snapshot.tree, node.path)),
      },
      CTX_SEP,
      notes > 0 && {
        label: 'Open all notes',
        icon: 'files',
        hint: String(notes),
        onClick: () => openFolderNotes(node),
      },
      notes > 0 && {
        label: 'Copy notes as links',
        icon: 'copy',
        hint: String(notes),
        onClick: () =>
          copyText(
            folderNotePaths(node)
              .map((p) => `- [[${notesByPath.get(p)?.title ?? p}]]`)
              .join('\n'),
            `${notes} links`,
            showToast
          ),
      },
      CTX_SEP,
      { label: 'Copy path', icon: 'copy', onClick: () => copyText(node.path, 'Path', showToast) },
      {
        label: 'Reveal in file manager',
        icon: 'external',
        onClick: () => void api.revealInFolder(node.path),
      },
      CTX_SEP,
      {
        label: 'Rename folder…',
        icon: 'edit',
        onClick: () => setDialog({ kind: 'rename-folder', path: node.path, name: node.name }),
      },
      {
        label: 'Move folder…',
        icon: 'folder',
        onClick: () => setDialog({ kind: 'move-folder', path: node.path }),
      },
      {
        label: 'Delete folder…',
        icon: 'trash',
        danger: true,
        onClick: () => setDialog({ kind: 'delete-folder', path: node.path, name: node.name, notes }),
      }
    );
  };

  /** Right-clicking the empty space around the tree acts on the vault. */
  const treeMenu = (): CtxItem[] =>
    ctxItems(
      { label: 'New note…', icon: 'plus', onClick: () => setDialog({ kind: 'new-note' }) },
      { label: 'New folder…', icon: 'folder', onClick: () => setDialog({ kind: 'new-folder' }) },
      CTX_SEP,
      someCollapsed(folderOpen, everyFolderPath) && {
        label: 'Expand all folders',
        icon: 'expand',
        onClick: () => setFoldersOpen(expansionPatch(everyFolderPath, true)),
      },
      someExpanded(folderOpen, everyFolderPath) && {
        label: 'Collapse all folders',
        icon: 'collapse',
        onClick: () => setFoldersOpen(expansionPatch(everyFolderPath, false)),
      },
      CTX_SEP,
      {
        label: 'Reveal vault in file manager',
        icon: 'external',
        onClick: () => void api.revealInFolder(),
      }
    );

  const renderNote = (path: string) => {
    const n = notesByPath.get(path);
    if (!n) return null;
    return (
      <button
        key={path}
        data-tree-key={path}
        tabIndex={cursorKey === path ? 0 : -1}
        draggable
        className={
          'tree__row' +
          (selectedPath === path && view === 'editor' ? ' is-active' : '') +
          (selectedNotes.has(path) ? ' is-selected' : '') +
          (menuTarget === path ? ' is-menu' : '')
        }
        onClick={(e) => selectNote(path, e)}
        onFocus={() => setCursorKey(path)}
        onDragStart={(e) => {
          setDragging({ kind: 'note', path });
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', path);
        }}
        onDragEnd={() => {
          setDragging(null);
          setDropTarget(null);
        }}
        onContextMenu={(e) => {
          if (!selectedNotes.has(path)) {
            setSelectedNotes(new Set([path]));
            setSelectionAnchor(path);
          }
          openMenu(e, path, noteMenu(n, !selectedNotes.has(path)));
        }}
        title={path}
      >
        <span className="tree__rune" style={{ color: schemaTone(n.schema) }}>
          <Rune schema={n.schema} size={14} />
        </span>
        <span className="tree__label">{n.title}</span>
      </button>
    );
  };

  const renderFolder = (node: FolderNode) => (
    <div key={node.path} className="tree__folder">
      <button
        data-tree-key={node.path}
        tabIndex={cursorKey === node.path ? 0 : -1}
        draggable
        className={
          'tree__folder-row' +
          (menuTarget === node.path ? ' is-menu' : '') +
          (dropTarget === node.path ? ' is-drop' : '')
        }
        aria-expanded={isOpen(node.path)}
        onClick={() => {
          setCursorKey(node.path);
          setSelectedNotes(new Set());
          toggleFolder(node.path);
        }}
        onFocus={() => setCursorKey(node.path)}
        onDragStart={(e) => {
          e.stopPropagation();
          setDragging({ kind: 'folder', path: node.path });
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', node.path);
        }}
        onDragOver={(e) => {
          if (!dragging || dragging.path === node.path) return;
          e.preventDefault();
          e.stopPropagation();
          setDropTarget(node.path);
        }}
        onDragLeave={() => setDropTarget((target) => (target === node.path ? null : target))}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void dropInto(node.path);
        }}
        onDragEnd={() => {
          setDragging(null);
          setDropTarget(null);
        }}
        onContextMenu={(e) => openMenu(e, node.path, folderMenu(node))}
        title={node.path}
      >
        <span className={'tree__caret' + (isOpen(node.path) ? ' is-open' : '')}>
          <Icon name="chevron" size={12} />
        </span>
        <span className="tree__folder-name">{node.name}</span>
        <span className="tree__count">{countNotes(node)}</span>
      </button>
      {isOpen(node.path) && (
        <div className="tree__children">
          {node.folders.map(renderFolder)}
          {node.notes.map(renderNote)}
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={treeRef}
      className={'tree tree--explorer' + (dropTarget === '' ? ' is-drop-root' : '')}
      role="tree"
      onKeyDown={onTreeKeyDown}
      onDragOver={(e) => {
        if (!dragging) return;
        e.preventDefault();
        setDropTarget('');
      }}
      onDrop={(e) => {
        if (!dragging) return;
        e.preventDefault();
        void dropInto('');
      }}
      onContextMenu={(e) => openMenu(e, null, treeMenu())}
    >
      <button
        className={'tree__special' + (view === 'logbook' ? ' is-active' : '')}
        onClick={openLogbook}
      >
        <span className="tree__special-rune" style={{ color: 'var(--schema-daily)' }}>
          <Rune schema="Daily" size={15} />
        </span>
        <span>Today</span>
        <span className="tree__special-meta">⌘D</span>
      </button>

      <button
        className={'tree__special' + (view === 'trash' ? ' is-active' : '')}
        onClick={() => useStore.getState().setView('trash')}
      >
        <span className="tree__glyph">↶</span>
        <span>Recently deleted</span>
      </button>

      <button
        className={'tree__special' + (view === 'tags' ? ' is-active' : '')}
        onClick={() => useStore.getState().setView('tags')}
      >
        <span className="tree__glyph">#</span>
        <span>Tags</span>
      </button>

      <div className="tree__divider" />

      {snapshot.tree.folders.map(renderFolder)}
      {snapshot.tree.notes.map(renderNote)}

      <div className="tree__footer">
        {snapshot.stats.notes} notes · {snapshot.stats.folders} folders
      </div>

      {ctx && <ContextMenu ctx={ctx} onClose={closeMenu} />}

      {dialog?.kind === 'new-note' && (
        <NewNoteDialog
          folders={allFolderPaths(snapshot.tree)}
          initialFolder={dialog.folder}
          onCreate={async (title, folder, schema) => {
            const path = await api.createNote(folder, title, schema);
            openNote(path);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'new-folder' && (
        <TextDialog
          title="New folder"
          lede={dialog.parent ? `Inside ${dialog.parent}/` : 'A real directory inside the vault.'}
          label="Folder name"
          submitLabel="Create"
          onSubmit={(name) =>
            api.createFolder(dialog.parent ? `${dialog.parent}/${name}` : name)
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <TextDialog
          title="Rename note"
          lede="Wikilinks pointing at this note are updated across the vault."
          label="New title"
          initial={dialog.title}
          submitLabel="Rename"
          onSubmit={async (name) => {
            const newPath = await api.renameNote(dialog.path, name);
            notePathRenamed(dialog.path, newPath);
            showToast(`Renamed to ${name}`);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'move-notes' && (
        <FolderDialog
          title={dialog.paths.length === 1 ? 'Move note' : `Move ${dialog.paths.length} notes`}
          lede="Wikilinks are updated across the vault when their paths need to change."
          folders={allFolderPaths(snapshot.tree)}
          initial={
            dialog.paths.every((path) => parentFolderPath(path) === parentFolderPath(dialog.paths[0]))
              ? parentFolderPath(dialog.paths[0])
              : ''
          }
          submitLabel="Move"
          onSubmit={async (folder) => {
            const changes = await api.moveNotes(dialog.paths, folder);
            pathsChanged(changes);
            const moved = new Map(changes.map((change) => [change.oldPath, change.newPath]));
            setSelectedNotes(new Set(dialog.paths.map((path) => moved.get(path) ?? path)));
            showToast(`Moved ${dialog.paths.length === 1 ? 'note' : `${dialog.paths.length} notes`}`);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename-folder' && (
        <TextDialog
          title="Rename folder"
          lede="Notes, histories, open tabs, and qualified wikilinks move with it."
          label="New name"
          initial={dialog.name}
          submitLabel="Rename"
          onSubmit={async (name) => {
            const changes = await api.renameFolder(dialog.path, name);
            pathsChanged(changes);
            showToast(`Renamed folder to ${name}`);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'move-folder' && (
        <FolderDialog
          title="Move folder"
          lede="The complete folder moves with all of its notes and attachments."
          folders={allFolderPaths(snapshot.tree).filter(
            (folder) => folder !== dialog.path && !folder.startsWith(`${dialog.path}/`)
          )}
          initial={parentFolderPath(dialog.path)}
          submitLabel="Move folder"
          onSubmit={async (folder) => {
            const changes = await api.moveFolder(dialog.path, folder);
            pathsChanged(changes);
            showToast('Moved folder');
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'open-many' && (
        <ConfirmDialog
          title={`Open ${dialog.paths.length} notes?`}
          lede={`Every note in ${dialog.where} gets its own tab.`}
          confirmLabel={`Open ${dialog.paths.length} notes`}
          onConfirm={async () => openNotes(dialog.paths)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete “${dialog.title}”?`}
          lede="The Markdown file is removed from the vault. Its latest version is retained in Skald history for recovery."
          confirmLabel="Delete note"
          danger
          onConfirm={() => api.deleteNote(dialog.path)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete-many' && (
        <ConfirmDialog
          title={`Delete ${dialog.paths.length} notes?`}
          lede="Their latest versions are retained in Skald history for recovery."
          confirmLabel={`Delete ${dialog.paths.length} notes`}
          danger
          onConfirm={async () => {
            await api.deleteNotes(dialog.paths);
            setSelectedNotes(new Set());
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete-folder' && (
        <ConfirmDialog
          title={`Delete “${dialog.name}”?`}
          lede={`The folder and everything inside it will be removed${dialog.notes ? `, including ${dialog.notes} note${dialog.notes === 1 ? '' : 's'}` : ''}. Deleted note text is retained in Skald history.`}
          confirmLabel="Delete folder"
          danger
          onConfirm={() => api.deleteFolder(dialog.path)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function TaskSidebar({ snapshot }: { snapshot: VaultSnapshot }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const views = [
    { id: 'tasks-table' as const, label: 'Table', icon: '≡' },
    { id: 'tasks-kanban' as const, label: 'Board', icon: '▦' },
    { id: 'tasks-calendar' as const, label: 'Calendar', icon: '▥' },
  ];
  const buckets = [
    { label: 'In progress', s: 'working', tone: 'var(--sy-blue)' },
    { label: 'Open', s: 'open', tone: 'var(--tx-2)' },
    { label: 'Blocked', s: 'blocked', tone: 'var(--err)' },
    { label: 'Done', s: 'done', tone: 'var(--ok)' },
  ];
  return (
    <div className="tree">
      <div className="tree__group-label">Views</div>
      {views.map((v) => (
        <button
          key={v.id}
          className={'tree__row mono-row' + (view === v.id ? ' is-active' : '')}
          onClick={() => setView(v.id)}
        >
          <span className="tree__glyph">{v.icon}</span>
          <span className="tree__label">{v.label}</span>
        </button>
      ))}
      <div className="tree__divider" />
      <div className="tree__group-label">Status</div>
      {buckets.map((b) => (
        <div key={b.s} className="tree__row mono-row no-hover">
          <span className="tree__statusdot" style={{ background: b.tone }} />
          <span className="tree__label">{b.label}</span>
          <span className="tree__count">
            {snapshot.tasks.filter((t) => t.status === b.s).length}
          </span>
        </div>
      ))}
      <div className="tree__divider" />
      <div className="tree__group-label">Due</div>
      <div className="tree__row mono-row no-hover">
        <span className="tree__statusdot" style={{ background: 'var(--err)' }} />
        <span className="tree__label">Overdue</span>
        <span className="tree__count">{snapshot.stats.overdue}</span>
      </div>
      <div className="tree__row mono-row no-hover">
        <span className="tree__statusdot" style={{ background: 'var(--warn)' }} />
        <span className="tree__label">Today</span>
        <span className="tree__count">
          {snapshot.tasks.filter((t) => t.due === todayISO() && t.status !== 'done').length}
        </span>
      </div>
    </div>
  );
}

function GraphSidebar({ snapshot }: { snapshot: VaultSnapshot }) {
  const clusters = useMemo(() => {
    const byFolder = new Map<string, number>();
    for (const n of snapshot.graph.nodes) {
      const f = n.folder || 'vault';
      byFolder.set(f, (byFolder.get(f) ?? 0) + 1);
    }
    return [...byFolder.entries()].sort((a, b) => b[1] - a[1]);
  }, [snapshot.graph.nodes]);

  const schemas = useMemo(() => {
    const set = new Map<string, number>();
    for (const n of snapshot.graph.nodes) set.set(n.schema, (set.get(n.schema) ?? 0) + 1);
    return [...set.entries()].sort((a, b) => b[1] - a[1]);
  }, [snapshot.graph.nodes]);

  return (
    <div className="tree">
      <div className="tree__group-label">Clusters</div>
      {clusters.map(([name, count]) => (
        <div key={name} className="tree__row mono-row no-hover">
          <span className="tree__statusdot" style={{ background: 'var(--ac)' }} />
          <span className="tree__label">{name}</span>
          <span className="tree__count">{count}</span>
        </div>
      ))}
      <div className="tree__divider" />
      <div className="tree__group-label">Schemas</div>
      {schemas.map(([s, count]) => (
        <div key={s} className="tree__row mono-row no-hover">
          <span className="tree__rune" style={{ color: schemaTone(s) }}>
            <Rune schema={s} size={14} />
          </span>
          <span className="tree__label">{s}</span>
          <span className="tree__count">{count}</span>
        </div>
      ))}
    </div>
  );
}

function SearchSidebar({ snapshot }: { snapshot: VaultSnapshot }) {
  const query = useStore((state) => state.searchQuery);
  const setQuery = useStore((state) => state.setSearchQuery);
  const setView = useStore((state) => state.setView);
  const saved = snapshot.settings.savedSearches;
  return (
    <div className="tree">
      <div className="tree__group-label">Saved searches</div>
      {saved.map((item) => (
        <div key={item.id} className="saved-search">
          <button
            className={'tree__row mono-row' + (query === item.query ? ' is-active' : '')}
            onClick={() => {
              setQuery(item.query);
              setView('search');
            }}
            title={item.query}
          >
            <span className="tree__glyph">⌕</span>
            <span className="tree__label">{item.name}</span>
          </button>
          <button
            className="saved-search__remove"
            title="Remove saved search"
            onClick={() =>
              void api.setSettings({ savedSearches: saved.filter((candidate) => candidate.id !== item.id) })
            }
          >
            ×
          </button>
        </div>
      ))}
      {!saved.length && (
        <div className="sidebar__hint">Saved searches appear here for one-click access.</div>
      )}
      <div className="tree__divider" />
      <div className="sidebar__hint">
        Search note bodies and narrow them with <code>schema:</code>, <code>tag:</code>, or <code>folder:</code>.
      </div>
    </div>
  );
}

export function allFolderPaths(root: FolderNode): string[] {
  const out: string[] = [];
  const walk = (n: FolderNode) => {
    if (n.path) out.push(n.path);
    n.folders.forEach(walk);
  };
  walk(root);
  return out.sort();
}
