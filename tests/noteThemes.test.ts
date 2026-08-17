import { describe, expect, it } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderMarkdown, type MdContext } from '../src/markdown';

// The `sk-` classes are a published contract that user-authored note themes
// target. Once a theme in someone's vault selects on one of these, renaming it
// breaks their note — so the names are pinned here deliberately.

function context(overrides: Partial<MdContext> = {}): MdContext {
  return {
    resolve: (target) => (target === 'Known' ? 'Known.md' : null),
    openNote: () => undefined,
    openExternal: () => undefined,
    resolveAttachment: () => null,
    openAttachment: () => undefined,
    attachmentUrl: (path) => path,
    toggleTask: () => undefined,
    todayISO: '2026-08-17',
    lineOffset: 0,
    frontmatter: {},
    ...overrides,
  };
}

type Props = { className?: string; children?: ReactNode; [key: string]: unknown };

function walk(nodes: ReactNode): ReactElement<Props>[] {
  const found: ReactElement<Props>[] = [];
  const visit = (node: ReactNode) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isValidElement(node)) return;
    const element = node as ReactElement<Props>;
    found.push(element);
    visit(element.props.children);
  };
  visit(nodes);
  return found;
}

function classes(element: ReactElement<Props>): string[] {
  return (element.props.className ?? '').split(' ').filter(Boolean);
}

function findByClass(markdown: string, className: string, ctx = context()): ReactElement<Props>[] {
  return walk(renderMarkdown(markdown, ctx)).filter((el) => classes(el).includes(className));
}

describe('note theme class contract', () => {
  it('gives every heading level its own tag and class', () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const nodes = renderMarkdown(`${'#'.repeat(level)} Heading`, context());
      const heading = nodes[0] as ReactElement<Props>;
      expect(heading.type).toBe(`h${level}`);
      expect(classes(heading)).toContain(`sk-h${level}`);
    }
  });

  it('keeps the internal class alongside the public one', () => {
    const h1 = renderMarkdown('# Title', context())[0] as ReactElement<Props>;
    expect(classes(h1)).toEqual(expect.arrayContaining(['body-h1', 'sk-h1']));
  });

  it('distinguishes an outbound link from a link into the vault', () => {
    const wiki = findByClass('[[Known]]', 'sk-wikilink');
    const external = findByClass('[label](https://example.com)', 'sk-link');
    expect(wiki).toHaveLength(1);
    expect(external).toHaveLength(1);
    expect(classes(external[0])).not.toContain('sk-wikilink');
  });

  it('marks an unresolved wikilink', () => {
    expect(findByClass('[[Nowhere]]', 'sk-wikilink--missing')).toHaveLength(1);
  });

  it('carries task status in a class, never an inline style', () => {
    const working = findByClass('- [ ] Ship it @status(working)', 'sk-task__status');
    expect(working).toHaveLength(1);
    expect(working[0].props['data-status']).toBe('working');
    // An inline style would outrank every rule a theme could write.
    expect(working[0].props.style).toBeUndefined();

    const blocked = findByClass('- [ ] Wait @status(blocked)', 'sk-task__status');
    expect(blocked[0].props['data-status']).toBe('blocked');
    expect(blocked[0].props.style).toBeUndefined();
  });

  it('flags an overdue task on the due marker', () => {
    const due = findByClass('- [ ] Late @due(2020-01-01)', 'sk-task__due');
    expect(due[0].props['data-overdue']).toBe(true);
  });

  it('emits the block-level contract', () => {
    const markdown = [
      'A paragraph.',
      '',
      '> quoted',
      '',
      '---',
      '',
      '- one',
      '',
      '1. first',
      '',
      '```js',
      'code',
      '```',
      '',
      '> [!note] callout',
      '',
      '- [ ] a task',
    ].join('\n');

    for (const className of [
      'sk-p',
      'sk-quote',
      'sk-rule',
      'sk-list',
      'sk-list__item',
      'sk-code',
      'sk-callout',
      'sk-callout__label',
      'sk-tasks',
      'sk-task',
      'sk-task__box',
      'sk-task__label',
    ]) {
      expect(findByClass(markdown, className).length, className).toBeGreaterThan(0);
    }

    expect(findByClass(markdown, 'sk-list--ordered')).toHaveLength(1);
  });

  it('emits the inline contract', () => {
    expect(findByClass('some `code` here', 'sk-code-inline')).toHaveLength(1);
  });
});
