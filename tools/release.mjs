#!/usr/bin/env node
// Release plumbing for Skald. One command owns the version everywhere it is written
// down, so a release is never half-applied.
//
//   node tools/release.mjs check [--tag v2.2.0]
//   node tools/release.mjs prepare <major|minor|patch|2.2.0> [--date 2026-08-09]
//   node tools/release.mjs notes [--version 2.2.0] [--out release-notes.md]
//   node tools/release.mjs version
//
// `check` is what CI and the release workflow run; `prepare` is what the
// release-prepare workflow (or a human) runs to cut the next version.

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  bumpVersion,
  checkRelease,
  extractNotes,
  isPrerelease,
  releaseChangelog,
  setLockVersion,
  setPackageVersion,
} from './release-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Every file that carries the release version. Adding one here makes it part of
// both `prepare` and `check`.
const FILES = {
  pkg: join(ROOT, 'package.json'),
  lock: join(ROOT, 'package-lock.json'),
  changelog: join(ROOT, 'CHANGELOG.md'),
};

const read = (file) => readFileSync(file, 'utf8');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=');
      if (inline !== undefined) flags[name] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[name] = argv[(i += 1)];
      else flags[name] = 'true';
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function currentVersion() {
  return JSON.parse(read(FILES.pkg)).version;
}

function emitOutputs(outputs) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function commandCheck(flags) {
  const pkg = JSON.parse(read(FILES.pkg));
  const lock = JSON.parse(read(FILES.lock));
  const tag = flags.tag && flags.tag !== 'true' ? flags.tag : null;

  const problems = checkRelease({
    packageVersion: pkg.version,
    lockVersion: lock.version,
    lockRootVersion: lock.packages?.['']?.version,
    changelogText: read(FILES.changelog),
    tag,
  });

  if (problems.length) {
    console.error(`Release metadata is inconsistent (${problems.length} problem(s)):\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('\nRun `npm run release:prepare -- <major|minor|patch>` to cut a version, or fix the files by hand.');
    process.exitCode = 1;
    return;
  }

  console.log(`Release metadata is consistent at ${pkg.version}${tag ? ` (tag ${tag})` : ''}.`);
  emitOutputs({
    version: pkg.version,
    tag: `v${pkg.version}`,
    prerelease: String(isPrerelease(pkg.version)),
  });
}

function commandPrepare(positional, flags) {
  const bump = positional[0];
  if (!bump) throw new Error('Usage: node tools/release.mjs prepare <major|minor|patch|X.Y.Z>');

  const from = currentVersion();
  const version = bumpVersion(from, bump);
  const date = flags.date && flags.date !== 'true' ? flags.date : today();

  const changelog = releaseChangelog(read(FILES.changelog), version, date);
  const pkg = setPackageVersion(read(FILES.pkg), version);
  const lock = setLockVersion(read(FILES.lock), version);

  // Everything parsed and validated before anything is written.
  writeFileSync(FILES.changelog, changelog);
  writeFileSync(FILES.pkg, pkg);
  writeFileSync(FILES.lock, lock);

  const problems = checkRelease({
    packageVersion: version,
    lockVersion: JSON.parse(lock).version,
    lockRootVersion: JSON.parse(lock).packages?.['']?.version,
    changelogText: changelog,
    tag: `v${version}`,
  });
  if (problems.length) {
    throw new Error(`Prepared tree still fails the release check:\n  - ${problems.join('\n  - ')}`);
  }

  console.log(`Prepared ${from} -> ${version} (${date})`);
  console.log('  package.json, package-lock.json, CHANGELOG.md updated');
  emitOutputs({
    version,
    previous: from,
    tag: `v${version}`,
    branch: `release/v${version}`,
    date,
    prerelease: String(isPrerelease(version)),
  });
}

function commandNotes(flags) {
  const version = flags.version && flags.version !== 'true' ? flags.version.replace(/^v/, '') : currentVersion();
  const notes = extractNotes(read(FILES.changelog), version);
  if (flags.out && flags.out !== 'true') writeFileSync(join(ROOT, flags.out), `${notes}\n`);
  else console.log(notes);
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional.shift() ?? 'check';

  switch (command) {
    case 'check':
      return commandCheck(flags);
    case 'prepare':
      return commandPrepare(positional, flags);
    case 'notes':
      return commandNotes(flags);
    case 'version':
      return void console.log(currentVersion());
    default:
      throw new Error(`Unknown command: ${command}. Expected check, prepare, notes, or version.`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
