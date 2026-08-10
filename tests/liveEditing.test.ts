import { describe, it, expect } from 'vitest';
import {
  enterInBlock,
  offsetAt,
  positionAt,
  replaceMarkdownBlock,
  softBreakInBlock,
  splitMarkdownBlocks,
} from '../src-shared/liveMarkdown';

/**
 * Presses a key in a block and reports what the whole body becomes, plus where
 * the caret lands in it — which is the part that was broken: the keystroke did
 * something, and the caret did not follow it.
 */
function press(
  body: string,
  caretLine: number,
  caretCol: number,
  key: 'Enter' | 'Shift+Enter'
): { body: string; line: number; col: number } {
  const blocks = splitMarkdownBlocks(body);
  const block = blocks.find((b) => caretLine >= b.startLine && caretLine <= b.endLine)!;
  const at = offsetAt(block.raw, caretLine - block.startLine, caretCol);
  const edit =
    key === 'Enter' ? enterInBlock(block.kind, block.raw, at) : softBreakInBlock(block.kind, block.raw, at);
  const pos = positionAt(edit.raw, edit.caret);
  return {
    body: replaceMarkdownBlock(body, block, edit.raw),
    line: block.startLine + pos.line,
    col: pos.col,
  };
}

/** The block the caret would be editing, after the press. */
function blockAt(body: string, line: number) {
  return splitMarkdownBlocks(body).find((b) => line >= b.startLine && line <= b.endLine)!;
}

/** Types text at the caret, the way the textarea would. */
function type(
  body: string,
  line: number,
  col: number,
  text: string
): { body: string; line: number; col: number } {
  const block = blockAt(body, line);
  const at = offsetAt(block.raw, line - block.startLine, col);
  const raw = `${block.raw.slice(0, at)}${text}${block.raw.slice(at)}`;
  const pos = positionAt(raw, at + text.length);
  return {
    body: replaceMarkdownBlock(body, block, raw),
    line: block.startLine + pos.line,
    col: pos.col,
  };
}

describe('caret arithmetic', () => {
  it('round-trips a position through an offset', () => {
    const raw = 'first line\nsecond\n\nfourth';
    for (let offset = 0; offset <= raw.length; offset++) {
      const pos = positionAt(raw, offset);
      expect(offsetAt(raw, pos.line, pos.col)).toBe(offset);
    }
  });

  it('clamps a position that no longer fits the text', () => {
    expect(offsetAt('short', 9, 99)).toBe(5);
    expect(positionAt('short', 99)).toEqual({ line: 0, col: 5 });
  });
});

describe('Enter at the end of a paragraph', () => {
  const body = 'The first paragraph.';

  it('opens a new block instead of stranding the newline', () => {
    const after = press(body, 0, body.length, 'Enter');
    expect(after.body).toBe('The first paragraph.\n\n');
    // The caret has to land past the blank line, in the new block — this is the
    // bug: it used to stay in the old one, and the keystroke looked lost.
    expect(after.line).toBe(2);
    expect(after.col).toBe(0);
  });

  it('lands the caret in a block that is not the one it came from', () => {
    const after = press(body, 0, body.length, 'Enter');
    expect(blockAt(after.body, after.line).startLine).not.toBe(0);
  });

  it('types into the new block rather than the old one', () => {
    const first = press(body, 0, body.length, 'Enter');
    const typed = type(first.body, first.line, first.col, 'The second paragraph.');
    expect(typed.body).toBe('The first paragraph.\n\nThe second paragraph.');
    expect(splitMarkdownBlocks(typed.body).filter((b) => b.kind === 'paragraph')).toHaveLength(2);
  });

  it('survives Enter pressed twice with typing in between', () => {
    let at = press(body, 0, body.length, 'Enter');
    at = type(at.body, at.line, at.col, 'Second.');
    at = press(at.body, at.line, at.col, 'Enter');
    at = type(at.body, at.line, at.col, 'Third.');
    expect(at.body).toBe('The first paragraph.\n\nSecond.\n\nThird.');
    expect(splitMarkdownBlocks(at.body).filter((b) => b.kind === 'paragraph')).toHaveLength(3);
  });

  it('builds a list item by item', () => {
    let at = { body: '- milk', line: 0, col: 6 };
    at = press(at.body, at.line, at.col, 'Enter');
    at = type(at.body, at.line, at.col, 'eggs');
    at = press(at.body, at.line, at.col, 'Enter');
    at = type(at.body, at.line, at.col, 'bread');
    expect(at.body).toBe('- milk\n- eggs\n- bread');
    // One list block throughout, never fragmented into three.
    expect(splitMarkdownBlocks(at.body)).toHaveLength(1);
  });
});

describe('Enter in the middle of a block', () => {
  it('splits a paragraph in two', () => {
    const after = press('one two', 0, 3, 'Enter');
    expect(after.body).toBe('one\n\n two');
    expect(after.line).toBe(2);
  });

  it('splits a heading, leaving the tail as ordinary text', () => {
    const after = press('# Title here', 0, 7, 'Enter');
    expect(after.body).toBe('# Title\n\n here');
    expect(blockAt(after.body, 0).kind).toBe('heading');
    expect(blockAt(after.body, after.line).kind).toBe('paragraph');
  });
});

describe('Enter inside a list', () => {
  it('opens the next bullet', () => {
    const after = press('- milk\n- eggs', 1, 6, 'Enter');
    expect(after.body).toBe('- milk\n- eggs\n- ');
    expect(after.line).toBe(2);
    expect(after.col).toBe(2);
  });

  it('numbers the next item', () => {
    const after = press('1. first\n2. second', 1, 9, 'Enter');
    expect(after.body).toBe('1. first\n2. second\n3. ');
  });

  it('opens an unchecked box after a checked one', () => {
    const after = press('- [x] done', 0, 10, 'Enter');
    expect(after.body).toBe('- [x] done\n- [ ] ');
  });

  it('keeps the indent of the item it follows', () => {
    const after = press('  - nested', 0, 10, 'Enter');
    expect(after.body).toBe('  - nested\n  - ');
  });

  it('leaves the list when the item is empty', () => {
    // Enter on an empty bullet is how a person says "done listing".
    const after = press('- milk\n- ', 1, 2, 'Enter');
    expect(after.body).toBe('- milk\n\n');
    expect(blockAt(after.body, after.line).kind).not.toBe('list');
  });
});

describe('Enter elsewhere', () => {
  it('stays inside a fenced code block', () => {
    const body = '```js\nconst a = 1;\n```';
    const after = press(body, 1, 12, 'Enter');
    expect(after.body).toBe('```js\nconst a = 1;\n\n```');
    expect(blockAt(after.body, after.line).kind).toBe('code');
  });

  it('continues a quote', () => {
    const after = press('> a thought', 0, 11, 'Enter');
    expect(after.body).toBe('> a thought\n> ');
    expect(blockAt(after.body, after.line).kind).toBe('quote');
  });
});

describe('Shift+Enter', () => {
  it('breaks the line without leaving the block', () => {
    const after = press('roses are red', 0, 13, 'Shift+Enter');
    expect(after.body).toBe('roses are red  \n');
    // One block, not two: the whole point of a soft break.
    expect(splitMarkdownBlocks(after.body).filter((b) => b.kind === 'paragraph')).toHaveLength(1);
    expect(after.line).toBe(1);
    expect(after.col).toBe(0);
  });

  it('writes a break Markdown will actually honour', () => {
    // A bare newline is joined back into one line by any Markdown renderer;
    // two trailing spaces are the portable way to mean "break here".
    const after = press('first', 0, 5, 'Shift+Enter');
    expect(after.body.startsWith('first  \n')).toBe(true);
  });

  it('does not stack trailing spaces when pressed twice', () => {
    const once = press('first', 0, 5, 'Shift+Enter');
    const twice = press(once.body, once.line, once.col, 'Shift+Enter');
    expect(twice.body).toBe('first  \n  \n');
  });

  it('is a plain newline inside code', () => {
    const after = press('```\nx\n```', 1, 1, 'Shift+Enter');
    expect(after.body).toBe('```\nx\n\n```');
  });
});
