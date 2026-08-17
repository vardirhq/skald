import type { EditorInsertContribution } from '../extensions/types';

export type InsertCategory = 'Text' | 'Lists' | 'Blocks' | 'Containers' | 'Extensions';

export interface InsertMenuItem {
  id: string;
  name: string;
  description: string;
  category: InsertCategory;
  keywords: string[];
  markdown: string;
  placeholder?: string;
  block: boolean;
  extension?: EditorInsertContribution;
}

export interface TextSelection {
  start: number;
  end: number;
}

export interface InsertionResult extends TextSelection {
  text: string;
}

export const coreInsertions: readonly InsertMenuItem[] = [
  item('heading', 'Heading', 'Start a section heading', 'Text', '## Heading', 'Heading', true, ['title', 'section']),
  item('bold', 'Bold text', 'Emphasize the selected text', 'Text', '**bold text**', 'bold text', false, ['strong']),
  item('italic', 'Italic text', 'Add light emphasis', 'Text', '*italic text*', 'italic text', false, ['emphasis']),
  item('link', 'Web link', 'Link text to a URL', 'Text', '[link text](https://example.com)', 'link text', false, ['url', 'hyperlink']),
  item('wikilink', 'Note link', 'Link to another note in the vault', 'Text', '[[Note title]]', 'Note title', false, ['wiki', 'backlink']),
  item('bulleted-list', 'Bulleted list', 'Start an unordered list', 'Lists', '- List item', 'List item', true, ['unordered', 'bullet']),
  item('numbered-list', 'Numbered list', 'Start an ordered list', 'Lists', '1. List item', 'List item', true, ['ordered']),
  item('task', 'Task', 'Add an unchecked task', 'Lists', '- [ ] Task', 'Task', true, ['todo', 'checkbox', 'thread']),
  item('quote', 'Quote', 'Add a block quote', 'Blocks', '> Quote', 'Quote', true, ['blockquote']),
  item('callout', 'Callout', 'Add a highlighted note block', 'Blocks', '> [!note]\n> Callout text', 'Callout text', true, ['admonition']),
  item('code', 'Code block', 'Add a fenced code block', 'Blocks', '```text\nCode\n```', 'Code', true, ['fence', 'snippet']),
  item('table', 'Table', 'Add a two-column Markdown table', 'Blocks', '| Column 1 | Column 2 |\n| --- | --- |\n| Value | Value |', 'Column 1', true, ['grid', 'columns']),
  item('divider', 'Divider', 'Separate sections with a horizontal rule', 'Blocks', '---', undefined, true, ['rule', 'separator']),
  item('aside', 'Aside', 'Group supporting context without changing its Markdown blocks', 'Containers', ':::aside\n\nContent\n\n:::', 'Content', true, ['semantic', 'context', 'note', 'fenced div', 'wrap']),
  item('gallery', 'Gallery', 'Group images or other media as one semantic gallery', 'Containers', ':::gallery\n\n![](image.jpg)\n\n:::', '![](image.jpg)', true, ['semantic', 'images', 'photos', 'media', 'fenced div']),
  item('group', 'Group', 'Group related blocks without prescribing their visual layout', 'Containers', ':::group\n\nContent\n\n:::', 'Content', true, ['semantic', 'section', 'collection', 'fenced div', 'wrap']),
];

export function extensionInsertions(contributions: readonly EditorInsertContribution[]): InsertMenuItem[] {
  return contributions.map((extension) => ({
    id: extension.id,
    name: extension.menuLabel ?? extension.label.replace(/^\+\s*/, ''),
    description: extension.title,
    category: 'Extensions',
    keywords: extension.keywords ?? [],
    markdown: extension.markdown,
    placeholder: extension.placeholder,
    block: true,
    extension,
  }));
}

export function applyInsertion(
  text: string,
  selection: TextSelection,
  insertion: Pick<InsertMenuItem, 'markdown' | 'placeholder' | 'block'>
): InsertionResult {
  const start = Math.max(0, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));
  const selected = text.slice(start, end);
  let markdown = insertion.markdown;
  const placeholderAt = insertion.placeholder ? markdown.indexOf(insertion.placeholder) : -1;
  if (selected && placeholderAt >= 0 && insertion.placeholder) {
    markdown = markdown.slice(0, placeholderAt) + selected + markdown.slice(placeholderAt + insertion.placeholder.length);
  }

  const before = text.slice(0, start);
  const after = text.slice(end);
  const prefix = insertion.block ? blockPrefix(before) : '';
  const suffix = insertion.block ? blockSuffix(after) : '';
  const insertedAt = before.length + prefix.length;
  const next = before + prefix + markdown + suffix + after;

  if (!selected && placeholderAt >= 0 && insertion.placeholder) {
    return {
      text: next,
      start: insertedAt + placeholderAt,
      end: insertedAt + placeholderAt + insertion.placeholder.length,
    };
  }
  const caret = insertedAt + markdown.length;
  return { text: next, start: caret, end: caret };
}

export function matchesInsertion(item: InsertMenuItem, query: string): boolean {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [item.name, item.description, item.category, ...item.keywords].join(' ').toLowerCase();
  return words.every((word) => haystack.includes(word));
}

function item(
  id: string,
  name: string,
  description: string,
  category: InsertCategory,
  markdown: string,
  placeholder: string | undefined,
  block: boolean,
  keywords: string[]
): InsertMenuItem {
  return { id: `core.${id}`, name, description, category, markdown, placeholder, block, keywords };
}

function blockPrefix(before: string): string {
  if (!before || before.endsWith('\n\n')) return '';
  return before.endsWith('\n') ? '\n' : '\n\n';
}

function blockSuffix(after: string): string {
  if (!after) return '\n';
  if (after.startsWith('\n\n')) return '';
  return after.startsWith('\n') ? '\n' : '\n\n';
}
