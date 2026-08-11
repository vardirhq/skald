import { GITHUB_EXTENSION_MANIFEST } from '../src-shared/extensions';
import { GitHubService } from './github';
import { MainExtensionRegistry } from './extensionRegistry';

const github = new GitHubService();

export const mainExtensionRegistry = new MainExtensionRegistry([
  {
    manifest: GITHUB_EXTENSION_MANIFEST,
    ipc: [
      { channel: 'github:status', handler: () => github.status() },
      { channel: 'github:login:begin', handler: () => github.beginLogin() },
      { channel: 'github:login:complete', handler: () => github.completeLogin() },
      { channel: 'github:login:cancel', handler: () => github.cancelLogin() },
      { channel: 'github:disconnect', handler: () => github.disconnect() },
      { channel: 'github:repository', handler: (repo: string, force?: boolean) => github.repository(repo, force) },
    ],
  },
]);
