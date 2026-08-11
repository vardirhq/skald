import type { SchemaName, SearchResult } from './types';

export interface SearchableNote {
  path: string;
  title: string;
  schema: SchemaName;
  folder: string;
  tags: string[];
  body: string;
  bodyStartLine: number;
  updated: number;
}

export interface ParsedSearchQuery {
  terms: string[];
  schemas: string[];
  tags: string[];
  folders: string[];
}

export function parseSearchQuery(input: string): ParsedSearchQuery {
  const parsed: ParsedSearchQuery = { terms: [], schemas: [], tags: [], folders: [] };
  const tokens = input.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  for (const raw of tokens) {
    const token = raw.replace(/^"|"$/g, '').trim();
    const filter = token.match(/^(schema|tag|folder):(.*)$/i);
    if (!filter || !filter[2]) {
      if (token) parsed.terms.push(token.toLocaleLowerCase());
      continue;
    }
    const value = filter[2].replace(/^"|"$/g, '').toLocaleLowerCase();
    if (filter[1].toLocaleLowerCase() === 'schema') parsed.schemas.push(value);
    if (filter[1].toLocaleLowerCase() === 'tag') parsed.tags.push(value.replace(/^#/, ''));
    if (filter[1].toLocaleLowerCase() === 'folder') parsed.folders.push(value.replace(/\\/g, '/'));
  }
  return parsed;
}

export function searchNotes(notes: SearchableNote[], input: string, limit = 100): SearchResult[] {
  const query = parseSearchQuery(input);
  if (!query.terms.length && !query.schemas.length && !query.tags.length && !query.folders.length) return [];
  const results: SearchResult[] = [];
  for (const note of notes) {
    const schema = note.schema.toLocaleLowerCase();
    const tags = note.tags.map((tag) => tag.toLocaleLowerCase().replace(/^#/, ''));
    const folder = note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')).toLocaleLowerCase() : '';
    if (query.schemas.length && !query.schemas.includes(schema)) continue;
    if (query.tags.some((tag) => !tags.includes(tag))) continue;
    if (query.folders.some((value) => folder !== value && !folder.startsWith(`${value}/`))) continue;

    const title = note.title.toLocaleLowerCase();
    const path = note.path.toLocaleLowerCase();
    const body = note.body.toLocaleLowerCase();
    if (query.terms.some((term) => !title.includes(term) && !path.includes(term) && !body.includes(term))) continue;

    let score = 0;
    let matchIndex = -1;
    let matchTerm = '';
    for (const term of query.terms) {
      if (title === term) score += 160;
      else if (title.startsWith(term)) score += 110;
      else if (title.includes(term)) score += 75;
      if (path.includes(term)) score += 20;
      const at = body.indexOf(term);
      if (at !== -1) {
        score += 35 + Math.min(20, body.split(term).length - 2) * 2;
        if (matchIndex === -1 || at < matchIndex) {
          matchIndex = at;
          matchTerm = term;
        }
      }
    }
    if (!query.terms.length) score += 10;
    score += Math.max(0, 12 - Math.floor((Date.now() - note.updated) / 86400000 / 30));

    const location = matchLocation(note.body, matchIndex, matchTerm);
    results.push({
      path: note.path,
      title: note.title,
      schema: note.schema,
      folder: note.folder,
      tags: note.tags,
      snippet: location.snippet,
      line: note.bodyStartLine + location.bodyLine - 1,
      column: location.column,
      length: matchIndex >= 0 ? matchTerm.length : 0,
      score,
      updated: note.updated,
    });
  }
  return results.sort((a, b) => b.score - a.score || b.updated - a.updated || a.path.localeCompare(b.path)).slice(0, limit);
}

function matchLocation(body: string, index: number, term: string): { snippet: string; bodyLine: number; column: number } {
  const at = index >= 0 ? index : 0;
  const before = body.slice(0, at);
  const bodyLine = before.split('\n').length;
  const column = at - before.lastIndexOf('\n');
  const lines = body.split('\n');
  const line = lines[bodyLine - 1] ?? '';
  const start = Math.max(0, column - 1 - 70);
  const end = Math.min(line.length, column - 1 + Math.max(term.length, 1) + 110);
  const core = line.slice(start, end).replace(/\s+/g, ' ').trim();
  return {
    snippet: `${start > 0 ? '…' : ''}${core}${end < line.length ? '…' : ''}` || '(empty note)',
    bodyLine,
    column,
  };
}
