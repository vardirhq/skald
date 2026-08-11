export interface TagCompletionRange {
  query: string;
  start: number;
  end: number;
}

export function extractInlineTags(markdown: string): string[] {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /(^|[\s([{])#([\p{L}\p{N}_/-]+)/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(withoutCode)) !== null) {
    const tag = match[2];
    const key = tag.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

export function tagCompletionAt(text: string, cursor: number): TagCompletionRange | null {
  const before = text.slice(0, cursor);
  const match = before.match(/(^|[\s([{])#([\p{L}\p{N}_/-]*)$/u);
  if (!match) return null;
  const query = match[2];
  const start = cursor - query.length - 1;
  return { query, start, end: cursor };
}

export function completeTag(text: string, range: TagCompletionRange, tag: string): { text: string; caret: number } {
  const replacement = `#${tag}`;
  return {
    text: text.slice(0, range.start) + replacement + text.slice(range.end),
    caret: range.start + replacement.length,
  };
}

export function matchingTags(tags: string[], query: string, limit = 8): string[] {
  const needle = query.toLocaleLowerCase();
  const unique = new Map<string, string>();
  for (const raw of tags) {
    const tag = raw.replace(/^#/, '');
    if (tag && !unique.has(tag.toLocaleLowerCase())) unique.set(tag.toLocaleLowerCase(), tag);
  }
  return [...unique.values()]
    .filter((tag) => tag.toLocaleLowerCase().startsWith(needle) && tag.toLocaleLowerCase() !== needle)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);
}
