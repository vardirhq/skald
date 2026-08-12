import { useEffect, useMemo, useRef, useState } from 'react';
import type { VaultSnapshot } from '../../src-shared/types';
import { fuzzyMatch, highlightSegments } from '../../src-shared/fuzzy';
import { Rune, schemaTone } from '../ui/runes';
import { api } from '../api';
import { useStore, relTime } from '../store';
import { requestInsertMenu } from '../editor/events';

interface Item {
  type: 'note' | 'task' | 'command';
  id: string;
  label: string;
  schema?: string;
  folder: string;
  ts: string;
  score: number;
  indices: number[];
  run?: () => void;
}

export function Switcher({
  snapshot,
  onRequestNewNote,
}: {
  snapshot: VaultSnapshot;
  onRequestNewNote: () => void;
}) {
  const open = useStore((s) => s.switcherOpen);
  const setOpen = useStore((s) => s.setSwitcherOpen);
  const openNote = useStore((s) => s.openNote);
  const openLogbook = useStore((s) => s.openLogbook);
  const setView = useStore((s) => s.setView);
  const switchVault = useStore((s) => s.switchVault);
  const showToast = useStore((s) => s.showToast);
  const view = useStore((s) => s.view);
  const selectedPath = useStore((s) => s.selectedPath);

  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'note' | 'task' | 'command'>('all');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setFilter('all');
      setSel(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands = useMemo<Omit<Item, 'score' | 'indices'>[]>(
    () => [
      { type: 'command', id: 'c-new', label: 'New note…', folder: 'Vault', ts: '⌘N', run: onRequestNewNote },
      {
        type: 'command',
        id: 'c-daily',
        label: "Go to today's page",
        folder: 'Vault',
        ts: '⌘D',
        run: () => void api.createDailyNote().then((p) => openNote(p)),
      },
      { type: 'command', id: 'c-graph', label: 'Open graph view', folder: 'View', ts: '⌘G', run: () => setView('graph') },
      { type: 'command', id: 'c-tasks', label: 'Open task table', folder: 'View', ts: '↵', run: () => setView('tasks-table') },
      { type: 'command', id: 'c-logbook', label: 'Open logbook', folder: 'View', ts: '↵', run: openLogbook },
      {
        type: 'command',
        id: 'c-theme',
        label: 'Cycle theme',
        folder: 'Theme',
        ts: '↵',
        run: () => {
          const order = ['midnight', 'slate', 'light'] as const;
          const next = order[(order.indexOf(snapshot.settings.theme) + 1) % order.length];
          void api.setSettings({ theme: next });
          showToast(`Theme: ${next}`);
        },
      },
      {
        type: 'command',
        id: 'c-margin',
        label: 'Toggle right panel',
        folder: 'Editor',
        ts: '⌘B',
        run: () => void api.setSettings({ marginOn: !snapshot.settings.marginOn }),
      },
      ...(view === 'editor' && selectedPath ? [{
        type: 'command' as const,
        id: 'c-insert',
        label: 'Insert Markdown or component…',
        folder: 'Editor',
        ts: '⌘I',
        run: requestInsertMenu,
      }] : []),
      { type: 'command', id: 'c-settings', label: 'Open settings', folder: 'View', ts: '↵', run: () => setView('settings') },
      {
        type: 'command',
        id: 'c-reveal',
        label: 'Reveal vault in file manager',
        folder: 'Vault',
        ts: '↵',
        run: () => void api.revealInFolder(),
      },
      { type: 'command', id: 'c-vault', label: 'Switch vault…', folder: 'Vault', ts: '↵', run: switchVault },
      {
        type: 'command',
        id: 'c-relayout',
        label: 'Recompute graph layout',
        folder: 'Graph',
        ts: '↵',
        run: () => void api.resetGraphLayout(),
      },
    ],
    [snapshot.settings, onRequestNewNote, view, selectedPath]
  );

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (filter === 'all' || filter === 'command') {
      for (const c of commands) {
        const m = fuzzyMatch(q, c.label);
        if (m) out.push({ ...c, score: m.score + (q ? 0 : -10), indices: m.indices });
      }
    }
    if (filter === 'all' || filter === 'note') {
      for (const n of snapshot.notes) {
        const m = fuzzyMatch(q, n.title);
        if (m)
          out.push({
            type: 'note',
            id: n.path,
            label: n.title,
            schema: n.schema,
            folder: n.folder || 'vault',
            ts: relTime(n.updated),
            score: m.score - Math.min(10, Math.floor((Date.now() - n.updated) / 86400000)),
            indices: m.indices,
          });
      }
    }
    if (filter === 'all' || filter === 'task') {
      for (const t of snapshot.tasks) {
        const m = fuzzyMatch(q, t.content);
        if (m)
          out.push({
            type: 'task',
            id: t.id,
            label: t.content,
            folder: t.noteTitle,
            ts: t.due ? t.due.slice(5) : t.status,
            score: m.score - (t.status === 'done' ? 15 : 0),
            indices: m.indices,
          });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 24);
  }, [q, filter, snapshot, commands]);

  const grouped = useMemo(() => {
    const g: Record<string, Item[]> = { command: [], note: [], task: [] };
    for (const it of items) g[it.type].push(it);
    return g;
  }, [items]);

  useEffect(() => setSel(0), [q, filter]);
  if (!open) return null;
  const active = items[sel];

  const select = (it: Item) => {
    setOpen(false);
    if (it.type === 'note') openNote(it.id);
    else if (it.type === 'task') {
      const notePath = it.id.replace(/#L\d+$/, '');
      openNote(notePath);
    } else it.run?.();
  };

  const Row = ({ it, glyph }: { it: Item; glyph: React.ReactNode }) => (
    <div
      className="switcher__row"
      aria-selected={items.indexOf(it) === sel}
      onMouseEnter={() => setSel(items.indexOf(it))}
      onClick={() => select(it)}
    >
      {glyph}
      <span>
        {highlightSegments(it.label, it.indices).map((seg, i) =>
          seg.hit ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>
        )}
      </span>
      <span className="ts">{it.type === 'note' ? it.folder : it.ts}</span>
    </div>
  );

  return (
    <div className="switcher-scrim" onMouseDown={() => setOpen(false)}>
      <div className="switcher" onMouseDown={(e) => e.stopPropagation()}>
        <div className="switcher__bar">
          <span className="glyph mono" style={{ fontWeight: 700 }}>
            ›
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search notes, tasks, and commands…"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                setSel(Math.min(sel + 1, items.length - 1));
                e.preventDefault();
              }
              if (e.key === 'ArrowUp') {
                setSel(Math.max(sel - 1, 0));
                e.preventDefault();
              }
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'Enter' && active) select(active);
              if (e.key === 'Tab') {
                e.preventDefault();
                const order = ['all', 'note', 'task', 'command'] as const;
                setFilter(order[(order.indexOf(filter) + 1) % order.length]);
              }
            }}
          />
          <span className="keys">
            <span className="kbd">↑</span>
            <span className="kbd">↓</span>
            <span className="kbd">↵</span>
          </span>
        </div>

        <div className="switcher__filters">
          {(
            [
              ['all', 'All'],
              ['note', 'Notes'],
              ['task', 'Tasks'],
              ['command', 'Commands'],
            ] as const
          ).map(([k, lbl]) => (
            <button key={k} className="switcher__filter" aria-selected={filter === k} onClick={() => setFilter(k)}>
              {lbl}
            </button>
          ))}
        </div>

        <div className="switcher__body">
          <div className="switcher__list">
            {grouped.command.length > 0 && (
              <>
                <div className="switcher__group">Commands</div>
                {grouped.command.map((it) => (
                  <Row key={it.id} it={it} glyph={<span className="glyph-m">›</span>} />
                ))}
              </>
            )}
            {grouped.note.length > 0 && (
              <>
                <div className="switcher__group">Notes</div>
                {grouped.note.map((it) => (
                  <Row
                    key={it.id}
                    it={it}
                    glyph={
                      <span className="rune" style={{ color: schemaTone(it.schema) }}>
                        <Rune schema={it.schema ?? 'Note'} size={15} />
                      </span>
                    }
                  />
                ))}
              </>
            )}
            {grouped.task.length > 0 && (
              <>
                <div className="switcher__group">Tasks</div>
                {grouped.task.map((it) => (
                  <Row key={it.id} it={it} glyph={<span className="glyph-m">☐</span>} />
                ))}
              </>
            )}
            {items.length === 0 && <div className="switcher__empty">No results. Try fewer words.</div>}
          </div>

          <div className="switcher__preview">
            {active ? (
              <SwitcherPreview item={active} snapshot={snapshot} />
            ) : (
              <div style={{ color: 'var(--tx-3)', fontSize: 13 }}>Select a result.</div>
            )}
          </div>
        </div>

        <div className="switcher__foot">
          <span className="group">
            <span className="kbd">↑↓</span> move
          </span>
          <span className="group">
            <span className="kbd">↵</span> open
          </span>
          <span className="group">
            <span className="kbd">⇥</span> filter
          </span>
          <span style={{ marginLeft: 'auto' }} className="mono">
            {items.length} results
          </span>
        </div>
      </div>
    </div>
  );
}

function SwitcherPreview({ item, snapshot }: { item: Item; snapshot: VaultSnapshot }) {
  if (item.type === 'command') {
    return (
      <>
        <div className="switcher__preview__crumb">command · {item.folder}</div>
        <div className="switcher__preview__title">{item.label}</div>
        <div className="switcher__preview__body">
          <p>
            Press <span className="kbd">↵</span> to run this command.
          </p>
        </div>
      </>
    );
  }
  if (item.type === 'task') {
    const task = snapshot.tasks.find((t) => t.id === item.id);
    return (
      <>
        <div className="switcher__preview__crumb">task · from {item.folder}</div>
        <div className="switcher__preview__title">{item.label}</div>
        <div className="switcher__preview__body">
          <p>
            This thread lives in <span style={{ color: 'var(--ac)' }}>[[{item.folder}]]</span>. Opening it jumps to the source note; checking it anywhere updates the file.
          </p>
        </div>
        <div className="switcher__preview__meta">
          {task?.due && <span>due {task.due}</span>}
          {task?.due && <span>·</span>}
          <span>{task?.status}</span>
          <span>·</span>
          <span>{task?.priority}</span>
        </div>
      </>
    );
  }
  const note = snapshot.notes.find((n) => n.path === item.id);
  const backlinks = note ? snapshot.notes.filter((n) => n.links.includes(note.path)).length : 0;
  return (
    <>
      <div className="switcher__preview__crumb">
        {item.folder} / {item.schema}
      </div>
      <div className="switcher__preview__title">{item.label}</div>
      <div className="switcher__preview__body">
        <p>{note?.excerpt || 'An empty page, waiting.'}</p>
      </div>
      <div className="switcher__preview__meta">
        <span>edited {note ? relTime(note.updated) : '—'} ago</span>
        <span>·</span>
        <span>{item.schema}</span>
        <span>·</span>
        <span>
          {backlinks} {backlinks === 1 ? 'backlink' : 'backlinks'}
        </span>
        <span>·</span>
        <span>{note?.wordCount ?? 0} words</span>
      </div>
    </>
  );
}
