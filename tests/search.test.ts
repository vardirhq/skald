import { describe, expect, it } from 'vitest';
import { parseSearchQuery, searchNotes, type SearchableNote } from '../src-shared/search';

const notes: SearchableNote[] = [
  { path: 'Projects/Skald.md', title: 'Skald', schema: 'Project', folder: 'Projects', tags: ['app', 'rust'], body: 'A local-first knowledge base.\nSecond line.', bodyStartLine: 5, updated: 100 },
  { path: 'Notes/Other.md', title: 'Other', schema: 'Note', folder: 'Notes', tags: ['app'], body: 'Skald appears only in this body.', bodyStartLine: 1, updated: 200 },
];

describe('full-text search', () => {
  it('parses quoted terms and filters', () => {
    expect(parseSearchQuery('"local-first" schema:project tag:#rust folder:Projects')).toEqual({
      terms: ['local-first'], schemas: ['project'], tags: ['rust'], folders: ['projects'],
    });
  });

  it('ranks title matches above body matches and reports file coordinates', () => {
    const results = searchNotes(notes, 'skald');
    expect(results.map((result) => result.path)).toEqual(['Projects/Skald.md', 'Notes/Other.md']);
    expect(results[1]).toMatchObject({ line: 1, column: 1, length: 5 });
  });

  it('combines schema, tag, and folder filters', () => {
    expect(searchNotes(notes, 'local schema:Project tag:rust folder:projects')[0].path).toBe('Projects/Skald.md');
    expect(searchNotes(notes, 'schema:Note tag:rust')).toEqual([]);
  });
});
