export type ExtensionPlatform = 'desktop' | 'android';

export type ExtensionCapability =
  | 'network'
  | 'authentication'
  | 'secure-storage'
  | 'external-links'
  | 'settings'
  | 'vault-read'
  | 'vault-write';

/** Metadata is deliberately serializable so every Skald client can inspect it. */
export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  builtin: true;
  platforms: ExtensionPlatform[];
  capabilities: Partial<Record<ExtensionPlatform, ExtensionCapability[]>>;
}

export const GITHUB_EXTENSION_MANIFEST: ExtensionManifest = {
  id: 'dev.skald.github',
  name: 'GitHub',
  version: '1.0.0',
  description: 'Portable repository properties and live GitHub repository cards.',
  builtin: true,
  platforms: ['desktop', 'android'],
  capabilities: {
    desktop: ['network', 'authentication', 'secure-storage', 'external-links', 'settings'],
    android: ['external-links'],
  },
};

export const MERMAID_EXTENSION_MANIFEST: ExtensionManifest = {
  id: 'dev.skald.mermaid',
  name: 'Mermaid',
  version: '1.0.0',
  description: 'Local diagrams rendered from portable Mermaid code fences.',
  builtin: true,
  platforms: ['desktop'],
  capabilities: {
    desktop: [],
  },
};
