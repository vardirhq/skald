import { describe, expect, it } from 'vitest';
import { githubPageCount, githubRepoUrl, normalizeGitHubRepo } from '../src-shared/github';

describe('GitHub repository references', () => {
  it('normalizes compact names and GitHub URLs', () => {
    expect(normalizeGitHubRepo('vardirhq/skald')).toBe('vardirhq/skald');
    expect(normalizeGitHubRepo('github:VardirHQ/Skald.git')).toBe('VardirHQ/Skald');
    expect(normalizeGitHubRepo('https://github.com/vardirhq/skald/issues/12')).toBe('vardirhq/skald');
    expect(githubRepoUrl('vardirhq/skald')).toBe('https://github.com/vardirhq/skald');
  });

  it('rejects other hosts and unsafe or incomplete names', () => {
    expect(normalizeGitHubRepo('https://gitlab.com/vardirhq/skald')).toBeNull();
    expect(normalizeGitHubRepo('vardirhq')).toBeNull();
    expect(normalizeGitHubRepo('../skald')).toBeNull();
    expect(normalizeGitHubRepo('vardirhq/skald?tab=readme')).toBeNull();
  });

  it('uses GitHub pagination to count a one-item page', () => {
    const link = '<https://api.github.com/repositories/1/pulls?per_page=1&page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/pulls?per_page=1&page=14>; rel="last"';
    expect(githubPageCount(1, link)).toBe(14);
    expect(githubPageCount(0, null)).toBe(0);
  });
});
