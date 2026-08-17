import { readFile, writeFile, mkdir, rm, rename, readdir, stat, copyFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep, basename, extname, resolve } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { parseFrontmatter, serializeFrontmatter } from '../src-shared/frontmatter';
import { isValidThemeName, themeFilePath } from '../src-shared/noteThemes';
import { extractTasks, updateTaskLine, formatTaskLine, taskId, type TaskEdits } from '../src-shared/tasks';
import {
  extractWikilinkTargets,
  countWikilinks,
  rewriteWikilinks,
  retargetWikilink,
  buildLinkIndex,
  resolveLinkTarget,
  snippetAround,
  type LinkIndex,
} from '../src-shared/wikilinks';
import {
  inferSchema,
  noteTitle,
  titleFromPath,
  topFolder,
  extractHeadings,
  excerptOf,
  countWords,
  localISO,
  safeFileName,
  renderSchemaTemplate,
} from '../src-shared/notes';
import { layoutGraph } from './layout';
import { isAttachmentPath } from '../src-shared/sync/payload';
import {
  attachmentKind,
  attachmentMarkdown,
  attachmentMime,
  extractAttachmentLinks,
  resolveAttachmentPath,
} from '../src-shared/attachments';
import type {
  ActivityEvent,
  AttachmentImportResult,
  AttachmentRef,
  BacklinkRef,
  FolderNode,
  GraphData,
  NoteMeta,
  NotePayload,
  NoteHistoryEntry,
  NoteHistoryReason,
  NoteHistoryVersion,
  TaskItem,
  VaultSettings,
  VaultSnapshot,
  VaultStats,
  SchemaName,
  PathChange,
  SearchResult,
  DeletedNoteEntry,
} from '../src-shared/types';
import { DEFAULT_SETTINGS } from '../src-shared/types';
import { searchNotes } from '../src-shared/search';
import { extractInlineTags } from '../src-shared/tags';

interface NoteRecord {
  path: string;
  raw: string;
  body: string;
  bodyStartLine: number;
  frontmatter: Record<string, unknown>;
  title: string;
  folder: string;
  schema: SchemaName;
  tags: string[];
  linkTargets: string[];
  headings: NoteMeta['headings'];
  excerpt: string;
  wordCount: number;
  wikilinkCount: number;
  created: number;
  updated: number;
}

const SKALD_DIR = '.skald';
/** Note themes live in the vault, not in .skald: they are the user's own writing. */
const THEMES_DIR = 'themes';
const ACTIVITY_CAP = 300;
const HISTORY_CAP_PER_NOTE = 100;
const HISTORY_COALESCE_MS = 5 * 60_000;

export class Vault {
  readonly path: string;
  private notes = new Map<string, NoteRecord>();
  private folders = new Set<string>();
  private watcher: FSWatcher | null = null;
  private settings: VaultSettings = { ...DEFAULT_SETTINGS };
  private activity: ActivityEvent[] = [];
  private positions: Record<string, { x: number; y: number }> = {};
  private selfWrites = new Map<string, number>();
  private broadcast: () => void;
  private broadcastTimer: NodeJS.Timeout | null = null;
  private onAssetChange: () => void;

  constructor(
    vaultPath: string,
    onChange: (snapshot: VaultSnapshot) => void,
    /**
     * Called when a non-Markdown file changes. Attachments are not indexed, so
     * they never move the snapshot — but sync still needs to hear about them.
     */
    onAssetChange: () => void = () => {}
  ) {
    this.path = resolve(vaultPath);
    this.onAssetChange = onAssetChange;
    this.broadcast = () => {
      if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
      this.broadcastTimer = setTimeout(() => onChange(this.snapshot()), 120);
    };
  }

  // ---------- lifecycle ----------

  async open(): Promise<void> {
    await mkdir(this.path, { recursive: true });
    await mkdir(join(this.path, SKALD_DIR), { recursive: true });
    this.loadState();
    await this.scan();
    this.ensurePositions();

    this.watcher = watch(this.path, {
      ignored: (p: string) => {
        const rel = relative(this.path, p);
        if (!rel) return false;
        return rel.split(sep).some((seg) => seg.startsWith('.') || seg === 'node_modules');
      },
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 80 },
    });
    this.watcher.on('add', (p) => this.onFsEvent('add', p));
    this.watcher.on('change', (p) => this.onFsEvent('change', p));
    this.watcher.on('unlink', (p) => this.onFsEvent('unlink', p));
    this.watcher.on('addDir', (p) => this.onFsEvent('addDir', p));
    this.watcher.on('unlinkDir', (p) => this.onFsEvent('unlinkDir', p));
  }

  async close(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
  }

  /** Seed a brand-new vault with a small real starter structure. */
  async seed(): Promise<void> {
    const today = localISO(new Date());
    const welcome = [
      '---',
      'schema: Note',
      `created: ${today}`,
      'tags: [welcome]',
      '---',
      '',
      'Welcome to your vault. Skald keeps everything as plain Markdown files in this folder — you own the data.',
      '',
      '## How Skald thinks',
      '',
      'Every note has a schema (`Note`, `Project`, `Person`, `Daily`, `Idea`, `Source`, `Code`) drawn as a small rune wherever the note appears. Link notes with wikilinks like [[' + today + ']].',
      '',
      '## Threads',
      '',
      'Any checkbox you write becomes a thread in the Tasks views, and stays in sync both ways:',
      '',
      '- [ ] Write your first note @p(high)',
      `- [ ] Link two notes together @due(${today})`,
      '- [x] Open Skald',
      '',
      'Press `⌘K` to search everything, `⌘D` for today, `⌘G` for the graph.',
      '',
    ].join('\n');

    const daily = [
      '---',
      'schema: Daily',
      `created: ${today}`,
      '---',
      '',
      `The first page of the saga. Started the vault with [[Welcome to Skald]].`,
      '',
      '- [ ] Wander around the app',
      '',
    ].join('\n');

    await mkdir(join(this.path, this.settings.dailyFolder), { recursive: true });
    this.folders.add(this.settings.dailyFolder);
    const dailyPath = `${this.settings.dailyFolder}/${today}.md`;
    for (const [path, content] of [
      ['Welcome to Skald.md', welcome],
      [dailyPath, daily],
    ] as const) {
      this.markSelfWrite(path);
      await writeFile(this.full(path), content, 'utf-8');
      this.indexContent(path, content, Date.now(), Date.now());
    }
    this.ensurePositions();
    this.recordActivity({ kind: 'note', verb: 'created', title: 'Welcome to Skald', ref: 'vault', ts: Date.now() });
    this.broadcast();
  }

  // ---------- persistence of .skald state ----------

  private stateFile(name: string): string {
    return join(this.path, SKALD_DIR, name);
  }

  private loadState(): void {
    this.settings = { ...DEFAULT_SETTINGS, ...readJson(this.stateFile('settings.json'), {}) };
    this.activity = readJson<ActivityEvent[]>(this.stateFile('activity.json'), []);
    this.positions = readJson(this.stateFile('graph.json'), {});
  }

  private saveSettings(): void {
    writeJson(this.stateFile('settings.json'), this.settings);
  }

  private saveActivity(): void {
    writeJson(this.stateFile('activity.json'), this.activity.slice(0, ACTIVITY_CAP));
  }

  private savePositions(): void {
    writeJson(this.stateFile('graph.json'), this.positions);
  }

  // ---------- scanning / indexing ----------

  private async scan(): Promise<void> {
    this.notes.clear();
    this.folders.clear();
    await this.scanDir(this.path);
  }

  private async scanDir(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        this.folders.add(this.rel(full));
        await this.scanDir(full);
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        await this.indexFile(full);
      }
    }
  }

  private rel(full: string): string {
    return relative(this.path, full).split(sep).join('/');
  }

  private async indexFile(full: string): Promise<void> {
    const path = this.rel(full);
    try {
      const [raw, st] = await Promise.all([readFile(full, 'utf-8'), stat(full)]);
      this.indexContent(path, raw, st.birthtimeMs || st.mtimeMs, st.mtimeMs);
    } catch (err) {
      console.error(`skald: failed to index ${path}`, err);
    }
  }

  private indexContent(path: string, raw: string, created: number, updated: number): void {
    const { frontmatter, body, bodyStartLine } = parseFrontmatter(raw);
    const title = noteTitle(frontmatter, path);
    const folder = topFolder(path);
    const fmCreated = frontmatter['created'];
    const createdTs =
      typeof fmCreated === 'string' && /^\d{4}-\d{2}-\d{2}/.test(fmCreated)
        ? new Date(fmCreated).getTime()
        : created;
    const frontmatterTags = Array.isArray(frontmatter['tags'])
      ? (frontmatter['tags'] as unknown[]).map(String)
      : [];
    const tags = [...new Map([...frontmatterTags, ...extractInlineTags(body)].map((tag) => [tag.toLocaleLowerCase().replace(/^#/, ''), tag.replace(/^#/, '')])).values()];
    this.notes.set(path, {
      path,
      raw,
      body,
      bodyStartLine,
      frontmatter,
      title,
      folder,
      schema: inferSchema(frontmatter, title, folder),
      tags,
      linkTargets: extractWikilinkTargets(body),
      headings: extractHeadings(body, bodyStartLine),
      excerpt: excerptOf(body),
      wordCount: countWords(body),
      wikilinkCount: countWikilinks(body),
      created: createdTs,
      updated,
    });
  }

  private onFsEvent(kind: string, full: string): void {
    const path = this.rel(full);
    const isSelf = (this.selfWrites.get(path) ?? 0) > Date.now() - 2500;
    if (kind === 'addDir') {
      if (isSelf) return;
      this.folders.add(path);
      this.broadcast();
      return;
    }
    if (kind === 'unlinkDir') {
      if (isSelf) return;
      this.folders.delete(path);
      for (const p of [...this.notes.keys()]) {
        if (p.startsWith(path + '/')) this.notes.delete(p);
      }
      this.broadcast();
      return;
    }
    if (!/\.md$/i.test(path)) {
      // An attachment. Nothing to index, but sync publishes these too — unless
      // this is the write sync itself just made.
      if ((this.selfWrites.get(path) ?? 0) <= Date.now() - 2500) this.onAssetChange();
      return;
    }
    if (kind === 'unlink') {
      if (isSelf) return;
      this.notes.delete(path);
      this.broadcast();
      return;
    }
    const previous = this.notes.get(path);
    this.indexFile(full).then(async () => {
      const current = this.notes.get(path);
      if (!isSelf && kind === 'change') {
        if (previous && current && previous.raw !== current.raw) {
          await this.storeHistory(path, previous.raw, 'external', true);
        }
        const rec = current;
        if (rec) {
          this.recordActivity({
            kind: 'note',
            verb: 'edited',
            title: rec.title,
            ref: rec.folder || 'vault',
            ts: Date.now(),
          });
        }
      }
      this.ensurePositions();
      this.broadcast();
    });
  }

  // ---------- resolution ----------

  /** Index every note by path, title and trailing path fragments. */
  private linkIndex(): LinkIndex {
    return buildLinkIndex(this.notes.values());
  }

  resolveTarget(name: string): string | null {
    return resolveLinkTarget(this.linkIndex(), name);
  }

  search(query: string): SearchResult[] {
    return searchNotes(
      [...this.notes.values()].map((rec) => ({
        path: rec.path,
        title: rec.title,
        schema: rec.schema,
        folder: rec.folder,
        tags: rec.tags,
        body: rec.body,
        bodyStartLine: rec.bodyStartLine,
        updated: rec.updated,
      })),
      query
    );
  }

  // ---------- snapshot ----------

  snapshot(): VaultSnapshot {
    const idx = this.linkIndex();
    const notes: NoteMeta[] = [];
    const tasks: TaskItem[] = [];
    const edgeSet = new Set<string>();
    const edges: [string, string][] = [];
    const linkedInto = new Set<string>();
    let wikilinksTotal = 0;
    let resolvedTotal = 0;

    for (const rec of this.notes.values()) {
      const links: string[] = [];
      const linked = new Set<string>();
      const unresolved: string[] = [];
      let resolvedHere = 0;
      for (const target of rec.linkTargets) {
        const hit = resolveLinkTarget(idx, target);
        if (hit && hit !== rec.path) {
          resolvedHere++;
          // Two spellings of one note ([[Note]] and [[Folder/Note]]) are a single link.
          if (!linked.has(hit)) {
            linked.add(hit);
            links.push(hit);
          }
          linkedInto.add(hit);
          const key = [rec.path, hit].sort().join(' ');
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push([rec.path, hit]);
          }
        } else if (!hit) {
          unresolved.push(target);
        }
      }
      wikilinksTotal += rec.wikilinkCount;
      resolvedTotal += resolvedHere;

      const rawTasks = extractTasks(rec.body, rec.bodyStartLine);
      for (const t of rawTasks) {
        tasks.push({
          id: taskId(rec.path, t.line),
          notePath: rec.path,
          noteTitle: rec.title,
          line: t.line,
          content: t.content,
          status: t.status,
          priority: t.priority,
          due: t.due,
          tags: t.tags,
        });
      }

      notes.push({
        path: rec.path,
        title: rec.title,
        folder: rec.folder,
        schema: rec.schema,
        tags: rec.tags,
        frontmatter: rec.frontmatter,
        links,
        unresolved,
        headings: rec.headings,
        excerpt: rec.excerpt,
        wordCount: rec.wordCount,
        taskCount: rawTasks.length,
        openTaskCount: rawTasks.filter((t) => t.status !== 'done').length,
        created: rec.created,
        updated: rec.updated,
      });
    }

    notes.sort((a, b) => a.path.localeCompare(b.path));
    tasks.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.id.localeCompare(b.id));

    const today = localISO(new Date());
    const degree = new Map<string, number>();
    for (const [a, b] of edges) {
      degree.set(a, (degree.get(a) ?? 0) + 1);
      degree.set(b, (degree.get(b) ?? 0) + 1);
    }

    const graph: GraphData = {
      nodes: notes.map((n) => ({
        path: n.path,
        label: n.title,
        schema: n.schema,
        folder: n.folder,
        deg: degree.get(n.path) ?? 0,
        x: this.positions[n.path]?.x ?? 0.5,
        y: this.positions[n.path]?.y ?? 0.5,
        updated: n.updated,
      })),
      edges,
    };

    const stats: VaultStats = {
      notes: notes.length,
      folders: this.folders.size,
      tasksOpen: tasks.filter((t) => t.status !== 'done').length,
      tasksTotal: tasks.length,
      overdue: tasks.filter((t) => t.due && t.due < today && t.status !== 'done').length,
      wikilinks: wikilinksTotal,
      resolved: resolvedTotal,
      orphans: notes.filter((n) => n.links.length === 0 && !linkedInto.has(n.path)).length,
    };

    return {
      vaultPath: this.path,
      vaultName: this.path.split(sep).pop() || this.path,
      tree: this.buildTree(notes),
      notes,
      tasks,
      stats,
      graph,
      activity: this.activity.slice(0, 60),
      settings: this.settings,
    };
  }

  private buildTree(notes: NoteMeta[]): FolderNode {
    const root: FolderNode = { name: '', path: '', folders: [], notes: [] };
    const dirIndex = new Map<string, FolderNode>([['', root]]);
    const ensureDir = (path: string): FolderNode => {
      const existing = dirIndex.get(path);
      if (existing) return existing;
      const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      const parent = ensureDir(parentPath);
      const node: FolderNode = {
        name: path.split('/').pop() || path,
        path,
        folders: [],
        notes: [],
      };
      parent.folders.push(node);
      dirIndex.set(path, node);
      return node;
    };
    for (const folder of [...this.folders].sort()) ensureDir(folder);
    for (const note of notes) {
      const dir = note.path.includes('/')
        ? note.path.slice(0, note.path.lastIndexOf('/'))
        : '';
      ensureDir(dir).notes.push(note.path);
    }
    const sortNode = (n: FolderNode) => {
      n.folders.sort((a, b) => a.name.localeCompare(b.name));
      n.folders.forEach(sortNode);
    };
    sortNode(root);
    return root;
  }

  private ensurePositions(): void {
    const ids = [...this.notes.keys()];
    const missing = ids.some((id) => !this.positions[id]);
    if (!missing) return;
    const idx = this.linkIndex();
    const edges: [string, string][] = [];
    const folders: Record<string, string> = {};
    for (const rec of this.notes.values()) {
      folders[rec.path] = rec.folder;
      for (const t of rec.linkTargets) {
        const hit = resolveLinkTarget(idx, t);
        if (hit && hit !== rec.path) edges.push([rec.path, hit]);
      }
    }
    this.positions = { ...this.positions, ...layoutGraph(ids, edges, this.positions, folders) };
    this.savePositions();
  }

  // ---------- note operations ----------

  readNote(path: string): NotePayload {
    const rec = this.notes.get(path);
    if (!rec) throw new Error(`Note not found: ${path}`);
    const meta = this.snapshotMetaFor(path);
    return {
      meta,
      content: rec.raw,
      body: rec.body,
      bodyStartLine: rec.bodyStartLine,
      backlinks: this.backlinksFor(rec),
      attachments: this.attachmentsFor(rec.path, rec.body),
    };
  }

  private attachmentsFor(notePath: string, body: string): AttachmentRef[] {
    return extractAttachmentLinks(body).map((link) => {
      const path = resolveAttachmentPath(notePath, link.target);
      const full = path ? this.full(path) : null;
      const exists = !!full && existsSync(full);
      let size: number | null = null;
      if (exists && full) {
        try {
          size = statSync(full).size;
        } catch {
          size = null;
        }
      }
      const mime = attachmentMime(path ?? link.target);
      return {
        ...link,
        path,
        exists,
        size,
        mime,
        kind: attachmentKind(path ?? link.target, mime),
      };
    });
  }

  private snapshotMetaFor(path: string): NoteMeta {
    const snap = this.snapshot();
    const meta = snap.notes.find((n) => n.path === path);
    if (!meta) throw new Error(`Note not found: ${path}`);
    return meta;
  }

  private backlinksFor(rec: NoteRecord): BacklinkRef[] {
    const out: BacklinkRef[] = [];
    const idx = this.linkIndex();
    for (const other of this.notes.values()) {
      if (other.path === rec.path) continue;
      const hit = other.linkTargets.find((t) => resolveLinkTarget(idx, t) === rec.path);
      if (!hit) continue;
      out.push({
        path: other.path,
        title: other.title,
        schema: other.schema,
        folder: other.folder || 'vault',
        snippet: snippetAround(other.body, hit),
        updated: other.updated,
      });
    }
    out.sort((a, b) => b.updated - a.updated);
    return out;
  }

  private full(path: string): string {
    const full = join(this.path, path);
    const normalized = full.split(sep).join('/');
    const base = this.path.split(sep).join('/');
    if (normalized !== base && !normalized.startsWith(base + '/')) {
      throw new Error(`Path escapes vault: ${path}`);
    }
    return full;
  }

  resolveVaultFile(path: string): string {
    return this.full(path);
  }

  private cleanAttachmentsFolder(): string {
    const raw = this.settings.attachmentsFolder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const parts = raw.split('/').filter(Boolean);
    if (!parts.length || parts.some((part) => part === '.' || part === '..' || part.startsWith('.'))) {
      throw new Error('The attachments folder must be a normal folder inside the vault.');
    }
    return parts.join('/');
  }

  private nextAttachmentPath(fileName: string): string {
    const folder = this.cleanAttachmentsFolder();
    const rawName = basename(fileName).replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim();
    const safeName = rawName && rawName !== '.' && rawName !== '..' ? rawName : 'Attachment';
    if (/\.md$/i.test(safeName)) throw new Error('Markdown files belong in the vault as notes, not attachments.');
    const extension = extname(safeName);
    const stem = safeName.slice(0, safeName.length - extension.length) || 'Attachment';
    let candidate = `${folder}/${stem}${extension}`;
    let n = 2;
    while (existsSync(this.full(candidate))) candidate = `${folder}/${stem} ${n++}${extension}`;
    return candidate;
  }

  private attachmentResult(notePath: string, path: string, providedMime = ''): AttachmentImportResult {
    const name = basename(path);
    const mime = attachmentMime(name, providedMime);
    const kind = attachmentKind(name, mime);
    return { path, name, mime, kind, markdown: attachmentMarkdown(notePath, path, name, kind) };
  }

  async importAttachmentPaths(notePath: string, sourcePaths: string[]): Promise<AttachmentImportResult[]> {
    const note = this.notes.get(notePath);
    if (!note) throw new Error(`Note not found: ${notePath}`);
    const out: AttachmentImportResult[] = [];
    for (const sourcePath of sourcePaths) {
      const source = resolve(sourcePath);
      const info = await stat(source);
      if (!info.isFile()) continue;
      const destination = this.nextAttachmentPath(basename(source));
      const fullDestination = this.full(destination);
      await mkdir(dirname(fullDestination), { recursive: true });
      await copyFile(source, fullDestination);
      this.folders.add(this.cleanAttachmentsFolder());
      out.push(this.attachmentResult(notePath, destination));
      this.recordActivity({ kind: 'note', verb: 'attached', title: basename(destination), ref: note.title, ts: Date.now() });
    }
    if (out.length) this.broadcast();
    return out;
  }

  async importAttachmentData(
    notePath: string,
    fileName: string,
    mime: string,
    bytes: number[] | Uint8Array
  ): Promise<AttachmentImportResult> {
    const note = this.notes.get(notePath);
    if (!note) throw new Error(`Note not found: ${notePath}`);
    const destination = this.nextAttachmentPath(fileName);
    const fullDestination = this.full(destination);
    await mkdir(dirname(fullDestination), { recursive: true });
    await writeFile(fullDestination, Buffer.from(bytes));
    this.folders.add(this.cleanAttachmentsFolder());
    const result = this.attachmentResult(notePath, destination, mime);
    this.recordActivity({ kind: 'note', verb: 'attached', title: result.name, ref: note.title, ts: Date.now() });
    this.broadcast();
    return result;
  }

  private markSelfWrite(path: string): void {
    this.selfWrites.set(path, Date.now());
    if (this.selfWrites.size > 200) {
      const cutoff = Date.now() - 10_000;
      for (const [k, v] of this.selfWrites) if (v < cutoff) this.selfWrites.delete(k);
    }
  }

  private historyDir(path: string): string {
    this.full(path); // Reject absolute paths and traversal before mapping into .skald.
    // Encode each path segment so note history stays self-contained under .skald.
    const segments = path.split('/').filter(Boolean).map(encodeURIComponent);
    return join(this.path, SKALD_DIR, 'history', ...segments);
  }

  private async storeHistory(
    path: string,
    content: string,
    reason: NoteHistoryReason,
    force = false
  ): Promise<void> {
    const entries = await this.listNoteHistory(path);
    const newest = entries[0];
    if (
      !force &&
      reason === 'edit' &&
      newest?.reason === 'edit' &&
      Date.now() - newest.createdAt < HISTORY_COALESCE_MS
    ) return;
    if (newest) {
      try {
        const last = await this.readNoteHistoryVersion(path, newest.id);
        if (last.content === content) return;
      } catch {
        // A damaged history entry should not prevent protecting the current note.
      }
    }

    const dir = this.historyDir(path);
    await mkdir(dir, { recursive: true });
    let timestamp = Date.now();
    while (existsSync(join(dir, `${timestamp}-${reason}.md`))) timestamp++;
    const id = `${timestamp}-${reason}.md`;
    await writeFile(join(dir, id), content, 'utf-8');

    const after = await this.listNoteHistory(path);
    await Promise.all(
      after.slice(HISTORY_CAP_PER_NOTE).map((entry) => rm(join(dir, entry.id), { force: true }))
    );
  }

  async listNoteHistory(path: string): Promise<NoteHistoryEntry[]> {
    const dir = this.historyDir(path);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const entries = await Promise.all(
      names
        .filter((name) => /^\d+-(edit|external|rename|delete|restore|sync)\.md$/.test(name))
        .map(async (id): Promise<NoteHistoryEntry | null> => {
          try {
            const info = await stat(join(dir, id));
            const match = id.match(/^(\d+)-(edit|external|rename|delete|restore|sync)\.md$/);
            if (!match) return null;
            return {
              id,
              notePath: path,
              createdAt: Number(match[1]),
              size: info.size,
              reason: match[2] as NoteHistoryReason,
            };
          } catch {
            return null;
          }
        })
    );
    return entries
      .filter((entry): entry is NoteHistoryEntry => entry !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async readNoteHistoryVersion(path: string, id: string): Promise<NoteHistoryVersion> {
    if (basename(id) !== id || !/^\d+-(edit|external|rename|delete|restore|sync)\.md$/.test(id)) {
      throw new Error('Invalid history version');
    }
    const entry = (await this.listNoteHistory(path)).find((item) => item.id === id);
    if (!entry) throw new Error('History version not found');
    const content = await readFile(join(this.historyDir(path), id), 'utf-8');
    return { ...entry, content };
  }

  async restoreNoteHistoryVersion(path: string, id: string): Promise<void> {
    const version = await this.readNoteHistoryVersion(path, id);
    const current = this.notes.get(path);
    if (current) await this.storeHistory(path, current.raw, 'restore', true);
    await this.writeNote(path, version.content, { history: false, silent: true });
    const restored = this.notes.get(path);
    this.recordActivity({
      kind: 'note',
      verb: 'restored',
      title: restored?.title ?? titleFromPath(path),
      ref: restored?.folder || 'vault',
      ts: Date.now(),
    });
    this.broadcast();
  }

  async listDeletedNotes(): Promise<DeletedNoteEntry[]> {
    const root = this.stateFile('history');
    const out: DeletedNoteEntry[] = [];
    const walk = async (dir: string, segments: string[]): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      const historyFiles = entries.filter(
        (entry) => entry.isFile() && /^\d+-delete\.md$/.test(entry.name)
      );
      if (historyFiles.length && segments.length) {
        const path = segments.map(decodeURIComponent).join('/');
        if (!this.notes.has(path)) {
          const latest = historyFiles.sort((a, b) => Number(b.name.split('-')[0]) - Number(a.name.split('-')[0]))[0];
          const full = join(dir, latest.name);
          try {
            const [content, info] = await Promise.all([readFile(full, 'utf-8'), stat(full)]);
            const parsed = parseFrontmatter(content);
            const title = noteTitle(parsed.frontmatter, path);
            out.push({
              path,
              title,
              schema: inferSchema(parsed.frontmatter, title, topFolder(path)),
              deletedAt: Number(latest.name.split('-')[0]),
              size: info.size,
            });
          } catch {
            // One damaged snapshot should not hide the rest of the trash list.
          }
        }
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) await walk(join(dir, entry.name), [...segments, entry.name]);
      }
    };
    await walk(root, []);
    return out.sort((a, b) => b.deletedAt - a.deletedAt);
  }

  async restoreDeletedNote(path: string): Promise<void> {
    if (this.notes.has(path) || existsSync(this.full(path))) {
      throw new Error(`A note already exists at “${path}”.`);
    }
    const version = (await this.listNoteHistory(path)).find((entry) => entry.reason === 'delete');
    if (!version) throw new Error('Deleted note snapshot not found');
    await this.restoreNoteHistoryVersion(path, version.id);
  }

  async writeNote(
    path: string,
    content: string,
    opts: { silent?: boolean; history?: boolean } = {}
  ): Promise<void> {
    const full = this.full(path);
    const prev = this.notes.get(path);
    if (prev?.raw === content) return;
    if (prev && opts.history !== false) await this.storeHistory(path, prev.raw, 'edit');
    this.markSelfWrite(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf-8');
    this.indexContent(path, content, prev?.created ?? Date.now(), Date.now());
    if (!opts.silent) {
      const rec = this.notes.get(path)!;
      this.recordActivity({
        kind: 'note',
        verb: prev ? 'edited' : 'created',
        title: rec.title,
        ref: rec.folder || 'vault',
        ts: Date.now(),
      });
    }
    this.ensurePositions();
    this.broadcast();
  }

  async createNote(folder: string, title: string, schema: SchemaName): Promise<string> {
    const name = safeFileName(title) || 'Untitled';
    const dir = this.cleanFolderPath(folder, true);
    let path = dir ? `${dir}/${name}.md` : `${name}.md`;
    let n = 2;
    while (this.notes.has(path) || existsSync(this.full(path))) {
      path = dir ? `${dir}/${name} ${n}.md` : `${name} ${n}.md`;
      n++;
    }
    const date = localISO(new Date());
    const fm: Record<string, unknown> = {
      schema,
      created: date,
    };
    const body = renderSchemaTemplate(this.settings.schemaTemplates[schema] ?? '', name, date);
    const content = serializeFrontmatter(fm, body);
    this.markSelfWrite(path);
    const full = this.full(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf-8');
    this.indexContent(path, content, Date.now(), Date.now());
    this.recordActivity({
      kind: 'note',
      verb: 'created',
      title: titleFromPath(path),
      ref: dir || 'vault',
      ts: Date.now(),
    });
    this.ensurePositions();
    this.broadcast();
    return path;
  }

  async createDailyNote(): Promise<string> {
    const today = localISO(new Date());
    const dir = this.settings.dailyFolder;
    const path = `${dir}/${today}.md`;
    if (this.notes.has(path)) return path;
    const body = renderSchemaTemplate(this.settings.schemaTemplates.Daily ?? '', today, today);
    const content = serializeFrontmatter({ schema: 'Daily', created: today }, body);
    this.markSelfWrite(path);
    const full = this.full(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf-8');
    this.indexContent(path, content, Date.now(), Date.now());
    this.recordActivity({ kind: 'note', verb: 'created', title: today, ref: dir, ts: Date.now() });
    this.ensurePositions();
    this.broadcast();
    return path;
  }

  async renameNote(path: string, newTitle: string): Promise<string> {
    const rec = this.notes.get(path);
    if (!rec) throw new Error(`Note not found: ${path}`);
    const oldTitle = rec.title;
    const name = safeFileName(newTitle);
    if (!name) throw new Error('Empty name');
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const newPath = dir ? `${dir}/${name}.md` : `${name}.md`;
    if (newPath === path) return path;
    if (this.notes.has(newPath) || existsSync(this.full(newPath))) {
      throw new Error(`A note named “${name}” already exists there.`);
    }
    await this.storeHistory(path, rec.raw, 'rename', true);

    // Update every wikilink across the vault that resolved to this note, whether
    // it was written bare, folder-qualified or as a full path.
    const idx = this.linkIndex();
    const pointsHere = (target: string): boolean => resolveLinkTarget(idx, target) === path;
    for (const other of this.notes.values()) {
      if (other.path === path) continue;
      if (!other.linkTargets.some(pointsHere)) continue;
      const raw = rewriteWikilinks(other.raw, pointsHere, (target) =>
        retargetWikilink(target, newPath)
      );
      await this.writeNote(other.path, raw, { silent: true });
    }

    // If frontmatter pinned an old title, update it.
    let raw = rec.raw;
    if (typeof rec.frontmatter['title'] === 'string') {
      const { frontmatter, body } = parseFrontmatter(raw);
      frontmatter['title'] = name;
      raw = serializeFrontmatter(frontmatter, body);
    }

    this.markSelfWrite(path);
    this.markSelfWrite(newPath);
    await mkdir(dirname(this.full(newPath)), { recursive: true });
    await rename(this.full(path), this.full(newPath));
    await writeFile(this.full(newPath), raw, 'utf-8');
    const oldHistoryDir = this.historyDir(path);
    const newHistoryDir = this.historyDir(newPath);
    if (existsSync(oldHistoryDir)) {
      await mkdir(dirname(newHistoryDir), { recursive: true });
      await rename(oldHistoryDir, newHistoryDir);
    }
    this.notes.delete(path);
    this.indexContent(newPath, raw, rec.created, Date.now());
    if (this.positions[path]) {
      this.positions[newPath] = this.positions[path];
      delete this.positions[path];
      this.savePositions();
    }
    if (this.settings.pinnedNote === path) {
      this.settings.pinnedNote = newPath;
      this.saveSettings();
    }
    this.recordActivity({
      kind: 'note',
      verb: 'renamed',
      title: `${oldTitle} → ${name}`,
      ref: dir || 'vault',
      ts: Date.now(),
    });
    this.broadcast();
    return newPath;
  }

  async deleteNote(path: string): Promise<void> {
    const rec = this.notes.get(path);
    if (rec) await this.storeHistory(path, rec.raw, 'delete', true);
    this.markSelfWrite(path);
    try {
      await rm(this.full(path));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    this.notes.delete(path);
    delete this.positions[path];
    this.savePositions();
    if (this.settings.pinnedNote === path) {
      this.settings.pinnedNote = null;
      this.saveSettings();
    }
    if (rec) {
      this.recordActivity({
        kind: 'note',
        verb: 'deleted',
        title: rec.title,
        ref: rec.folder || 'vault',
        ts: Date.now(),
      });
    }
    this.broadcast();
  }

  async deleteNotes(paths: string[]): Promise<void> {
    const unique = [...new Set(paths)];
    for (const path of unique) {
      if (!this.notes.has(path)) throw new Error(`Note not found: ${path}`);
    }
    for (const path of unique) await this.deleteNote(path);
  }

  /**
   * Move several notes as one logical operation. All wikilinks are resolved
   * against the pre-move index, so duplicate file names cannot make a later
   * move in the batch rewrite the wrong target.
   */
  async moveNotes(paths: string[], folder: string): Promise<PathChange[]> {
    const destination = this.cleanFolderPath(folder, true);
    const unique = [...new Set(paths)];
    if (!unique.length) return [];
    const changes = unique.map((oldPath) => {
      if (!this.notes.has(oldPath)) throw new Error(`Note not found: ${oldPath}`);
      return { oldPath, newPath: destination ? `${destination}/${basename(oldPath)}` : basename(oldPath) };
    });
    await this.relocateNotes(changes, async () => {
      if (destination) await mkdir(this.full(destination), { recursive: true });
      for (const { oldPath, newPath } of changes) {
        if (oldPath !== newPath) await rename(this.full(oldPath), this.full(newPath));
      }
    });
    if (destination) this.folders.add(destination);
    this.recordActivity({
      kind: 'note',
      verb: changes.length === 1 ? 'moved' : `moved ${changes.length} notes`,
      title: changes.length === 1 ? titleFromPath(changes[0].newPath) : `${changes.length} notes`,
      ref: destination || 'vault',
      ts: Date.now(),
    });
    this.broadcast();
    return changes.filter((c) => c.oldPath !== c.newPath);
  }

  async createFolder(folderPath: string): Promise<void> {
    const clean = this.cleanFolderPath(folderPath);
    if (!clean) return;
    await mkdir(this.full(clean), { recursive: true });
    this.folders.add(clean);
    this.broadcast();
  }

  async renameFolder(path: string, name: string): Promise<PathChange[]> {
    const clean = this.cleanFolderPath(path);
    const safeName = safeFileName(name);
    if (!safeName) throw new Error('Empty folder name');
    const parent = clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : '';
    return this.relocateFolder(clean, parent ? `${parent}/${safeName}` : safeName);
  }

  async moveFolder(path: string, parent: string): Promise<PathChange[]> {
    const clean = this.cleanFolderPath(path);
    const destinationParent = this.cleanFolderPath(parent, true);
    const destination = destinationParent ? `${destinationParent}/${basename(clean)}` : basename(clean);
    return this.relocateFolder(clean, destination);
  }

  async deleteFolder(path: string): Promise<void> {
    const clean = this.cleanFolderPath(path);
    if (!this.folders.has(clean) && !existsSync(this.full(clean))) {
      throw new Error(`Folder not found: ${clean}`);
    }
    const notes = [...this.notes.values()].filter((rec) => rec.path.startsWith(`${clean}/`));
    for (const rec of notes) await this.storeHistory(rec.path, rec.raw, 'delete', true);
    for (const rec of notes) {
      this.markSelfWrite(rec.path);
      this.notes.delete(rec.path);
      delete this.positions[rec.path];
      if (this.settings.pinnedNote === rec.path) this.settings.pinnedNote = null;
    }
    await rm(this.full(clean), { recursive: true, force: true });
    for (const folder of [...this.folders]) {
      if (folder === clean || folder.startsWith(`${clean}/`)) this.folders.delete(folder);
    }
    this.savePositions();
    this.saveSettings();
    this.recordActivity({
      kind: 'note',
      verb: 'deleted folder',
      title: basename(clean),
      ref: clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : 'vault',
      ts: Date.now(),
    });
    this.broadcast();
  }

  private cleanFolderPath(path: string, allowRoot = false): string {
    const clean = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!clean) {
      if (allowRoot) return '';
      throw new Error('The vault root cannot be changed.');
    }
    const parts = clean.split('/');
    if (
      parts.some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          part.startsWith('.') ||
          safeFileName(part) !== part
      )
    ) {
      throw new Error('Folder path contains an invalid name.');
    }
    this.full(clean);
    return clean;
  }

  private async relocateFolder(oldPath: string, newPath: string): Promise<PathChange[]> {
    if (!this.folders.has(oldPath) && !existsSync(this.full(oldPath))) {
      throw new Error(`Folder not found: ${oldPath}`);
    }
    this.cleanFolderPath(newPath);
    if (oldPath === newPath) return [];
    if (newPath.startsWith(`${oldPath}/`)) throw new Error('A folder cannot be moved inside itself.');
    if (existsSync(this.full(newPath))) throw new Error(`A folder already exists at “${newPath}”.`);

    const changes = [...this.notes.keys()]
      .filter((path) => path.startsWith(`${oldPath}/`))
      .map((path) => ({ oldPath: path, newPath: `${newPath}${path.slice(oldPath.length)}` }));
    const movedFolders = [...this.folders].filter(
      (folder) => folder === oldPath || folder.startsWith(`${oldPath}/`)
    );
    for (const folder of movedFolders) {
      this.markSelfWrite(folder);
      this.markSelfWrite(`${newPath}${folder.slice(oldPath.length)}`);
    }
    const moveDirectory = async () => {
      await mkdir(dirname(this.full(newPath)), { recursive: true });
      await rename(this.full(oldPath), this.full(newPath));
    };
    if (changes.length) await this.relocateNotes(changes, moveDirectory);
    else await moveDirectory();

    for (const folder of movedFolders) this.folders.delete(folder);
    for (const folder of movedFolders) this.folders.add(`${newPath}${folder.slice(oldPath.length)}`);
    this.recordActivity({
      kind: 'note',
      verb: 'moved folder',
      title: `${basename(oldPath)} → ${basename(newPath)}`,
      ref: newPath.includes('/') ? newPath.slice(0, newPath.lastIndexOf('/')) : 'vault',
      ts: Date.now(),
    });
    this.broadcast();
    return changes;
  }

  private async relocateNotes(
    changes: PathChange[],
    moveOnDisk: () => Promise<void>
  ): Promise<void> {
    const effective = changes.filter((change) => change.oldPath !== change.newPath);
    if (!effective.length) return;
    const moving = new Set(effective.map((change) => change.oldPath));
    const destinations = new Set<string>();
    for (const { newPath } of effective) {
      this.full(newPath);
      if (destinations.has(newPath)) throw new Error(`More than one note would become “${newPath}”.`);
      destinations.add(newPath);
      if (!moving.has(newPath) && (this.notes.has(newPath) || existsSync(this.full(newPath)))) {
        throw new Error(`A note already exists at “${newPath}”.`);
      }
    }

    const originalIndex = this.linkIndex();
    const pathMap = new Map(effective.map((change) => [change.oldPath, change.newPath]));
    const finalIndex = buildLinkIndex(
      [...this.notes.values()].map((rec) => ({
        path: pathMap.get(rec.path) ?? rec.path,
        title: rec.title,
      }))
    );
    const rewritten = new Map<string, string>();
    for (const rec of this.notes.values()) {
      const raw = rewriteWikilinks(
        rec.raw,
        (target) => {
          const hit = resolveLinkTarget(originalIndex, target);
          return !!hit && pathMap.has(hit);
        },
        (target) => {
          const hit = resolveLinkTarget(originalIndex, target)!;
          const newPath = pathMap.get(hit)!;
          const shaped = retargetWikilink(target, newPath);
          if (resolveLinkTarget(finalIndex, shaped) === newPath) return shaped;
          const rooted = /^\s*\//.test(target);
          const keepExt = /\.md\s*$/i.test(target);
          const fullTarget = newPath.replace(/\.md$/i, '');
          return `${rooted ? '/' : ''}${fullTarget}${keepExt ? '.md' : ''}`;
        }
      );
      rewritten.set(rec.path, raw);
      if (raw !== rec.raw && !moving.has(rec.path)) await this.storeHistory(rec.path, rec.raw, 'edit');
    }
    for (const { oldPath, newPath } of effective) {
      const rec = this.notes.get(oldPath)!;
      await this.storeHistory(oldPath, rec.raw, 'rename', true);
      this.markSelfWrite(oldPath);
      this.markSelfWrite(newPath);
    }

    await moveOnDisk();

    for (const { oldPath, newPath } of effective) {
      const oldHistory = this.historyDir(oldPath);
      const newHistory = this.historyDir(newPath);
      if (existsSync(oldHistory)) {
        await mkdir(dirname(newHistory), { recursive: true });
        if (!existsSync(newHistory)) {
          await rename(oldHistory, newHistory);
        } else {
          // A previously deleted note may already own history at the target
          // path. Preserve both timelines, making colliding snapshot ids
          // unique rather than overwriting either one.
          await mkdir(newHistory, { recursive: true });
          for (const name of await readdir(oldHistory)) {
            let destination = join(newHistory, name);
            const match = name.match(/^(\d+)-(edit|external|rename|delete|restore|sync)\.md$/);
            if (!match) continue;
            let stamp = Number(match[1]);
            while (existsSync(destination)) destination = join(newHistory, `${++stamp}-${match[2]}.md`);
            await rename(join(oldHistory, name), destination);
          }
          await rm(oldHistory, { recursive: true, force: true });
        }
      }
    }

    const records = [...this.notes.values()];
    for (const { oldPath } of effective) this.notes.delete(oldPath);
    for (const rec of records) {
      const destination = pathMap.get(rec.path) ?? rec.path;
      const raw = rewritten.get(rec.path) ?? rec.raw;
      if (destination !== rec.path || raw !== rec.raw) {
        await writeFile(this.full(destination), raw, 'utf-8');
        this.indexContent(destination, raw, rec.created, Date.now());
      }
    }
    for (const { oldPath, newPath } of effective) {
      if (this.positions[oldPath]) {
        this.positions[newPath] = this.positions[oldPath];
        delete this.positions[oldPath];
      }
      if (this.settings.pinnedNote === oldPath) this.settings.pinnedNote = newPath;
    }
    this.savePositions();
    this.saveSettings();
    this.ensurePositions();
  }

  // ---------- tasks ----------

  async updateTask(id: string, edits: TaskEdits): Promise<void> {
    const m = id.match(/^(.*)#L(\d+)$/);
    if (!m) throw new Error(`Bad task id: ${id}`);
    const [, path, lineStr] = m;
    const rec = this.notes.get(path);
    if (!rec) throw new Error(`Note not found: ${path}`);
    const line = parseInt(lineStr, 10);
    const before = extractTasks(rec.body, rec.bodyStartLine).find((t) => t.line === line);
    const updated = updateTaskLine(rec.raw, line, edits);
    if (updated === rec.raw) return;
    await this.writeNote(path, updated, { silent: true });

    if (edits.status && edits.status !== before?.status) {
      const verb =
        edits.status === 'done'
          ? 'completed'
          : edits.status === 'blocked'
            ? 'blocked'
            : edits.status === 'working'
              ? 'started'
              : 'reopened';
      this.recordActivity({
        kind: 'task',
        verb,
        title: edits.content ?? before?.content ?? 'task',
        ref: rec.title,
        ts: Date.now(),
      });
      this.broadcast();
    }
  }

  async addTask(
    notePath: string,
    content: string,
    opts: { due?: string | null; priority?: 'low' | 'med' | 'high' } = {}
  ): Promise<void> {
    const rec = this.notes.get(notePath);
    if (!rec) throw new Error(`Note not found: ${notePath}`);
    const line = formatTaskLine(content, opts);
    const raw = rec.raw.replace(/\n*$/, '\n') + line + '\n';
    await this.writeNote(notePath, raw, { silent: true });
    this.recordActivity({ kind: 'task', verb: 'added', title: content, ref: rec.title, ts: Date.now() });
    this.broadcast();
  }

  // ---------- sync ----------
  //
  // The sync engine works in whole files. These are the only doors it goes
  // through, and each one is deliberately narrow: it can enumerate notes, read
  // one, write one, delete one, and force a history snapshot before losing a
  // local edit to a remote one.

  /** Every note the engine may publish, as raw file content. */
  syncFiles(): { path: string; raw: string }[] {
    return [...this.notes.values()].map((rec) => ({ path: rec.path, raw: rec.raw }));
  }

  /**
   * Every non-Markdown file in the vault, with the stat the engine uses to skip
   * re-hashing something that has not moved. Notes are indexed in memory;
   * attachments are not, so this walks the tree.
   */
  async syncAssets(): Promise<{ path: string; size: number; mtimeMs: number }[]> {
    const out: { path: string; size: number; mtimeMs: number }[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && !/\.md$/i.test(entry.name)) {
          try {
            const info = await stat(full);
            out.push({ path: this.rel(full), size: info.size, mtimeMs: info.mtimeMs });
          } catch {
            // A file that vanished mid-walk is simply not there to publish.
          }
        }
      }
    };
    await walk(this.path);
    return out;
  }

  /** Bytes of one attachment, or null when it is not there. */
  async syncReadAsset(path: string): Promise<Uint8Array | null> {
    // Belt and braces: events are path-validated on decode, but these doors are
    // the ones that touch the filesystem, and `.skald/` must stay unreachable
    // through them however they are called.
    if (!isAttachmentPath(path)) return null;
    try {
      return new Uint8Array(await readFile(this.full(path)));
    } catch {
      return null;
    }
  }

  /**
   * Applies an attachment received from another device. Staged under a
   * temporary name and published by rename, so a reader never sees a
   * half-written file — the same rule the relay applies to its own blobs.
   */
  async syncWriteAsset(path: string, bytes: Uint8Array): Promise<void> {
    if (!isAttachmentPath(path)) throw new Error(`Not a syncable attachment: ${path}`);
    const full = this.full(path);
    await mkdir(dirname(full), { recursive: true });
    // Stage inside .skald/ rather than beside the target: it is the same
    // filesystem so the rename is atomic, and a partial file there is invisible
    // to the watcher, the scanner, and the next attachment walk.
    const stagingDir = join(this.path, SKALD_DIR, 'staging');
    await mkdir(stagingDir, { recursive: true });
    const staging = join(stagingDir, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    this.markSelfWrite(path);
    await writeFile(staging, bytes);
    await rename(staging, full);
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (folder) this.folders.add(folder);
    this.recordActivity({
      kind: 'note',
      verb: 'received',
      title: basename(path),
      ref: folder || 'vault',
      ts: Date.now(),
    });
    this.broadcast();
  }

  /** Applies an attachment deletion received from another device. */
  async syncDeleteAsset(path: string): Promise<void> {
    if (!isAttachmentPath(path)) throw new Error(`Not a syncable attachment: ${path}`);
    this.markSelfWrite(path);
    try {
      await rm(this.full(path));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    this.broadcast();
  }

  /** Raw content of one note, or null when it is not in the vault. */
  syncRead(path: string): string | null {
    return this.notes.get(path)?.raw ?? null;
  }

  /** Applies a note received from another device. */
  async syncWrite(path: string, content: string): Promise<void> {
    const previous = this.notes.get(path);
    if (previous?.raw === content) return;
    const existed = !!previous;
    // Always keep what sync is about to replace. The ordinary edit path
    // coalesces rapid history entries, which would be exactly the wrong
    // behaviour here: the text being overwritten came from a person, and it is
    // not being replaced by their next keystroke but by another device.
    if (previous) await this.storeHistory(path, previous.raw, 'sync', true);
    await this.writeNote(path, content, { silent: true, history: false });
    const rec = this.notes.get(path);
    if (!rec) return;
    this.recordActivity({
      kind: 'note',
      verb: existed ? 'synced' : 'received',
      title: rec.title,
      ref: rec.folder || 'vault',
      ts: Date.now(),
    });
    this.broadcast();
  }

  /** Applies a deletion received from another device. */
  async syncDelete(path: string): Promise<void> {
    if (!this.notes.has(path)) return;
    await this.deleteNote(path);
  }

  /**
   * Forces the note's current content into its history before something else
   * overwrites it. Used when a local edit loses a sync conflict, so the losing
   * side is recoverable from the editor rather than gone.
   */
  async captureVersion(path: string, reason: NoteHistoryReason): Promise<void> {
    const rec = this.notes.get(path);
    if (!rec) return;
    await this.storeHistory(path, rec.raw, reason, true);
  }

  // ---------- settings / graph / activity ----------

  getSettings(): VaultSettings {
    return this.settings;
  }

  setSettings(patch: Partial<VaultSettings>): VaultSettings {
    this.settings = { ...this.settings, ...patch };
    this.saveSettings();
    this.broadcast();
    return this.settings;
  }

  // ---------- note themes ----------

  /** Theme names available in the vault's themes folder. */
  async listThemes(): Promise<string[]> {
    try {
      const entries = await readdir(this.full(THEMES_DIR), { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.css')
        .map((entry) => basename(entry.name, extname(entry.name)))
        .filter(isValidThemeName)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  /**
   * A theme's source, or null when there is no such theme. The name is
   * validated here as well as at the caller: it arrives from note frontmatter,
   * which is user text that reaches this method through IPC.
   */
  async readTheme(name: string): Promise<string | null> {
    const relPath = themeFilePath(name);
    if (!relPath) return null;
    try {
      return await readFile(this.full(relPath), 'utf-8');
    } catch {
      return null;
    }
  }

  setGraphPosition(path: string, x: number, y: number): void {
    this.positions[path] = {
      x: Math.max(0.02, Math.min(0.98, x)),
      y: Math.max(0.02, Math.min(0.98, y)),
    };
    this.savePositions();
    this.broadcast();
  }

  resetGraphLayout(): void {
    this.positions = {};
    this.ensurePositions();
    this.broadcast();
  }

  private recordActivity(ev: ActivityEvent): void {
    // Collapse repeated identical events (e.g. autosave "edited" bursts).
    const head = this.activity[0];
    if (
      head &&
      head.kind === ev.kind &&
      head.verb === ev.verb &&
      head.title === ev.title &&
      head.ref === ev.ref &&
      ev.ts - head.ts < 10 * 60_000
    ) {
      head.ts = ev.ts;
      this.saveActivity();
      return;
    }
    this.activity.unshift(ev);
    if (this.activity.length > ACTIVITY_CAP) this.activity.length = ACTIVITY_CAP;
    this.saveActivity();
  }
}

// ---------- small fs helpers ----------

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value, null, 2), 'utf-8');
  } catch (err) {
    console.error(`skald: failed to write ${file}`, err);
  }
}
