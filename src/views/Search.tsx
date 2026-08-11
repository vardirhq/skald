import { useEffect, useRef, useState } from 'react';
import type { SearchResult, VaultSnapshot } from '../../src-shared/types';
import { api } from '../api';
import { useStore } from '../store';
import { Rune, schemaTone } from '../ui/runes';
import { TextDialog } from '../ui/dialogs';

export function SearchView({ snapshot }: { snapshot: VaultSnapshot }) {
  const query = useStore((state) => state.searchQuery);
  const setQuery = useStore((state) => state.setSearchQuery);
  const openNoteAt = useStore((state) => state.openNoteAt);
  const showToast = useStore((state) => state.showToast);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const request = useRef(0);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const id = ++request.current;
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      void api.search(query).then((items) => {
        if (id !== request.current) return;
        setResults(items);
        setSelected(0);
        setLoading(false);
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [query]);

  const open = (result: SearchResult) =>
    openNoteAt(result.path, result.line, result.column, result.length);
  const active = results[selected];

  return (
    <div className="search-view">
      <div className="search-view__head">
        <div>
          <div className="eyebrow">Full-text search</div>
          <h1>Search the vault</h1>
        </div>
        <button className="btn btn--ghost" disabled={!query.trim()} onClick={() => setSaving(true)}>
          Save search
        </button>
      </div>
      <div className="search-view__input">
        <span aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Words in any note…  schema:Project tag:work folder:Projects"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              setSelected((index) => Math.min(results.length - 1, index + 1));
              event.preventDefault();
            } else if (event.key === 'ArrowUp') {
              setSelected((index) => Math.max(0, index - 1));
              event.preventDefault();
            } else if (event.key === 'Enter' && active) open(active);
          }}
        />
        <span className="search-view__count">{loading ? 'searching…' : `${results.length} results`}</span>
      </div>
      <div className="search-view__help">
        Filters: <code>schema:Project</code> <code>tag:work</code> <code>folder:Projects</code> · quote exact phrases
      </div>
      <div className="search-results">
        {results.map((result, index) => (
          <button
            key={result.path}
            className="search-result"
            aria-selected={index === selected}
            onMouseEnter={() => setSelected(index)}
            onClick={() => open(result)}
          >
            <span className="search-result__rune" style={{ color: schemaTone(result.schema) }}>
              <Rune schema={result.schema} size={17} />
            </span>
            <span className="search-result__content">
              <strong>{result.title}</strong>
              <span>{result.snippet}</span>
              <small>
                {result.path} · line {result.line}
                {result.tags.length ? ` · ${result.tags.map((tag) => `#${tag}`).join(' ')}` : ''}
              </small>
            </span>
          </button>
        ))}
        {!loading && query.trim() && !results.length && (
          <div className="search-view__empty">No note bodies matched this query.</div>
        )}
        {!query.trim() && (
          <div className="search-view__empty">Searches include complete note bodies, titles, paths, schemas, and tags.</div>
        )}
      </div>

      {saving && (
        <TextDialog
          title="Save search"
          lede={`Pin “${query}” in the search sidebar.`}
          label="Name"
          initial={query}
          submitLabel="Save"
          onSubmit={async (name) => {
            const savedSearches = [
              ...snapshot.settings.savedSearches,
              { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name, query },
            ];
            await api.setSettings({ savedSearches });
            showToast('Search saved');
          }}
          onClose={() => setSaving(false)}
        />
      )}
    </div>
  );
}
