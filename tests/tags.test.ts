import { describe, expect, it } from 'vitest';
import { completeTag, extractInlineTags, matchingTags, tagCompletionAt } from '../src-shared/tags';

describe('tag completion', () => {
  it('finds a tag prefix at the caret but not a hash inside a word', () => {
    expect(tagCompletionAt('Plan #pro', 9)).toEqual({ query: 'pro', start: 5, end: 9 });
    expect(tagCompletionAt('C#pro', 5)).toBeNull();
  });

  it('replaces only the active prefix', () => {
    expect(completeTag('Plan #pro later', { query: 'pro', start: 5, end: 9 }, 'project')).toEqual({
      text: 'Plan #project later', caret: 13,
    });
  });

  it('matches unique tags case-insensitively', () => {
    expect(matchingTags(['Project', '#personal', 'project'], 'p')).toEqual(['personal', 'Project']);
  });

  it('extracts inline tags without treating headings or code as tags', () => {
    expect(extractInlineTags('# Heading\nWork on #Skald and (#project). `#ignored`\n```\n#also-ignored\n```')).toEqual([
      'Skald',
      'project',
    ]);
  });
});
