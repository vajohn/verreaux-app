import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../ui/Button';
import { ProgressBar } from '../../ui/ProgressBar';
import { useEscape } from '../../lib/useEscape';
import { useLibraryStore } from './library.store';
import { db } from '../../db/db';
import {
  clearSeriesProgress,
  getProgressForProfile,
} from '../../db/repos/progress.repo';
import { deleteReadChapters, type DeleteProgress } from '../../db/repos/series.repo';
import { formatBytes } from '../../lib/formatBytes';
import type { Series } from '../../db/types';

type Mode = 'reset' | 'delete';

interface SeriesProgress {
  seriesIndex: number; // 1-based
  totalSeries: number;
  seriesTitle: string;
  inner: DeleteProgress | null;
}

function progressLabel(sp: SeriesProgress, isDestructive: boolean): string {
  const head = `${isDestructive ? 'Deleting' : 'Resetting'} ${sp.seriesIndex} / ${sp.totalSeries}: ${sp.seriesTitle}`;
  if (!sp.inner) return head;
  if (sp.inner.phase === 'preparing') return `${head} — preparing…`;
  if (sp.inner.phase === 'finalizing') return `${head} — finalizing…`;
  if (sp.inner.total === 0) return `${head} — cleaning up…`;
  return `${head} — ${sp.inner.done} / ${sp.inner.total} pages`;
}

interface ProgressEntry {
  series: Series;
  readChapters: number;
  bytesFreeable: number;
}

interface ClearProgressSheetProps {
  onClose: () => void;
}

export function ClearProgressSheet({ onClose }: ClearProgressSheetProps) {
  const profileId = useLibraryStore((s) => s.activeProfileId);
  const loadLibrary = useLibraryStore((s) => s.loadLibrary);
  const refreshStorageUsed = useLibraryStore((s) => s.refreshStorageUsed);

  const [mode, setMode] = useState<Mode>('reset');
  const [entries, setEntries] = useState<ProgressEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [working, setWorking] = useState(false);
  const [seriesProgress, setSeriesProgress] = useState<SeriesProgress | null>(null);

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
        const readList = await db.chapters
          .where('[seriesId+order]')
          .between([cur.seriesId, -Infinity], [cur.seriesId, cur.order], true, true)
          .toArray();
        if (readList.length === 0) continue;
        const readIds = readList.map((c) => c.id);
        const pages = await db.pages.where('chapterId').anyOf(readIds).toArray();
        let bytesFreeable = 0;
        for (const p of pages) {
          const b = await db.blobs.get(p.blobId);
          if (b) bytesFreeable += b.blob.size;
        }
        out.push({ series, readChapters: readList.length, bytesFreeable });
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

  const totalBytes = useMemo(() => {
    let n = 0;
    for (const e of entries) if (selected.has(e.series.id)) n += e.bytesFreeable;
    return n;
  }, [entries, selected]);

  const totalChapters = useMemo(() => {
    let n = 0;
    for (const e of entries) if (selected.has(e.series.id)) n += e.readChapters;
    return n;
  }, [entries, selected]);

  function toggleAll(): void {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(entries.map((e) => e.series.id)));
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
    const total = ids.length;
    const titleById = new Map(entries.map((e) => [e.series.id, e.series.title] as const));
    try {
      for (let i = 0; i < ids.length; i += 1) {
        const id = ids[i];
        const title = titleById.get(id) ?? 'series';
        setSeriesProgress({
          seriesIndex: i + 1,
          totalSeries: total,
          seriesTitle: title,
          inner: null,
        });
        if (mode === 'delete') {
          await deleteReadChapters(profileId, id, (p) =>
            setSeriesProgress({
              seriesIndex: i + 1,
              totalSeries: total,
              seriesTitle: title,
              inner: p,
            }),
          );
        } else {
          await clearSeriesProgress(profileId, id);
        }
      }
      await loadLibrary();
      await refreshStorageUsed();
    } finally {
      setSeriesProgress(null);
      setWorking(false);
      setConfirm(false);
      onClose();
    }
  }

  const isDestructive = mode === 'delete';
  const proceedLabel = isDestructive ? 'Delete…' : 'Reset…';

  return (
    <div className="confirm-sheet" role="dialog" aria-modal="true">
      <div className="confirm-sheet__inner">
        <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
          Clear Read Chapters
        </div>

        <div className="cp-mode-row">
          <button
            type="button"
            className={`settings-toggle type-button${mode === 'reset' ? ' settings-toggle--on' : ''}`}
            onClick={() => setMode('reset')}
            aria-pressed={mode === 'reset'}
          >
            Reset progress
          </button>
          <button
            type="button"
            className={`settings-toggle type-button${mode === 'delete' ? ' settings-toggle--gold' : ''}`}
            onClick={() => setMode('delete')}
            aria-pressed={mode === 'delete'}
          >
            Delete chapter data
          </button>
        </div>

        <div className="type-nav-label" style={{ color: 'var(--color-text-muted)' }}>
          {isDestructive
            ? 'Destructive: pages and bookmarks for read chapters are deleted. Re-import to recover. Frees storage.'
            : 'Resets reading progress only. Chapters and bookmarks are kept. Storage unchanged.'}
        </div>

        {loading && <div className="type-body">Loading…</div>}

        {!loading && entries.length === 0 && (
          <div className="type-body" style={{ color: 'var(--color-text-muted)' }}>
            No series have read chapters.
          </div>
        )}

        {!loading && entries.length > 0 && (
          <>
            <label className="clear-progress-row" style={selectAllRowStyle}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select all"
              />
              <span className="type-body" style={{ flex: 1 }}>Select all</span>
              <span className="type-nav-label" style={{ color: 'var(--color-text-muted)' }}>
                {selected.size} / {entries.length}
              </span>
            </label>

            <div style={listStyle}>
              {entries.map((e) => {
                const checked = selected.has(e.series.id);
                return (
                  <label key={e.series.id} className="clear-progress-row" style={rowStyle}>
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
                    <span className="type-nav-label" style={{ color: 'var(--color-text-muted)' }}>
                      {e.readChapters} read
                      {isDestructive && ` · ${formatBytes(e.bytesFreeable)}`}
                    </span>
                  </label>
                );
              })}
            </div>

            {isDestructive && (
              <div className="type-nav-label" style={{ color: 'var(--color-gold)' }}>
                About {formatBytes(totalBytes)} will be freed across {totalChapters} chapter
                {totalChapters === 1 ? '' : 's'}.
              </div>
            )}
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
            {proceedLabel}
          </Button>
        </div>
      </div>

      {confirm && (
        <div className="confirm-sheet" role="dialog" aria-modal="true">
          <div className="confirm-sheet__inner">
            <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
              {isDestructive ? 'Confirm delete' : 'Confirm reset'}
            </div>
            <div className="type-body">
              {isDestructive
                ? `Permanently delete ${totalChapters} read chapter${totalChapters === 1 ? '' : 's'} across ${selected.size} series, freeing about ${formatBytes(totalBytes)}? This cannot be undone.`
                : `Reset reading progress for ${selected.size} series? This cannot be undone.`}
            </div>
            {seriesProgress && (
              <div style={{ marginTop: 8 }}>
                <div
                  className="type-nav-label"
                  style={{
                    color: 'var(--color-text-muted)',
                    marginBottom: 4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {progressLabel(seriesProgress, isDestructive)}
                </div>
                <ProgressBar
                  value={(() => {
                    const outer = (seriesProgress.seriesIndex - 1) / seriesProgress.totalSeries;
                    const inner =
                      seriesProgress.inner && seriesProgress.inner.total > 0
                        ? seriesProgress.inner.done / seriesProgress.inner.total
                        : seriesProgress.inner?.phase === 'finalizing'
                          ? 1
                          : 0;
                    return outer + inner / seriesProgress.totalSeries;
                  })()}
                />
              </div>
            )}
            <div className="confirm-sheet__actions">
              <Button variant="ghost" onClick={() => setConfirm(false)} disabled={working}>
                Cancel
              </Button>
              <Button onClick={() => void handleProceed()} disabled={working}>
                {working ? (isDestructive ? 'Deleting…' : 'Resetting…') : (isDestructive ? 'Delete' : 'Reset')}
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
