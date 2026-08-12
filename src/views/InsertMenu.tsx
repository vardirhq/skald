import { useEffect, useMemo, useRef, useState } from 'react';
import type { InsertCategory, InsertMenuItem } from '../editor/insertions';
import { matchesInsertion } from '../editor/insertions';

const categories: InsertCategory[] = ['Text', 'Lists', 'Blocks', 'Extensions'];

export function InsertMenu({
  items,
  onInsert,
  onClose,
}: {
  items: readonly InsertMenuItem[];
  onInsert: (item: InsertMenuItem) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => items.filter((item) => matchesInsertion(item, query)), [items, query]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setSelected(0), [query]);

  const choose = (item: InsertMenuItem | undefined) => {
    if (!item) return;
    onInsert(item);
    onClose();
  };

  return (
    <div className="switcher-scrim" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="insert-menu" role="dialog" aria-modal="true" aria-label="Insert">
        <div className="switcher__bar">
          <span className="insert-menu__plus" aria-hidden="true">+</span>
          <input
            ref={inputRef}
            value={query}
            placeholder="Insert heading, task, diagram…"
            aria-label="Search things to insert"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelected((index) => Math.max(0, Math.min(visible.length - 1, index + 1)));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelected((index) => Math.max(0, index - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(visible[selected]);
              }
            }}
          />
          <span className="keys"><span className="kbd">esc</span></span>
        </div>
        <div className="insert-menu__list" role="listbox">
          {categories.map((category) => {
            const entries = visible.filter((item) => item.category === category);
            if (entries.length === 0) return null;
            return (
              <div key={category}>
                <div className="switcher__group">{category}</div>
                {entries.map((item) => {
                  const index = visible.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      className="insert-menu__row"
                      role="option"
                      aria-selected={index === selected}
                      onMouseMove={() => setSelected(index)}
                      onClick={() => choose(item)}
                    >
                      <span className="insert-menu__glyph" aria-hidden="true">{glyph(item.id)}</span>
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.description}</small>
                      </span>
                      <code>{preview(item.markdown)}</code>
                    </button>
                  );
                })}
              </div>
            );
          })}
          {visible.length === 0 && <div className="switcher__empty">No insertions match “{query}”.</div>}
        </div>
        <div className="switcher__foot">
          <span className="group"><span className="kbd">↑↓</span> move</span>
          <span className="group"><span className="kbd">↵</span> insert</span>
          <span style={{ marginLeft: 'auto' }}>Markdown stays portable</span>
        </div>
      </div>
    </div>
  );
}

function preview(markdown: string): string {
  return markdown.split('\n')[0].slice(0, 28);
}

function glyph(id: string): string {
  if (id.includes('heading')) return 'H';
  if (id.includes('task')) return '☐';
  if (id.includes('list')) return '≡';
  if (id.includes('link')) return '↗';
  if (id.includes('table')) return '▦';
  if (id.includes('diagram')) return '◇';
  if (id.includes('github')) return '⌁';
  if (id.includes('code')) return '</>';
  if (id.includes('quote') || id.includes('callout')) return '❯';
  return '+';
}
