import { Fragment, useEffect, useState } from 'react';
import { useStore } from './store';
import { TitleBar } from './chrome/TitleBar';
import { ActivityBar } from './chrome/ActivityBar';
import { Sidebar, allFolderPaths } from './chrome/Sidebar';
import { TabStrip } from './chrome/TabStrip';
import { StatusBar } from './chrome/StatusBar';
import { LogbookView } from './views/Logbook';
import { EditorView } from './views/Editor';
import { TasksView } from './views/Tasks';
import { ConstellationView } from './views/Graph';
import { SettingsView } from './views/Settings';
import { Switcher } from './views/Switcher';
import { SearchView } from './views/Search';
import { TrashView } from './views/Trash';
import { TagsView } from './views/Tags';
import { VaultPicker } from './views/VaultPicker';
import { NewNoteDialog } from './ui/dialogs';
import { api } from './api';
import { todayISO } from './store';

export default function App() {
  const phase = useStore((s) => s.phase);
  const snapshot = useStore((s) => s.snapshot);
  const view = useStore((s) => s.view);
  const selectedPath = useStore((s) => s.selectedPath);
  const setView = useStore((s) => s.setView);
  const openNote = useStore((s) => s.openNote);
  const openLogbook = useStore((s) => s.openLogbook);
  const setSwitcherOpen = useStore((s) => s.setSwitcherOpen);
  const switcherOpen = useStore((s) => s.switcherOpen);
  const boot = useStore((s) => s.boot);
  const toast = useStore((s) => s.toast);
  const docStatus = useStore((s) => s.docStatus);
  const [newNoteOpen, setNewNoteOpen] = useState(false);

  useEffect(() => {
    void boot();
  }, []);

  // theme + density on the root element
  useEffect(() => {
    const settings = snapshot?.settings;
    document.documentElement.setAttribute('data-theme', settings?.theme ?? 'midnight');
    document.documentElement.setAttribute('data-density', settings?.density ?? 'regular');
  }, [snapshot?.settings.theme, snapshot?.settings.density]);

  // global keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) {
        if (e.key === 'Escape') setSwitcherOpen(false);
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'k' || key === 'p') {
        e.preventDefault();
        setSwitcherOpen(true);
      } else if (key === 'd') {
        e.preventDefault();
        openLogbook();
      } else if (key === 'g') {
        e.preventDefault();
        setView('graph');
      } else if (key === 'n') {
        e.preventDefault();
        setNewNoteOpen(true);
      } else if (key === 'b') {
        e.preventDefault();
        const s = useStore.getState().snapshot;
        if (s) void api.setSettings({ marginOn: !s.settings.marginOn });
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  if (phase === 'boot') {
    return <div className="app" style={{ background: 'var(--bg-0)' }} />;
  }

  if (phase === 'picker' || !snapshot) {
    return (
      <div className="app" style={{ gridTemplateRows: '1fr' }}>
        <VaultPicker />
      </div>
    );
  }

  const note = snapshot.notes.find((n) => n.path === selectedPath);
  const crumb: string[] =
    view === 'editor'
      ? [snapshot.vaultName, note?.folder || 'vault', note?.title ?? '']
      : view === 'logbook'
        ? [snapshot.vaultName, 'Daily', todayISO()]
        : view.startsWith('tasks')
          ? [
              snapshot.vaultName,
              'Tasks',
              view === 'tasks-table' ? 'Table' : view === 'tasks-kanban' ? 'Board' : 'Calendar',
            ]
          : view === 'graph'
            ? [snapshot.vaultName, 'Graph']
            : view === 'search'
              ? [snapshot.vaultName, 'Search']
            : view === 'trash'
              ? [snapshot.vaultName, 'Recently deleted']
            : view === 'tags'
              ? [snapshot.vaultName, 'Tags']
            : [snapshot.vaultName, 'Settings'];

  const fullBleed = view === 'settings';

  return (
    <div className="app">
      <TitleBar />

      <div className="app-body">
        <ActivityBar />
        <Sidebar />

        <main className="main">
          <TabStrip />
          <div className="breadcrumb">
            {crumb.filter(Boolean).map((c, i, arr) => (
              <Fragment key={i}>
                <span className={'seg' + (i === arr.length - 1 ? ' leaf' : '')}>{c}</span>
                {i < arr.length - 1 && <span className="sep">›</span>}
              </Fragment>
            ))}
          </div>

          <div className="view-host">
            {view === 'editor' && selectedPath && note && (
              <EditorView snapshot={snapshot} path={selectedPath} />
            )}
            {view === 'editor' && selectedPath && !note && (
              <div className="empty-note">This note is syncing — it will open in a moment.</div>
            )}
            {view === 'editor' && !selectedPath && (
              <div className="empty-note">No note open. ⌘K to find one.</div>
            )}
            {view === 'logbook' && <LogbookView snapshot={snapshot} />}
            {view.startsWith('tasks') && <TasksView snapshot={snapshot} view={view} />}
            {view === 'graph' && <ConstellationView snapshot={snapshot} />}
            {view === 'search' && <SearchView snapshot={snapshot} />}
            {view === 'trash' && <TrashView />}
            {view === 'tags' && <TagsView snapshot={snapshot} />}
            {fullBleed && <SettingsView snapshot={snapshot} />}
          </div>
        </main>
      </div>

      <StatusBar
        doc={
          view === 'editor'
            ? docStatus
            : view === 'logbook'
              ? { schema: 'Daily' }
              : {}
        }
      />

      {switcherOpen && (
        <Switcher snapshot={snapshot} onRequestNewNote={() => setNewNoteOpen(true)} />
      )}

      {newNoteOpen && (
        <NewNoteDialog
          folders={allFolderPaths(snapshot.tree)}
          onCreate={async (title, folder, schema) => {
            const path = await api.createNote(folder, title, schema);
            openNote(path);
          }}
          onClose={() => setNewNoteOpen(false)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
