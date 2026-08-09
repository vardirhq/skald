import { describe, it, expect } from 'vitest';
import {
  extractWikilinkTargets,
  countWikilinks,
  renameWikilinks,
  rewriteWikilinks,
  retargetWikilink,
  buildLinkIndex,
  normalizeLinkTarget,
  resolveLinkTarget,
  parseWikilink,
  snippetAround,
} from '../src-shared/wikilinks';

describe('wikilinks', () => {
  it('extracts distinct targets, ignoring code', () => {
    const body =
      'See [[Alpha]] and [[Beta|the b note]] and [[Alpha#Heading]].\n`[[NotThis]]`\n```\n[[NorThis]]\n```';
    expect(extractWikilinkTargets(body)).toEqual(['Alpha', 'Beta']);
  });

  it('counts occurrences', () => {
    expect(countWikilinks('[[A]] x [[A]] y [[B]]')).toBe(3);
  });

  it('parses pipe and heading', () => {
    expect(parseWikilink('Note#Sec|Shown')).toEqual({
      target: 'Note',
      heading: 'Sec',
      display: 'Shown',
    });
    expect(parseWikilink('Just A Note')).toEqual({
      target: 'Just A Note',
      heading: null,
      display: 'Just A Note',
    });
  });

  it('renames targets case-insensitively, preserving display', () => {
    const body = 'A [[old name|shown]] and [[Old Name#H]] and [[Other]]';
    const out = renameWikilinks(body, 'Old Name', 'New Name');
    expect(out).toBe('A [[New Name|shown]] and [[New Name#H]] and [[Other]]');
  });

  it('builds a snippet around the mention', () => {
    const body = 'x'.repeat(200) + ' before [[Target]] after ' + 'y'.repeat(200);
    const s = snippetAround(body, 'Target');
    expect(s).toContain('[[Target]]');
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
  });

  it('rewrites only the matching targets', () => {
    const body = 'See [[Notes/Alpha#H|shown]] and [[Beta]].';
    const out = rewriteWikilinks(
      body,
      (t) => t.startsWith('Notes/'),
      () => 'Archive/Alpha'
    );
    expect(out).toBe('See [[Archive/Alpha#H|shown]] and [[Beta]].');
  });
});

describe('link target resolution', () => {
  const notes = [
    { path: 'Notes/Why local-first.md', title: 'Why local-first' },
    { path: 'Projects/Skald.md', title: 'Skald' },
    { path: 'Projects/Archive/Skald.md', title: 'Skald' },
    { path: 'Inbox.md', title: 'Scratch inbox' },
  ];
  const index = buildLinkIndex(notes);

  it('normalizes the shapes a target can be written in', () => {
    expect(normalizeLinkTarget('Notes/Why local-first.md')).toBe('notes/why local-first');
    expect(normalizeLinkTarget('/Notes/Why local-first')).toBe('notes/why local-first');
    expect(normalizeLinkTarget('./Notes//Why local-first')).toBe('notes/why local-first');
    expect(normalizeLinkTarget('  ../Notes/Why local-first  ')).toBe('notes/why local-first');
  });

  it('resolves folder-qualified targets', () => {
    expect(resolveLinkTarget(index, 'Notes/Why local-first')).toBe('Notes/Why local-first.md');
    expect(resolveLinkTarget(index, 'notes/why local-first.md')).toBe('Notes/Why local-first.md');
    expect(resolveLinkTarget(index, '/Notes/Why local-first')).toBe('Notes/Why local-first.md');
  });

  it('still resolves bare names and titles', () => {
    expect(resolveLinkTarget(index, 'Why local-first')).toBe('Notes/Why local-first.md');
    expect(resolveLinkTarget(index, 'Scratch inbox')).toBe('Inbox.md');
    expect(resolveLinkTarget(index, 'Inbox')).toBe('Inbox.md');
    expect(resolveLinkTarget(index, 'Nowhere')).toBeNull();
  });

  it('keeps same-named notes apart by folder', () => {
    expect(resolveLinkTarget(index, 'Projects/Skald')).toBe('Projects/Skald.md');
    expect(resolveLinkTarget(index, 'Projects/Archive/Skald')).toBe('Projects/Archive/Skald.md');
    expect(resolveLinkTarget(index, 'Archive/Skald')).toBe('Projects/Archive/Skald.md');
    // The bare name is ambiguous; it picks one deterministically by path order.
    expect(resolveLinkTarget(index, 'Skald')).toBe('Projects/Archive/Skald.md');
  });

  it('retargets a link while keeping the shape it was written in', () => {
    expect(retargetWikilink('Jormungandr', 'Projects/World Serpent.md')).toBe('World Serpent');
    expect(retargetWikilink('Projects/Jormungandr', 'Projects/World Serpent.md')).toBe(
      'Projects/World Serpent'
    );
    expect(retargetWikilink('/Projects/Jormungandr.md', 'Projects/World Serpent.md')).toBe(
      '/Projects/World Serpent.md'
    );
    expect(retargetWikilink('Deep/Nest/Old', 'New.md')).toBe('New');
  });
});
