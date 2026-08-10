# Changelog

All notable changes to Skald will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.2.0] - 2026-08-10

### Added

- Added encrypted vault sync over [GESH](https://github.com/vardirhq/generic-encrypted-sync-hub).
  Settings → Sync creates a sync root, pairs further devices with a one-time code and QR
  code, lists and revokes them, and reports what is waiting to publish. Notes are sealed
  with AES-256-GCM on the device; the relay stores opaque blobs it cannot read and erases
  them once every device has collected them. The content key never reaches the server —
  it travels to a new device only in the fragment of the pairing link.
- Added attachment sync. Images, PDFs and every other non-Markdown file in the vault
  travel with the notes that reference them, as raw bytes in their own event rather than
  base64 inside one — a file costs its own size to sync, not a third more. Attachments
  are written by atomic rename, so a half-written file is never visible. A file too large
  for the relay is named in Settings → Sync instead of quietly failing the pass, and a
  file whose size and modification time have not moved is never re-read.
- Added conflict resolution that converges on the same winner on every device, and never
  discards the losing text: it is written into that note's history first, and appears in
  the editor's history list as "Replaced by sync".
- Added real key handling to the live editor. Enter ends the block you are in
  and opens a new one with the caret in it, Shift+Enter breaks the line without
  leaving the block, Enter inside a list opens the next item (numbering and
  checkboxes included) and leaves the list on an empty one, and Backspace at the
  top of a block reaches into the one above.
- Added click-to-place-caret in the live editor. Clicking a rendered block now
  opens it with the caret where you pointed, mapping the position back through
  the Markdown syntax you cannot see — past a heading's hashes, a link's target,
  emphasis markers, and a list item's bullet.
- Added window controls that follow the desktop they are running on: traffic
  lights on the left for macOS, and minimise/maximise/close buttons on the right
  for Windows and Linux, with the maximise button reflecting the window state.
- Added a portable GESH client under `src-shared/gesh/` and `src-shared/sync/`, with no
  Node or Electron imports, so a future mobile client can reuse the protocol, sealing,
  pairing and merge logic unchanged. See [docs/sync.md](docs/sync.md).

### Changed

- The badge in the top-right corner is a vault badge, not a user avatar — this
  app has no accounts. It now says so: a rounded square rather than a circle,
  naming the vault in its tooltip, and clicking it switches vault instead of
  doing nothing.

### Fixed

- Fixed line breaks in the live editor. Pressing Enter moved the newline out of
  the block being edited and into a new empty one below, so the keystroke looked
  like it had done nothing but add a box — the caret stayed behind and the break
  was unreachable. The caret is now tracked as a position in the note rather than
  an offset into a block, so it follows an edit that re-splits the blocks under it.

## [2.1.4] - 2026-08-09

### Fixed

- Fixed the Release workflow failing when the tag did not exist yet. A manual run now
  releases the version `main` is on and creates the tag itself once every check passes,
  so merging a release PR and running the workflow is the whole flow.
- Fixed Prepare release failing outright when the repository does not let GitHub Actions
  open pull requests. It now finishes the bump, pushes the validated release branch, and
  links to the PR form instead.

## [2.1.3] - 2026-08-09

### Added

- Added zoom and pan to the Constellation: wheel or pinch to zoom around the cursor,
  drag the background to pan, and `+` / `−` / `0` (or the on-screen controls) to zoom
  and fit. Dragging a star still works at any zoom level.
- Added folder clustering to the graph layout — a fresh layout gathers each folder
  around its own centre instead of scattering notes across the map, and the named
  cluster regions can now be toggled off.
- Added an opening animation to the Constellation: stars fade in from the most
  connected outwards, then the threads between them. Honours reduced-motion settings.

### Changed

- The release version now lives in one tool: `tools/release.mjs` bumps `package.json`,
  `package-lock.json`, and `CHANGELOG.md` together, and `npm run release:check` runs in CI
  so the three can never drift apart again. Added a **Prepare release** workflow that cuts
  a version and opens a validated release PR, and hardened the **Release** workflow with a
  fast verification job, an on-main tag check, published-release protection, build
  provenance attestations, and `SHA256SUMS.txt` on every release.

### Fixed

- Fixed folder-qualified wikilinks: `[[Folder/Note]]`, `[[Folder/Note.md]]`, and any
  trailing part of a note's path now resolve, so two notes sharing a file name can be
  linked apart. Renaming a note keeps the form each link was written in.
- Fixed `package-lock.json` still reporting 2.1.1 after the 2.1.2 release.

## [2.1.2] - 2026-07-22

### Fixed

- Fixed a blank renderer screen that could appear after creating or opening a note
  before the vault snapshot finished refreshing.

## [2.1.1] - 2026-07-21

### Added

- Added Linux app icon assets for packaged releases.

### Fixed

- Fixed vault creation when the selected vault path is relative, allowing the starter
  `Welcome to Skald.md` note to be seeded at the vault root.
- Fixed packaged app icon wiring for the Linux desktop entry and application window.

## [2.1.0] - 2026-07-21

### Added

- Added automatic local note history with preview and restore support.
- Added first-class attachment support for picked, dropped, and pasted files.
- Added a live Markdown editor surface with rendered blocks that can be edited inline.
- Added GitHub Actions workflows for CI validation and tag-driven Linux releases.

### Changed

- Documented local note history and attachment handling in the README.
- Refreshed the website copy to reflect live editing, attachments, and local note history.

[Unreleased]: https://github.com/vardirhq/skald/compare/v2.2.0...HEAD
[2.2.0]: https://github.com/vardirhq/skald/compare/v2.1.4...v2.2.0
[2.1.4]: https://github.com/vardirhq/skald/compare/v2.1.3...v2.1.4
[2.1.3]: https://github.com/vardirhq/skald/compare/v2.1.2...v2.1.3
[2.1.2]: https://github.com/vardirhq/skald/compare/v2.1.1...v2.1.2
[2.1.1]: https://github.com/vardirhq/skald/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/vardirhq/skald/releases/tag/v2.1.0
