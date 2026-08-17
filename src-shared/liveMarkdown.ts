import {
  flattenEditableBlocks,
  parseDocumentTree,
  type MarkdownBlockKind,
  type SemanticContainerKind,
} from './documentTree';

export type { MarkdownBlockKind } from './documentTree';

export interface MarkdownBlock {
  id: string;
  kind: MarkdownBlockKind;
  startLine: number;
  endLine: number;
  raw: string;
  container?: {
    id: string;
    kind: SemanticContainerKind;
    startLine: number;
    endLine: number;
  };
}

/**
 * Compatibility projection for the live editor.
 *
 * The runtime model is a tree, but the current editor still edits one ordinary
 * Markdown block at a time. Container fences therefore do not become giant
 * editable pseudo-blocks: their children are returned as the same block types
 * the editor already understands, annotated with their semantic parent.
 */
export function splitMarkdownBlocks(body: string): MarkdownBlock[] {
  const blocks = flattenEditableBlocks(parseDocumentTree(body));
  if (blocks.length === 0 && body.length === 0) {
    return [{ id: 'b0-0', kind: 'blank', startLine: 0, endLine: 0, raw: '' }];
  }
  return blocks.map(({ type: _type, parentContainerId: _parentId, parentContainerKind: _parentKind, ...block }) => block);
}

export function offsetAt(raw: string, line: number, col: number): number {
  const lines = raw.split('\n');
  const row = Math.max(0, Math.min(line, lines.length - 1));
  let offset = 0;
  for (let i = 0; i < row; i++) offset += lines[i].length + 1;
  return offset + Math.max(0, Math.min(col, lines[row].length));
}

export function positionAt(raw: string, offset: number): { line: number; col: number } {
  const before = raw.slice(0, Math.max(0, Math.min(offset, raw.length))).split('\n');
  return { line: before.length - 1, col: before[before.length - 1].length };
}

const WHITESPACE = /\s/;
const LIST_PREFIX = /^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|(\d+)([.)])\s+)/;
const QUOTE_PREFIX = /^(\s*>\s?)/;
const SEMANTIC_FENCE = /^\s*:::(?:aside|gallery|group)?\s*$/;

export function sourceOffsetFromRendered(raw: string, rendered: string): number {
  const MAX_MARKUP_RUN = 400;
  let source = 0;
  let shown = 0;
  let agreed = 0;

  while (shown < rendered.length && source < raw.length) {
    if (WHITESPACE.test(rendered[shown])) {
      while (shown < rendered.length && WHITESPACE.test(rendered[shown])) shown++;
      while (source < raw.length && WHITESPACE.test(raw[source])) source++;
      if (source > 0 && raw[source - 1] === '\n') {
        const rest = raw.slice(source);
        const marker = LIST_PREFIX.exec(rest)?.[0] ?? QUOTE_PREFIX.exec(rest)?.[1];
        if (marker) source += marker.length;
      }
      agreed = source;
      continue;
    }
    if (raw[source] === rendered[shown]) {
      source++;
      shown++;
      agreed = source;
      continue;
    }
    if (source - agreed > MAX_MARKUP_RUN) return agreed;
    source++;
  }
  return shown >= rendered.length ? agreed : source;
}

export interface CaretEdit {
  raw: string;
  caret: number;
}

function nextMarker(prefix: string): string {
  const ordered = /^(\s*)(\d+)([.)])(\s+)$/.exec(prefix);
  if (ordered) return `${ordered[1]}${Number(ordered[2]) + 1}${ordered[3]}${ordered[4]}`;
  return prefix.replace(/\[[xX]\]/, '[ ]');
}

function lineBoundsAt(raw: string, caret: number): { start: number; end: number } {
  const start = raw.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  const nl = raw.indexOf('\n', caret);
  return { start, end: nl === -1 ? raw.length : nl };
}

export function softBreakInBlock(kind: MarkdownBlockKind, raw: string, caret: number): CaretEdit {
  const before = raw.slice(0, caret);
  const after = raw.slice(caret);
  if (kind === 'code') return { raw: `${before}\n${after}`, caret: caret + 1 };
  const padded = /\s$/.test(before) ? before.replace(/[ \t]+$/, '') : before;
  const inserted = `${padded}  \n`;
  return { raw: `${inserted}${after}`, caret: inserted.length };
}

export function enterInBlock(kind: MarkdownBlockKind, raw: string, caret: number): CaretEdit {
  const before = raw.slice(0, caret);
  const after = raw.slice(caret);

  if (kind === 'code') return { raw: `${before}\n${after}`, caret: caret + 1 };

  if (kind === 'list' || kind === 'task') {
    const { start, end } = lineBoundsAt(raw, caret);
    const line = raw.slice(start, end);
    const match = LIST_PREFIX.exec(line);
    if (match) {
      const marker = match[0];
      if (line.trim() === marker.trim()) {
        const head = raw.slice(0, start).replace(/\n$/, '');
        const tail = raw.slice(end);
        const joined = head ? `${head}\n\n` : '';
        return { raw: `${joined}${tail.replace(/^\n/, '')}`, caret: joined.length };
      }
      const opened = `${before}\n${nextMarker(marker)}`;
      return { raw: `${opened}${after}`, caret: opened.length };
    }
  }

  if (kind === 'quote') {
    const { start } = lineBoundsAt(raw, caret);
    const prefix = QUOTE_PREFIX.exec(raw.slice(start))?.[1];
    if (prefix && raw.slice(start).trim() !== prefix.trim()) {
      const opened = `${before}\n${prefix}`;
      return { raw: `${opened}${after}`, caret: opened.length };
    }
  }

  const head = before.replace(/[ \t]+$/, '');
  return { raw: `${head}\n\n${after}`, caret: head.length + 2 };
}

/**
 * Replace an ordinary editable block without implicitly changing semantic
 * structure. If a multi-block edit would consume an aside/gallery/group fence,
 * leave the source untouched. Container fences are changed by source mode or a
 * dedicated container operation, never as a side effect of block joining.
 */
export function replaceMarkdownBlock(
  body: string,
  block: Pick<MarkdownBlock, 'startLine' | 'endLine'>,
  raw: string
): string {
  const lines = body.length === 0 ? [''] : body.split('\n');
  const removed = lines.slice(block.startLine, block.endLine + 1);
  if (removed.some((line) => SEMANTIC_FENCE.test(line))) return body;
  const replacement = raw.length === 0 ? [''] : raw.split('\n');
  lines.splice(block.startLine, block.endLine - block.startLine + 1, ...replacement);
  return lines.join('\n');
}

export function replaceMarkdownBody(content: string, bodyStartLine: number, body: string): string {
  const lines = content.split('\n');
  const frontmatter = lines.slice(0, bodyStartLine).join('\n');
  if (!frontmatter) return body;
  return `${frontmatter}\n${body}`;
}
