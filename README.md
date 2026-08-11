# Skald

Skald is a local-first Markdown knowledge base. A *skáld* was an Old Norse poet — the one
who kept the saga alive. Skald treats your vault the same way: notes are pages of a saga,
tasks are open threads, and the knowledge graph is a constellation you can return to.

Everything is plain Markdown files in a folder you own. Skald keeps its index, settings,
graph layout, and local note history in a `.skald/` directory inside the vault — delete
it and your Markdown remains untouched.

![The Logbook — Skald's Today view](docs/screenshots/logbook.png)

## What it does

- **Typed notes** — every note has a schema (`Note`, `Project`, `Person`, `Daily`, `Idea`,
  `Source`, `Code`, `Place`), set via frontmatter or inferred from its folder. Each schema
  carries a monoline rune that follows the note everywhere it's mentioned.
- **Threads** — any `- [ ]` checkbox you write becomes a task in the global Table, Kanban,
  and Calendar views. Edits propagate both ways: check it in the board and the Markdown
  file is rewritten; metadata rides along as `@due(2026-06-01) @p(high) @status(working) #tag`.
- **Wikilinks & backlinks** — `[[Note]]`, `[[Folder/Note]]`, and `[[Folder/Note.md]]` all
  resolve across the vault; folder-qualified links keep two notes with the same file name
  apart. The editor's right panel shows backlinks with snippets, threads in the note, and
  the outline. Renaming a note rewrites every wikilink that points at it, in whichever
  form it was written.
- **A real explorer** — multi-select notes with Shift/Ctrl/⌘, then move, open, copy, or
  delete the selection together. Notes and complete folders move by menu or drag-and-drop;
  qualified wikilinks, histories, graph positions, pinned notes, and open tabs follow them.
  The tree supports arrow-key navigation and type-ahead.
- **The Logbook** — the Today view: week activity, open threads, the saga (recent
  activity), recently touched notes, a pinned note, and honest vault stats.
- **The Constellation** — a stable graph. Star positions are laid out once, persisted, and
  draggable; a fresh layout gathers each folder into its own cluster, drawn as a named
  region you can hide. Zoom with the wheel or pinch, drag the background to pan, `0` to
  fit. Your map is a place, not a simulation.
- **Local note history** — Skald snapshots notes before edits, external changes, renames,
  deletions, and restores. Earlier versions can be previewed from the editor, and deleted
  notes can be restored from Recently deleted.
- **First-class attachments** — pick or drop any file, paste clipboard images, and Skald
  copies them into the vault with collision-safe names and portable relative Markdown links.
  Images render inline; files can be opened or revealed from the editor.
- **Live Markdown editing** — write in rendered blocks by default, with raw source mode still
  one shortcut away when you want to work directly with the Markdown file.
- **Search** — `⌘K` opens Skald's Hall for fuzzy note, task, and command access. The Search
  pane searches complete note bodies with ranked snippets and exact locations, supports
  `schema:`, `tag:`, and `folder:` filters, and pins saved searches in the sidebar.
- **Tags & templates** — browse frontmatter, inline, and task tags in one pane; complete
  existing `#tags` while writing; and give each schema a body template with `{{title}}`
  and `{{date}}` placeholders.
- **GitHub repository cards** — bind a project or any note with `github: owner/repo`, then
  insert `> [!github]` for live repository, issue, pull request, release, and workflow
  context. Public repositories need no account; optional GitHub App device login unlocks
  private repositories without exposing tokens to the renderer. See [docs/github.md](docs/github.md).
- **Built-in extensions** — cross-surface integrations register versioned Markdown components,
  note properties, editor actions, settings panes, capabilities, and protected main-process
  providers. Unknown components remain ordinary portable callouts. See [docs/extensions.md](docs/extensions.md).
- **Pro tabs** — reorder and pin tabs, middle-click to close, or use the context menu to
  close other tabs and tabs to the right.
- **Encrypted sync** — pair a second device and your vault follows, through
  [GESH](https://github.com/vardirhq/generic-encrypted-sync-hub): a relay that holds
  encrypted blobs just long enough to hand them over. Notes and their attachments are
  sealed with AES-256-GCM before they leave the machine, and the content key never reaches
  the server — it rides to a new device only in the fragment of a pairing QR code, the part
  no server receives. Conflicts resolve to the same winner on every device, and the losing
  text is kept in that note's history. See [docs/sync.md](docs/sync.md).
- **Three surfaces** — Midnight, Slate, and Daybreak themes; three densities; three marks.

## Screenshots

| | |
| --- | --- |
| ![Editor with margin panel](docs/screenshots/editor.png) *Editor — reading view, typed frontmatter, backlinks margin* | ![Source view](docs/screenshots/editor-src.png) *Editor — source view with autosave* |
| ![Kanban board](docs/screenshots/tasks-kanban.png) *Threads — kanban, drag to change status* | ![Task table](docs/screenshots/tasks-table.png) *Threads — table* |
| ![Calendar](docs/screenshots/tasks-calendar.png) *Threads — calendar* | ![Constellation graph](docs/screenshots/graph.png) *The Constellation — stable, draggable star map* |
| ![Command palette](docs/screenshots/switcher.png) *Skald's Hall — ⌘K fuzzy search with preview* | ![Daybreak theme](docs/screenshots/settings-light.png) *Settings — the Daybreak surface* |

## Development

```bash
npm install
npm run electron:dev   # dev server + electron
npm run typecheck
npm test               # vitest — core logic, vault, and sync end-to-end
npm run electron:pack  # build distributables

# smoke-test the sync client against a real GESH relay (skipped without the variable)
GESH_URL=https://gesh.vardir.no npx vitest run tests/gesh-live.test.ts

# optional private GitHub repository access (public cards need no configuration)
SKALD_GITHUB_CLIENT_ID=... SKALD_GITHUB_APP_SLUG=... npm run electron:dev
```

CI runs on pull requests and pushes to `main`:

- `npm run release:check` — version and changelog consistency
- `npm ci`
- `npm run typecheck`
- `npm test`
- `npm run build`

Repo layout:

- `src-main/` — Electron main process: vault manager (scan, watch, index, tasks,
  backlinks, graph layout), IPC, window.
- `src/` — renderer: React + plain CSS design tokens (no CSS framework).
- `src/extensions/` — trusted renderer extension manifests and contributions.
- `src-main/extensionRegistry.ts` and `src-main/extensions.ts` — protected extension provider
  contracts, built-ins, and IPC registration.
- `src-shared/` — pure logic shared by both: frontmatter, tasks, wikilinks, full-text search,
  tags, sync protocol, and merge rules.
- `tools/` — release tooling and the screenshot driver.
- `tests/` — vitest suites, including an end-to-end suite driving a real temp vault.
- `archive/skald-v1/` — the previous implementation, kept for reference only.

## Releasing

The version is written down in three places — `package.json`, `package-lock.json`, and
`CHANGELOG.md` — and `tools/release.mjs` owns all three so they can never drift apart.

```bash
npm run release:check                 # are the three files consistent?
npm run release:prepare -- minor      # cut the next version (major|minor|patch|X.Y.Z)
npm run release:notes                 # print the changelog section for this version
```

`release:prepare` bumps both version fields in `package-lock.json`, dates the
`[Unreleased]` changelog section, opens a fresh empty one, and regenerates the changelog
compare links. It refuses to run if `[Unreleased]` is empty or the new version does not
come after the last released one.

To publish a release:

1. Run the **Prepare release** workflow (Actions → Prepare release) and pick a bump. It
   runs `release:prepare`, validates the result with typecheck, tests, and a build, and
   opens a `release/vX.Y.Z` PR. Doing it locally with `npm run release:prepare` works the
   same way.
2. Merge that PR.
3. Run the **Release** workflow (Actions → Release) and leave the tag empty. It releases
   whatever version `main` is on, creating the tag once the checks pass. Pushing the tag
   by hand does the same thing:

   ```bash
   git checkout main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

Either way the **Release** workflow:

- re-verifies that the tag, `package.json`, `package-lock.json`, and the changelog section
  all agree, before building anything or creating the tag;
- refuses a tag that is not an ancestor of `main`, and refuses to overwrite a release that
  is already published (both overridable from a manual run);
- typechecks, tests, and builds, then packages Linux x64 AppImage and `.deb` artifacts;
- attaches a [build provenance attestation](https://github.com/vardirhq/skald/attestations)
  to each artifact, verifiable with
  `gh attestation verify <file> --repo vardirhq/skald`;
- publishes the GitHub Release with the changelog section, install instructions, and a
  `SHA256SUMS.txt`, failing if any expected artifact is missing.

Tags matching `vX.Y.Z-rc.1` and friends are published as prereleases and do not become the
latest release.

**Prepare release** needs *Settings → Actions → General → Workflow permissions → Allow
GitHub Actions to create and approve pull requests*. Without it the workflow still bumps
the version, validates it, and pushes the `release/vX.Y.Z` branch — it just prints a link
to open the PR yourself instead of opening it.

## Keyboard

| Key | Action |
| --- | --- |
| `⌘K` / `⌘P` | Command palette |
| `⌘D` | Today's logbook |
| `⌘N` | New note |
| `⌘E` | Toggle reading / source view |
| `⌘B` | Toggle right panel |
| `⌘G` | Constellation |
| `+` / `−` / `0` | Zoom in, zoom out, fit the map (Constellation) |
| `⌘S` | Save now (autosave is always on) |

## License

MIT © Christoffer Madsen
