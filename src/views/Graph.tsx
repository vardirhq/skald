import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode, VaultSnapshot } from '../../src-shared/types';
import { Rune, schemaTone } from '../ui/runes';
import { api } from '../api';
import { useStore, relTime } from '../store';

/** Viewport transform in CSS pixels: translate(x, y) scale(k). */
interface Viewport {
  x: number;
  y: number;
  k: number;
}

const IDENTITY: Viewport = { x: 0, y: 0, k: 1 };
const MIN_K = 0.2;
const MAX_K = 5;
const ENTER_MS = 900;
/** Room each star wants to itself, in pixels at 100%. Sets the world's size. */
const BREATHING = 132;

const clampK = (k: number): number => Math.max(MIN_K, Math.min(MAX_K, k));

export function ConstellationView({ snapshot }: { snapshot: VaultSnapshot }) {
  const openNote = useStore((s) => s.openNote);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(
    () =>
      [...snapshot.graph.nodes].sort((a, b) => b.deg - a.deg)[0]?.path ?? null
  );
  const [filter, setFilter] = useState<string>('All');
  const [showClusters, setShowClusters] = useState(true);
  const [view, setView] = useState<Viewport>(IDENTITY);
  // Nodes and edges fade in the first time the map is opened.
  const [entering, setEntering] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ path: string; moved: boolean } | null>(null);
  const pan = useRef<{ px: number; py: number; from: Viewport } | null>(null);
  // local position overrides during/after drag, until snapshot catches up
  const [localPos, setLocalPos] = useState<Record<string, { x: number; y: number }>>({});
  // The pane's own size, so the map fills it instead of letterboxing inside a
  // fixed viewBox. One viewBox unit is one CSS pixel.
  const [size, setSize] = useState({ w: 1200, h: 720 });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setEntering(false), ENTER_MS);
    return () => clearTimeout(t);
  }, []);

  const schemasPresent = useMemo(() => {
    const set = new Map<string, number>();
    for (const n of snapshot.graph.nodes) set.set(n.schema, (set.get(n.schema) ?? 0) + 1);
    return [...set.keys()];
  }, [snapshot.graph.nodes]);

  const nodes = useMemo(() => {
    const list = snapshot.graph.nodes.map((n) => ({
      ...n,
      ...(localPos[n.path] ?? {}),
    }));
    return filter === 'All' ? list : list.filter((n) => n.schema === filter);
  }, [snapshot.graph.nodes, filter, localPos]);

  const visible = useMemo(() => new Set(nodes.map((n) => n.path)), [nodes]);
  const nodeIndex = useMemo(() => new Map(nodes.map((n) => [n.path, n])), [nodes]);
  const edges = useMemo(
    () => snapshot.graph.edges.filter(([a, b]) => visible.has(a) && visible.has(b)),
    [snapshot.graph.edges, visible]
  );

  // Positions are normalized, so without this the map packs tighter as the
  // vault grows. Growing the world with the node count keeps the spacing
  // between stars constant instead.
  const world = useMemo(() => {
    const area = Math.max(nodes.length, 1) * BREATHING * BREATHING;
    const aspect = size.w / Math.max(size.h, 1);
    const h = Math.sqrt(area / aspect);
    return { w: Math.max(size.w, h * aspect), h: Math.max(size.h, h) };
  }, [nodes.length, size]);

  // What the current focus touches. Everything else fades back, which is most
  // of what turns a hairball back into a diagram.
  const near = useMemo(() => {
    const focus = hover ?? selected;
    if (!focus || !visible.has(focus)) return null;
    const set = new Set([focus]);
    for (const [a, b] of edges) {
      if (a === focus) set.add(b);
      else if (b === focus) set.add(a);
    }
    return set;
  }, [hover, selected, edges, visible]);

  // Well-connected notes arrive first, so the map draws itself outwards from its hubs.
  const enterRank = useMemo(() => {
    const ranked = [...nodes].sort((a, b) => b.deg - a.deg || a.path.localeCompare(b.path));
    return new Map(ranked.map((n, i) => [n.path, i]));
  }, [nodes]);

  // clusters: top-level folders with at least 2 visible notes
  const clusters = useMemo(() => {
    const byFolder = new Map<string, GraphNode[]>();
    for (const n of nodes) {
      if (!n.folder) continue;
      (byFolder.get(n.folder) ?? byFolder.set(n.folder, []).get(n.folder)!).push(n);
    }
    return [...byFolder.entries()].filter(([, ns]) => ns.length >= 2);
  }, [nodes]);

  const activeNode = nodeIndex.get(hover ?? selected ?? '') ?? null;

  // How well connected a note must be to keep its name at this zoom. Zoomed
  // out, only the hubs are legible anyway; zoomed in, there is room for all.
  const minLabelDeg =
    view.k >= 1.5 ? 0 : view.k >= 1 ? 2 : view.k >= 0.7 ? 4 : view.k >= 0.45 ? 8 : Infinity;

  /** Client point → viewBox units, which are just pixels within the pane. */
  const toViewBox = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return { vx: clientX - rect.left, vy: clientY - rect.top };
  }, []);

  /** Client point → normalized map coordinates, undoing zoom and pan too. */
  const toNorm = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const p = toViewBox(clientX, clientY);
      if (!p) return null;
      const x = (p.vx - view.x) / view.k / world.w;
      const y = (p.vy - view.y) / view.k / world.h;
      return { x: Math.max(0.02, Math.min(0.98, x)), y: Math.max(0.02, Math.min(0.98, y)) };
    },
    [toViewBox, view, world]
  );

  /** Keep a corner of the map on screen, so panning can never lose it entirely. */
  const clampView = useCallback(
    (v: Viewport): Viewport => {
      const edge = 140;
      return {
        k: v.k,
        x: Math.max(edge - world.w * v.k, Math.min(size.w - edge, v.x)),
        y: Math.max(edge - world.h * v.k, Math.min(size.h - edge, v.y)),
      };
    },
    [world, size]
  );

  /** Scale about a fixed point in viewBox units, so it stays under the cursor. */
  const zoomAround = useCallback(
    (factor: number, vx: number, vy: number) => {
      setView((v) => {
        const k = clampK(v.k * factor);
        if (k === v.k) return v;
        return clampView({ k, x: vx - ((vx - v.x) / v.k) * k, y: vy - ((vy - v.y) / v.k) * k });
      });
    },
    [clampView]
  );

  const zoomBy = useCallback(
    (factor: number) => zoomAround(factor, size.w / 2, size.h / 2),
    [zoomAround, size]
  );

  /** Frame every visible star with a little breathing room. */
  const fitView = useCallback(() => {
    if (!nodes.length) {
      setView(IDENTITY);
      return;
    }
    // Leave the inspector and the legend a lane of their own.
    const padX = 200;
    const padY = 110;
    const xs = nodes.map((n) => n.x * world.w);
    const ys = nodes.map((n) => n.y * world.h);
    const minX = Math.min(...xs) - padX;
    const maxX = Math.max(...xs) + padX;
    const minY = Math.min(...ys) - padY;
    const maxY = Math.max(...ys) + padY;
    const k = clampK(Math.min(size.w / (maxX - minX), size.h / (maxY - minY)));
    setView({
      k,
      x: size.w / 2 - ((minX + maxX) / 2) * k,
      y: size.h / 2 - ((minY + maxY) / 2) * k,
    });
  }, [nodes, world, size]);

  // Open framed on the whole map, and reframe when the filter changes which
  // stars are on it. Never on resize or drag — that would fight the user.
  const fitRef = useRef(fitView);
  fitRef.current = fitView;
  const lastFit = useRef<string | null>(null);
  useEffect(() => {
    if (!size.w || !nodes.length || lastFit.current === filter) return;
    lastFit.current = filter;
    fitRef.current();
  }, [filter, size.w, nodes.length]);

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toViewBox(e.clientX, e.clientY);
      if (!p) return;
      // Trackpad pinch arrives as ctrl+wheel; both gestures zoom.
      const step = Math.exp(-(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) * 0.0016);
      zoomAround(step, p.vx, p.vy);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [toViewBox, zoomAround]);

  // +/- zoom, 0 fits — plain keys, so ignore them while typing elsewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === '+' || e.key === '=') zoomBy(1.25);
      else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.25);
      else if (e.key === '0') fitView();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomBy, fitView]);

  const onPointerDown = (e: React.PointerEvent) => {
    // Anything that isn't a star pans the map.
    if (drag.current) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pan.current = { px: e.clientX, py: e.clientY, from: view };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current) {
      const p = toNorm(e.clientX, e.clientY);
      if (!p) return;
      drag.current.moved = true;
      setLocalPos((lp) => ({ ...lp, [drag.current!.path]: p }));
      return;
    }
    const panning = pan.current;
    if (!panning) return;
    setView(
      clampView({
        k: panning.from.k,
        x: panning.from.x + (e.clientX - panning.px),
        y: panning.from.y + (e.clientY - panning.py),
      })
    );
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pan.current = null;
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      const p = localPos[d.path] ?? toNorm(e.clientX, e.clientY);
      if (p) void api.setGraphPosition(d.path, p.x, p.y);
    }
  };

  return (
    <div className={'constellation' + (entering ? ' constellation--enter' : '')}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size.w} ${size.h}`}
        preserveAspectRatio="xMinYMin slice"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <defs>
          <radialGradient id="halo" r="0.5">
            <stop offset="0" stopColor="var(--ac)" stopOpacity="0.32" />
            <stop offset="1" stopColor="var(--ac)" stopOpacity="0" />
          </radialGradient>
          <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
            <path d="M44 0 H0 V44" fill="none" stroke="var(--tx-0)" strokeWidth="0.5" opacity="0.03" />
          </pattern>
        </defs>

        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* oversized so panning never runs off the paper */}
          <rect
            x={-2 * world.w}
            y={-2 * world.h}
            width={5 * world.w}
            height={5 * world.h}
            fill="url(#grid)"
          />

          {showClusters &&
            clusters.map(([name, ns]) => {
              const xs = ns.map((n) => n.x * world.w);
              const ys = ns.map((n) => n.y * world.h);
              const minX = Math.min(...xs) - 46;
              const maxX = Math.max(...xs) + 46;
              const minY = Math.min(...ys) - 34;
              const maxY = Math.max(...ys) + 40;
              return (
                <g key={name} className="cluster">
                  <rect
                    x={minX}
                    y={minY}
                    width={maxX - minX}
                    height={maxY - minY}
                    rx="18"
                    fill="none"
                    stroke="var(--ac)"
                    strokeDasharray={`2 ${7 / view.k}`}
                    strokeWidth={1 / view.k}
                    opacity="0.18"
                  />
                  {/* Anchored in the corner, not centred above: centred titles
                      collide the moment two clusters sit side by side. */}
                  <text
                    x={minX + 12 / view.k}
                    y={minY + 16 / view.k}
                    fontFamily="var(--font-mono)"
                    fontSize={11 / view.k}
                    fill="var(--tx-3)"
                    letterSpacing="0.16em"
                    opacity="0.75"
                  >
                    {name.toUpperCase()}
                  </text>
                </g>
              );
            })}

          <g className="edges">
            {edges.map(([a, b], i) => {
              const na = nodeIndex.get(a)!;
              const nb = nodeIndex.get(b)!;
              const act = [selected, hover].some((s) => s === a || s === b);
              return (
                <line
                  key={i}
                  x1={na.x * world.w}
                  y1={na.y * world.h}
                  x2={nb.x * world.w}
                  y2={nb.y * world.h}
                  stroke={act ? 'var(--ac)' : 'var(--tx-0)'}
                  strokeOpacity={act ? 0.75 : near ? 0.05 : 0.12}
                  strokeWidth={(act ? 1.3 : 0.8) / view.k}
                />
              );
            })}
          </g>

          {nodes.map((n) => {
            // Capped: an unbounded radius lets one 100-link hub swallow its
            // own neighbourhood.
            const r = 3 + Math.min(11, Math.sqrt(n.deg + 1) * 2.1);
            const act = selected === n.path || hover === n.path;
            const col = schemaTone(n.schema);
            const cx = n.x * world.w;
            const cy = n.y * world.h;
            const dim = near !== null && !near.has(n.path);
            // Only the stars that earn a name get one: hubs when zoomed out,
            // everything once you have zoomed in far enough to read them.
            const labelled = act || (near?.has(n.path) ?? false) || n.deg >= minLabelDeg;
            return (
              <g
                key={n.path}
                className="node"
                opacity={dim ? 0.22 : 1}
                style={{ animationDelay: `${Math.min((enterRank.get(n.path) ?? 0) * 16, 520)}ms` }}
                onMouseEnter={() => setHover(n.path)}
                onMouseLeave={() => setHover((h) => (h === n.path ? null : h))}
                onPointerDown={(e) => {
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  drag.current = { path: n.path, moved: false };
                }}
                onClick={() => {
                  if (drag.current?.moved) return;
                  setSelected(n.path);
                }}
                onDoubleClick={() => openNote(n.path)}
              >
                {act && <circle cx={cx} cy={cy} r={r * 4} fill="url(#halo)" />}
                <circle cx={cx} cy={cy} r={r} fill={col} stroke="var(--bg-2)" strokeWidth={2 / view.k} />
                {labelled && (
                  <text
                    // Counter-scaled: a label that shrinks with the map is
                    // unreadable at exactly the zoom where you need the map.
                    x={cx}
                    y={cy + r + 13 / view.k}
                    textAnchor="middle"
                    fontFamily="var(--font-ui)"
                    fontSize={(act ? 12.5 : 11.5) / view.k}
                    fill={act ? 'var(--tx-0)' : 'var(--tx-3)'}
                    paintOrder="stroke"
                    stroke="var(--bg-2)"
                    strokeWidth={3 / view.k}
                    strokeLinejoin="round"
                  >
                    {n.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {nodes.length === 0 && (
        <div className="constellation__empty">No stars yet — write some notes and link them.</div>
      )}

      <div className="constellation__bar">
        <button className="btn" aria-selected={filter === 'All'} onClick={() => setFilter('All')}>
          All
        </button>
        {schemasPresent.slice(0, 4).map((s) => (
          <button key={s} className="btn" aria-selected={filter === s} onClick={() => setFilter(s)}>
            {s}
          </button>
        ))}
        <span className="constellation__sep" />
        <button
          className="btn"
          aria-selected={showClusters}
          title="Show folder clusters"
          onClick={() => setShowClusters((v) => !v)}
        >
          ⬚
        </button>
        <button
          className="btn"
          title="Recompute the layout from scratch"
          onClick={() => {
            setLocalPos({});
            void api.resetGraphLayout();
          }}
        >
          ↺
        </button>
      </div>

      <div className="constellation__zoom">
        <button className="btn" title="Zoom in (+)" onClick={() => zoomBy(1.25)}>
          +
        </button>
        <span className="constellation__scale">{Math.round(view.k * 100)}%</span>
        <button className="btn" title="Zoom out (−)" onClick={() => zoomBy(1 / 1.25)}>
          −
        </button>
        <button className="btn" title="Fit the whole map (0)" onClick={fitView}>
          ⤢
        </button>
      </div>

      <div className="constellation__legend">
        <div className="ttl">Schemas</div>
        {schemasPresent.map((s) => (
          <div key={s} className="row">
            <span className="sw" style={{ color: schemaTone(s) }}>
              <Rune schema={s} size={14} />
            </span>{' '}
            {s}
          </div>
        ))}
      </div>

      {activeNode && (
        <div className="constellation__inspector">
          <div className="eyebrow">
            <span style={{ color: schemaTone(activeNode.schema), display: 'inline-flex' }}>
              <Rune schema={activeNode.schema} size={13} />
            </span>{' '}
            {activeNode.schema}
          </div>
          <div className="name">{activeNode.label}</div>
          <div className="desc">
            {snapshot.notes.find((n) => n.path === activeNode.path)?.excerpt ||
              `A ${activeNode.schema.toLowerCase()} in the vault, linked to ${activeNode.deg} other ${activeNode.deg === 1 ? 'note' : 'notes'}.`}
          </div>
          <div className="row">
            <span>links</span>
            <span className="v">{activeNode.deg}</span>
          </div>
          <div className="row">
            <span>last edit</span>
            <span className="v">{relTime(activeNode.updated)} ago</span>
          </div>
          <div className="row">
            <span>cluster</span>
            <span className="v">{activeNode.folder || '—'}</span>
          </div>
          <div className="row" style={{ borderTop: 'none', paddingTop: 8 }}>
            <button className="btn btn--accent" style={{ width: '100%', justifyContent: 'center' }} onClick={() => openNote(activeNode.path)}>
              Open note
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
