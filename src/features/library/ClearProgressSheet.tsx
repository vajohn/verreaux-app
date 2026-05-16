import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../ui/Button';
import { useEscape } from '../../lib/useEscape';
import { useLibraryStore } from './library.store';
import { db } from '../../db/db';
import {
  clearSeriesProgress,
  getProgressForProfile,
} from '../../db/repos/progress.repo';
import type { Series } from '../../db/types';

interface ProgressEntry {
  series: Series;
  readChapters: number;
}

interface ClearProgressSheetProps {
  onClose: () => void;
}

export function ClearProgressSheet({ onClose }: ClearProgressSheetProps) {
  const profileId = useLibraryStore((s) => s.activeProfileId);
  const loadLibrary = useLibraryStore((s) => s.loadLibrary);

  const [entries, setEntries] = useState<ProgressEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [working, setWorking] = useState(false);

  const handleEscape = useCallback(() => {
    if (working) return;
    if (confirm) { setConfirm(false); return; }
    onClose();
  }, [confirm, working, onClose]);

  useEscape(handleEscape);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      const records = await getProgressForProfile(profileId);
      const out: ProgressEntry[] = [];
      for (const rec of records) {
        const series = await db.series.get(rec.seriesId);
        if (!series) continue;
        const cur = await db.chapters.get(rec.currentChapterId);
        if (!cur) continue;
        const readChapters = await db.chapters
          .where('[seriesId+order]')
          .between([cur.seriesId, -Infinity], [cur.seriesId, cur.order], true, true)
          .count();
        if (readChapters > 0) out.push({ series, readChapters });
      }
      out.sort((a, b) => a.series.title.localeCompare(b.series.title));
      if (cancelled) return;
      setEntries(out);
      setSelected(new Set(out.map((e) => e.series.id)));
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const allSelected = useMemo(
    () => entries.length > 0 && selected.size === entries.length,
    [entries, selected],
  );

  function toggleAll(): void {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(entries.map((e) => e.series.id)));
    }
  }

  function toggleOne(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleProceed(): Promise<void> {
    if (selected.size === 0) return;
    setWorking(true);
    const ids = Array.from(selected);
    for (const id of ids) {
      await clearSeriesProgress(profileId, id);
    }
    await loadLibrary();
    setWorking(false);
    setConfirm(false);
    onClose();
  }

  return (
    <div className="confirm-sheet" role="dialog" aria-modal="true">
      <div className="confirm-sheet__inner">
        <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
          Clear Read Chapters
        </div>

        {loading && <div className="type-body">Loading…</div>}

        {!loading && entries.length === 0 && (
          <div className="type-body" style={{ color: 'var(--color-text-muted)' }}>
            No series have read chapters to clear.
          </div>
        )}

        {!loading && entries.length > 0 && (
          <>
            <div
              className="type-nav-label"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Selected series will have their reading progress reset.
              Chapters and bookmarks are kept.
            </div>

            <label className="clear-progress-row" style={selectAllRowStyle}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select all"
              />
              <span className="type-body" style={{ flex: 1 }}>
                Select all
              </span>
              <span
                className="type-nav-label"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {selected.size} / {entries.length}
              </span>
            </label>

            <div style={listStyle}>
              {entries.map((e) => {
                const checked = selected.has(e.series.id);
                return (
                  <label
                    key={e.series.id}
                    className="clear-progress-row"
                    style={rowStyle}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(e.series.id)}
                      aria-label={`Select ${e.series.title}`}
                    />
                    <span
                      className="type-body"
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {e.series.title}
                    </span>
                    <span
                      className="type-nav-label"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {e.readChapters} read
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        <div className="confirm-sheet__actions">
          <Button variant="ghost" onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (selected.size === 0) return;
              setConfirm(true);
            }}
            disabled={loading || working || selected.size === 0}
          >
            Proceed
          </Button>
        </div>
      </div>

      {confirm && (
        <div className="confirm-sheet" role="dialog" aria-modal="true">
          <div className="confirm-sheet__inner">
            <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
              Confirm clear
            </div>
            <div className="type-body">
              Reset reading progress for {selected.size} series? This cannot be
              undone.
            </div>
            <div className="confirm-sheet__actions">
              <Button
                variant="ghost"
                onClick={() => setConfirm(false)}
                disabled={working}
              >
                Cancel
              </Button>
              <Button onClick={() => void handleProceed()} disabled={working}>
                {working ? 'Clearing…' : 'Proceed'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const selectAllRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '40vh',
  overflowY: 'auto',
  border: '1px solid var(--color-border)',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px',
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
};
