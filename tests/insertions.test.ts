import { describe, expect, it } from 'vitest';
import { applyInsertion, coreInsertions, extensionInsertions, matchesInsertion } from '../src/editor/insertions';

describe('editor insertions', () => {
  it('wraps a selection with an inline insertion', () => {
    const bold = coreInsertions.find((item) => item.id === 'core.bold')!;
    expect(applyInsertion('Make this clear', { start: 5, end: 9 }, bold)).toEqual({
      text: 'Make **this** clear',
      start: 13,
      end: 13,
    });
  });

  it('selects placeholder text when there is no selection', () => {
    const heading = coreInsertions.find((item) => item.id === 'core.heading')!;
    expect(applyInsertion('', { start: 0, end: 0 }, heading)).toEqual({
      text: '## Heading\n',
      start: 3,
      end: 10,
    });
  });

  it('keeps block insertions separated from surrounding prose', () => {
    const task = coreInsertions.find((item) => item.id === 'core.task')!;
    expect(applyInsertion('BeforeAfter', { start: 6, end: 6 }, task).text).toBe(
      'Before\n\n- [ ] Task\n\nAfter'
    );
  });

  it('offers the v1 semantic containers in their own category', () => {
    const containers = coreInsertions.filter((item) => item.category === 'Containers');
    expect(containers.map((item) => item.id)).toEqual(['core.aside', 'core.gallery', 'core.group']);
  });

  it('wraps selected Markdown in an aside without rewriting the selected blocks', () => {
    const aside = coreInsertions.find((item) => item.id === 'core.aside')!;
    const selected = '## Context\n\n- First\n- Second';
    const result = applyInsertion(selected, { start: 0, end: selected.length }, aside);
    expect(result.text).toBe(':::aside\n\n## Context\n\n- First\n- Second\n\n:::\n');
  });

  it('turns every extension contribution into a searchable menu item', () => {
    const [item] = extensionInsertions([{
      id: 'demo.card',
      label: '+ card',
      menuLabel: 'Demo card',
      title: 'Insert a demo card',
      keywords: ['widget'],
      markdown: '> [!demo]\n',
    }]);
    expect(item.category).toBe('Extensions');
    expect(item.extension?.id).toBe('demo.card');
    expect(matchesInsertion(item, 'widget card')).toBe(true);
    expect(matchesInsertion(item, 'diagram')).toBe(false);
  });
});
