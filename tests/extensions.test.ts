import { describe, expect, it } from 'vitest';
import type { ExtensionManifest } from '../src-shared/extensions';
import { GITHUB_EXTENSION_MANIFEST } from '../src-shared/extensions';
import { ExtensionRegistry } from '../src/extensions/registry';
import type { RendererExtension } from '../src/extensions/types';
import { MainExtensionRegistry } from '../src-main/extensionRegistry';
import { renderMarkdown, type MdContext } from '../src/markdown';
import type { ReactElement } from 'react';

function manifest(id: string): ExtensionManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    description: 'test extension',
    builtin: true,
    platforms: ['desktop'],
    capabilities: { desktop: [] },
  };
}

function extension(id = 'dev.skald.test'): RendererExtension {
  return {
    manifest: manifest(id),
    markdownComponents: [{ type: 'demo', render: () => null }],
    noteProperties: [{
      key: 'demo',
      label: 'demo',
      emptyLabel: 'Add demo',
      dialogTitle: () => 'Demo',
      dialogLede: 'Demo value',
      inputLabel: 'Value',
      submitLabel: 'Save',
      normalize: (value) => typeof value === 'string' && value.trim() ? value.trim() : null,
    }],
    editorInsertions: [{ id: 'demo.insert', label: '+ demo', title: 'Insert demo', markdown: '> [!demo]\n', propertyKey: 'demo' }],
    settingsPanes: [{ id: 'extension:demo', label: 'Demo', group: 'test', schema: 'Note', component: () => null }],
  };
}

describe('ExtensionRegistry', () => {
  it('indexes every declared contribution and matches component names case-insensitively', () => {
    const registry = new ExtensionRegistry([extension()]);
    expect(registry.markdownComponent('DEMO')?.type).toBe('demo');
    expect(registry.noteProperty('demo')?.label).toBe('demo');
    expect(registry.editorInsertion('demo.insert')?.propertyKey).toBe('demo');
    expect(registry.settingsPanes[0].id).toBe('extension:demo');
  });

  it('rejects contribution collisions instead of depending on registration order', () => {
    const second = extension('dev.skald.second');
    expect(() => new ExtensionRegistry([extension(), second])).toThrow('Duplicate Markdown component');
  });

  it('rejects insertions whose required property is not registered', () => {
    const broken = extension();
    broken.noteProperties = [];
    expect(() => new ExtensionRegistry([broken])).toThrow('requires unknown property');
  });

  it('validates stable ids, semantic versions, and desktop support', () => {
    const invalid = extension('Not valid');
    expect(() => new ExtensionRegistry([invalid])).toThrow('Invalid extension id');
    invalid.manifest = { ...manifest('dev.skald.valid'), version: 'next' };
    expect(() => new ExtensionRegistry([invalid])).toThrow('semantic version');
    invalid.manifest = { ...manifest('dev.skald.valid'), platforms: ['android'] };
    expect(() => new ExtensionRegistry([invalid])).toThrow('does not support desktop');
  });

  it('declares GitHub privileges up front', () => {
    expect(GITHUB_EXTENSION_MANIFEST.capabilities.desktop).toEqual([
      'network', 'authentication', 'secure-storage', 'external-links', 'settings',
    ]);
    expect(GITHUB_EXTENSION_MANIFEST.capabilities.android).toEqual(['external-links']);
    expect(GITHUB_EXTENSION_MANIFEST.platforms).toContain('android');
  });

  it('keeps unknown components as ordinary portable callouts', () => {
    const context: MdContext = {
      resolve: () => null,
      openNote: () => undefined,
      openExternal: () => undefined,
      resolveAttachment: () => null,
      openAttachment: () => undefined,
      attachmentUrl: (path) => path,
      toggleTask: () => undefined,
      todayISO: '2026-08-11',
      lineOffset: 0,
      frontmatter: {},
    };
    const node = renderMarkdown('> [!future] still readable', context)[0] as ReactElement<{ className: string }>;
    expect(node.props.className).toBe('editor-callout');
  });
});

describe('MainExtensionRegistry', () => {
  it('registers declared IPC and rejects channel collisions', () => {
    const registered: string[] = [];
    const first = { manifest: manifest('dev.skald.first'), ipc: [{ channel: 'first:read', handler: () => 1 }] };
    new MainExtensionRegistry([first]).register((channel) => registered.push(channel));
    expect(registered).toEqual(['first:read']);
    const second = { manifest: manifest('dev.skald.second'), ipc: [{ channel: 'first:read', handler: () => 2 }] };
    expect(() => new MainExtensionRegistry([first, second])).toThrow('Duplicate extension IPC');
  });
});
