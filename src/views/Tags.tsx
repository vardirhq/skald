import { useMemo } from 'react';
import type { VaultSnapshot } from '../../src-shared/types';
import { useStore } from '../store';
import { Rune, schemaTone } from '../ui/runes';

export function TagsView({ snapshot }: { snapshot: VaultSnapshot }) {
  const selectedTag = useStore((state) => state.selectedTag);
  const setSelectedTag = useStore((state) => state.setSelectedTag);
  const openNote = useStore((state) => state.openNote);
  const tags = useMemo(() => {
    const counts = new Map<string, { notes: number; tasks: number }>();
    for (const note of snapshot.notes) {
      for (const raw of note.tags) {
        const tag = raw.replace(/^#/, '');
        const count = counts.get(tag) ?? { notes: 0, tasks: 0 };
        count.notes++;
        counts.set(tag, count);
      }
    }
    for (const task of snapshot.tasks) {
      for (const raw of task.tags) {
        const tag = raw.replace(/^#/, '');
        const count = counts.get(tag) ?? { notes: 0, tasks: 0 };
        count.tasks++;
        counts.set(tag, count);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1].notes + b[1].tasks - (a[1].notes + a[1].tasks) || a[0].localeCompare(b[0]));
  }, [snapshot.notes, snapshot.tasks]);
  const active = selectedTag && tags.some(([tag]) => tag === selectedTag) ? selectedTag : tags[0]?.[0] ?? null;
  const notes = active
    ? snapshot.notes.filter((note) => note.tags.some((tag) => tag.replace(/^#/, '').toLocaleLowerCase() === active.toLocaleLowerCase()))
    : [];
  const tasks = active
    ? snapshot.tasks.filter((task) => task.tags.some((tag) => tag.replace(/^#/, '').toLocaleLowerCase() === active.toLocaleLowerCase()))
    : [];

  return (
    <div className="tags-view">
      <div className="tags-view__head">
        <div className="eyebrow">Vocabulary</div>
        <h1>Tags</h1>
        <p>Browse the labels already used in note frontmatter and task lines.</p>
      </div>
      <div className="tags-layout">
        <div className="tag-index">
          {tags.map(([tag, count]) => (
            <button key={tag} aria-selected={active === tag} onClick={() => setSelectedTag(tag)}>
              <span>#{tag}</span>
              <small>{count.notes + count.tasks}</small>
            </button>
          ))}
          {!tags.length && <div className="tags-empty">No tags yet. Type <code>#tag</code> in a note or add tags to frontmatter.</div>}
        </div>
        <div className="tag-detail">
          {active && <h2>#{active}</h2>}
          {notes.map((note) => (
            <button key={note.path} className="tag-note" onClick={() => openNote(note.path)}>
              <span style={{ color: schemaTone(note.schema), display: 'inline-flex' }}><Rune schema={note.schema} size={15} /></span>
              <span><strong>{note.title}</strong><small>{note.path}</small></span>
            </button>
          ))}
          {tasks.map((task) => (
            <button key={task.id} className="tag-note" onClick={() => openNote(task.notePath)}>
              <span className="tree__glyph">☐</span>
              <span><strong>{task.content}</strong><small>{task.noteTitle} · line {task.line}</small></span>
            </button>
          ))}
          {active && !notes.length && !tasks.length && <div className="tags-empty">Nothing currently carries this tag.</div>}
        </div>
      </div>
    </div>
  );
}
