import type { ComponentType, ReactNode } from 'react';
import type { ExtensionManifest } from '../../src-shared/extensions';
import type { MdContext } from '../markdown';

export interface MarkdownComponentContribution {
  /** The case-insensitive callout name in `> [!type]`. */
  type: string;
  render: (input: { content: string; context: MdContext }) => ReactNode;
}

export interface NotePropertyContribution {
  key: string;
  label: string;
  emptyLabel: string;
  dialogTitle: (connected: boolean) => string;
  dialogLede: string;
  inputLabel: string;
  submitLabel: string;
  normalize: (input: unknown) => string | null;
  externalUrl?: (value: string) => string;
}

export interface EditorInsertContribution {
  id: string;
  label: string;
  title: string;
  markdown: string;
  /** When absent, insertion does not require a note property. */
  propertyKey?: string;
}

export interface SettingsPaneContribution {
  id: `extension:${string}`;
  label: string;
  group: string;
  schema: string;
  component: ComponentType;
}

export interface RendererExtension {
  manifest: ExtensionManifest;
  markdownComponents?: MarkdownComponentContribution[];
  noteProperties?: NotePropertyContribution[];
  editorInsertions?: EditorInsertContribution[];
  settingsPanes?: SettingsPaneContribution[];
}
