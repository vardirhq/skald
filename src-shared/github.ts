const REPO_PART = /^[A-Za-z0-9_.-]+$/;

/**
 * Accept the compact value Skald writes as well as ordinary GitHub repository
 * URLs. The API client receives only owner/name, never an arbitrary URL.
 */
export function normalizeGitHubRepo(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (!value) return null;
  value = value.replace(/^github:/i, '');
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.hostname.toLowerCase() !== 'github.com') return null;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 2) return null;
      value = `${parts[0]}/${parts[1]}`;
    } catch {
      return null;
    }
  }
  value = value.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const parts = value.split('/');
  if (
    parts.length !== 2 ||
    parts.some((part) => !REPO_PART.test(part) || part === '.' || part === '..')
  ) return null;
  return `${parts[0]}/${parts[1]}`;
}

export function githubRepoUrl(repo: string): string {
  const normalized = normalizeGitHubRepo(repo);
  if (!normalized) throw new Error('Expected a GitHub repository in owner/name form');
  return `https://github.com/${normalized}`;
}

/** Total items from GitHub's per-page response and RFC 5988 Link header. */
export function githubPageCount(length: number, link: string | null): number {
  if (!link) return length;
  const last = link.split(',').find((part) => /rel="last"/.test(part));
  const page = last?.match(/[?&]page=(\d+)/)?.[1];
  return page ? Number(page) : length;
}
