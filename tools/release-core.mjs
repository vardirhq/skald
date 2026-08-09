// Pure helpers behind the release tooling: semver handling, changelog surgery, and
// the consistency rules the CI check enforces. Nothing here touches the file system
// or the network, so every rule below is unit tested in tests/release.test.ts.

export const REPO_URL = 'https://github.com/vardirhq/skald';

const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/;
const HEADING_RE = /^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$/;
const LINK_RE = /^\[([^\]]+)\]:\s*(\S+)\s*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseVersion(input) {
  const m = VERSION_RE.exec(String(input).trim());
  if (!m) throw new Error(`Not a semantic version: ${input}`);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : [],
    raw: String(input).trim(),
  };
}

export function isVersion(input) {
  return VERSION_RE.test(String(input).trim());
}

export function isPrerelease(input) {
  return parseVersion(input).prerelease.length > 0;
}

function comparePrerelease(a, b) {
  // Per semver: a version without a prerelease outranks one with it.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
      continue;
    }
    if (xNum !== yNum) return xNum ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function bumpVersion(current, kind) {
  const v = parseVersion(current);
  switch (kind) {
    case 'major':
      return `${v.major + 1}.0.0`;
    case 'minor':
      return `${v.major}.${v.minor + 1}.0`;
    case 'patch':
      // A prerelease patch-bumps to its own release, matching npm's behaviour.
      return v.prerelease.length ? `${v.major}.${v.minor}.${v.patch}` : `${v.major}.${v.minor}.${v.patch + 1}`;
    default:
      if (isVersion(kind)) return parseVersion(kind).raw;
      throw new Error(`Unknown bump: ${kind}. Use major, minor, patch, or an explicit version.`);
  }
}

export function isUnreleasedName(name) {
  return name.trim().toLowerCase() === 'unreleased';
}

/**
 * Split a Keep a Changelog document into its preamble, its `## [x]` sections, and
 * the link reference block at the foot. Link references are pulled out wherever
 * they sit so they can be regenerated from the section list.
 */
export function parseChangelog(text) {
  const lines = text.split('\n');
  const header = [];
  const sections = [];
  const links = [];
  let current = null;

  for (const line of lines) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      current = { name: heading[1].trim(), date: heading[2] ?? null, body: [] };
      sections.push(current);
      continue;
    }
    const link = LINK_RE.exec(line);
    if (link) {
      links.push({ label: link[1], url: link[2] });
      continue;
    }
    (current ? current.body : header).push(line);
  }

  for (const section of sections) {
    while (section.body.length && section.body[section.body.length - 1].trim() === '') section.body.pop();
    while (section.body.length && section.body[0].trim() === '') section.body.shift();
  }

  return { header: header.join('\n').trim(), sections, links };
}

export function releasedSections(changelog) {
  return changelog.sections.filter((s) => !isUnreleasedName(s.name));
}

export function findSection(changelog, version) {
  return changelog.sections.find((s) => !isUnreleasedName(s.name) && s.name === version) ?? null;
}

export function hasEntries(section) {
  return section.body.some((line) => /^\s*[-*]\s+\S/.test(line));
}

export function buildLinks(changelog) {
  const released = releasedSections(changelog);
  const links = [];
  const unreleased = changelog.sections.find((s) => isUnreleasedName(s.name));

  if (unreleased) {
    links.push({
      label: 'Unreleased',
      url: released.length ? `${REPO_URL}/compare/v${released[0].name}...HEAD` : `${REPO_URL}/commits/main`,
    });
  }
  released.forEach((section, index) => {
    const previous = released[index + 1];
    links.push({
      label: section.name,
      url: previous
        ? `${REPO_URL}/compare/v${previous.name}...v${section.name}`
        : `${REPO_URL}/releases/tag/v${section.name}`,
    });
  });
  return links;
}

function renderSection(section) {
  const heading = section.date ? `## [${section.name}] - ${section.date}` : `## [${section.name}]`;
  const body = section.body.join('\n').trim();
  return body ? `${heading}\n\n${body}` : heading;
}

export function serializeChangelog(changelog) {
  const links = buildLinks(changelog);
  const parts = [changelog.header, ...changelog.sections.map(renderSection)];
  if (links.length) parts.push(links.map((l) => `[${l.label}]: ${l.url}`).join('\n'));
  return `${parts.join('\n\n')}\n`;
}

/**
 * Promote `## [Unreleased]` to a dated release section and open a fresh, empty
 * Unreleased section above it. Refuses to cut a release with nothing in it.
 */
export function releaseChangelog(text, version, date) {
  parseVersion(version);
  if (!DATE_RE.test(date)) throw new Error(`Release date must be YYYY-MM-DD; got ${date}`);

  const changelog = parseChangelog(text);
  const unreleased = changelog.sections.find((s) => isUnreleasedName(s.name));
  if (!unreleased) throw new Error('CHANGELOG.md has no ## [Unreleased] section.');
  if (!hasEntries(unreleased)) {
    throw new Error('## [Unreleased] is empty — there is nothing to release.');
  }
  if (findSection(changelog, version)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}.`);
  }

  const latest = releasedSections(changelog)[0];
  if (latest && compareVersions(version, latest.name) <= 0) {
    throw new Error(`${version} does not come after the last released version (${latest.name}).`);
  }

  unreleased.name = version;
  unreleased.date = date;
  changelog.sections.unshift({ name: 'Unreleased', date: null, body: [] });

  return serializeChangelog(changelog);
}

export function extractNotes(text, version) {
  const changelog = parseChangelog(text);
  const section = findSection(changelog, version);
  if (!section) throw new Error(`CHANGELOG.md has no section for ${version}.`);
  const body = section.body.join('\n').trim();
  if (!body) throw new Error(`The CHANGELOG.md section for ${version} is empty.`);
  return body;
}

/**
 * Every rule the release is allowed to depend on, in one place. Returns a list of
 * human-readable problems; an empty list means the tree is releasable.
 */
export function checkRelease({ packageVersion, lockVersion, lockRootVersion, changelogText, tag = null }) {
  const problems = [];

  if (!isVersion(packageVersion)) {
    problems.push(`package.json version is not a semantic version: ${packageVersion}`);
    return problems;
  }

  if (lockVersion !== packageVersion) {
    problems.push(`package-lock.json version (${lockVersion}) does not match package.json (${packageVersion})`);
  }
  if (lockRootVersion !== packageVersion) {
    problems.push(
      `package-lock.json packages[""].version (${lockRootVersion}) does not match package.json (${packageVersion})`,
    );
  }
  if (tag !== null && tag !== `v${packageVersion}`) {
    problems.push(`tag ${tag} does not match package.json version (expected v${packageVersion})`);
  }

  const changelog = parseChangelog(changelogText);
  const released = releasedSections(changelog);

  if (!changelog.sections.some((s) => isUnreleasedName(s.name))) {
    problems.push('CHANGELOG.md has no ## [Unreleased] section');
  }
  if (!released.length) {
    problems.push('CHANGELOG.md has no released sections');
    return problems;
  }

  // Malformed headings are reported on their own: the ordering and link checks
  // below can only run once every section name is known to be a version.
  const malformed = [];
  for (const section of released) {
    if (!isVersion(section.name)) malformed.push(`CHANGELOG.md heading "## [${section.name}]" is not a version`);
    if (!section.date) problems.push(`CHANGELOG.md section ${section.name} is missing a YYYY-MM-DD date`);
    if (!hasEntries(section)) problems.push(`CHANGELOG.md section ${section.name} has no entries`);
  }
  if (malformed.length) return [...problems, ...malformed];

  for (let i = 1; i < released.length; i += 1) {
    if (compareVersions(released[i - 1].name, released[i].name) <= 0) {
      problems.push(
        `CHANGELOG.md sections are out of order: ${released[i - 1].name} is listed above ${released[i].name}`,
      );
    }
  }

  const current = findSection(changelog, packageVersion);
  if (!current) {
    problems.push(`CHANGELOG.md has no section for the current version ${packageVersion}`);
  } else if (released[0].name !== packageVersion) {
    problems.push(
      `CHANGELOG.md lists ${released[0].name} above the current version ${packageVersion} — the top released section must be the version being shipped`,
    );
  }

  const expected = buildLinks(changelog);
  const actual = new Map(changelog.links.map((l) => [l.label, l.url]));
  for (const link of expected) {
    if (!actual.has(link.label)) {
      problems.push(`CHANGELOG.md is missing the [${link.label}] link reference`);
    } else if (actual.get(link.label) !== link.url) {
      problems.push(`CHANGELOG.md link [${link.label}] should point at ${link.url}`);
    }
  }

  return problems;
}

/**
 * Rewrite the single `"version"` field of package.json without disturbing the rest
 * of the file's formatting.
 */
export function setPackageVersion(text, version) {
  parseVersion(version);
  let replaced = 0;
  const next = text.replace(/^(\s*"version":\s*)"[^"]*"/m, (_match, prefix) => {
    replaced += 1;
    return `${prefix}"${version}"`;
  });
  if (replaced !== 1) throw new Error('Could not find the "version" field in package.json');
  if (JSON.parse(next).version !== version) throw new Error('package.json version rewrite did not take effect');
  return next;
}

/**
 * package-lock.json carries the version twice: at the root and on the `""` entry of
 * `packages`. Both have to move together or `npm ci` reports the lockfile as stale.
 */
export function setLockVersion(text, version) {
  parseVersion(version);
  let next = text.replace(/^(\s{2}"version":\s*)"[^"]*"/m, (_match, prefix) => `${prefix}"${version}"`);
  next = next.replace(
    /("packages":\s*\{\s*\n\s*"":\s*\{(?:[^{}]*?))("version":\s*)"[^"]*"/,
    (_match, head, prefix) => `${head}${prefix}"${version}"`,
  );

  const parsed = JSON.parse(next);
  if (parsed.version !== version || parsed.packages?.['']?.version !== version) {
    throw new Error('package-lock.json version rewrite did not take effect');
  }
  return next;
}
