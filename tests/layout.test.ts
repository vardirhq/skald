import { describe, it, expect } from 'vitest';
import { layoutGraph } from '../src-main/layout';

function centroid(points: { x: number; y: number }[]) {
  const x = points.reduce((a, p) => a + p.x, 0) / points.length;
  const y = points.reduce((a, p) => a + p.y, 0) / points.length;
  return { x, y };
}

function spread(points: { x: number; y: number }[]) {
  const c = centroid(points);
  return Math.max(...points.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe('graph layout', () => {
  const notes = ['Notes/a.md', 'Notes/b.md', 'Notes/c.md', 'Projects/x.md', 'Projects/y.md', 'Projects/z.md'];
  const folders = Object.fromEntries(notes.map((p) => [p, p.split('/')[0]]));

  it('keeps every position on the map', () => {
    const pos = layoutGraph(notes, [], {}, folders);
    expect(Object.keys(pos)).toHaveLength(notes.length);
    for (const p of Object.values(pos)) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(1);
    }
  });

  it('gathers each folder into its own cluster', () => {
    const pos = layoutGraph(notes, [], {}, folders);
    const inNotes = notes.filter((p) => folders[p] === 'Notes').map((p) => pos[p]);
    const inProjects = notes.filter((p) => folders[p] === 'Projects').map((p) => pos[p]);

    const apart = dist(centroid(inNotes), centroid(inProjects));
    expect(apart).toBeGreaterThan(spread(inNotes));
    expect(apart).toBeGreaterThan(spread(inProjects));
  });

  it('is deterministic and leaves stored positions untouched', () => {
    const stored = { 'Notes/a.md': { x: 0.11, y: 0.12 } };
    const first = layoutGraph(notes, [['Notes/a.md', 'Projects/x.md']], stored, folders);
    const second = layoutGraph(notes, [['Notes/a.md', 'Projects/x.md']], stored, folders);
    expect(first).toEqual(second);
    expect(first['Notes/a.md']).toEqual({ x: 0.11, y: 0.12 });
  });

  it('still lays out without folder information', () => {
    const pos = layoutGraph(['a.md', 'b.md'], [['a.md', 'b.md']], {});
    expect(pos['a.md'].x).toBeGreaterThan(0);
    expect(dist(pos['a.md'], pos['b.md'])).toBeGreaterThan(0);
  });
});
