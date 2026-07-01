import { useEffect, useState } from 'react';
import {
  listSearchSources,
  searchSeries,
  type SearchSourceInfo,
  type SeriesSearchHit,
} from '../sync/piClient';
import { getEnabledSources } from './searchSources';
import { Button } from '../../ui/Button';
import './SearchSheet.css';

interface SearchSheetProps {
  onClose: () => void;
  onSelect: (seriesUrl: string) => void;
}

export function SearchSheet({ onClose, onSelect }: SearchSheetProps) {
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState<SearchSourceInfo[]>([]);
  const [results, setResults] = useState<SeriesSearchHit[]>([]);
  const [errors, setErrors] = useState<Array<{ adapterId: string; error: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    listSearchSources()
      .then((all) => setSources(all.filter((s) => s.searchable)))
      .catch(() => {
        // Leave sources empty; search will proceed with no source filter
      });
  }, []);

  async function handleSearch(): Promise<void> {
    if (loading) return;
    setLoading(true);
    setError('');
    setSearched(false);
    try {
      const enabled = getEnabledSources(sources.map((s) => s.id));
      const r = await searchSeries(query.trim(), enabled);
      setResults(r.results);
      setErrors(r.errors);
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      void handleSearch();
    }
  }

  function sourceNameFor(adapterId: string): string {
    return sources.find((s) => s.id === adapterId)?.name ?? adapterId;
  }

  return (
    <div className="confirm-sheet" role="dialog" aria-modal="true">
      <div className="confirm-sheet__inner">
        <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
          Search sources
        </div>

        <div className="search-sheet__row">
          <input
            className="series-title-input type-body search-sheet__input"
            type="search"
            placeholder="Search sources…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            autoFocus
          />
          <Button
            onClick={() => void handleSearch()}
            disabled={loading || query.trim().length < 2}
          >
            {loading ? 'Searching…' : 'Search'}
          </Button>
        </div>

        {error && (
          <div className="type-body search-sheet__error">
            {error}
          </div>
        )}

        {errors.length > 0 && (
          <div className="type-body search-sheet__partial-errors">
            {errors.map((e) => (
              <div key={e.adapterId} className="search-sheet__partial-error">
                {sourceNameFor(e.adapterId)}: unavailable
              </div>
            ))}
          </div>
        )}

        {searched && results.length === 0 && !error && (
          <div className="type-body search-sheet__empty">
            No results
          </div>
        )}

        {results.length > 0 && (
          <div className="search-sheet__results">
            {results.map((hit, i) => (
              <button
                key={`${hit.adapterId}-${hit.seriesUrl}-${i}`}
                className="search-sheet__result-row"
                onClick={() => onSelect(hit.seriesUrl)}
                type="button"
              >
                <span className="search-sheet__result-title type-body">{hit.title}</span>
                <span className="search-sheet__result-badge type-body">
                  {sourceNameFor(hit.adapterId)}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="confirm-sheet__actions">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
