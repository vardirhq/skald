import { useEffect, useState } from 'react';
import { GITHUB_EXTENSION_MANIFEST } from '../../src-shared/extensions';
import { githubRepoUrl, normalizeGitHubRepo } from '../../src-shared/github';
import type { GitHubAuthStatus, GitHubDeviceLogin } from '../../src-shared/types';
import { api } from '../api';
import { GitHubCard } from '../components/GitHubCard';
import { SettingsRow } from '../ui/settings';
import type { RendererExtension } from './types';

export const githubExtension: RendererExtension = {
  manifest: GITHUB_EXTENSION_MANIFEST,
  markdownComponents: [
    {
      type: 'github',
      render: ({ content, context }) => {
        const repo = normalizeGitHubRepo(content) ?? normalizeGitHubRepo(context.frontmatter['github']);
        return repo ? (
          <GitHubCard repo={repo} openExternal={context.openExternal} />
        ) : (
          <div className="github-card github-card--error">
            Add <code>github: owner/repository</code> to this note or put a repository after the callout.
          </div>
        );
      },
    },
  ],
  noteProperties: [
    {
      key: 'github',
      label: 'github',
      emptyLabel: 'Connect repository…',
      dialogTitle: (connected) => connected ? 'Change GitHub repository' : 'Connect GitHub repository',
      dialogLede: 'Use owner/repository or paste a github.com URL. Public repositories need no sign-in.',
      inputLabel: 'Repository',
      submitLabel: 'Connect',
      normalize: normalizeGitHubRepo,
      externalUrl: githubRepoUrl,
    },
  ],
  editorInsertions: [
    {
      id: 'github.repository-card',
      label: '+ repo card',
      title: 'Insert a live GitHub repository card',
      markdown: '> [!github]\n',
      propertyKey: 'github',
    },
  ],
  settingsPanes: [
    {
      id: 'extension:github',
      label: 'GitHub',
      group: 'connections',
      schema: 'Project',
      component: GitHubSettingsPane,
    },
  ],
};

function GitHubSettingsPane() {
  const [status, setStatus] = useState<GitHubAuthStatus | null>(null);
  const [device, setDevice] = useState<GitHubDeviceLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.githubStatus().then(setStatus).catch((err) => setError(String(err)));
    return () => { void api.githubCancelLogin(); };
  }, []);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const login = await api.githubBeginLogin();
      setDevice(login);
      window.open(login.verificationUri);
      const next = await api.githubCompleteLogin();
      setStatus(next);
      setDevice(null);
    } catch (err) {
      const message = String((err as Error).message ?? err);
      if (!/cancelled/i.test(message)) setError(message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    void api.githubCancelLogin();
    setDevice(null);
    setBusy(false);
  };

  return (
    <>
      <h1 className="settings__title">GitHub</h1>
      <p className="settings__lede">
        Repository cards work for public repositories without an account. Connect GitHub only to
        read repositories your GitHub App installation can access.
      </p>

      <SettingsRow
        title="Connection"
        desc={status?.connected ? `Signed in as @${status.login ?? 'GitHub user'}. Tokens stay encrypted in your OS keyring.` : 'Optional. Skald requests read-only repository access.'}
      >
        <div className="github-settings__actions">
          {status?.connected ? (
            <>
              <span className="github-settings__identity">@{status.login ?? 'connected'}</span>
              <button className="btn" onClick={() => void api.githubDisconnect().then(setStatus)}>Disconnect</button>
            </>
          ) : (
            <button
              className="btn btn--accent"
              disabled={busy || !status?.configured || !status?.secretsProtected}
              onClick={() => void connect()}
            >
              {busy ? 'Waiting for GitHub…' : 'Connect GitHub'}
            </button>
          )}
        </div>
      </SettingsRow>

      {device && (
        <div className="github-device-login">
          <div>
            <strong>Enter this code on GitHub</strong>
            <code>{device.userCode}</code>
            <span>The GitHub device page opened in your browser.</span>
          </div>
          <div>
            <button className="btn" onClick={() => window.open(device.verificationUri)}>Open GitHub</button>
            <button className="btn btn--ghost" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}

      {status && !status.configured && (
        <div className="settings__notice">
          Private-repository login is not configured in this build. Set
          <code>SKALD_GITHUB_CLIENT_ID</code> and <code>SKALD_GITHUB_APP_SLUG</code> when building;
          public repository cards still work.
        </div>
      )}
      {status && !status.secretsProtected && (
        <div className="settings__notice settings__notice--warn">
          Unlock your OS keyring before connecting. Skald will not save a GitHub token without encrypted storage.
        </div>
      )}
      {error && <div className="settings__notice settings__notice--warn">{error}</div>}

      {status?.connected && status.installUrl && (
        <SettingsRow title="Repository access" desc="Add or remove private repositories from this GitHub App installation.">
          <button className="btn" onClick={() => window.open(status.installUrl!)}>Manage on GitHub ↗</button>
        </SettingsRow>
      )}
    </>
  );
}
