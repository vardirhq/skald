// Screenshot generator for the README / website.
// Loads the built renderer (run `npm run build:app` first) with a stubbed
// skald bridge feeding a demo snapshot, then screenshots every major view
// into docs/screenshots/. Usage: node tools/screenshots.mjs
// Set CHROMIUM to point at a Chromium binary if the default path is wrong.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = join(REPO, 'dist');
const OUT = join(REPO, 'docs', 'screenshots');

const now = Date.now();
const day = 86400000;
const iso = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const notes = [
  { path: 'Notes/Skald design rationale.md', title: 'Skald design rationale', folder: 'Notes', schema: 'Note', tags: ['design', 'vision'], frontmatter: { created: '2026-05-12', tags: ['design', 'vision'] }, links: ['Notes/Stack decisions.md', 'Notes/On the use of runes.md'], unresolved: ["tomorrow's note"], headings: [{ level: 2, text: 'Typed notes, not folders', line: 12 }, { level: 2, text: 'Tasks live in the text', line: 20 }, { level: 2, text: 'A graph you can return to', line: 28 }], excerpt: 'Resisting the urge to make a knowledge tool into a database. The connections are the product…', wordCount: 612, taskCount: 3, openTaskCount: 2, created: now - 30 * day, updated: now - 120000 },
  { path: 'Notes/Stack decisions.md', title: 'Stack decisions', folder: 'Notes', schema: 'Note', tags: [], frontmatter: {}, links: ['Notes/Skald design rationale.md'], unresolved: [], headings: [], excerpt: 'TipTap vs CodeMirror, chokidar v4, and the case for dropping Tailwind.', wordCount: 420, taskCount: 2, openTaskCount: 1, created: now - 20 * day, updated: now - 3 * 3600000 },
  { path: 'Notes/On the use of runes.md', title: 'On the use of runes', folder: 'Notes', schema: 'Idea', tags: [], frontmatter: {}, links: [], unresolved: [], headings: [], excerpt: 'Schemas should leave a mark. A small rune next to a title tells you what kind of thing it is.', wordCount: 300, taskCount: 0, openTaskCount: 0, created: now - 10 * day, updated: now - day },
  { path: 'Projects/Jormungandr API rewrite.md', title: 'Jormungandr API rewrite', folder: 'Projects', schema: 'Project', tags: ['api'], frontmatter: { schema: 'Project' }, links: ['Notes/Stack decisions.md'], unresolved: [], headings: [], excerpt: 'The API rewrite, inheriting the design language from the rationale.', wordCount: 800, taskCount: 4, openTaskCount: 3, created: now - 40 * day, updated: now - 3600000 },
  { path: 'Projects/Yggdrasil graph layout.md', title: 'Yggdrasil graph layout', folder: 'Projects', schema: 'Project', tags: [], frontmatter: { schema: 'Project' }, links: ['Notes/Skald design rationale.md'], unresolved: [], headings: [], excerpt: 'The graph should not re-layout on every change.', wordCount: 350, taskCount: 1, openTaskCount: 1, created: now - 15 * day, updated: now - day },
  { path: 'People/Ada.md', title: 'Ada', folder: 'People', schema: 'Person', tags: [], frontmatter: {}, links: [], unresolved: [], headings: [], excerpt: 'Works on the sync layer.', wordCount: 60, taskCount: 0, openTaskCount: 0, created: now - 50 * day, updated: now - 2 * day },
  { path: `Daily/${iso(now)}.md`, title: iso(now), folder: 'Daily', schema: 'Daily', tags: [], frontmatter: {}, links: ['Notes/Skald design rationale.md'], unresolved: [], headings: [], excerpt: 'Rewriting the design rationale for the third time. It is finally honest.', wordCount: 90, taskCount: 1, openTaskCount: 1, created: now, updated: now - 600000 },
  { path: 'Sources/CRDTs in collaboration.md', title: 'CRDTs in collaboration', folder: 'Sources', schema: 'Source', tags: [], frontmatter: {}, links: [], unresolved: [], headings: [], excerpt: 'Shapiro et al. on conflict-free replicated data types.', wordCount: 200, taskCount: 0, openTaskCount: 0, created: now - 60 * day, updated: now - 5 * day },
];

const tasks = [
  { id: 'Projects/Jormungandr API rewrite.md#L12', notePath: 'Projects/Jormungandr API rewrite.md', noteTitle: 'Jormungandr API rewrite', line: 12, content: 'Replace Lexical with TipTap for live collab', status: 'working', priority: 'high', due: iso(now + day), tags: ['editor'] },
  { id: 'Projects/Jormungandr API rewrite.md#L13', notePath: 'Projects/Jormungandr API rewrite.md', noteTitle: 'Jormungandr API rewrite', line: 13, content: 'Wire awareness into the presence layer', status: 'open', priority: 'med', due: iso(now + 2 * day), tags: ['sync'] },
  { id: 'Notes/Skald design rationale.md#L22', notePath: 'Notes/Skald design rationale.md', noteTitle: 'Skald design rationale', line: 22, content: 'Draft schema for the Saga entity', status: 'open', priority: 'med', due: iso(now + 3 * day), tags: ['schema'] },
  { id: 'Projects/Yggdrasil graph layout.md#L8', notePath: 'Projects/Yggdrasil graph layout.md', noteTitle: 'Yggdrasil graph layout', line: 8, content: 'Rebuild constellation graph layout', status: 'working', priority: 'high', due: iso(now), tags: ['graph'] },
  { id: 'Projects/Jormungandr API rewrite.md#L14', notePath: 'Projects/Jormungandr API rewrite.md', noteTitle: 'Jormungandr API rewrite', line: 14, content: 'Migrate auth from Passport to Lucia', status: 'blocked', priority: 'high', due: iso(now - 6 * day), tags: ['auth'] },
  { id: 'Notes/Stack decisions.md#L9', notePath: 'Notes/Stack decisions.md', noteTitle: 'Stack decisions', line: 9, content: 'Refactor folder watcher to chokidar v4', status: 'done', priority: 'med', due: iso(now - 4 * day), tags: ['infra'] },
  { id: `Daily/${iso(now)}.md#L5`, notePath: `Daily/${iso(now)}.md`, noteTitle: iso(now), line: 5, content: 'Write field guide to runic schema markers', status: 'open', priority: 'low', due: iso(now + 7 * day), tags: ['doc'] },
];

const pos = {
  'Notes/Skald design rationale.md': { x: 0.5, y: 0.42 },
  'Notes/Stack decisions.md': { x: 0.74, y: 0.46 },
  'Notes/On the use of runes.md': { x: 0.4, y: 0.62 },
  'Projects/Jormungandr API rewrite.md': { x: 0.3, y: 0.3 },
  'Projects/Yggdrasil graph layout.md': { x: 0.62, y: 0.28 },
  'People/Ada.md': { x: 0.1, y: 0.3 },
  [`Daily/${iso(now)}.md`]: { x: 0.5, y: 0.18 },
  'Sources/CRDTs in collaboration.md': { x: 0.84, y: 0.62 },
};

const snapshot = {
  vaultPath: '/home/chris/vaults/midgard',
  vaultName: 'midgard',
  tree: {
    name: '', path: '', notes: [],
    folders: [
      { name: 'Daily', path: 'Daily', folders: [], notes: [`Daily/${iso(now)}.md`] },
      { name: 'Notes', path: 'Notes', folders: [], notes: ['Notes/Skald design rationale.md', 'Notes/Stack decisions.md', 'Notes/On the use of runes.md'] },
      { name: 'People', path: 'People', folders: [], notes: ['People/Ada.md'] },
      { name: 'Projects', path: 'Projects', folders: [], notes: ['Projects/Jormungandr API rewrite.md', 'Projects/Yggdrasil graph layout.md'] },
      { name: 'Sources', path: 'Sources', folders: [], notes: ['Sources/CRDTs in collaboration.md'] },
    ],
  },
  notes,
  tasks,
  stats: { notes: 8, folders: 5, tasksOpen: 6, tasksTotal: 7, overdue: 1, wikilinks: 9, resolved: 8, orphans: 1 },
  graph: {
    nodes: notes.map((n) => ({ path: n.path, label: n.title, schema: n.schema, folder: n.folder, deg: n.links.length + notes.filter((o) => o.links.includes(n.path)).length, x: pos[n.path].x, y: pos[n.path].y, updated: n.updated })),
    edges: notes.flatMap((n) => n.links.map((l) => [n.path, l])),
  },
  activity: [
    { kind: 'task', verb: 'completed', title: 'Refactor folder watcher to chokidar v4', ref: 'Stack decisions', ts: now - 20 * 3600000 },
    { kind: 'note', verb: 'edited', title: 'Skald design rationale', ref: 'Notes', ts: now - 26 * 3600000 },
    { kind: 'task', verb: 'added', title: 'Wire awareness into the presence layer', ref: 'Jormungandr API rewrite', ts: now - 30 * 3600000 },
    { kind: 'note', verb: 'created', title: iso(now - 2 * day), ref: 'Daily', ts: now - 2 * day },
    { kind: 'task', verb: 'blocked', title: 'Migrate auth from Passport to Lucia', ref: 'Jormungandr API rewrite', ts: now - 3 * day },
  ],
  settings: { theme: 'midnight', density: 'regular', logoVariant: 'sigil', marginOn: true, pinnedNote: 'Notes/On the use of runes.md', dailyFolder: 'Daily', attachmentsFolder: 'Attachments', editorFontSize: 15, autosaveMs: 800, savedSearches: [{ id: 'design', name: 'Design notes', query: 'design tag:vision' }], schemaTemplates: {} },
};

const rationaleBody = `The hardest part of building a knowledge tool is resisting the urge to make it a database. Most apps drift that way, and you end up with a thousand notes that never become anything. Skald takes the opposite bet: the connections *are* the product, so the editor surfaces them as you write instead of making you file them.

> [!premise] The graph is not the point. The writing is — the graph is just what writing leaves behind.

## Typed notes, not folders

Every note has a schema — \`Note\`, \`Project\`, \`Person\`, \`Idea\`, \`Source\`, \`Daily\`. The schema draws a small [[rune]] that shows up wherever the note is mentioned, so you can scan the sidebar, the switcher, and your backlinks by shape instead of reading every title.

Frontmatter is not YAML you hand-edit. It is a typed block at the top of the page, with fields that know their kind.

## Tasks live in the text

Tasks aren't bolted on. An inline checkbox exists in the note where you wrote it *and* in the global table, and an edit in either place propagates.

- [ ] Replace Lexical with TipTap for live collab @due(${iso(now + day)}) @p(high)
- [ ] Draft the *Project* schema fields @due(${iso(now + 3 * day)})
- [x] Refactor folder watcher to chokidar v4

## A graph you can return to

The graph view in most apps is a science fair: forces, springs, nodes flying around. Skald's is a fixed map — positions you can shape over time, with named clusters for the parts that matter. See [[Stack decisions]] and [[On the use of runes]].

> Let the links between your thoughts be the thing that endures.`;

const payload = {
  meta: notes[0],
  content: `---\ncreated: 2026-05-12\ntags: [design, vision]\n---\n\n${rationaleBody}`,
  body: rationaleBody,
  bodyStartLine: 5,
  backlinks: [
    { path: 'Projects/Jormungandr API rewrite.md', title: 'Jormungandr API rewrite', schema: 'Project', folder: 'Projects', snippet: '…inheriting the design language from [[Skald design rationale]] so the editor surfaces…', updated: now - 3600000 },
    { path: 'Projects/Yggdrasil graph layout.md', title: 'Yggdrasil graph layout', schema: 'Project', folder: 'Projects', snippet: '…per [[Skald design rationale]], the graph should not re-layout on every change…', updated: now - day },
    { path: `Daily/${iso(now)}.md`, title: iso(now), schema: 'Daily', folder: 'Daily', snippet: '…rewriting [[Skald design rationale]] for the third time. It is finally honest.', updated: now - 600000 },
  ],
};

const initScript = `
  const SNAPSHOT = ${JSON.stringify(snapshot)};
  const PAYLOAD = ${JSON.stringify(payload)};
  window.skald = {
    invoke: async (channel, ...args) => {
      switch (channel) {
        case 'vault:getLast': return SNAPSHOT.vaultPath;
        case 'vault:open': case 'vault:create': case 'vault:snapshot': return SNAPSHOT;
        case 'note:read': return PAYLOAD;
        case 'search:query': return SNAPSHOT.notes.slice(0, 4).map((note, index) => ({ ...note, snippet: note.excerpt, line: 6 + index * 3, column: 1, length: 6, score: 100 - index }));
        case 'trash:list': return [{ path: 'Archive/Old direction.md', title: 'Old direction', schema: 'Idea', deletedAt: ${now - 2 * day}, size: 1840 }];
        case 'window:isMaximized': return false;
        case 'settings:set': Object.assign(SNAPSHOT.settings, args[0]); window.__emit && window.__emit(SNAPSHOT); return SNAPSHOT.settings;
        default: return null;
      }
    },
    onVaultChanged: (cb) => { window.__emit = cb; return () => {}; },
    onWindowMaximized: () => () => {},
  };
`;

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = join(ROOT, p);
  if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(4173, r));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text()); });
page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));
await page.addInitScript(initScript);
await page.goto('http://localhost:4173/');
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/logbook.png` });

// editor
await page.click('text=Skald design rationale', { timeout: 5000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/editor.png` });

// source mode
await page.click('.editor-mode-toggle button:has-text("src")');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/editor-src.png` });
await page.click('.editor-mode-toggle button:has-text("read")');

// tasks table
await page.click('.activitybar .act[title="Tasks"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/tasks-table.png` });

// kanban
await page.click('.tasks-bar__view:has-text("Kanban")');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/tasks-kanban.png` });

// calendar
await page.click('.tasks-bar__view:has-text("Calendar")');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/tasks-calendar.png` });

// graph
await page.click('.activitybar .act[title="Graph — ⌘G"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/graph.png` });

// switcher
await page.keyboard.press('Control+k');
await page.waitForTimeout(300);
await page.keyboard.type('graph');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/switcher.png` });
await page.keyboard.press('Escape');

// settings + light theme
await page.click('.activitybar__bottom .act[title="Settings"]');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/settings.png` });
await page.click('.settings__nav .item:has-text("Themes")');
await page.waitForTimeout(200);
await page.click('.theme-card:has-text("Daybreak")');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/settings-light.png` });

await browser.close();
server.close();
console.log('wrote 10 screenshots to', OUT);
