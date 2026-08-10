export type MarkdownBlockKind =
  | 'blank'
  | 'heading'
  | 'code'
  | 'quote'
  | 'task'
  | 'list'
  | 'rule'
  | 'paragraph';

export interface MarkdownBlock {
  id: string;
  kind: MarkdownBlockKind;
  startLine: number;
  endLine: number;
  raw: string;
}

const TASK_LINE = /^\s*[-*+]\s+\[( |x|X)\]\s+/;
const UL_LINE = /^\s*[-*+]\s+(?!\[[ xX]\]\s)/;
const OL_LINE = /^\s*\d+[.)]\s+/;
const HR_LINE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

export function splitMarkdownBlocks(body: string): MarkdownBlock[] {
  if (body.length === 0) {
    return [{ id: 'b0-0', kind: 'blank', startLine: 0, endLine: 0, raw: '' }];
  }

  const lines = body.split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  const push = (kind: MarkdownBlockKind, start: number, end: number) => {
    blocks.push({
      id: `b${start}-${end}`,
      kind,
      startLine: start,
      endLine: end,
      raw: lines.slice(start, end + 1).join('\n'),
    });
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      const start = i;
      while (i < lines.length && !lines[i].trim()) i++;
      push('blank', start, i - 1);
      continue;
    }

    if (/^\s*```/.test(line)) {
      const start = i;
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) i++;
      if (i < lines.length) i++;
      push('code', start, i - 1);
      continue;
    }

    if (/^(#{1,6})\s+/.test(line)) {
      push('heading', i, i);
      i++;
      continue;
    }

    if (HR_LINE.test(line)) {
      push('rule', i, i);
      i++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const start = i;
      while (i < lines.length && /^\s*>/.test(lines[i])) i++;
      push('quote', start, i - 1);
      continue;
    }

    if (TASK_LINE.test(line)) {
      const start = i;
      while (i < lines.length && TASK_LINE.test(lines[i])) i++;
      push('task', start, i - 1);
      continue;
    }

    if (UL_LINE.test(line) || OL_LINE.test(line)) {
      const start = i;
      const matcher = UL_LINE.test(line) ? UL_LINE : OL_LINE;
      while (i < lines.length && matcher.test(lines[i])) i++;
      push('list', start, i - 1);
      continue;
    }

    const start = i;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(#{1,6}\s|>|```)/.test(lines[i]) &&
      !TASK_LINE.test(lines[i]) &&
      !UL_LINE.test(lines[i]) &&
      !OL_LINE.test(lines[i]) &&
      !HR_LINE.test(lines[i])
    ) {
      i++;
    }
    push('paragraph', start, i - 1);
  }

  return blocks;
}

// ---------- caret arithmetic ----------
//
// The editor tracks the caret as a position in the whole body rather than an
// offset in one block, because a keystroke can re-split the blocks underneath
// it. A line and column survive that; an offset into a block that no longer
// exists does not.

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

/** The bullet, number or checkbox that opens a list line. */
const LIST_PREFIX = /^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|(\d+)([.)])\s+)/;
const QUOTE_PREFIX = /^(\s*>\s?)/;


/**
 * Maps a position in a block's *rendered* text back to an offset in its
 * Markdown source.
 *
 * A reader clicks what they can see, and what they can see is the source with
 * the syntax taken out — so the two are walked in step. Characters that agree
 * advance both; anything left over in the source is markup the reader never
 * saw, and is stepped over. Whitespace is treated as equivalent throughout,
 * because a rendered paragraph joins source lines with a space.
 *
 * Where the rendered text is not the source minus syntax — a due date shown as
 * "May 1" — alignment cannot be exact, so the search for the next agreeing
 * character is bounded and falls back to the last position that did agree.
 * Being a few characters out beats landing at the end of the block.
 */
export function sourceOffsetFromRendered(raw: string, rendered: string): number {
  const MAX_MARKUP_RUN = 400;
  let source = 0;
  let shown = 0;
  let agreed = 0;

  while (shown < rendered.length && source < raw.length) {
    if (WHITESPACE.test(rendered[shown])) {
      while (shown < rendered.length && WHITESPACE.test(rendered[shown])) shown++;
      while (source < raw.length && WHITESPACE.test(raw[source])) source++;
      // Landing at the start of a source line means the marker that opens it —
      // a bullet, a number, a quote caret — is still ahead. A reader who clicks
      // the start of a list item means its text, not its bullet.
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
  /** Replacement text for the block. */
  raw: string;
  /** Where the caret belongs inside that replacement. */
  caret: number;
}

/** The marker that should open the item after this one. */
function nextMarker(prefix: string): string {
  const ordered = /^(\s*)(\d+)([.)])(\s+)$/.exec(prefix);
  if (ordered) return `${ordered[1]}${Number(ordered[2]) + 1}${ordered[3]}${ordered[4]}`;
  // A checked box does not carry its tick to the next item.
  return prefix.replace(/\[[xX]\]/, '[ ]');
}

function lineBoundsAt(raw: string, caret: number): { start: number; end: number } {
  const start = raw.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  const nl = raw.indexOf('\n', caret);
  return { start, end: nl === -1 ? raw.length : nl };
}

/**
 * Shift+Enter: a line break that stays inside this block. Markdown only breaks
 * a line when it is asked to, so the break is written the portable way — two
 * trailing spaces — rather than left as a newline the renderer would swallow.
 */
export function softBreakInBlock(kind: MarkdownBlockKind, raw: string, caret: number): CaretEdit {
  const before = raw.slice(0, caret);
  const after = raw.slice(caret);
  if (kind === 'code') return { raw: `${before}\n${after}`, caret: caret + 1 };
  const padded = /\s$/.test(before) ? before.replace(/[ \t]+$/, '') : before;
  const inserted = `${padded}  \n`;
  return { raw: `${inserted}${after}`, caret: inserted.length };
}

/**
 * Enter. Inside a list it opens the next item; on an empty item it leaves the
 * list; inside code it is just a newline. Everywhere else it ends this block
 * and opens a new one, which is the thing the editor was failing to do — the
 * newline used to fall out of the block being edited and strand the caret.
 */
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
        // An empty item means "I am done listing". Drop it and start a block.
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

  // End this block and open the next. The blank line between them is what makes
  // them two blocks rather than one paragraph with a newline in it.
  const head = before.replace(/[ \t]+$/, '');
  return { raw: `${head}\n\n${after}`, caret: head.length + 2 };
}

export function replaceMarkdownBlock(
  body: string,
  block: Pick<MarkdownBlock, 'startLine' | 'endLine'>,
  raw: string
): string {
  const lines = body.length === 0 ? [''] : body.split('\n');
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
