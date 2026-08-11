import type { HeadingItem, SchemaName } from './types';
import { SCHEMA_NAMES } from './types';

const FOLDER_SCHEMAS: Record<string, SchemaName> = {
  daily: 'Daily',
  journal: 'Daily',
  projects: 'Project',
  sagas: 'Project',
  people: 'Person',
  folk: 'Person',
  ideas: 'Idea',
  sources: 'Source',
  references: 'Source',
  lore: 'Source',
  code: 'Code',
  snippets: 'Code',
  places: 'Place',
};

export function inferSchema(
  frontmatter: Record<string, unknown>,
  title: string,
  folder: string
): SchemaName {
  const fm = frontmatter['schema'];
  if (typeof fm === 'string') {
    const hit = SCHEMA_NAMES.find((s) => s.toLowerCase() === fm.toLowerCase());
    if (hit) return hit;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(title.trim())) return 'Daily';
  const byFolder = FOLDER_SCHEMAS[folder.toLowerCase()];
  if (byFolder) return byFolder;
  return 'Note';
}

export function titleFromPath(path: string): string {
  const base = path.split('/').pop() || path;
  return base.replace(/\.md$/i, '');
}

export function noteTitle(frontmatter: Record<string, unknown>, path: string): string {
  const t = frontmatter['title'];
  if (typeof t === 'string' && t.trim()) return t.trim();
  return titleFromPath(path);
}

export function topFolder(path: string): string {
  const idx = path.indexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

export function extractHeadings(body: string, lineOffset = 0): HeadingItem[] {
  const out: HeadingItem[] = [];
  const lines = body.split('\n');
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) out.push({ level: m[1].length, text: m[2], line: i + 1 + lineOffset });
  }
  return out;
}

export function excerptOf(body: string, maxLen = 220): string {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a)
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen).trimEnd() + '…' : text;
}

export function countWords(body: string): number {
  const text = body.replace(/```[\s\S]*?```/g, ' ');
  const words = text.match(/[\p{L}\p{N}'’-]+/gu);
  return words ? words.length : 0;
}

export function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/** Sanitize a user-supplied title into a safe file name (no path separators). */
export function safeFileName(title: string): string {
  return title.replace(/[<>:"|?*\\/\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function renderSchemaTemplate(template: string, title: string, date: string): string {
  return template.replace(/\{\{\s*title\s*\}\}/gi, title).replace(/\{\{\s*date\s*\}\}/gi, date);
}
