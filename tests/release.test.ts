import { describe, it, expect } from 'vitest';
import {
  bumpVersion,
  buildLinks,
  checkRelease,
  compareVersions,
  extractNotes,
  parseChangelog,
  releaseChangelog,
  serializeChangelog,
  setLockVersion,
  setPackageVersion,
} from '../tools/release-core.mjs';

const CHANGELOG = [
  '# Changelog',
  '',
  'All notable changes to Skald will be documented in this file.',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '',
  '- Added folder clustering to the graph layout.',
  '',
  '## [2.1.2] - 2026-07-22',
  '',
  '### Fixed',
  '',
  '- Fixed a blank renderer screen.',
  '',
  '## [2.1.1] - 2026-07-21',
  '',
  '### Added',
  '',
  '- Added Linux app icon assets.',
  '',
  '[Unreleased]: https://github.com/vardirhq/skald/compare/v2.1.2...HEAD',
  '[2.1.2]: https://github.com/vardirhq/skald/compare/v2.1.1...v2.1.2',
  '[2.1.1]: https://github.com/vardirhq/skald/releases/tag/v2.1.1',
  '',
].join('\n');

const consistent = (overrides: Record<string, unknown> = {}) =>
  checkRelease({
    packageVersion: '2.1.2',
    lockVersion: '2.1.2',
    lockRootVersion: '2.1.2',
    changelogText: CHANGELOG,
    ...overrides,
  });

describe('compareVersions', () => {
  it('orders by major, minor, then patch', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('2.1.0', '2.2.0')).toBe(-1);
    expect(compareVersions('2.1.2', '2.1.2')).toBe(0);
  });

  it('ranks a prerelease below its release', () => {
    expect(compareVersions('2.2.0-rc.1', '2.2.0')).toBe(-1);
    expect(compareVersions('2.2.0-rc.2', '2.2.0-rc.10')).toBe(-1);
    expect(compareVersions('2.2.0-beta', '2.2.0-rc.1')).toBe(-1);
  });

  it('rejects nonsense', () => {
    expect(() => compareVersions('2.1', '2.1.0')).toThrow(/semantic version/);
    expect(() => compareVersions('v2.1.0', '2.1.0')).toThrow(/semantic version/);
  });
});

describe('bumpVersion', () => {
  it('bumps each level', () => {
    expect(bumpVersion('2.1.2', 'patch')).toBe('2.1.3');
    expect(bumpVersion('2.1.2', 'minor')).toBe('2.2.0');
    expect(bumpVersion('2.1.2', 'major')).toBe('3.0.0');
  });

  it('promotes a prerelease to its release on patch', () => {
    expect(bumpVersion('2.2.0-rc.1', 'patch')).toBe('2.2.0');
  });

  it('accepts an explicit version and refuses anything else', () => {
    expect(bumpVersion('2.1.2', '3.0.0-rc.1')).toBe('3.0.0-rc.1');
    expect(() => bumpVersion('2.1.2', 'nope')).toThrow(/Unknown bump/);
  });
});

describe('parseChangelog', () => {
  it('splits the preamble, sections, and link references', () => {
    const parsed = parseChangelog(CHANGELOG);
    expect(parsed.header).toMatch(/^# Changelog/);
    expect(parsed.sections.map((s: { name: string }) => s.name)).toEqual(['Unreleased', '2.1.2', '2.1.1']);
    expect(parsed.sections[1].date).toBe('2026-07-22');
    expect(parsed.links.map((l: { label: string }) => l.label)).toEqual(['Unreleased', '2.1.2', '2.1.1']);
  });

  it('round-trips a document it already owns', () => {
    expect(serializeChangelog(parseChangelog(CHANGELOG))).toBe(CHANGELOG);
  });
});

describe('releaseChangelog', () => {
  it('dates the unreleased section and opens a fresh one', () => {
    const next = releaseChangelog(CHANGELOG, '2.2.0', '2026-08-09');
    const parsed = parseChangelog(next);

    expect(parsed.sections.map((s: { name: string }) => s.name)).toEqual(['Unreleased', '2.2.0', '2.1.2', '2.1.1']);
    expect(parsed.sections[0].body.join('\n').trim()).toBe('');
    expect(parsed.sections[1].date).toBe('2026-08-09');
    expect(next).toContain('- Added folder clustering to the graph layout.');
  });

  it('rewrites the link references around the new version', () => {
    const next = releaseChangelog(CHANGELOG, '2.2.0', '2026-08-09');
    expect(next).toContain('[Unreleased]: https://github.com/vardirhq/skald/compare/v2.2.0...HEAD');
    expect(next).toContain('[2.2.0]: https://github.com/vardirhq/skald/compare/v2.1.2...v2.2.0');
    expect(next).toContain('[2.1.1]: https://github.com/vardirhq/skald/releases/tag/v2.1.1');
  });

  it('refuses to cut a release with an empty Unreleased section', () => {
    const empty = CHANGELOG.replace('### Added\n\n- Added folder clustering to the graph layout.\n\n', '');
    expect(() => releaseChangelog(empty, '2.2.0', '2026-08-09')).toThrow(/nothing to release/);
  });

  it('refuses to go backwards or sideways', () => {
    expect(() => releaseChangelog(CHANGELOG, '2.1.1', '2026-08-09')).toThrow(/already has a section/);
    expect(() => releaseChangelog(CHANGELOG, '2.1.0', '2026-08-09')).toThrow(/does not come after/);
  });

  it('refuses a malformed date', () => {
    expect(() => releaseChangelog(CHANGELOG, '2.2.0', '09-08-2026')).toThrow(/YYYY-MM-DD/);
  });

  it('produces a document that passes the release check', () => {
    const next = releaseChangelog(CHANGELOG, '2.2.0', '2026-08-09');
    expect(
      checkRelease({
        packageVersion: '2.2.0',
        lockVersion: '2.2.0',
        lockRootVersion: '2.2.0',
        changelogText: next,
        tag: 'v2.2.0',
      }),
    ).toEqual([]);
  });
});

describe('extractNotes', () => {
  it('returns just the requested section', () => {
    const notes = extractNotes(CHANGELOG, '2.1.2');
    expect(notes).toBe('### Fixed\n\n- Fixed a blank renderer screen.');
  });

  it('never returns the link reference block', () => {
    expect(extractNotes(CHANGELOG, '2.1.1')).not.toContain('https://github.com');
  });

  it('throws for a version it does not know', () => {
    expect(() => extractNotes(CHANGELOG, '9.9.9')).toThrow(/no section for 9.9.9/);
  });
});

describe('checkRelease', () => {
  it('passes on a consistent tree', () => {
    expect(consistent()).toEqual([]);
    expect(consistent({ tag: 'v2.1.2' })).toEqual([]);
  });

  it('catches a stale lockfile — either copy of the version', () => {
    expect(consistent({ lockVersion: '2.1.1' })).toEqual([
      'package-lock.json version (2.1.1) does not match package.json (2.1.2)',
    ]);
    expect(consistent({ lockRootVersion: '2.1.1' })).toEqual([
      'package-lock.json packages[""].version (2.1.1) does not match package.json (2.1.2)',
    ]);
  });

  it('catches a tag that does not match the package version', () => {
    expect(consistent({ tag: 'v2.1.1' })).toContain('tag v2.1.1 does not match package.json version (expected v2.1.2)');
  });

  it('catches a version with no changelog section', () => {
    const problems = consistent({ packageVersion: '2.2.0', lockVersion: '2.2.0', lockRootVersion: '2.2.0' });
    expect(problems).toContain('CHANGELOG.md has no section for the current version 2.2.0');
  });

  it('catches an undated or empty section', () => {
    expect(consistent({ changelogText: CHANGELOG.replace('## [2.1.2] - 2026-07-22', '## [2.1.2]') })).toContain(
      'CHANGELOG.md section 2.1.2 is missing a YYYY-MM-DD date',
    );
    expect(consistent({ changelogText: CHANGELOG.replace('- Fixed a blank renderer screen.', '') })).toContain(
      'CHANGELOG.md section 2.1.2 has no entries',
    );
  });

  it('catches sections listed out of order', () => {
    const swapped = [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '## [2.1.1] - 2026-07-21',
      '',
      '- Older, listed first.',
      '',
      '## [2.1.2] - 2026-07-22',
      '',
      '- Newer, listed second.',
      '',
    ].join('\n');
    expect(consistent({ packageVersion: '2.1.1', lockVersion: '2.1.1', lockRootVersion: '2.1.1', changelogText: swapped })).toContain(
      'CHANGELOG.md sections are out of order: 2.1.1 is listed above 2.1.2',
    );
  });

  it('catches missing and stale link references', () => {
    const stripped = CHANGELOG.replace('[2.1.2]: https://github.com/vardirhq/skald/compare/v2.1.1...v2.1.2\n', '');
    expect(consistent({ changelogText: stripped })).toContain('CHANGELOG.md is missing the [2.1.2] link reference');

    const stale = CHANGELOG.replace(
      '[Unreleased]: https://github.com/vardirhq/skald/compare/v2.1.2...HEAD',
      '[Unreleased]: https://github.com/vardirhq/skald/compare/v2.1.1...HEAD',
    );
    expect(consistent({ changelogText: stale })).toContain(
      'CHANGELOG.md link [Unreleased] should point at https://github.com/vardirhq/skald/compare/v2.1.2...HEAD',
    );
  });
});

describe('buildLinks', () => {
  it('points the oldest release at its tag and the rest at compare ranges', () => {
    const links = buildLinks(parseChangelog(CHANGELOG));
    expect(links).toEqual([
      { label: 'Unreleased', url: 'https://github.com/vardirhq/skald/compare/v2.1.2...HEAD' },
      { label: '2.1.2', url: 'https://github.com/vardirhq/skald/compare/v2.1.1...v2.1.2' },
      { label: '2.1.1', url: 'https://github.com/vardirhq/skald/releases/tag/v2.1.1' },
    ]);
  });
});

describe('setPackageVersion', () => {
  const pkg = '{\n  "name": "skald",\n  "version": "2.1.2",\n  "copyright": "\\u00a9 2026",\n  "scripts": {}\n}\n';

  it('rewrites only the top-level version and leaves formatting alone', () => {
    const next = setPackageVersion(pkg, '2.2.0');
    expect(next).toBe('{\n  "name": "skald",\n  "version": "2.2.0",\n  "copyright": "\\u00a9 2026",\n  "scripts": {}\n}\n');
    expect(JSON.parse(next).version).toBe('2.2.0');
  });

  it('refuses a file with no version field', () => {
    expect(() => setPackageVersion('{\n  "name": "skald"\n}\n', '2.2.0')).toThrow(/Could not find/);
  });

  it('refuses a version that is not semver', () => {
    expect(() => setPackageVersion(pkg, '2.2')).toThrow(/semantic version/);
  });
});

describe('setLockVersion', () => {
  const lock = [
    '{',
    '  "name": "skald",',
    '  "version": "2.1.1",',
    '  "lockfileVersion": 3,',
    '  "packages": {',
    '    "": {',
    '      "name": "skald",',
    '      "version": "2.1.1",',
    '      "license": "MIT",',
    '      "dependencies": {',
    '        "react": "^18.2.0"',
    '      }',
    '    },',
    '    "node_modules/react": {',
    '      "version": "18.2.0"',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');

  it('moves both copies of the version and leaves dependencies untouched', () => {
    const next = setLockVersion(lock, '2.2.0');
    const parsed = JSON.parse(next);
    expect(parsed.version).toBe('2.2.0');
    expect(parsed.packages[''].version).toBe('2.2.0');
    expect(parsed.packages['node_modules/react'].version).toBe('18.2.0');
  });

  it('throws rather than write a lockfile it could not fully update', () => {
    const rootOnly = lock.replace('      "version": "2.1.1",\n', '');
    expect(() => setLockVersion(rootOnly, '2.2.0')).toThrow(/did not take effect/);
  });
});
