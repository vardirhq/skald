import { describe, expect, it } from 'vitest';
import {
  replaceMarkdownBlock,
  replaceMarkdownBody,
  splitMarkdownBlocks,
} from '../src-shared/liveMarkdown';

describe('live Markdown blocks', () => {
  it('splits common Markdown structures into editable blocks', () => {
    const blocks = splitMarkdownBlocks(
      '# Title\n\nIntro text\nstill intro\n\n- [ ] Do thing\n- [x] Done\n\n```ts\nconst x = 1\n```\n\n> [!note] Hello\n> body'
    );

    expect(blocks.map((b) => b.kind)).toEqual([
      'heading',
      'blank',
      'paragraph',
      'blank',
      'task',
      'blank',
      'code',
      'blank',
      'quote',
    ]);
    expect(blocks[2].raw).toBe('Intro text\nstill intro');
    expect(blocks[6].raw).toBe('```ts\nconst x = 1\n```');
  });

  it('projects semantic container children as ordinary editable blocks', () => {
    const blocks = splitMarkdownBlocks(':::aside\n\n## Context\n\nText\n\n:::');
    expect(blocks.map((block) => block.kind)).toEqual(['blank', 'heading', 'blank', 'paragraph', 'blank']);
    expect(blocks.find((block) => block.kind === 'heading')?.container?.kind).toBe('aside');
  });

  it('replaces only the selected block', () => {
    const body = '# Title\n\nOld paragraph\n\n- [ ] Task';
    const block = splitMarkdownBlocks(body).find((item) => item.kind === 'paragraph')!;

    expect(replaceMarkdownBlock(body, block, 'New paragraph')).toBe(
      '# Title\n\nNew paragraph\n\n- [ ] Task'
    );
  });

  it('refuses a block edit that would implicitly consume a semantic fence', () => {
    const body = 'Before\n:::aside\nInside\n:::';
    expect(replaceMarkdownBlock(body, { startLine: 0, endLine: 2 }, 'BeforeInside')).toBe(body);
  });

  it('still edits a child block without touching its surrounding fences', () => {
    const body = ':::aside\nInside\n:::';
    const block = splitMarkdownBlocks(body).find((item) => item.kind === 'paragraph')!;
    expect(replaceMarkdownBlock(body, block, 'Changed')).toBe(':::aside\nChanged\n:::');
  });

  it('replaces a frontmatter-stripped body without touching frontmatter', () => {
    const content = '---\ntitle: Note\n---\n\nOld body';
    expect(replaceMarkdownBody(content, 4, 'New body')).toBe('---\ntitle: Note\n---\n\nNew body');
  });
});
