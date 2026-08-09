import { useEffect, useMemo, useState } from 'react';
import type { VaultSnapshot, VaultSettings } from '../../src-shared/types';
import { SCHEMA_NAMES } from '../../src-shared/types';
import { Rune, schemaTone } from '../ui/runes';
import { Logo, type LogoVariant } from '../ui/logo';
import { api } from '../api';
import { useStore } from '../store';
import { allFolderPaths } from '../chrome/Sidebar';
import { SyncPane } from './SyncPane';

type Pane = 'appearance' | 'themes' | 'editor' | 'schemas' | 'vault' | 'sync' | 'shortcuts';

const SCHEMA_DESC: Record<string, string> = {
  Note: 'Catch-all note.',
  Project: 'A long thread with status, due dates, and people.',
  Person: 'Someone in your vault. Has aliases and links.',
  Daily: 'A dated logbook page. One per day.',
  Idea: 'A loose seed, half-formed on purpose.',
  Source: "External text you're drawing from.",
  Code: 'Code-heavy notes; monospace by default.',
  Place: 'A location — a hearth on the map.',
};

export function SettingsView({ snapshot }: { snapshot: VaultSnapshot }) {
  const [pane, setPane] = useState<Pane>('appearance');
  const s = snapshot.settings;
  const set = (patch: Partial<VaultSettings>) => void api.setSettings(patch);

  return (
    <div className="settings">
      <SettingsNav pane={pane} setPane={setPane} />
      <div className="settings__main">
        {pane === 'appearance' && <AppearancePane s={s} set={set} />}
        {pane === 'themes' && <ThemesPane s={s} set={set} />}
        {pane === 'editor' && <EditorPane s={s} set={set} snapshot={snapshot} />}
        {pane === 'schemas' && <SchemasPane snapshot={snapshot} />}
        {pane === 'vault' && <VaultPane snapshot={snapshot} s={s} set={set} />}
        {pane === 'sync' && <SyncPane />}
        {pane === 'shortcuts' && <ShortcutsPane />}
      </div>
    </div>
  );
}

function SettingsNav({ pane, setPane }: { pane: Pane; setPane: (p: Pane) => void }) {
  const items: ({ group: string } | { id: Pane; label: string; schema: string })[] = [
    { group: 'look' },
    { id: 'appearance', label: 'Appearance', schema: 'Note' },
    { id: 'themes', label: 'Themes', schema: 'Idea' },
    { group: 'writing' },
    { id: 'editor', label: 'Editor', schema: 'Code' },
    { id: 'schemas', label: 'Schemas & runes', schema: 'Source' },
    { group: 'vault' },
    { id: 'vault', label: 'Vault', schema: 'Place' },
    { id: 'sync', label: 'Sync', schema: 'Person' },
    { id: 'shortcuts', label: 'Shortcuts', schema: 'Daily' },
  ];
  return (
    <nav className="settings__nav">
      {items.map((it, i) =>
        'group' in it ? (
          <div key={i} className="group">
            {it.group}
          </div>
        ) : (
          <div key={it.id} className="item" aria-selected={pane === it.id} onClick={() => setPane(it.id)}>
            <span className="rune" style={{ color: pane === it.id ? schemaTone(it.schema) : undefined }}>
              <Rune schema={it.schema} size={15} />
            </span>
            {it.label}
          </div>
        )
      )}
    </nav>
  );
}

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings__row">
      <div className="settings__row__l">
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
      <div className="settings__row__r">{children}</div>
    </div>
  );
}

function AppearancePane({ s, set }: { s: VaultSettings; set: (p: Partial<VaultSettings>) => void }) {
  return (
    <>
      <h1 className="settings__title">Appearance</h1>
      <p className="settings__lede">Density, the right panel, and the mark in the title bar.</p>

      <Row title="Density" desc="The rhythm of every list and tree. Compact when you're deep in a file; cozy on a big monitor.">
        <div className="toggle-group">
          {(['compact', 'regular', 'cozy'] as const).map((d) => (
            <button key={d} aria-selected={s.density === d} onClick={() => set({ density: d })}>
              {d}
            </button>
          ))}
        </div>
      </Row>

      <Row title="Right panel" desc="Backlinks, threads, and the outline, docked to the right of the editor.">
        <div className="toggle-group">
          <button aria-selected={s.marginOn} onClick={() => set({ marginOn: true })}>
            On
          </button>
          <button aria-selected={!s.marginOn} onClick={() => set({ marginOn: false })}>
            Off
          </button>
        </div>
      </Row>

      <div className="settings__row">
        <div className="settings__row__l">
          <h3>Mark</h3>
          <p>The logo in the title bar. All three are monoline.</p>
        </div>
        <div className="settings__row__r" style={{ width: 320 }}>
          <div className="mark-grid">
            {(['sigil', 'monogram', 'bracket'] as LogoVariant[]).map((v) => (
              <div key={v} className="mark-card" aria-selected={s.logoVariant === v} onClick={() => set({ logoVariant: v })}>
                <Logo size={32} variant={v} />
                <div className="lbl">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function ThemesPane({ s, set }: { s: VaultSettings; set: (p: Partial<VaultSettings>) => void }) {
  const themes = [
    {
      id: 'midnight' as const,
      name: 'Midnight',
      desc: 'Deep blue-black. The default night surface.',
      swatch: ['#0d1015', '#eaeef4', '#6ae0c6', '#6cb2ff'],
    },
    {
      id: 'slate' as const,
      name: 'Slate',
      desc: 'Neutral graphite, low chroma.',
      swatch: ['#121315', '#ecedef', '#6ae0c6', '#f0a878'],
    },
    {
      id: 'light' as const,
      name: 'Daybreak',
      desc: 'Bright editor for daytime work.',
      swatch: ['#fafbfc', '#1c2330', '#119e84', '#2f74d0'],
    },
  ];
  return (
    <>
      <h1 className="settings__title">Themes</h1>
      <p className="settings__lede">Three editor surfaces. Dark by default — pick the one your eyes want.</p>
      <div className="theme-grid">
        {themes.map((t) => (
          <div key={t.id} className="theme-card" aria-selected={s.theme === t.id} onClick={() => set({ theme: t.id })}>
            <div className="theme-card__preview" style={{ background: t.swatch[0] }}>
              <div
                className="pv-side"
                style={{ background: t.swatch[0], borderColor: t.swatch[1] + '22', color: t.swatch[1] + '99' }}
              >
                Notes
                <br />
                Projects
                <br />
                Daily
              </div>
              <div className="pv-main">
                <div className="pv-h" style={{ background: t.swatch[1] }} />
                <div className="pv-l" style={{ background: t.swatch[1], opacity: 0.45 }} />
                <div className="pv-l" style={{ background: t.swatch[1], opacity: 0.45 }} />
                <div className="pv-l" style={{ background: t.swatch[2], width: '45%' }} />
              </div>
            </div>
            <div className="theme-card__foot">
              <div className="theme-card__name">{t.name}</div>
              <div className="theme-card__swatch">
                {t.swatch.map((c, i) => (
                  <span key={i} style={{ background: c }} />
                ))}
              </div>
              <div className="theme-card__desc">{t.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function EditorPane({
  s,
  set,
  snapshot,
}: {
  s: VaultSettings;
  set: (p: Partial<VaultSettings>) => void;
  snapshot: VaultSnapshot;
}) {
  const folders = allFolderPaths(snapshot.tree);
  return (
    <>
      <h1 className="settings__title">Editor</h1>
      <p className="settings__lede">How the writing surface behaves.</p>

      <Row title="Reading size" desc="Base font size of the rendered note body.">
        <div className="toggle-group">
          {[14, 15, 16, 17].map((n) => (
            <button key={n} aria-selected={s.editorFontSize === n} onClick={() => set({ editorFontSize: n })}>
              {n}px
            </button>
          ))}
        </div>
      </Row>

      <Row title="Autosave" desc="How long Skald waits after your last keystroke before writing to disk.">
        <div className="toggle-group">
          {[
            [400, 'fast'],
            [800, 'normal'],
            [2000, 'relaxed'],
          ].map(([ms, label]) => (
            <button key={ms} aria-selected={s.autosaveMs === ms} onClick={() => set({ autosaveMs: ms as number })}>
              {label}
            </button>
          ))}
        </div>
      </Row>

      <Row title="Daily folder" desc="Where ⌘D pages live. One dated Markdown file per day.">
        <select value={s.dailyFolder} onChange={(e) => set({ dailyFolder: e.target.value })}>
          {!folders.includes(s.dailyFolder) && <option value={s.dailyFolder}>{s.dailyFolder}</option>}
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </Row>
    </>
  );
}

function SchemasPane({ snapshot }: { snapshot: VaultSnapshot }) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of snapshot.notes) map.set(n.schema, (map.get(n.schema) ?? 0) + 1);
    return map;
  }, [snapshot.notes]);
  return (
    <>
      <h1 className="settings__title">Schemas &amp; runes</h1>
      <p className="settings__lede">
        Every note has a type, and every type carries a monoline rune that follows it everywhere it's
        mentioned. Set a note's schema with <code className="mono">schema:</code> in its frontmatter — or
        let the folder decide (notes in Daily become Daily, People become Person, and so on).
      </p>
      <div className="set-table">
        {SCHEMA_NAMES.map((n) => (
          <div key={n} className="row" style={{ gridTemplateColumns: '32px 150px 1fr auto' }}>
            <span className="schema-rune" style={{ color: schemaTone(n) }}>
              <Rune schema={n} size={18} />
            </span>
            <span style={{ fontWeight: 600, color: 'var(--tx-0)' }}>{n}</span>
            <span style={{ color: 'var(--tx-3)', fontSize: 13 }}>{SCHEMA_DESC[n]}</span>
            <span className="tree__count">{counts.get(n) ?? 0} notes</span>
          </div>
        ))}
      </div>
    </>
  );
}

function VaultPane({
  snapshot,
  s,
  set,
}: {
  snapshot: VaultSnapshot;
  s: VaultSettings;
  set: (p: Partial<VaultSettings>) => void;
}) {
  const switchVault = useStore((st) => st.switchVault);
  return (
    <>
      <h1 className="settings__title">Vault</h1>
      <p className="settings__lede">
        Plain Markdown files on disk. Skald keeps its index, settings, and graph layout in a{' '}
        <code className="mono">.skald/</code> folder inside the vault.
      </p>

      <Row title="Location" desc="The folder this vault lives in.">
        <span className="settings__kv">{snapshot.vaultPath}</span>
      </Row>

      <Row title="Contents" desc="What the index sees right now.">
        <span className="settings__kv">
          {snapshot.stats.notes} notes · {snapshot.stats.folders} folders · {snapshot.stats.tasksTotal} threads
        </span>
      </Row>

      <Row title="Attachments folder" desc="Imported files are copied here and linked with portable relative Markdown paths.">
        <AttachmentFolderSetting
          value={s.attachmentsFolder}
          save={(attachmentsFolder) => set({ attachmentsFolder })}
        />
      </Row>

      <Row title="Reveal" desc="Open the vault folder in your file manager.">
        <button className="btn" onClick={() => void api.revealInFolder()}>
          Reveal in file manager
        </button>
      </Row>

      <Row title="Switch vault" desc="Open a different folder as a vault. The current vault stays untouched.">
        <button className="btn" onClick={switchVault}>
          Switch vault…
        </button>
      </Row>
    </>
  );
}

function AttachmentFolderSetting({
  value,
  save,
}: {
  value: string;
  save: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const clean = draft.trim().replace(/^\/+|\/+$/g, '') || 'Attachments';
    setDraft(clean);
    if (clean !== value) save(clean);
  };

  return (
    <input
      className="settings__text-input"
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

function ShortcutsPane() {
  return (
    <>
      <h1 className="settings__title">Shortcuts</h1>
      <p className="settings__lede">Skald is keyboard-first. These are the bindings worth memorizing.</p>
      <div className="set-table">
        {[
          ['⌘K / ⌘P', 'Open command palette'],
          ['⌘D', "Go to today's page"],
          ['⌘N', 'New note'],
          ['⌘B', 'Toggle right panel'],
          ['⌘G', 'Open graph view'],
          ['⌘E', 'Toggle reading / source view'],
          ['⌘S', 'Save now (autosave is always on)'],
          ['Esc', 'Close palette or dialog'],
        ].map(([k, l]) => (
          <div key={k} className="row" style={{ gridTemplateColumns: '150px 1fr' }}>
            <span className="kbd" style={{ fontSize: 12 }}>
              {k}
            </span>
            <span style={{ fontSize: 13.5, color: 'var(--tx-1)' }}>{l}</span>
          </div>
        ))}
      </div>
    </>
  );
}
