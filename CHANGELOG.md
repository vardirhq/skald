# Changelog

All notable changes to Skald will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/vardirhq/skald/compare/v2.1.4...HEAD
[2.1.4]: https://github.com/vardirhq/skald/compare/v2.1.3...v2.1.4
[2.1.3]: https://github.com/vardirhq/skald/compare/v2.1.2...v2.1.3
[2.1.2]: https://github.com/vardirhq/skald/compare/v2.1.1...v2.1.2
[2.1.1]: https://github.com/vardirhq/skald/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/vardirhq/skald/releases/tag/v2.1.0
