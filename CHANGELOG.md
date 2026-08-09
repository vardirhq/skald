# Changelog

All notable changes to Skald will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Fixed folder-qualified wikilinks: `[[Folder/Note]]`, `[[Folder/Note.md]]`, and any
  trailing part of a note's path now resolve, so two notes sharing a file name can be
  linked apart. Renaming a note keeps the form each link was written in.

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
