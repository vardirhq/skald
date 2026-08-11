import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GITHUB_APP_SLUG, GITHUB_CLIENT_ID } from './githubConfig';
import {
  forgetGitHubCredentials,
  githubSecretsProtected,
  loadGitHubCredentials,
  saveGitHubCredentials,
  type GitHubCredentials,
} from './githubSecrets';
import { githubPageCount, normalizeGitHubRepo } from '../src-shared/github';
import type {
  GitHubAuthStatus,
  GitHubDeviceLogin,
  GitHubRepositoryCard,
} from '../src-shared/types';

const API = 'https://api.github.com';
const LOGIN = 'https://github.com/login';
const API_VERSION = '2022-11-28';
const CACHE_MS = 10 * 60_000;

interface PendingLogin {
  deviceCode: string;
  intervalMs: number;
  expiresAt: number;
  cancelled: boolean;
}

interface CacheEntry {
  etag?: string;
  card: GitHubRepositoryCard;
}

interface RepoJson {
  full_name?: string;
  html_url?: string;
  name?: string;
  owner?: { login?: string };
  description?: string | null;
  visibility?: string;
  private?: boolean;
  default_branch?: string;
  language?: string | null;
  license?: { spdx_id?: string | null; name?: string | null } | null;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
}

export class GitHubService {
  private pending: PendingLogin | null = null;
  private memory = new Map<string, CacheEntry>();

  status(): GitHubAuthStatus {
    const credentials = loadGitHubCredentials();
    return {
      configured: !!GITHUB_CLIENT_ID,
      connected: !!credentials,
      login: credentials?.login ?? null,
      secretsProtected: githubSecretsProtected(),
      installUrl: GITHUB_APP_SLUG ? `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new` : null,
    };
  }

  async beginLogin(): Promise<GitHubDeviceLogin> {
    if (!GITHUB_CLIENT_ID) throw new Error('GitHub login is not configured in this build');
    if (!githubSecretsProtected()) {
      throw new Error('Unlock an OS keyring before connecting GitHub');
    }
    const response = await fetch(`${LOGIN}/device/code`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID }),
    });
    const value = (await response.json()) as Record<string, unknown>;
    if (!response.ok || typeof value['device_code'] !== 'string' || typeof value['user_code'] !== 'string') {
      throw new Error(String(value['error_description'] ?? value['error'] ?? 'GitHub did not start sign-in'));
    }
    const expiresAt = Date.now() + Number(value['expires_in'] ?? 900) * 1000;
    this.pending = {
      deviceCode: value['device_code'],
      intervalMs: Math.max(5, Number(value['interval'] ?? 5)) * 1000,
      expiresAt,
      cancelled: false,
    };
    return {
      userCode: value['user_code'],
      verificationUri: String(value['verification_uri'] ?? 'https://github.com/login/device'),
      expiresAt,
    };
  }

  async completeLogin(): Promise<GitHubAuthStatus> {
    const pending = this.pending;
    if (!pending) throw new Error('Start GitHub sign-in first');
    while (!pending.cancelled && Date.now() < pending.expiresAt) {
      await delay(pending.intervalMs);
      const response = await fetch(`${LOGIN}/oauth/access_token`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GITHUB_CLIENT_ID,
          device_code: pending.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
      const value = (await response.json()) as Record<string, unknown>;
      const error = typeof value['error'] === 'string' ? value['error'] : null;
      if (error === 'authorization_pending') continue;
      if (error === 'slow_down') {
        pending.intervalMs += 5_000;
        continue;
      }
      if (error) {
        this.pending = null;
        throw new Error(String(value['error_description'] ?? error));
      }
      if (typeof value['access_token'] !== 'string') continue;
      const credentials: GitHubCredentials = {
        accessToken: value['access_token'],
        ...(typeof value['refresh_token'] === 'string' ? { refreshToken: value['refresh_token'] } : {}),
        ...(typeof value['expires_in'] === 'number'
          ? { expiresAt: Date.now() + value['expires_in'] * 1000 }
          : {}),
        ...(typeof value['refresh_token_expires_in'] === 'number'
          ? { refreshTokenExpiresAt: Date.now() + value['refresh_token_expires_in'] * 1000 }
          : {}),
      };
      credentials.login = await this.fetchLogin(credentials.accessToken);
      saveGitHubCredentials(credentials);
      this.pending = null;
      return this.status();
    }
    this.pending = null;
    throw new Error(pending.cancelled ? 'GitHub sign-in cancelled' : 'GitHub sign-in expired');
  }

  cancelLogin(): void {
    if (this.pending) this.pending.cancelled = true;
    this.pending = null;
  }

  disconnect(): GitHubAuthStatus {
    this.cancelLogin();
    forgetGitHubCredentials();
    this.memory.clear();
    return this.status();
  }

  async repository(input: string, force = false): Promise<GitHubRepositoryCard> {
    const repo = normalizeGitHubRepo(input);
    if (!repo) throw new Error('Use a GitHub repository in owner/name form');
    const cached = this.memory.get(repo) ?? this.readPublicCache()[repo];
    if (!force && cached && Date.now() - cached.card.fetchedAt < CACHE_MS) return cached.card;

    let token: string | null = null;
    try {
      token = await this.accessToken();
    } catch {
      // Public repositories remain available when an old private login cannot refresh.
    }
    const headers = this.headers(token, cached?.etag);
    let response: Response;
    try {
      response = await fetch(`${API}/repos/${repo}`, { headers });
    } catch (error) {
      if (cached) return { ...cached.card, stale: true };
      throw error;
    }
    if (response.status === 304 && cached) {
      const entry = { ...cached, card: { ...cached.card, fetchedAt: Date.now(), stale: false } };
      this.remember(repo, entry);
      return entry.card;
    }
    if (response.status === 404 && !token) {
      throw new Error('Repository unavailable or private — connect GitHub to continue');
    }
    if (!response.ok) {
      if ((response.status === 403 || response.status === 429) && cached) return { ...cached.card, stale: true };
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message || `GitHub returned ${response.status}`);
    }
    const raw = (await response.json()) as RepoJson;
    const [pulls, release, runs] = await Promise.all([
      this.optional(`${API}/repos/${repo}/pulls?state=open&per_page=1`, token),
      this.optional(`${API}/repos/${repo}/releases/latest`, token),
      this.optional(`${API}/repos/${repo}/actions/runs?branch=${encodeURIComponent(raw.default_branch ?? 'main')}&per_page=1`, token),
    ]);
    const releaseRaw = release.json as Record<string, unknown> | null;
    const run = ((runs.json as { workflow_runs?: Array<Record<string, unknown>> } | null)?.workflow_runs ?? [])[0];
    const card: GitHubRepositoryCard = {
      repo,
      url: raw.html_url || `https://github.com/${repo}`,
      name: raw.name || repo.split('/')[1],
      owner: raw.owner?.login || repo.split('/')[0],
      description: raw.description ?? null,
      visibility: raw.private ? 'private' : raw.visibility === 'internal' ? 'internal' : 'public',
      defaultBranch: raw.default_branch || 'main',
      language: raw.language ?? null,
      license: raw.license?.spdx_id || raw.license?.name || null,
      stars: raw.stargazers_count ?? 0,
      forks: raw.forks_count ?? 0,
      openIssues: raw.open_issues_count ?? 0,
      openPullRequests: pulls.ok ? githubPageCount(Array.isArray(pulls.json) ? pulls.json.length : 0, pulls.link) : null,
      latestRelease: release.ok && releaseRaw
        ? {
            name: String(releaseRaw['name'] || releaseRaw['tag_name'] || 'Latest release'),
            tag: String(releaseRaw['tag_name'] || ''),
            url: String(releaseRaw['html_url'] || `${raw.html_url}/releases`),
            publishedAt: typeof releaseRaw['published_at'] === 'string' ? releaseRaw['published_at'] : null,
          }
        : null,
      workflow: run
        ? {
            name: String(run['name'] || 'Workflow'),
            status: String(run['status'] || 'unknown'),
            conclusion: typeof run['conclusion'] === 'string' ? run['conclusion'] : null,
            url: String(run['html_url'] || `${raw.html_url}/actions`),
          }
        : null,
      fetchedAt: Date.now(),
    };
    const entry = { card, etag: response.headers.get('etag') ?? undefined };
    this.remember(repo, entry);
    return card;
  }

  private async accessToken(): Promise<string | null> {
    const credentials = loadGitHubCredentials();
    if (!credentials) return null;
    if (!credentials.expiresAt || credentials.expiresAt > Date.now() + 60_000) return credentials.accessToken;
    if (!credentials.refreshToken || !GITHUB_CLIENT_ID) {
      forgetGitHubCredentials();
      return null;
    }
    const response = await fetch(`${LOGIN}/oauth/access_token`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: credentials.refreshToken,
      }),
    });
    const value = (await response.json()) as Record<string, unknown>;
    if (!response.ok || typeof value['access_token'] !== 'string') {
      forgetGitHubCredentials();
      return null;
    }
    const refreshed: GitHubCredentials = {
      accessToken: value['access_token'],
      login: credentials.login,
      ...(typeof value['refresh_token'] === 'string' ? { refreshToken: value['refresh_token'] } : {}),
      ...(typeof value['expires_in'] === 'number' ? { expiresAt: Date.now() + value['expires_in'] * 1000 } : {}),
      ...(typeof value['refresh_token_expires_in'] === 'number'
        ? { refreshTokenExpiresAt: Date.now() + value['refresh_token_expires_in'] * 1000 }
        : {}),
    };
    saveGitHubCredentials(refreshed);
    return refreshed.accessToken;
  }

  private async fetchLogin(token: string): Promise<string | undefined> {
    const response = await fetch(`${API}/user`, { headers: this.headers(token) });
    const value = (await response.json().catch(() => ({}))) as { login?: string };
    return response.ok && typeof value.login === 'string' ? value.login : undefined;
  }

  private headers(token: string | null, etag?: string): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'Skald-Desktop',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(etag ? { 'If-None-Match': etag } : {}),
    };
  }

  private async optional(url: string, token: string | null): Promise<{ ok: boolean; json: unknown; link: string | null }> {
    try {
      const response = await fetch(url, { headers: this.headers(token) });
      return {
        ok: response.ok,
        json: response.ok ? await response.json() : null,
        link: response.headers.get('link'),
      };
    } catch {
      return { ok: false, json: null, link: null };
    }
  }

  private remember(repo: string, entry: CacheEntry): void {
    this.memory.set(repo, entry);
    if (entry.card.visibility !== 'public') return;
    const cache = this.readPublicCache();
    cache[repo] = entry;
    try {
      writeFileSync(this.cachePath(), JSON.stringify(cache), { encoding: 'utf-8', mode: 0o600 });
    } catch {
      // Cache failure must never make live repository data unavailable.
    }
  }

  private cachePath(): string {
    return join(app.getPath('userData'), 'skald-github-public-cache.json');
  }

  private readPublicCache(): Record<string, CacheEntry> {
    try {
      if (!existsSync(this.cachePath())) return {};
      const value = JSON.parse(readFileSync(this.cachePath(), 'utf-8')) as Record<string, CacheEntry>;
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
