import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

export interface CtxItem {
  label: string;
  icon?: string;
  danger?: boolean;
  sep?: boolean;
  /** Muted text on the right — a count, a shortcut, a target. */
  hint?: string;
  disabled?: boolean;
  onClick?: () => void;
}

/** Drops falsy entries so menus can be built with inline conditions. */
export function ctxItems(...items: (CtxItem | false | null | undefined)[]): CtxItem[] {
  const out = items.filter((i): i is CtxItem => Boolean(i));
  // A separator is only a separator when it has something on both sides.
  return out.filter((it, i) => !it.sep || (i > 0 && i < out.length - 1 && !out[i - 1].sep));
}

export const CTX_SEP: CtxItem = { sep: true, label: '' };

export interface CtxState {
  x: number;
  y: number;
  items: CtxItem[];
}

export function useContextMenu() {
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const open = (e: React.MouseEvent, items: CtxItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, items });
  };
  const close = () => setCtx(null);
  return { ctx, open, close };
}

export function ContextMenu({ ctx, onClose }: { ctx: CtxState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: ctx.x, y: ctx.y });

  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({
        x: Math.min(ctx.x, window.innerWidth - r.width - 8),
        y: Math.min(ctx.y, window.innerHeight - r.height - 8),
      });
    }
    const down = () => onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
    };
  }, [ctx, onClose]);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {ctx.items.map((it, i) =>
        it.sep ? (
          <div key={i} className="sep" />
        ) : (
          <button
            key={i}
            className={it.danger ? 'danger' : undefined}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick?.();
            }}
          >
            {it.icon ? <Icon name={it.icon} size={14} /> : <span className="ctx-menu__gap" />}
            <span className="ctx-menu__label">{it.label}</span>
            {it.hint && <span className="ctx-menu__hint">{it.hint}</span>}
          </button>
        )
      )}
    </div>
  );
}
