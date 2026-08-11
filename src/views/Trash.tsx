import { useEffect, useState } from 'react';
import type { DeletedNoteEntry } from '../../src-shared/types';
import { api } from '../api';
import { useStore, relTimeLong } from '../store';
import { Rune, schemaTone } from '../ui/runes';

export function TrashView() {
  const [items, setItems] = useState<DeletedNoteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const openNote = useStore((state) => state.openNote);
  const showToast = useStore((state) => state.showToast);
  const load = () =>
    void api.listDeletedNotes().then((deleted) => {
      setItems(deleted);
      setLoading(false);
    });
  useEffect(load, []);

  return (
    <div className="trash-view">
      <div className="trash-view__head">
        <div className="eyebrow">Recovery</div>
        <h1>Recently deleted</h1>
        <p>Skald keeps the latest local-history snapshot when a note is removed.</p>
      </div>
      <div className="trash-list">
        {items.map((item) => (
          <div key={item.path} className="trash-item">
            <span style={{ color: schemaTone(item.schema), display: 'inline-flex' }}>
              <Rune schema={item.schema} size={17} />
            </span>
            <span className="trash-item__content">
              <strong>{item.title}</strong>
              <small>{item.path} · deleted {relTimeLong(item.deletedAt)}</small>
            </span>
            <button
              className="btn btn--ghost"
              disabled={restoring === item.path}
              onClick={() => {
                setRestoring(item.path);
                void api.restoreDeletedNote(item.path).then(() => {
                  setItems((current) => current.filter((candidate) => candidate.path !== item.path));
                  setRestoring(null);
                  showToast(`Restored ${item.title}`);
                  openNote(item.path);
                }).catch((err) => {
                  setRestoring(null);
                  showToast(String((err as Error).message ?? err));
                });
              }}
            >
              {restoring === item.path ? 'Restoring…' : 'Restore'}
            </button>
          </div>
        ))}
        {!loading && !items.length && <div className="trash-view__empty">Nothing is waiting to be restored.</div>}
      </div>
    </div>
  );
}
