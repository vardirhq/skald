import { describe, it, expect } from 'vitest';
import {
  inferSchema,
  noteTitle,
  topFolder,
  extractHeadings,
  excerptOf,
  countWords,
  safeFileName,
  renderSchemaTemplate,
} from '../src-shared/notes';
import { fuzzyMatch } from '../src-shared/fuzzy';
import { layoutGraph } from '../src-main/layout';

describe('inferSchema', () => {
  it('prefers frontmatter', () => {
    expect(inferSchema({ schema: 'project' }, 'x', 'Whatever')).toBe('Project');
  });
  it('detects daily notes by title', () => {
    expect(inferSchema({}, '2026-07-17', '')).toBe('Daily');
  });
  it('falls back to folder mapping, then Note', () => {
    expect(inferSchema({}, 'Ada', 'People')).toBe('Person');
    expect(inferSchema({}, 'Misc', 'Random')).toBe('Note');
  });
});

describe('note utilities', () => {
  it('titles from frontmatter or filename', () => {
    expect(noteTitle({ title: 'Fancy' }, 'a/b.md')).toBe('Fancy');
    expect(noteTitle({}, 'a/Plain Name.md')).toBe('Plain Name');
  });
  it('topFolder', () => {
    expect(topFolder('Daily/2026.md')).toBe('Daily');
    expect(topFolder('root.md')).toBe('');
  });
  it('extractHeadings skips code fences and offsets lines', () => {
    const body = '# A\n```\n# not\n```\n## B';
    const hs = extractHeadings(body, 3);
    expect(hs).toEqual([
      { level: 1, text: 'A', line: 4 },
      { level: 2, text: 'B', line: 8 },
    ]);
  });
  it('excerpt strips markdown', () => {
    expect(excerptOf('# H\n\nSome **bold** and [[Link|shown]] text')).toBe(
      'Some bold and shown text'
    );
  });
  it('counts words', () => {
    expect(countWords('one two three')).toBe(3);
  });
  it('sanitizes file names', () => {
    expect(safeFileName('a/b: c?')).toBe('a b c');
  });
  it('renders schema template placeholders case-insensitively', () => {
    expect(renderSchemaTemplate('# {{ title }}\n\nStarted {{DATE}}.', 'Skald', '2026-08-11')).toBe(
      '# Skald\n\nStarted 2026-08-11.'
    );
  });
});

describe('fuzzyMatch', () => {
  it('prefers word-boundary substring matches', () => {
    const a = fuzzyMatch('graph', 'Open graph view')!;
    const b = fuzzyMatch('graph', 'biography')!;
    expect(a.score).toBeGreaterThan(b.score);
  });
  it('matches subsequences', () => {
    expect(fuzzyMatch('ogv', 'Open graph view')).not.toBeNull();
    expect(fuzzyMatch('zzz', 'Open graph view')).toBeNull();
  });
});

describe('layoutGraph', () => {
  it('keeps stored positions fixed and places new nodes deterministically', () => {
    const stored = { a: { x: 0.2, y: 0.2 } };
    const p1 = layoutGraph(['a', 'b', 'c'], [['a', 'b']], stored);
    const p2 = layoutGraph(['a', 'b', 'c'], [['a', 'b']], stored);
    expect(p1['a']).toEqual({ x: 0.2, y: 0.2 });
    expect(p1).toEqual(p2);
    for (const id of ['b', 'c']) {
      expect(p1[id].x).toBeGreaterThan(0);
      expect(p1[id].x).toBeLessThan(1);
    }
  });
});
