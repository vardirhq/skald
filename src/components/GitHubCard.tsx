import { useCallback, useEffect, useState } from 'react';
import type { GitHubRepositoryCard } from '../../src-shared/types';
import { api } from '../api';

export function GitHubCard({
  repo,
  openExternal,
}: {
  repo: string;
  openExternal: (url: string) => void;
}) {
  const [card, setCard] = useState<GitHubRepositoryCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      setCard(await api.githubRepository(repo, force));
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setLoading(false);
    }
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !card) {
    return <div className="github-card github-card--quiet">Loading {repo}…</div>;
  }
  if (error && !card) {
    return (
      <div className="github-card github-card--error">
        <strong>{repo}</strong>
        <span>{error}</span>
        <button onClick={() => void load(true)}>Try again</button>
      </div>
    );
  }
  if (!card) return null;

  const workflowTone = card.workflow?.conclusion === 'success'
    ? 'good'
    : card.workflow?.conclusion === 'failure'
      ? 'bad'
      : 'neutral';
  return (
    <section className="github-card" aria-label={`GitHub repository ${card.repo}`}>
      <div className="github-card__head">
        <div>
          <span className="github-card__mark">GH</span>
          <button className="github-card__repo" onClick={() => openExternal(card.url)}>
            <span>{card.owner}/</span>{card.name}
          </button>
          <span className="github-card__visibility">{card.visibility}</span>
        </div>
        <button className="github-card__refresh" disabled={loading} onClick={() => void load(true)}>
          {loading ? 'refreshing…' : 'refresh'}
        </button>
      </div>
      {card.description && <p>{card.description}</p>}
      <div className="github-card__stats">
        <span>★ {card.stars}</span>
        <span>⑂ {card.forks}</span>
        <span>issues {card.openIssues}</span>
        {card.openPullRequests !== null && <span>PRs {card.openPullRequests}</span>}
      </div>
      <div className="github-card__detail">
        <span>{card.defaultBranch}</span>
        {card.language && <span>{card.language}</span>}
        {card.license && <span>{card.license}</span>}
        {card.workflow && (
          <button data-tone={workflowTone} onClick={() => openExternal(card.workflow!.url)}>
            {card.workflow.name}: {card.workflow.conclusion ?? card.workflow.status}
          </button>
        )}
        {card.latestRelease && (
          <button onClick={() => openExternal(card.latestRelease!.url)}>
            release {card.latestRelease.tag || card.latestRelease.name}
          </button>
        )}
      </div>
      <div className="github-card__foot">
        {card.stale && <span>Showing cached data · </span>}
        Updated {new Date(card.fetchedAt).toLocaleString()}
      </div>
    </section>
  );
}
