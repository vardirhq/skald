import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SCHEMA_NAMES, type SchemaName } from '../../src-shared/types';
import { Rune, schemaTone } from './runes';

export function DialogScrim({
  onClose,
  children,
  className = '',
}: {
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);
  return (
    <div className="dialog-scrim" onMouseDown={onClose}>
      <div className={`dialog ${className}`.trim()} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function NewNoteDialog({
  folders,
  initialFolder,
  onCreate,
  onClose,
}: {
  folders: string[];
  initialFolder?: string;
  onCreate: (title: string, folder: string, schema: SchemaName) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState(initialFolder ?? '');
  const [schema, setSchema] = useState<SchemaName>('Note');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const submit = async () => {
    if (!title.trim()) return;
    try {
      await onCreate(title.trim(), folder, schema);
      onClose();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  return (
    <DialogScrim onClose={onClose}>
      <h2>New note</h2>
      <p className="lede">A Markdown file in your vault, typed with a schema.</p>
      <label>Title</label>
      <input
        ref={inputRef}
        type="text"
        value={title}
        placeholder="The name of the note"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
      />
      <label>Folder</label>
      <select value={folder} onChange={(e) => setFolder(e.target.value)}>
        <option value="">vault root</option>
        {folders.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <label>Schema</label>
      <div className="dialog__schemas">
        {SCHEMA_NAMES.map((s) => (
          <button key={s} aria-selected={schema === s} onClick={() => setSchema(s)}>
            <span style={{ color: schemaTone(s), display: 'inline-flex' }}>
              <Rune schema={s} size={13} />
            </span>
            {s}
          </button>
        ))}
      </div>
      {error && <div className="dialog__error">{error}</div>}
      <div className="dialog__actions">
        <button className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn--accent" onClick={() => void submit()} disabled={!title.trim()}>
          Create note
        </button>
      </div>
    </DialogScrim>
  );
}

export function TextDialog({
  title,
  lede,
  label,
  initial = '',
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  lede: string;
  label: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async () => {
    if (!value.trim()) return;
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  return (
    <DialogScrim onClose={onClose}>
      <h2>{title}</h2>
      <p className="lede">{lede}</p>
      <label>{label}</label>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
      />
      {error && <div className="dialog__error">{error}</div>}
      <div className="dialog__actions">
        <button className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn--accent" onClick={() => void submit()} disabled={!value.trim()}>
          {submitLabel}
        </button>
      </div>
    </DialogScrim>
  );
}

export function ConfirmDialog({
  title,
  lede,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  lede: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <DialogScrim onClose={onClose}>
      <h2 className={danger ? 'danger' : undefined}>{title}</h2>
      <p className="lede">{lede}</p>
      <div className="dialog__actions">
        <button className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn"
          style={danger ? { color: 'var(--err)', borderColor: 'color-mix(in oklab, var(--err) 40%, transparent)' } : undefined}
          onClick={() => void onConfirm().then(onClose)}
        >
          {confirmLabel}
        </button>
      </div>
    </DialogScrim>
  );
}

export function FolderDialog({
  title,
  lede,
  folders,
  initial = '',
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  lede: string;
  folders: string[];
  initial?: string;
  submitLabel: string;
  onSubmit: (folder: string) => Promise<void>;
  onClose: () => void;
}) {
  const [folder, setFolder] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(folder);
      onClose();
    } catch (err) {
      setError(String((err as Error).message ?? err));
      setBusy(false);
    }
  };
  return (
    <DialogScrim onClose={onClose}>
      <h2>{title}</h2>
      <p className="lede">{lede}</p>
      <label>Destination</label>
      <select value={folder} onChange={(e) => setFolder(e.target.value)} autoFocus>
        <option value="">vault root</option>
        {folders.map((item) => (
          <option key={item} value={item}>{item}</option>
        ))}
      </select>
      {error && <div className="dialog__error">{error}</div>}
      <div className="dialog__actions">
        <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn--accent" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Moving…' : submitLabel}
        </button>
      </div>
    </DialogScrim>
  );
}
