import type { ExtensionManifest } from '../src-shared/extensions';

export type ExtensionIpcHandler = (...args: any[]) => unknown | Promise<unknown>;

export interface MainExtension {
  manifest: ExtensionManifest;
  ipc: Array<{ channel: string; handler: ExtensionIpcHandler }>;
}

export class MainExtensionRegistry {
  readonly extensions: readonly MainExtension[];

  constructor(extensions: MainExtension[]) {
    const ids = new Set<string>();
    const channels = new Set<string>();
    for (const extension of extensions) {
      if (ids.has(extension.manifest.id)) throw new Error(`Duplicate main extension: ${extension.manifest.id}`);
      if (!extension.manifest.platforms.includes('desktop')) {
        throw new Error(`Main extension ${extension.manifest.id} does not support desktop`);
      }
      ids.add(extension.manifest.id);
      for (const contribution of extension.ipc) {
        if (channels.has(contribution.channel)) throw new Error(`Duplicate extension IPC: ${contribution.channel}`);
        channels.add(contribution.channel);
      }
    }
    this.extensions = Object.freeze([...extensions]);
  }

  register(register: (channel: string, handler: ExtensionIpcHandler) => void): void {
    for (const extension of this.extensions) {
      for (const contribution of extension.ipc) register(contribution.channel, contribution.handler);
    }
  }
}
