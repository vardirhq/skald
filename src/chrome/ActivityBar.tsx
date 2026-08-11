import { Icon } from '../ui/icons';
import { useStore, type View } from '../store';

export function activityFor(view: View): string {
  if (view === 'logbook' || view === 'editor' || view === 'trash' || view === 'tags') return 'explorer';
  if (view.startsWith('tasks')) return 'tasks';
  if (view === 'graph') return 'graph';
  if (view === 'search') return 'search';
  if (view === 'settings') return 'settings';
  return 'explorer';
}

export function ActivityBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const activity = activityFor(view);

  const items = [
    { id: 'explorer', icon: 'files', label: 'Explorer', go: () => setView(view === 'settings' || view === 'graph' || view.startsWith('tasks') ? 'logbook' : view) },
    { id: 'search', icon: 'search', label: 'Full-text search', go: () => setView('search') },
    { id: 'tasks', icon: 'tasks', label: 'Tasks', go: () => setView('tasks-table') },
    { id: 'graph', icon: 'graph', label: 'Graph — ⌘G', go: () => setView('graph') },
  ];

  return (
    <nav className="activitybar">
      <div className="activitybar__top">
        {items.map((it) => (
          <button
            key={it.id}
            className={'act' + (activity === it.id ? ' is-active' : '')}
            title={it.label}
            onClick={it.go}
          >
            <Icon name={it.icon} size={20} />
          </button>
        ))}
      </div>
      <div className="activitybar__bottom">
        <button
          className={'act' + (activity === 'settings' ? ' is-active' : '')}
          title="Settings"
          onClick={() => setView('settings')}
        >
          <Icon name="gear" size={20} />
        </button>
      </div>
    </nav>
  );
}
