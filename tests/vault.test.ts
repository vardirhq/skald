import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { Vault } from '../src-main/vault';

let dir: string;
let vault: Vault;

async function makeVault(): Promise<Vault> {
  const v = new Vault(dir, () => {});
  await v.open();
  return v;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skald-test-'));
  mkdirSync(join(dir, 'Daily'));
  mkdirSync(join(dir, 'Projects'));
  writeFileSync(
    join(dir, 'Projects', 'Jormungandr.md'),
    [
      '---',
      'schema: Project',
      'created: 2026-05-01',
      'tags: [api]',
      '---',
      '',
      'The API rewrite. Depends on [[Stack decisions]].',
      '',
      '## Threads',
      '',
      '- [ ] Ship the new editor @due(2026-05-01) @p(high) #editor',
      '- [x] Pick a framework',
      '',
    ].join('\n')
  );
  writeFileSync(
    join(dir, 'Stack decisions.md'),
    ['# Stack decisions', '', 'Everything flows from [[Jormungandr]].', ''].join('\n')
  );
  writeFileSync(
    join(dir, 'Daily', '2026-05-28.md'),
    ['Worked on [[Jormungandr]] today.', ''].join('\n')
  );
});

afterEach(async () => {
  await vault?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Vault end-to-end', () => {
  it('scans, types, links, and counts', async () => {
    vault = await makeVault();
    const snap = vault.snapshot();

    expect(snap.notes).toHaveLength(3);
    const proj = snap.notes.find((n) => n.title === 'Jormungandr')!;
    expect(proj.schema).toBe('Project');
    expect(proj.tags).toEqual(['api']);
    expect(proj.links).toEqual(['Stack decisions.md']);

    const daily = snap.notes.find((n) => n.title === '2026-05-28')!;
    expect(daily.schema).toBe('Daily');

    expect(snap.tasks).toHaveLength(2);
    const open = snap.tasks.find((t) => t.status === 'open')!;
    expect(open.content).toBe('Ship the new editor');
    expect(open.due).toBe('2026-05-01');
    expect(snap.stats.tasksOpen).toBe(1);
    expect(snap.stats.overdue).toBe(1); // due 2026-05-01 is past

    // graph: 3 nodes, edges between linked notes, positions laid out
    expect(snap.graph.nodes).toHaveLength(3);
    expect(snap.graph.edges.length).toBeGreaterThanOrEqual(2);
    for (const n of snap.graph.nodes) {
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(1);
    }

    // tree structure
    expect(snap.tree.folders.map((f) => f.name).sort()).toEqual(['Daily', 'Projects']);
    expect(snap.tree.notes).toEqual(['Stack decisions.md']);
  });

  it('reads notes with backlinks and snippets', async () => {
    vault = await makeVault();
    const payload = vault.readNote('Projects/Jormungandr.md');
    expect(payload.backlinks.map((b) => b.title).sort()).toEqual(['2026-05-28', 'Stack decisions']);
    expect(payload.backlinks[0].snippet).toContain('[[Jormungandr]]');
    expect(payload.bodyStartLine).toBe(5);
  });

  it('imports attachments with unique names and reports missing files', async () => {
    vault = await makeVault();
    const sourceDir = mkdtempSync(join(tmpdir(), 'skald-source-'));
    const source = join(sourceDir, 'Product map.png');
    writeFileSync(source, Buffer.from([137, 80, 78, 71]));

    const [first] = await vault.importAttachmentPaths('Projects/Jormungandr.md', [source]);
    const second = await vault.importAttachmentData(
      'Projects/Jormungandr.md',
      'Product map.png',
      'image/png',
      [1, 2, 3]
    );

    expect(first.path).toBe('Attachments/Product map.png');
    expect(first.markdown).toBe('![Product map.png](../Attachments/Product%20map.png)');
    expect(second.path).toBe('Attachments/Product map 2.png');
    expect(readFileSync(join(dir, first.path))).toEqual(Buffer.from([137, 80, 78, 71]));

    const note = vault.readNote('Projects/Jormungandr.md');
    await vault.writeNote(
      note.meta.path,
      `${note.content}\n${first.markdown}\n[Missing](../Attachments/gone.pdf)\n`
    );
    const attachments = vault.readNote(note.meta.path).attachments;
    expect(attachments[0]).toMatchObject({
      path: first.path,
      exists: true,
      kind: 'image',
      embedded: true,
    });
    expect(attachments[1]).toMatchObject({
      path: 'Attachments/gone.pdf',
      exists: false,
      kind: 'pdf',
    });
    expect(vault.snapshot().activity.some((event) => event.verb === 'attached')).toBe(true);

    rmSync(sourceDir, { recursive: true, force: true });
  });

  it('toggles a task and writes the file', async () => {
    vault = await makeVault();
    const snap = vault.snapshot();
    const open = snap.tasks.find((t) => t.status === 'open')!;
    await vault.updateTask(open.id, { status: 'done' });

    const onDisk = readFileSync(join(dir, 'Projects', 'Jormungandr.md'), 'utf-8');
    expect(onDisk).toContain('- [x] Ship the new editor @due(2026-05-01) @p(high) #editor');
    expect(vault.snapshot().stats.tasksOpen).toBe(0);

    await vault.updateTask(open.id, { status: 'working' });
    const again = readFileSync(join(dir, 'Projects', 'Jormungandr.md'), 'utf-8');
    expect(again).toContain('@status(working)');
    expect(vault.snapshot().tasks.find((t) => t.id === open.id)?.status).toBe('working');
  });

  it('adds a task to a note', async () => {
    vault = await makeVault();
    await vault.addTask('Stack decisions.md', 'Evaluate CodeMirror', { priority: 'high' });
    const onDisk = readFileSync(join(dir, 'Stack decisions.md'), 'utf-8');
    expect(onDisk.trim().endsWith('- [ ] Evaluate CodeMirror @p(high)')).toBe(true);
    expect(vault.snapshot().tasks.some((t) => t.content === 'Evaluate CodeMirror')).toBe(true);
  });

  it('creates notes with schema frontmatter and unique paths', async () => {
    vault = await makeVault();
    const p1 = await vault.createNote('Projects', 'New Saga', 'Project');
    const p2 = await vault.createNote('Projects', 'New Saga', 'Project');
    expect(p1).toBe('Projects/New Saga.md');
    expect(p2).toBe('Projects/New Saga 2.md');
    const meta = vault.snapshot().notes.find((n) => n.path === p1)!;
    expect(meta.schema).toBe('Project');
  });

  it('renames a note and rewrites wikilinks across the vault', async () => {
    vault = await makeVault();
    const newPath = await vault.renameNote('Projects/Jormungandr.md', 'World Serpent');
    expect(newPath).toBe('Projects/World Serpent.md');

    const stack = readFileSync(join(dir, 'Stack decisions.md'), 'utf-8');
    expect(stack).toContain('[[World Serpent]]');
    expect(stack).not.toContain('[[Jormungandr]]');

    const daily = readFileSync(join(dir, 'Daily', '2026-05-28.md'), 'utf-8');
    expect(daily).toContain('[[World Serpent]]');

    const snap = vault.snapshot();
    const renamed = snap.notes.find((n) => n.path === newPath)!;
    expect(renamed.title).toBe('World Serpent');
    // links still resolve after rename
    const stackMeta = snap.notes.find((n) => n.title === 'Stack decisions')!;
    expect(stackMeta.links).toEqual([newPath]);
  });

  it('resolves folder-qualified wikilinks, keeping same-named notes apart', async () => {
    mkdirSync(join(dir, 'Notes'));
    writeFileSync(join(dir, 'Notes', 'Skald.md'), 'The note about the app.\n');
    writeFileSync(join(dir, 'Projects', 'Skald.md'), 'The project.\n');
    writeFileSync(
      join(dir, 'Index.md'),
      [
        'Reading: [[Notes/Skald]] and [[Projects/Skald]].',
        'Also [[Projects/Jormungandr.md]] and [[Stack decisions]].',
        '',
      ].join('\n')
    );
    vault = await makeVault();
    const snap = vault.snapshot();

    const index = snap.notes.find((n) => n.path === 'Index.md')!;
    expect(index.unresolved).toEqual([]);
    expect(index.links.sort()).toEqual([
      'Notes/Skald.md',
      'Projects/Jormungandr.md',
      'Projects/Skald.md',
      'Stack decisions.md',
    ]);

    // the folder-qualified mention counts as a backlink on the right note
    expect(vault.readNote('Notes/Skald.md').backlinks.map((b) => b.path)).toEqual(['Index.md']);
    expect(vault.readNote('Projects/Skald.md').backlinks.map((b) => b.path)).toEqual(['Index.md']);
    expect(vault.resolveTarget('notes/skald.md')).toBe('Notes/Skald.md');
  });

  it('rewrites folder-qualified wikilinks on rename', async () => {
    writeFileSync(
      join(dir, 'Index.md'),
      'Both [[Projects/Jormungandr]] and [[Jormungandr|the serpent]].\n'
    );
    vault = await makeVault();
    await vault.renameNote('Projects/Jormungandr.md', 'World Serpent');

    const index = readFileSync(join(dir, 'Index.md'), 'utf-8');
    expect(index).toContain('[[Projects/World Serpent]]');
    expect(index).toContain('[[World Serpent|the serpent]]');
    expect(vault.snapshot().notes.find((n) => n.path === 'Index.md')!.unresolved).toEqual([]);
  });

  it('deletes notes and updates stats', async () => {
    vault = await makeVault();
    await vault.deleteNote('Daily/2026-05-28.md');
    const snap = vault.snapshot();
    expect(snap.notes).toHaveLength(2);
    expect(snap.notes.some((n) => n.title === '2026-05-28')).toBe(false);
  });

  it('persists and applies settings', async () => {
    vault = await makeVault();
    vault.setSettings({ theme: 'light', marginOn: false });
    await vault.close();
    vault = await makeVault();
    expect(vault.getSettings().theme).toBe('light');
    expect(vault.getSettings().marginOn).toBe(false);
  });

  it('records activity for real events', async () => {
    vault = await makeVault();
    await vault.createNote('', 'Fresh', 'Idea');
    const snap = vault.snapshot();
    expect(snap.activity[0]).toMatchObject({ kind: 'note', verb: 'created', title: 'Fresh' });
  });

  it('keeps local note history and restores an earlier version', async () => {
    vault = await makeVault();
    const path = 'Stack decisions.md';
    const original = vault.readNote(path).content;

    await vault.writeNote(path, '# Changed\n\nA newer version.\n');
    const history = await vault.listNoteHistory(path);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ notePath: path, reason: 'edit' });

    const version = await vault.readNoteHistoryVersion(path, history[0].id);
    expect(version.content).toBe(original);

    await vault.restoreNoteHistoryVersion(path, history[0].id);
    expect(readFileSync(join(dir, path), 'utf-8')).toBe(original);
    expect((await vault.listNoteHistory(path)).some((entry) => entry.reason === 'restore')).toBe(true);
    expect(vault.snapshot().activity[0]).toMatchObject({ kind: 'note', verb: 'restored' });
  });

  it('keeps the last version when a note is deleted', async () => {
    vault = await makeVault();
    const path = 'Stack decisions.md';
    const original = vault.readNote(path).content;
    await vault.deleteNote(path);

    const history = await vault.listNoteHistory(path);
    expect(history[0].reason).toBe('delete');
    expect((await vault.readNoteHistoryVersion(path, history[0].id)).content).toBe(original);
  });

  it('seeds an empty vault with a welcome saga', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'skald-empty-'));
    const v = new Vault(empty, () => {});
    await v.open();
    await v.seed();
    const snap = v.snapshot();
    expect(snap.notes.length).toBe(2);
    expect(snap.notes.some((n) => n.title === 'Welcome to Skald')).toBe(true);
    expect(snap.tasks.length).toBeGreaterThan(0);
    // welcome links to the daily note
    const welcome = snap.notes.find((n) => n.title === 'Welcome to Skald')!;
    expect(welcome.links.length).toBe(1);
    await v.close();
    rmSync(empty, { recursive: true, force: true });
  });

  it('seeds a relative vault path without rejecting root notes', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'skald-relative-parent-'));
    const absoluteVaultPath = join(parent, 'relative-vault');
    const relativeVaultPath = relative(process.cwd(), absoluteVaultPath);
    let v: Vault | null = null;
    try {
      v = new Vault(relativeVaultPath, () => {});
      await v.open();
      await v.seed();

      const snap = v.snapshot();
      expect(snap.vaultPath).toBe(absoluteVaultPath);
      expect(snap.notes.some((n) => n.path === 'Welcome to Skald.md')).toBe(true);
    } finally {
      await v?.close();
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
