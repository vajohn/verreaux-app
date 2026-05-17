import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { db } from '../../db/db';
import { getChaptersBySeriesId } from '../../db/repos/chapters.repo';
import { getPagesByChapterId } from '../../db/repos/pages.repo';
import { addBookmark, getBookmarksBySeriesId } from '../../db/repos/bookmarks.repo';
import { useReaderStore, type PageMeta } from './reader.store';
import { useLibraryStore } from '../library/library.store';
import { useVirtualization } from './useVirtualization';
import { useProgressPersist } from './useProgressPersist';
import { VirtualList } from './VirtualList';
import { ChapterDivider } from './ChapterDivider';
import { ChapterEndCard } from './ChapterEndCard';
import { ChapterDrawer } from './ChapterDrawer';
import { ReaderSettingsPanel } from './SettingsPanel';
import { Toast } from '../../ui/Toast';
import { navigate } from '../../app/router';
import type { Chapter, Bookmark } from '../../db/types';
import './ReaderScreen.css';

interface ReaderScreenProps {
  seriesId: string;
  chapterId: string;
}

export function ReaderScreen({ seriesId, chapterId }: ReaderScreenProps) {
  const profileId = useLibraryStore((s) => s.activeProfileId);
  const overlaysVisible = useReaderStore((s) => s.overlaysVisible);
  const toggleOverlays = useReaderStore((s) => s.toggleOverlays);
  const hideOverlays = useReaderStore((s) => s.hideOverlays);
  const settings = useReaderStore((s) => s.settings);

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [seriesTitle, setSeriesTitle] = useState('');
  const [scrollPct, setScrollPct] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const currentChapter = useMemo<Chapter | null>(() => {
    const p = pages[currentIndex];
    if (!p) return chapters[0] ?? null;
    return chapters.find((c) => c.id === p.chapterId) ?? null;
  }, [pages, currentIndex, chapters]);

  // Load chapters + pages.
  //
  // When `autoNextChapter` is ON we concatenate every subsequent chapter
  // into one flat scroll (seamless reader).  When OFF we stop after the
  // current chapter, so the end-of-chapter card halts the reader and
  // requires an explicit Next.
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const series = await db.series.get(seriesId);
      if (!cancelled && series) setSeriesTitle(series.title);
      const chs = await getChaptersBySeriesId(seriesId);
      if (cancelled) return;
      setChapters(chs);

      const startIdx = Math.max(
        0,
        chs.findIndex((c) => c.id === chapterId),
      );
      const endIdx = settings.autoNextChapter ? chs.length : startIdx + 1;
      const flat: PageMeta[] = [];
      for (let i = startIdx; i < endIdx; i++) {
        const cps = await getPagesByChapterId(chs[i]!.id);
        for (const p of cps) {
          flat.push({
            id: p.id,
            blobId: p.blobId,
            chapterId: chs[i]!.id,
            pageNumber: p.pageNumber,
          });
        }
      }
      if (!cancelled) setPages(flat);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [seriesId, chapterId, settings.autoNextChapter]);

  // Load bookmarks for this series.
  const loadBookmarks = useCallback(async () => {
    const bms = await getBookmarksBySeriesId(profileId, seriesId);
    setBookmarks(bms);
  }, [profileId, seriesId]);

  useEffect(() => {
    void loadBookmarks();
  }, [loadBookmarks]);

  useEffect(() => {
    if (seriesTitle && currentChapter) {
      document.title = `Verreaux — ${seriesTitle} Ch ${
        Number.isInteger(currentChapter.order) ? currentChapter.order : currentChapter.order.toFixed(1)
      }`;
    } else if (seriesTitle) {
      document.title = `Verreaux — ${seriesTitle}`;
    }
  }, [seriesTitle, currentChapter]);

  const virt = useVirtualization(pages);

  // Restore scroll position once pages mount.
  useEffect(() => {
    if (pages.length === 0 || !scrollRef.current) return;
    let cancelled = false;
    async function restore(): Promise<void> {
      const rec = await db.readingProgress
        .where('[profileId+seriesId]')
        .equals([profileId, seriesId])
        .first();
      if (cancelled || !scrollRef.current) return;
      requestAnimationFrame(() => {
        if (cancelled || !scrollRef.current) return;
        if (rec && rec.currentChapterId === chapterId && rec.scrollPosition > 0) {
          scrollRef.current.scrollTop = rec.scrollPosition;
        } else {
          scrollRef.current.scrollTop = 0;
        }
      });
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, [pages.length, profileId, seriesId, chapterId]);

  const { onScroll } = useProgressPersist(profileId, seriesId, () => {
    const p = pages[currentIndex];
    return {
      chapterId: p?.chapterId ?? chapterId,
      pageIndex: currentIndex,
      scrollPosition: scrollRef.current?.scrollTop ?? 0,
    };
  });

  function handleScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    const total = el.scrollHeight - el.clientHeight;
    setScrollPct(total > 0 ? el.scrollTop / total : 0);
    onScroll();
  }

  // Tap toggles overlays.
  function onContainerClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (
      (e.target as HTMLElement).closest(
        'button, .reader-top-overlay, .reader-bottom-overlay, .chapter-drawer, .reader-settings-panel',
      )
    ) {
      return;
    }
    if (drawerOpen || settingsOpen) return;
    toggleOverlays();
  }

  // Auto-hide overlays.
  useEffect(() => {
    if (!overlaysVisible) return;
    const t = setTimeout(() => hideOverlays(), 4000);
    return () => clearTimeout(t);
  }, [overlaysVisible, hideOverlays]);

  const chapterIndexInSeries = currentChapter
    ? chapters.findIndex((c) => c.id === currentChapter.id)
    : -1;

  // Long-press bookmark handler.
  const handlePageLongPress = useCallback(
    async (pageIndex: number) => {
      const page = pages[pageIndex];
      if (!page) return;
      await addBookmark({
        profileId,
        seriesId,
        chapterId: page.chapterId,
        pageIndex,
        scrollOffset: scrollRef.current?.scrollTop ?? 0,
        note: null,
      });
      await loadBookmarks();
      setToastMessage('Bookmark saved');
    },
    [pages, profileId, seriesId, loadBookmarks],
  );

  // Navigate to bookmark.
  function handleSelectBookmark(bookmark: Bookmark): void {
    const ch = chapters.find((c) => c.id === bookmark.chapterId);
    if (!ch) return;
    navigate({ screen: 'reader', seriesId, chapterId: ch.id });
  }

  return (
    <div className="reader-root">
      <div className="reader-persistent-bar" aria-hidden="true">
        <div
          className="reader-persistent-bar__fill"
          style={{ width: `${Math.min(100, Math.max(0, scrollPct * 100))}%` }}
        />
      </div>

      <div
        className="reader-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
        onClick={onContainerClick}
      >
        <VirtualList
          pages={pages}
          virt={virt}
          pageGap={settings.pageGap}
          scrollRoot={scrollRef.current}
          onCurrentIndex={setCurrentIndex}
          onPageLongPress={handlePageLongPress}
        />
        {/* End-of-data ChapterEndCard if at last chapter */}
        {pages.length > 0 && (
          <>
            <ChapterDivider label={currentChapter?.title} />
            <ChapterEndCard
              hasNext={chapterIndexInSeries >= 0 && chapterIndexInSeries < chapters.length - 1}
              onNext={() => {
                const next = chapters[chapterIndexInSeries + 1];
                if (next) navigate({ screen: 'reader', seriesId, chapterId: next.id });
              }}
            />
          </>
        )}
      </div>

      {settings.brightness > 0 && (
        <div
          className="reader-brightness-overlay"
          style={{ background: `rgba(0,0,0,${Math.min(0.6, settings.brightness)})` }}
          aria-hidden="true"
        />
      )}

      <div
        className={`reader-top-overlay${overlaysVisible ? '' : ' reader-overlay--hidden'}`}
        role="toolbar"
      >
        <button
          className="reader-icon-btn type-button"
          onClick={() => navigate({ screen: 'series', seriesId })}
        >
          Back
        </button>
        <button
          className="reader-top-overlay__chapter-chip type-meta-italic"
          onClick={() => {
            hideOverlays();
            setDrawerOpen(true);
          }}
          aria-label="Open chapter list"
        >
          {seriesTitle}
          {currentChapter && ` — ${currentChapter.title}`}
        </button>
        <button
          className="reader-icon-btn reader-bookmark-btn type-button"
          aria-label="Bookmark current page"
          onClick={() => { void handlePageLongPress(currentIndex); }}
          title="Bookmark current page"
        >
          [B]
        </button>
        <button
          className="reader-icon-btn type-button"
          onClick={() => navigate({ screen: 'home' })}
        >
          Home
        </button>
      </div>

      <div
        className={`reader-bottom-overlay${overlaysVisible ? '' : ' reader-overlay--hidden'}`}
      >
        <button
          className="reader-icon-btn type-button"
          onClick={() => {
            const prev = chapters[chapterIndexInSeries - 1];
            if (prev) navigate({ screen: 'reader', seriesId, chapterId: prev.id });
          }}
          disabled={chapterIndexInSeries <= 0}
          aria-disabled={chapterIndexInSeries <= 0}
        >
          Prev
        </button>
        <div className="reader-page-count type-nav-label">
          {currentIndex + 1} / {pages.length}
        </div>
        <button
          className="reader-icon-btn type-button"
          onClick={() => {
            hideOverlays();
            setDrawerOpen(true);
          }}
          aria-label="Open chapter list"
        >
          Chs
        </button>
        <button
          className="reader-icon-btn type-button"
          onClick={() => {
            hideOverlays();
            setSettingsOpen(true);
          }}
          aria-label="Open reader settings"
        >
          Cfg
        </button>
        <button
          className="reader-icon-btn type-button"
          onClick={() => {
            const next = chapters[chapterIndexInSeries + 1];
            if (next) navigate({ screen: 'reader', seriesId, chapterId: next.id });
          }}
          disabled={chapterIndexInSeries < 0 || chapterIndexInSeries >= chapters.length - 1}
          aria-disabled={chapterIndexInSeries < 0 || chapterIndexInSeries >= chapters.length - 1}
        >
          Next
        </button>
      </div>

      {drawerOpen && (
        <ChapterDrawer
          chapters={chapters}
          currentChapterId={currentChapter?.id ?? null}
          bookmarks={bookmarks}
          seriesId={seriesId}
          onSelectChapter={(cId) => navigate({ screen: 'reader', seriesId, chapterId: cId })}
          onSelectBookmark={handleSelectBookmark}
          onClose={() => setDrawerOpen(false)}
          onBookmarksChange={() => { void loadBookmarks(); }}
        />
      )}

      {settingsOpen && (
        <ReaderSettingsPanel onClose={() => setSettingsOpen(false)} />
      )}

      {toastMessage && (
        <Toast
          message={toastMessage}
          durationMs={1500}
          onDone={() => setToastMessage(null)}
        />
      )}
    </div>
  );
}
