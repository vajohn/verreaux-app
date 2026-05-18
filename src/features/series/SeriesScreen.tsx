import { useCallback, useEffect, useRef, useState } from 'react';
import { useSeriesStore } from './series.store';
import { useLibraryStore } from '../library/library.store';
import { CoverImage } from '../library/CoverImage';
import { ProgressBar } from '../../ui/ProgressBar';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { ImportZone } from '../library/ImportZone';
import { navigate } from '../../app/router';
import { useEscape } from '../../lib/useEscape';
import { db } from '../../db/db';
import {
  deleteSeries,
  updateSeriesTitle,
  setCoverBlobOverride,
  previewReadChaptersToDelete,
  deleteReadChapters,
  type DeleteReadChaptersResult,
} from '../../db/repos/series.repo';
import { updateChapterTitle } from '../../db/repos/chapters.repo';
import { upsertProgress, getProgress, clearSeriesProgress } from '../../db/repos/progress.repo';
import { addBlob } from '../../db/repos/blobs.repo';
import { sniffImageType } from './imageSniff';
import { useSeriesProgress } from '../library/useSeriesProgress';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { formatBytes } from '../../lib/formatBytes';
import type { Chapter } from '../../db/types';
import './SeriesScreen.css';

interface SeriesScreenProps {
  seriesId: string;
}

type OverflowTarget = { kind: 'series' } | { kind: 'chapter'; chapter: Chapter };

export function SeriesScreen({ seriesId }: SeriesScreenProps) {
  const profileId = useLibraryStore((s) => s.activeProfileId);
  const currentSeries = useSeriesStore((s) => s.currentSeries);
  const chapters = useSeriesStore((s) => s.chapters);
  const loadSeries = useSeriesStore((s) => s.loadSeries);
  const newChapterIds = useSeriesStore((s) => s.newChapterIds);
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const [manuallyReadIds, setManuallyReadIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClearProgress, setConfirmClearProgress] = useState(false);
  const [deleteReadPreview, setDeleteReadPreview] =
    useState<DeleteReadChaptersResult | null>(null);
  const [deleteReadWorking, setDeleteReadWorking] = useState(false);
  const loadLibrary = useLibraryStore((s) => s.loadLibrary);
  const refreshStorageUsed = useLibraryStore((s) => s.refreshStorageUsed);

  // Overflow sheet state
  const [overflowTarget, setOverflowTarget] = useState<OverflowTarget | null>(null);

  // Title editing
  const [editingTitle, setEditingTitle] = useState<{ kind: 'series' | 'chapter'; id: string; value: string } | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  // Cover editing (URL or device file)
  const [coverUrlSheet, setCoverUrlSheet] = useState(false);
  const [coverUrlInput, setCoverUrlInput] = useState('');
  const [coverUrlStatus, setCoverUrlStatus] = useState<'idle' | 'fetching' | 'error' | 'offline'>('idle');
  const [coverUrlError, setCoverUrlError] = useState('');
  const coverFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void loadSeries(seriesId);
  }, [seriesId, loadSeries]);

  useEffect(() => {
    if (currentSeries) {
      document.title = `Verreaux — ${currentSeries.title}`;
    }
  }, [currentSeries]);

  useEffect(() => {
    let cancelled = false;
    async function loadProgress(): Promise<void> {
      const rec = await db.readingProgress
        .where('[profileId+seriesId]')
        .equals([profileId, seriesId])
        .first();
      if (!cancelled) setCurrentChapterId(rec?.currentChapterId ?? null);
    }
    void loadProgress();
    return () => {
      cancelled = true;
    };
  }, [profileId, seriesId]);

  // Determine manually marked chapters (those that are manuallyMarked in progress).
  useEffect(() => {
    let cancelled = false;
    async function loadManuallyRead(): Promise<void> {
      const rec = await getProgress(profileId, seriesId);
      if (cancelled) return;
      if (rec?.manuallyMarked && rec.currentChapterId) {
        setManuallyReadIds(new Set([rec.currentChapterId]));
      } else {
        setManuallyReadIds(new Set());
      }
    }
    void loadManuallyRead();
    return () => { cancelled = true; };
  }, [profileId, seriesId]);

  const seriesProgress = useSeriesProgress(
    profileId,
    seriesId,
    currentSeries?.chapterCount ?? 0,
    currentSeries?.lastReadAt ?? null,
  );

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  const handleEscape = useCallback(() => {
    if (deleteReadWorking) return;
    if (confirmDelete) { setConfirmDelete(false); return; }
    if (confirmClearProgress) { setConfirmClearProgress(false); return; }
    if (deleteReadPreview) { setDeleteReadPreview(null); return; }
    if (editingTitle) { setEditingTitle(null); return; }
    if (coverUrlSheet) { setCoverUrlSheet(false); setCoverUrlStatus('idle'); return; }
    if (overflowTarget) { setOverflowTarget(null); }
  }, [confirmDelete, confirmClearProgress, deleteReadPreview, deleteReadWorking, editingTitle, coverUrlSheet, overflowTarget]);

  useEscape(handleEscape);

  if (!currentSeries) {
    return (
      <div className="screen-root" style={{ padding: 24 }}>
        <div className="type-body">Loading series…</div>
      </div>
    );
  }

  const blobId = currentSeries.coverBlobId ?? currentSeries.coverImageId;
  const firstChapter = chapters[0];
  const continueChapter = currentChapterId
    ? chapters.find((c) => c.id === currentChapterId) ?? firstChapter
    : firstChapter;
  // When all chapters have been wiped (e.g. via "Delete read chapters") but
  // we still have the breadcrumb pair (lastReadChapterOrder + lastKnownMaxOrder),
  // surface that snapshot so the header keeps showing e.g. "202 / 204"
  // instead of "0 / 0" until reimport restores the live counts.
  const showPreservedSnapshot =
    seriesProgress.totalChapters === 0 &&
    currentSeries.lastReadChapterOrder !== null &&
    currentSeries.lastKnownMaxOrder !== null;
  const displayRead = showPreservedSnapshot
    ? (currentSeries.lastReadChapterOrder as number)
    : seriesProgress.readChapters;
  const displayTotal = showPreservedSnapshot
    ? (currentSeries.lastKnownMaxOrder as number)
    : seriesProgress.totalChapters;
  const pct =
    displayTotal > 0 ? displayRead / displayTotal : 0;

  // Mark chapter read/unread
  async function handleMarkRead(chapter: Chapter, markRead: boolean): Promise<void> {
    const lastPage = Math.max(0, chapter.pageCount - 1);
    await upsertProgress({
      profileId,
      seriesId,
      currentChapterId: chapter.id,
      pageIndex: markRead ? lastPage : 0,
      scrollPosition: 0,
      manuallyMarked: true,
    });
    setCurrentChapterId(chapter.id);
    if (markRead) {
      setManuallyReadIds((prev) => new Set([...prev, chapter.id]));
    } else {
      setManuallyReadIds((prev) => {
        const next = new Set(prev);
        next.delete(chapter.id);
        return next;
      });
    }
    setOverflowTarget(null);
  }

  // Save title edit
  async function handleSaveTitle(): Promise<void> {
    if (!editingTitle) return;
    const val = editingTitle.value.slice(0, 80).trim();
    if (!val) { setEditingTitle(null); return; }
    if (editingTitle.kind === 'series') {
      await updateSeriesTitle(editingTitle.id, val);
      await loadSeries(seriesId);
    } else {
      await updateChapterTitle(editingTitle.id, val);
      await loadSeries(seriesId);
    }
    setEditingTitle(null);
    setOverflowTarget(null);
  }

  const MAX_COVER_BYTES = 5 * 1024 * 1024;

  async function commitCoverBlob(blob: Blob): Promise<void> {
    const newBlobId = await addBlob(blob);
    await setCoverBlobOverride(seriesId, newBlobId, 'url');
    await loadSeries(seriesId);
    setCoverUrlSheet(false);
    setCoverUrlInput('');
    setCoverUrlStatus('idle');
    setCoverUrlError('');
  }

  // Cover URL submit
  async function handleCoverUrlSubmit(): Promise<void> {
    const url = coverUrlInput.trim();
    if (!url.startsWith('https://')) {
      setCoverUrlStatus('error');
      setCoverUrlError('URL must start with https://');
      return;
    }

    if (!navigator.onLine) {
      // Persist pending URL for later fetch
      await db.series.update(seriesId, {
        pendingCoverUrl: url,
        coverSource: 'url',
        coverFetchAttempts: 0,
      });
      setCoverUrlStatus('offline');
      return;
    }

    setCoverUrlStatus('fetching');
    setCoverUrlError('');
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        setCoverUrlStatus('error');
        setCoverUrlError(`Server returned ${resp.status}. Try a different link.`);
        return;
      }
      const blob = await resp.blob();
      if (blob.size === 0) {
        setCoverUrlStatus('error');
        setCoverUrlError('Server returned an empty response.');
        return;
      }
      if (blob.size > MAX_COVER_BYTES) {
        setCoverUrlStatus('error');
        setCoverUrlError('Image exceeds 5 MB limit.');
        return;
      }
      const sniff = await sniffImageType(blob);
      if (sniff.kind === 'unsupported') {
        setCoverUrlStatus('error');
        setCoverUrlError(sniff.reason);
        return;
      }
      await commitCoverBlob(blob);
    } catch (err) {
      setCoverUrlStatus('error');
      if (err instanceof TypeError) {
        // Browser-level network/CORS failure — opaque response is unreadable.
        setCoverUrlError(
          "Can't reach this link from the browser (often a CORS block). Download the image and use 'Pick from device'.",
        );
      } else {
        setCoverUrlError('Failed to fetch image.');
      }
    }
  }

  // Cover file pick (device)
  async function handleCoverFilePick(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice still fires onChange.
    e.target.value = '';
    if (!file) return;

    setCoverUrlStatus('fetching');
    setCoverUrlError('');
    try {
      if (file.size === 0) {
        setCoverUrlStatus('error');
        setCoverUrlError('Selected file is empty.');
        return;
      }
      if (file.size > MAX_COVER_BYTES) {
        setCoverUrlStatus('error');
        setCoverUrlError('Image exceeds 5 MB limit.');
        return;
      }
      const sniff = await sniffImageType(file);
      if (sniff.kind === 'unsupported') {
        setCoverUrlStatus('error');
        setCoverUrlError(sniff.reason);
        return;
      }
      await commitCoverBlob(file);
    } catch {
      setCoverUrlStatus('error');
      setCoverUrlError('Could not read the selected file.');
    }
  }

  // A chapter is "read" if it was manually marked, or if it sits at-or-below
  // the current progress chapter in chapter order. This matches the formula
  // used by useSeriesProgress for the read-count, so the per-chapter
  // checkmarks and the "N / total" tally stay in sync.
  const currentChapterOrder = currentChapterId
    ? chapters.find((c) => c.id === currentChapterId)?.order ?? null
    : null;
  const isChapterRead = (c: Chapter): boolean =>
    manuallyReadIds.has(c.id) ||
    (currentChapterOrder !== null && c.order <= currentChapterOrder);

  return (
    <div className="screen-root series-screen">
      <header className="series-screen__header">
        <button
          className="series-screen__back type-button"
          onClick={() => navigate({ screen: 'home' })}
          aria-label="Back to home"
        >
          Back
        </button>
        <div className="series-screen__header-actions">
          <button
            className="series-screen__overflow type-button"
            onClick={() => setOverflowTarget({ kind: 'series' })}
            aria-label="Series options"
          >
            ...
          </button>
          <button
            className="series-screen__delete type-button"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete series"
          >
            Delete
          </button>
        </div>
      </header>

      <section className="series-hero">
        <div className="series-hero__cover">
          <CoverImage blobId={blobId} alt={currentSeries.title} className="series-hero__img" />
        </div>
        <div className="series-hero__body">
          {editingTitle?.kind === 'series' ? (
            <div className="series-title-edit">
              <input
                ref={titleInputRef}
                className="series-title-input type-card-title"
                value={editingTitle.value}
                maxLength={80}
                onChange={(e) => setEditingTitle({ ...editingTitle, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { void handleSaveTitle(); }
                  if (e.key === 'Escape') setEditingTitle(null);
                }}
              />
              <div className="series-title-edit-actions">
                <button className="series-action-btn type-button" onClick={() => void handleSaveTitle()}>
                  Save
                </button>
                <button className="series-action-btn type-button" onClick={() => setEditingTitle(null)}>
                  Cancel
                </button>
                {currentSeries.title !== currentSeries.originalTitle && (
                  <button
                    className="series-action-btn type-button"
                    onClick={async () => {
                      await updateSeriesTitle(seriesId, currentSeries.originalTitle);
                      await loadSeries(seriesId);
                      setEditingTitle(null);
                    }}
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="type-card-title series-hero__title">{currentSeries.title}</div>
          )}
          <div className="type-meta-italic series-hero__meta">
            {displayTotal} chapter{displayTotal === 1 ? '' : 's'}
            {currentSeries.lastReadAt && ` — ${formatRelativeTime(currentSeries.lastReadAt)}`}
          </div>
          <div className="type-progress-count">
            {displayRead} / {displayTotal}
          </div>
          <ProgressBar value={pct} />
          <div className="series-hero__cta">
            {continueChapter && (
              <Button
                onClick={() =>
                  navigate({
                    screen: 'reader',
                    seriesId: currentSeries.id,
                    chapterId: continueChapter.id,
                  })
                }
              >
                {currentChapterId ? 'Continue Reading' : 'Start Reading'}
              </Button>
            )}
          </div>
        </div>
      </section>

      <div className="section-head">
        <span className="type-section-label">Chapters</span>
        <span className="section-line" />
      </div>

      <ul className="chapter-list">
        {chapters.map((c) => {
          const isCurrent = c.id === currentChapterId;
          const isNew = newChapterIds.has(c.id);
          const isRead = isChapterRead(c);
          return (
            <li key={c.id}>
              <div className={`chapter-row-wrap${isRead ? ' chapter-row-wrap--read' : ''}`}>
                <button
                  className={`chapter-row${isCurrent ? ' chapter-row--current' : ''}`}
                  onClick={() =>
                    navigate({ screen: 'reader', seriesId: currentSeries.id, chapterId: c.id })
                  }
                >
                  <span className="chapter-row__order type-nav-label">
                    {Number.isInteger(c.order) ? c.order : c.order.toFixed(1)}
                  </span>
                  <span className="type-card-title chapter-row__title">{c.title}</span>
                  <span className="chapter-row__right">
                    {isNew && <Badge>New</Badge>}
                    {isRead && !isNew && (
                      <span className="chapter-row__read-check" aria-label="Read">
                        {'\u2713'}
                      </span>
                    )}
                    {isCurrent && (
                      <span className="type-nav-label chapter-row__current">Reading</span>
                    )}
                  </span>
                </button>
                <button
                  className="chapter-row__overflow type-button"
                  aria-label={`Options for ${c.title}`}
                  onClick={() => setOverflowTarget({ kind: 'chapter', chapter: c })}
                >
                  ...
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div style={{ padding: '24px 20px' }}>
        <div className="type-section-label" style={{ marginBottom: 12 }}>
          Add chapters
        </div>
        <ImportZone context="series" targetSeriesId={seriesId} />
      </div>

      {/* Series overflow menu */}
      {overflowTarget?.kind === 'series' && (
        <div className="confirm-sheet" role="dialog" aria-modal="true">
          <div className="confirm-sheet__inner">
            <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
              {currentSeries.title}
            </div>
            <button
              className="overflow-action-btn type-body"
              onClick={() => {
                setOverflowTarget(null);
                setEditingTitle({ kind: 'series', id: seriesId, value: currentSeries.title });
              }}
            >
              Edit title
            </button>
            <button
              className="overflow-action-btn type-body"
              onClick={() => {
                setOverflowTarget(null);
                setCoverUrlSheet(true);
                setCoverUrlInput('');
                setCoverUrlStatus('idle');
                setCoverUrlError('');
              }}
            >
              Edit cover
            </button>
            <button
              className="overflow-action-btn type-body"
              disabled={seriesProgress.readChapters === 0}
              style={{
                color: seriesProgress.readChapters === 0 ? 'var(--color-text-muted)' : 'var(--color-gold)',
                cursor: seriesProgress.readChapters === 0 ? 'not-allowed' : 'pointer',
              }}
              onClick={() => {
                if (seriesProgress.readChapters === 0) return;
                setOverflowTarget(null);
                setConfirmClearProgress(true);
              }}
            >
              Clear read chapters
              <div
                className="type-nav-label"
                style={{ color: 'var(--color-text-muted)', marginTop: 2 }}
              >
                Resets progress. Pages stay on device.
              </div>
            </button>
            <button
              className="overflow-action-btn type-body"
              disabled={seriesProgress.readChapters === 0}
              style={{
                color: seriesProgress.readChapters === 0 ? 'var(--color-text-muted)' : 'var(--color-gold)',
                cursor: seriesProgress.readChapters === 0 ? 'not-allowed' : 'pointer',
              }}
              onClick={async () => {
                if (seriesProgress.readChapters === 0) return;
                setOverflowTarget(null);
                const preview = await previewReadChaptersToDelete(profileId, seriesId);
                setDeleteReadPreview(preview);
              }}
            >
              Delete read chapters
              <div
                className="type-nav-label"
                style={{ color: 'var(--color-text-muted)', marginTop: 2 }}
              >
                Destructive. Frees storage. Re-import to recover.
              </div>
            </button>
            <div className="confirm-sheet__actions">
              <Button variant="ghost" onClick={() => setOverflowTarget(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Chapter overflow menu */}
      {overflowTarget?.kind === 'chapter' && (
        <div className="confirm-sheet" role="dialog" aria-modal="true">
          <div className="confirm-sheet__inner">
            <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
              {overflowTarget.chapter.title}
            </div>
            <button
              className="overflow-action-btn type-body"
              onClick={() => void handleMarkRead(overflowTarget.chapter, !isChapterRead(overflowTarget.chapter))}
            >
              {isChapterRead(overflowTarget.chapter) ? 'Mark as unread' : 'Mark as read'}
            </button>
            <button
              className="overflow-action-btn type-body"
              onClick={() => {
                setOverflowTarget(null);
                setEditingTitle({
                  kind: 'chapter',
                  id: overflowTarget.chapter.id,
                  value: overflowTarget.chapter.title,
                });
              }}
            >
              Edit title
            </button>
            <div className="confirm-sheet__actions">
              <Button variant="ghost" onClick={() => setOverflowTarget(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Cover edit sheet (URL or device file) */}
      {coverUrlSheet && (
        <div className="confirm-sheet" role="dialog" aria-modal="true">
          <div className="confirm-sheet__inner">
            <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
              Edit Cover
            </div>
            <input
              className="series-title-input type-body"
              type="url"
              placeholder="https://… (paste image link)"
              value={coverUrlInput}
              onChange={(e) => setCoverUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { void handleCoverUrlSubmit(); } }}
              autoFocus
            />
            <div className="type-nav-label" style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>
              Some short links may be blocked by the browser — use "Pick from device" if a link fails.
            </div>
            <input
              ref={coverFileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              style={{ display: 'none' }}
              onChange={(e) => void handleCoverFilePick(e)}
            />
            <div style={{ marginTop: 12 }}>
              <Button
                variant="ghost"
                onClick={() => coverFileInputRef.current?.click()}
                disabled={coverUrlStatus === 'fetching'}
              >
                Pick from device
              </Button>
            </div>
            {coverUrlStatus === 'error' && (
              <div className="type-body" style={{ color: 'var(--color-gold)' }}>
                {coverUrlError}
              </div>
            )}
            {coverUrlStatus === 'offline' && (
              <div className="type-body" style={{ color: 'var(--color-text-muted)' }}>
                Will download when online.
              </div>
            )}
            <div className="confirm-sheet__actions">
              <Button
                variant="ghost"
                onClick={() => {
                  setCoverUrlSheet(false);
                  setCoverUrlStatus('idle');
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleCoverUrlSubmit()}
                disabled={coverUrlStatus === 'fetching'}
              >
                {coverUrlStatus === 'fetching' ? 'Working…' : 'Save URL'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Chapter title inline editing */}
      {editingTitle?.kind === 'chapter' && (
        <div className="confirm-sheet" role="dialog" aria-modal="true">
          <div className="confirm-sheet__inner">
            <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
              Edit Chapter Title
            </div>
            <input
              ref={titleInputRef}
              className="series-title-input type-body"
              value={editingTitle.value}
              maxLength={80}
              onChange={(e) => setEditingTitle({ ...editingTitle, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { void handleSaveTitle(); }
                if (e.key === 'Escape') setEditingTitle(null);
              }}
              autoFocus
            />
            {(() => {
              const ch = chapters.find((c) => c.id === editingTitle.id);
              return ch && ch.title !== ch.originalTitle ? (
                <button
                  className="type-nav-label"
                  style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  onClick={async () => {
                    await updateChapterTitle(editingTitle.id, ch.originalTitle);
                    await loadSeries(seriesId);
                    setEditingTitle(null);
                  }}
                >
                  Reset to imported title
                </button>
              ) : null;
            })()}
            <div className="confirm-sheet__actions">
              <Button variant="ghost" onClick={() => setEditingTitle(null)}>Cancel</Button>
              <Button onClick={() => void handleSaveTitle()}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {deleteReadPreview && (
        <div className="confirm-sheet" role="dialog" aria-modal="true">
          <div className="confirm-sheet__inner">
            <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
              Delete read chapters
            </div>
            {deleteReadPreview.chaptersDeleted === 0 ? (
              <div className="type-body">No read chapters to delete.</div>
            ) : (
              <>
                <div className="type-body">
                  This permanently deletes {deleteReadPreview.chaptersDeleted} chapter
                  {deleteReadPreview.chaptersDeleted === 1 ? '' : 's'} from{' '}
                  {currentSeries.title}, freeing about{' '}
                  <strong>{formatBytes(deleteReadPreview.bytesFreed)}</strong>. Pages and
                  bookmarks for these chapters are removed. Re-import the series to
                  recover them.
                </div>
                <div className="type-nav-label" style={{ color: 'var(--color-text-muted)' }}>
                  Reading progress will be reset.
                </div>
              </>
            )}
            <div className="confirm-sheet__actions">
              <Button
                variant="ghost"
                onClick={() => setDeleteReadPreview(null)}
                disabled={deleteReadWorking}
              >
                Cancel
              </Button>
              <Button
                disabled={deleteReadWorking || deleteReadPreview.chaptersDeleted === 0}
                onClick={async () => {
                  setDeleteReadWorking(true);
                  await deleteReadChapters(profileId, seriesId);
                  setCurrentChapterId(null);
                  setManuallyReadIds(new Set());
                  await loadSeries(seriesId);
                  await loadLibrary();
                  await refreshStorageUsed();
                  setDeleteReadWorking(false);
                  setDeleteReadPreview(null);
                }}
              >
                {deleteReadWorking ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmClearProgress && (
        <div className="confirm-sheet" role="dialog" aria-modal="true">
          <div className="confirm-sheet__inner">
            <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
              Clear read chapters
            </div>
            <div className="type-body">
              Reset progress for {currentSeries.title}? This marks all {seriesProgress.readChapters} read chapter{seriesProgress.readChapters === 1 ? '' : 's'} as unread. Chapters and bookmarks are kept.
            </div>
            <div className="confirm-sheet__actions">
              <Button variant="ghost" onClick={() => setConfirmClearProgress(false)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  await clearSeriesProgress(profileId, seriesId);
                  setCurrentChapterId(null);
                  setManuallyReadIds(new Set());
                  setConfirmClearProgress(false);
                  await loadSeries(seriesId);
                  await loadLibrary();
                }}
              >
                Proceed
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="confirm-sheet" role="dialog" aria-modal="true">
          <div className="confirm-sheet__inner">
            <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
              Delete series
            </div>
            <div className="type-body">
              This removes {currentSeries.title} and all its chapters from this profile.
            </div>
            <div className="confirm-sheet__actions">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  await deleteSeries(currentSeries.id);
                  setConfirmDelete(false);
                  navigate({ screen: 'home' });
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
