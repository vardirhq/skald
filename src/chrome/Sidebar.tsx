import { useMemo, useState } from 'react';
import type { FolderNode, NoteMeta, VaultSnapshot } from '../../src-shared/types';
import { Icon } from '../ui/icons';
import { Rune, schemaTone } from '../ui/runes';
import { ContextMenu, ctxItems, useContextMenu, CTX_SEP, type CtxItem } from '../ui/contextMenu';
import { NewNoteDialog, TextDialog, ConfirmDialog } from '../ui/dialogs';
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
  someCollapsed,
  someExpanded,
} from './tree';

type DialogState =
  | { kind: 'new-note'; folder?: string }
  | { kind: 'new-folder'; parent?: string }
  | { kind: 'rename'; path: string; title: string }
  | { kind: 'delete'; path: string; title: string }
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

  /** Opens a folder's notes, asking first when that would flood the tab strip. */
  const openFolderNotes = (node: FolderNode) => {
    const paths = folderNotePaths(node);
    if (paths.length > BULK_OPEN_PROMPT) {
      setDialog({ kind: 'open-many', paths, where: node.name });
    } else {
      openNotes(paths);
    }
  };

  const noteMenu = (n: NoteMeta): CtxItem[] =>
    ctxItems(
      { label: 'Open', icon: 'files', onClick: () => openNote(n.path) },
      {
        label: 'Reveal in file manager',
        icon: 'external',
        onClick: () => void api.showItemInFolder(n.path),
      },
      CTX_SEP,
      {
        label: 'Copy wikilink',
        icon: 'copy',
        onClick: () => copyText(`[[${n.title}]]`, 'Wikilink', showToast),
      },
      { label: 'Copy path', icon: 'copy', onClick: () => copyText(n.path, 'Path', showToast) },
      CTX_SEP,
      {
        label: 'Rename…',
        icon: 'edit',
        onClick: () => setDialog({ kind: 'rename', path: n.path, title: n.title }),
      },
      {
        label: pinned === n.path ? 'Unpin from logbook' : 'Pin to logbook',
        icon: 'pin',
        onClick: () => void api.setSettings({ pinnedNote: pinned === n.path ? null : n.path }),
      },
      CTX_SEP,
      {
        label: 'Delete…',
        icon: 'trash',
        danger: true,
        onClick: () => setDialog({ kind: 'delete', path: n.path, title: n.title }),
      }
    );

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
        className={
          'tree__row' +
          (selectedPath === path && view === 'editor' ? ' is-active' : '') +
          (menuTarget === path ? ' is-menu' : '')
        }
        onClick={() => openNote(path)}
        onContextMenu={(e) => openMenu(e, path, noteMenu(n))}
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
        className={'tree__folder-row' + (menuTarget === node.path ? ' is-menu' : '')}
        aria-expanded={isOpen(node.path)}
        onClick={() => toggleFolder(node.path)}
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
    <div className="tree tree--explorer" onContextMenu={(e) => openMenu(e, null, treeMenu())}>
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
          lede="The Markdown file is removed from disk. This cannot be undone from inside Skald."
          confirmLabel="Delete note"
          danger
          onConfirm={() => api.deleteNote(dialog.path)}
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

export function allFolderPaths(root: FolderNode): string[] {
  const out: string[] = [];
  const walk = (n: FolderNode) => {
    if (n.path) out.push(n.path);
    n.folders.forEach(walk);
  };
  walk(root);
  return out.sort();
}
