// Stable graph layout. Positions are normalized to [0.05, 0.95] and persisted,
// so the constellation is a place you return to, not a simulation that
// re-renders on every open. Only nodes without a stored position are laid out;
// stored nodes act as fixed anchors.
//
// Notes carry their top-level folder as a group. Each group gets a home on the
// map and pulls its members towards it, so a fresh layout reads as folders
// rather than as one undifferentiated cloud.

export interface LayoutNode {
  id: string;
  group: string;
  fixed: boolean;
  x: number;
  y: number;
}

/** Deterministic hash → [0,1) */
function hash01(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Home position for a group, spread around the map on a ring so folders start
 * apart from each other. The vault root sits in the middle.
 */
function groupHome(group: string, ordinal: number, total: number): { x: number; y: number } {
  if (!group) return { x: 0.5, y: 0.5 };
  const spread = Math.max(1, total);
  const angle = (ordinal / spread) * Math.PI * 2 + hash01(group, 977) * 0.4;
  const radius = total <= 1 ? 0 : 0.26 + 0.06 * hash01(group, 41);
  return { x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius * 0.86 };
}

export function layoutGraph(
  ids: string[],
  edges: [string, string][],
  stored: Record<string, { x: number; y: number }>,
  groups: Record<string, string> = {}
): Record<string, { x: number; y: number }> {
  const groupNames = [...new Set(ids.map((id) => groups[id] ?? ''))].filter(Boolean).sort();
  const homes = new Map<string, { x: number; y: number }>();
  for (const [i, name] of groupNames.entries()) {
    homes.set(name, groupHome(name, i, groupNames.length));
  }

  const nodes: LayoutNode[] = ids.map((id) => {
    const group = groups[id] ?? '';
    const p = stored[id];
    if (p && isFinite(p.x) && isFinite(p.y)) {
      return { id, group, fixed: true, x: clamp01(p.x), y: clamp01(p.y) };
    }
    // Seed inside the group's neighbourhood; the simulation refines from there.
    const home = homes.get(group) ?? { x: 0.5, y: 0.5 };
    const scatter = homes.size ? 0.11 : 0.35;
    return {
      id,
      group,
      fixed: false,
      x: clamp01(home.x + (hash01(id, 7) - 0.5) * 2 * scatter),
      y: clamp01(home.y + (hash01(id, 131) - 0.5) * 2 * scatter),
    };
  });

  const hasNew = nodes.some((n) => !n.fixed);
  if (!hasNew) return positionsOf(nodes);

  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const adj: [number, number][] = [];
  for (const [a, b] of edges) {
    const ia = index.get(a);
    const ib = index.get(b);
    if (ia !== undefined && ib !== undefined && ia !== ib) adj.push([ia, ib]);
  }

  // Small force simulation; fixed nodes do not move.
  const ITER = 160;
  const REPULSE = 0.0035;
  const SPRING = 0.02;
  const REST = 0.16;
  const GROUP_PULL = 0.022;
  const CROSS_GROUP_PUSH = 1.6;
  for (let it = 0; it < ITER; it++) {
    const cool = 1 - it / ITER;
    const fx = new Array(nodes.length).fill(0);
    const fy = new Array(nodes.length).fill(0);

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[i].x - nodes[j].x;
        let dy = nodes[i].y - nodes[j].y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-6) {
          dx = (hash01(nodes[i].id + nodes[j].id, it) - 0.5) * 0.01;
          dy = (hash01(nodes[j].id + nodes[i].id, it) - 0.5) * 0.01;
          d2 = dx * dx + dy * dy + 1e-6;
        }
        const apart = nodes[i].group !== nodes[j].group ? CROSS_GROUP_PUSH : 1;
        const f = (REPULSE * apart) / d2;
        const d = Math.sqrt(d2);
        fx[i] += (dx / d) * f;
        fy[i] += (dy / d) * f;
        fx[j] -= (dx / d) * f;
        fy[j] -= (dy / d) * f;
      }
    }

    for (const [ia, ib] of adj) {
      const dx = nodes[ib].x - nodes[ia].x;
      const dy = nodes[ib].y - nodes[ia].y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-4;
      const f = SPRING * (d - REST);
      fx[ia] += (dx / d) * f;
      fy[ia] += (dy / d) * f;
      fx[ib] -= (dx / d) * f;
      fy[ib] -= (dy / d) * f;
    }

    // Folder cohesion: every note drifts towards the middle of its own folder.
    const centroids = new Map<string, { x: number; y: number; n: number }>();
    for (const n of nodes) {
      if (!n.group) continue;
      const c = centroids.get(n.group) ?? { x: 0, y: 0, n: 0 };
      c.x += n.x;
      c.y += n.y;
      c.n++;
      centroids.set(n.group, c);
    }
    for (let i = 0; i < nodes.length; i++) {
      const c = nodes[i].fixed ? undefined : centroids.get(nodes[i].group);
      if (!c || c.n < 2) continue;
      fx[i] += (c.x / c.n - nodes[i].x) * GROUP_PULL;
      fy[i] += (c.y / c.n - nodes[i].y) * GROUP_PULL;
    }

    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].fixed) continue;
      // gentle pull to center to keep strays on the map
      fx[i] += (0.5 - nodes[i].x) * 0.004;
      fy[i] += (0.5 - nodes[i].y) * 0.004;
      nodes[i].x = clamp01(nodes[i].x + Math.max(-0.03, Math.min(0.03, fx[i])) * cool);
      nodes[i].y = clamp01(nodes[i].y + Math.max(-0.03, Math.min(0.03, fy[i])) * cool);
    }
  }

  return positionsOf(nodes);
}

function clamp01(v: number): number {
  return Math.max(0.03, Math.min(0.97, v));
}

function positionsOf(nodes: LayoutNode[]): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) out[n.id] = { x: n.x, y: n.y };
  return out;
}
