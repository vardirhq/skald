// [[Wikilink]] parsing helpers shared by indexer and renderer.

export interface WikilinkParts {
  target: string;
  heading: string | null;
  display: string;
}

export function parseWikilink(inner: string): WikilinkParts {
  const pipe = inner.indexOf('|');
  const targetPart = pipe === -1 ? inner : inner.slice(0, pipe);
  const display = pipe === -1 ? null : inner.slice(pipe + 1).trim();
  const hash = targetPart.indexOf('#');
  const target = (hash === -1 ? targetPart : targetPart.slice(0, hash)).trim();
  const heading = hash === -1 ? null : targetPart.slice(hash + 1).trim();
  return { target, heading, display: display || (heading ? `${target} › ${heading}` : target) };
}

/** All distinct link target names in a body, in order of first appearance. */
export function extractWikilinkTargets(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const withoutCode = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutCode)) !== null) {
    const { target } = parseWikilink(m[1]);
    const key = target.toLowerCase();
    if (target && !seen.has(key)) {
      seen.add(key);
      out.push(target);
    }
  }
  return out;
}

/** Count every wikilink occurrence (not deduplicated). */
export function countWikilinks(body: string): number {
  const withoutCode = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return (withoutCode.match(/\[\[[^\]]+\]\]/g) || []).length;
}

/**
 * Rewrite the target of every wikilink `matches` accepts, leaving the heading
 * and display parts untouched.
 */
export function rewriteWikilinks(
  body: string,
  matches: (target: string) => boolean,
  rewrite: (target: string) => string
): string {
  return body.replace(/\[\[([^\]]+)\]\]/g, (whole, inner: string) => {
    const { target } = parseWikilink(inner);
    if (!target || !matches(target)) return whole;
    const rest = inner.slice(inner.toLowerCase().indexOf(target.toLowerCase()) + target.length);
    return `[[${rewrite(target)}${rest}]]`;
  });
}

/**
 * Rewrite every wikilink pointing at `oldName` to `newName`,
 * preserving heading and display parts.
 */
export function renameWikilinks(body: string, oldName: string, newName: string): string {
  return rewriteWikilinks(
    body,
    (target) => target.toLowerCase() === oldName.toLowerCase(),
    () => newName
  );
}

// ---------- target resolution ----------

/** A note as far as link resolution cares: where it lives and what it is called. */
export interface LinkableNote {
  /** vault-relative path, e.g. `Notes/Why local-first.md` */
  path: string;
  /** display title (frontmatter `title:` or the file stem) */
  title: string;
}

/** How specific a key is; lower wins when two notes claim the same key. */
const TIER_PATH = 0; // full vault-relative path
const TIER_TITLE = 1; // frontmatter/display title
const TIER_PARTIAL = 2; // trailing folder/…/name segments
const TIER_STEM = 3; // bare file name

/** An index of link keys to note paths; build it with `buildLinkIndex`. */
export type LinkIndex = Map<string, string>;

/**
 * Fold a written link target (or a note path) into its lookup key:
 * case-insensitive, `.md`-less, slash-normalized, without `./`, `../` or
 * leading-slash noise. `[[/Notes/Why local-first.md]]` and `[[notes/why
 * local-first]]` land on the same key.
 */
export function normalizeLinkTarget(target: string): string {
  return target
    .trim()
    .replace(/\\/g, '/')
    .replace(/\.md$/i, '')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .join('/')
    .trim()
    .toLowerCase();
}

/**
 * Index notes by every name a wikilink may reasonably use: the full path
 * (`Notes/Why local-first`), the title, any trailing path fragment
 * (`Why local-first`). Folder-qualified targets always beat bare names, so two
 * notes sharing a file name stay individually reachable.
 */
export function buildLinkIndex(notes: Iterable<LinkableNote>): LinkIndex {
  const index: LinkIndex = new Map();
  const tiers = new Map<string, number>();
  const add = (key: string, path: string, tier: number): void => {
    if (!key) return;
    const held = tiers.get(key);
    if (held !== undefined && held <= tier) return;
    tiers.set(key, tier);
    index.set(key, path);
  };
  // Sorted so that ties between equally specific keys resolve deterministically.
  const sorted = [...notes].sort((a, b) => a.path.localeCompare(b.path));
  for (const note of sorted) {
    const segments = normalizeLinkTarget(note.path).split('/').filter(Boolean);
    if (!segments.length) continue;
    add(segments.join('/'), note.path, TIER_PATH);
    add(normalizeLinkTarget(note.title), note.path, TIER_TITLE);
    for (let i = 1; i < segments.length; i++) {
      const suffix = segments.slice(i).join('/');
      add(suffix, note.path, i === segments.length - 1 ? TIER_STEM : TIER_PARTIAL);
    }
  }
  return index;
}

/** Resolve a written wikilink target to a note path, or null when it misses. */
export function resolveLinkTarget(index: LinkIndex, target: string): string | null {
  return index.get(normalizeLinkTarget(target)) ?? null;
}

/**
 * Point a written link target at `newPath` while keeping the shape the author
 * wrote: a bare `[[Note]]` stays bare, `[[Folder/Note]]` keeps one folder of
 * context, and an explicit `.md` or leading `/` survives the rewrite.
 */
export function retargetWikilink(written: string, newPath: string): string {
  const trimmed = written.trim();
  const rooted = /^\//.test(trimmed);
  const keepExt = /\.md$/i.test(trimmed);
  const depth = normalizeLinkTarget(trimmed).split('/').filter(Boolean).length || 1;
  const segments = newPath.replace(/\\/g, '/').replace(/\.md$/i, '').split('/').filter(Boolean);
  const kept = segments.slice(Math.max(0, segments.length - depth)).join('/');
  return `${rooted ? '/' : ''}${kept}${keepExt ? '.md' : ''}`;
}

/** Extract a short snippet around the first mention of `name` in a body. */
export function snippetAround(body: string, name: string, radius = 90): string {
  const idx = body.toLowerCase().indexOf(`[[${name.toLowerCase()}`);
  if (idx === -1) return body.slice(0, radius * 2).replace(/\s+/g, ' ').trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(body.length, idx + name.length + radius);
  const core = body.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${core}${end < body.length ? '…' : ''}`;
}
