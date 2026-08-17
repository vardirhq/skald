import { describe, expect, it } from 'vitest';
import { flattenEditableBlocks, parseDocumentTree, serializeDocumentTree } from '../src-shared/documentTree';

describe('semantic document tree', () => {
  it('keeps ordinary Markdown as ordinary top-level blocks', () => {
    const doc = parseDocumentTree('# Title\n\nIntro\n\n- [ ] Task');
    expect(doc.children.map((node) => node.kind)).toEqual(['heading', 'blank', 'paragraph', 'blank', 'task']);
    expect(doc.diagnostics).toEqual([]);
  });

  it('parses containers with real Markdown child blocks', () => {
    const source = '# Project\n\n:::aside\n\n## Context\n\nThis matters.\n\n- First\n- Second\n\n:::\n\nAfterwards.';
    const doc = parseDocumentTree(source);
    const aside = doc.children.find((node) => node.type === 'container');
    expect(aside?.type).toBe('container');
    if (!aside || aside.type !== 'container') throw new Error('aside missing');
    expect(aside.kind).toBe('aside');
    expect(aside.children.map((child) => child.kind)).toEqual(['blank', 'heading', 'blank', 'paragraph', 'blank', 'list', 'blank']);
    expect(aside.children.find((child) => child.kind === 'heading')?.startLine).toBe(4);
    expect(aside.children.every((child) => child.parentContainerId === aside.id)).toBe(true);
  });

  it('projects container children as independently editable blocks', () => {
    const blocks = flattenEditableBlocks(parseDocumentTree(':::group\n\nOne\n\n- [ ] Two\n\n:::'));
    expect(blocks.map((block) => block.kind)).toEqual(['blank', 'paragraph', 'blank', 'task', 'blank']);
    expect(blocks.find((block) => block.kind === 'task')?.container?.kind).toBe('group');
    expect(blocks.find((block) => block.kind === 'task')?.startLine).toBe(4);
  });

  it('does not confuse directives inside top-level code fences for containers', () => {
    const doc = parseDocumentTree('```text\n:::aside\nnot a container\n:::\n```');
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0].type).toBe('block');
    expect(doc.children[0].kind).toBe('code');
  });

  it('does not close a container on ::: shown inside one of its code blocks', () => {
    const source = ':::aside\n\n```text\n:::group\nexample\n:::\n```\n\nStill inside.\n\n:::';
    const doc = parseDocumentTree(source);
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0].type).toBe('container');
    if (doc.children[0].type !== 'container') throw new Error('container missing');
    expect(doc.children[0].endLine).toBe(10);
    expect(doc.children[0].children.some((child) => child.kind === 'code')).toBe(true);
    expect(doc.diagnostics).toEqual([]);
  });

  it('reports unclosed containers without swallowing the document', () => {
    const doc = parseDocumentTree(':::aside\n\nText without a closing fence');
    expect(doc.diagnostics[0]?.code).toBe('unclosed-container');
    expect(doc.children[0].type).toBe('block');
  });

  it('reports nesting because v1 deliberately forbids it', () => {
    const doc = parseDocumentTree(':::aside\n:::group\nNested\n:::\n:::');
    expect(doc.diagnostics.some((diagnostic) => diagnostic.code === 'nested-container')).toBe(true);
  });

  it('round-trips a well-formed document', () => {
    const source = '# Title\n\n:::aside\n\n## Why\n\nBecause.\n\n:::\n\nDone.';
    expect(serializeDocumentTree(parseDocumentTree(source))).toBe(source);
  });

  it('supports aside, gallery and group', () => {
    for (const kind of ['aside', 'gallery', 'group'] as const) {
      const doc = parseDocumentTree(`:::${kind}\n\nContent\n\n:::`);
      expect(doc.children[0].type).toBe('container');
      expect(doc.children[0].kind).toBe(kind);
    }
  });
});
