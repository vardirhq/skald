import type {
  EditorInsertContribution,
  MarkdownComponentContribution,
  NotePropertyContribution,
  RendererExtension,
  SettingsPaneContribution,
} from './types';
import { githubExtension } from './github';

export class ExtensionRegistry {
  readonly extensions: readonly RendererExtension[];
  readonly markdownComponents: readonly MarkdownComponentContribution[];
  readonly noteProperties: readonly NotePropertyContribution[];
  readonly editorInsertions: readonly EditorInsertContribution[];
  readonly settingsPanes: readonly SettingsPaneContribution[];

  constructor(extensions: RendererExtension[]) {
    unique(extensions.map((extension) => extension.manifest.id), 'extension id');
    for (const extension of extensions) validateManifest(extension);
    this.extensions = Object.freeze([...extensions]);
    this.markdownComponents = contributions(extensions, (item) => item.markdownComponents);
    this.noteProperties = contributions(extensions, (item) => item.noteProperties);
    this.editorInsertions = contributions(extensions, (item) => item.editorInsertions);
    this.settingsPanes = contributions(extensions, (item) => item.settingsPanes);
    unique(this.markdownComponents.map((item) => item.type.toLowerCase()), 'Markdown component');
    unique(this.noteProperties.map((item) => item.key), 'note property');
    unique(this.editorInsertions.map((item) => item.id), 'editor insertion');
    unique(this.settingsPanes.map((item) => item.id), 'settings pane');
    for (const insertion of this.editorInsertions) {
      if (insertion.propertyKey && !this.noteProperties.some((item) => item.key === insertion.propertyKey)) {
        throw new Error(`Editor insertion ${insertion.id} requires unknown property ${insertion.propertyKey}`);
      }
    }
  }

  markdownComponent(type: string): MarkdownComponentContribution | undefined {
    const normalized = type.toLowerCase();
    return this.markdownComponents.find((item) => item.type.toLowerCase() === normalized);
  }

  noteProperty(key: string): NotePropertyContribution | undefined {
    return this.noteProperties.find((item) => item.key === key);
  }

  editorInsertion(id: string): EditorInsertContribution | undefined {
    return this.editorInsertions.find((item) => item.id === id);
  }
}

function contributions<T>(
  extensions: RendererExtension[],
  select: (extension: RendererExtension) => T[] | undefined
): readonly T[] {
  return Object.freeze(extensions.flatMap((extension) => select(extension) ?? []));
}

function unique(values: string[], kind: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value.trim()) throw new Error(`Extension ${kind} cannot be empty`);
    if (seen.has(value)) throw new Error(`Duplicate ${kind}: ${value}`);
    seen.add(value);
  }
}

function validateManifest(extension: RendererExtension): void {
  const manifest = extension.manifest;
  if (!/^[a-z][a-z0-9.-]+$/.test(manifest.id)) throw new Error(`Invalid extension id: ${manifest.id}`);
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error(`Extension ${manifest.id} needs a semantic version`);
  }
  if (!manifest.platforms.includes('desktop')) {
    throw new Error(`Renderer extension ${manifest.id} does not support desktop`);
  }
}

export const extensionRegistry = new ExtensionRegistry([githubExtension]);
