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
  //
  // `pageIndex` is a within-chapter offset (page N of the saved chapter).
  // `scrollPosition` is an intra-page Y offset (pixels from the top of that
  // page's slot), not an absolute scrollTop. Restore is a three-step dance:
  //   1) Seed the virtualization window around the target page so its image
  //      is fetched on this render pass.
  //   2) Anchor scrollTop to the slot's offsetTop once it exists in the DOM.
  //   3) After the image loads and the slot settles to its real height,
  //      re-anchor with the intra-page offset applied, clamping to the slot.
  // Step 3 must wait for image decode because the slot's offsetTop drifts as
  // placeholder shimmers above swap to real images.
  useEffect(() => {
    if (pages.length === 0 || !scrollRef.current) return;
    let cancelled = false;
    let activeResizeObserver: ResizeObserver | null = null;
    let activeImg: HTMLImageElement | null = null;
    let imgLoadHandler: (() => void) | null = null;
    let settleTimer: number | null = null;

    function cleanup(): void {
      activeResizeObserver?.disconnect();
      activeResizeObserver = null;
      if (activeImg && imgLoadHandler) {
        activeImg.removeEventListener('load', imgLoadHandler);
        activeImg = null;
        imgLoadHandler = null;
      }
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
      }
    }

    async function restore(): Promise<void> {
      const rec = await db.readingProgress
        .where('[profileId+seriesId]')
        .equals([profileId, seriesId])
        .first();
      if (cancelled || !scrollRef.current) return;
      if (!rec || rec.currentChapterId !== chapterId || rec.pageIndex <= 0) {
        scrollRef.current.scrollTop = 0;
        return;
      }
      const chapterStart = pages.findIndex((p) => p.chapterId === rec.currentChapterId);
      if (chapterStart < 0) {
        scrollRef.current.scrollTop = 0;
        return;
      }
      const targetIndex = Math.min(chapterStart + rec.pageIndex, pages.length - 1);
      const intraPageY = Math.max(0, rec.scrollPosition);

      setCurrentIndex(targetIndex);
      virt.onCurrentIndexChange(targetIndex);

      const applyAnchor = (el: HTMLElement, includeOffset: boolean): void => {
        const root = scrollRef.current;
        if (!root) return;
        const maxIntra = Math.max(0, el.offsetHeight - root.clientHeight);
        const offset = includeOffset ? Math.min(intraPageY, maxIntra) : 0;
        root.scrollTop = el.offsetTop + offset;
      };

      const armSettleObserver = (el: HTMLElement): void => {
        // Re-anchor while neighboring placeholders swap to real images and
        // shift this slot's offsetTop. End the watch after a 400ms quiet
        // period — enough for adjacent pages in the prefetch window to load
        // without holding scroll hostage forever on slow connections.
        const ro = new ResizeObserver(() => {
          if (cancelled) return;
          applyAnchor(el, true);
          if (settleTimer !== null) window.clearTimeout(settleTimer);
          settleTimer = window.setTimeout(() => {
            ro.disconnect();
            activeResizeObserver = null;
          }, 400);
        });
        // Observe the scroll root so any layout shift inside the document
        // (any slot resizing) re-triggers the anchor.
        if (scrollRef.current) ro.observe(scrollRef.current);
        ro.observe(el);
        activeResizeObserver = ro;
        settleTimer = window.setTimeout(() => {
          ro.disconnect();
          activeResizeObserver = null;
        }, 400);
      };

      const tryAnchor = (attempts: number): void => {
        if (cancelled || !scrollRef.current) return;
        const el = scrollRef.current.querySelector<HTMLElement>(
          `.page-slot[data-index="${targetIndex}"]`,
        );
        if (!el) {
          if (attempts > 0) requestAnimationFrame(() => tryAnchor(attempts - 1));
          return;
        }
        // Step 2: land at top of slot immediately so the user sees the right
        // page even before the image decodes.
        applyAnchor(el, false);

        // Step 3: once the image loads, apply intra-page offset and watch for
        // settling. If the slot is still a shimmer placeholder, retry.
        const img = el.querySelector<HTMLImageElement>('img.page-slot__img');
        if (!img) {
          if (attempts > 0) requestAnimationFrame(() => tryAnchor(attempts - 1));
          return;
        }
        const onReady = (): void => {
          if (cancelled) return;
          applyAnchor(el, true);
          armSettleObserver(el);
        };
        if (img.complete && img.naturalHeight > 0) {
          onReady();
        } else {
          activeImg = img;
          imgLoadHandler = onReady;
          img.addEventListener('load', onReady, { once: true });
        }
      };
      requestAnimationFrame(() => tryAnchor(30));
    }
    void restore();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [pages, profileId, seriesId, chapterId, virt.onCurrentIndexChange]);

  const { onScroll } = useProgressPersist(profileId, seriesId, () => {
    const root = scrollRef.current;
    if (!root || pages.length === 0) {
      return { chapterId: null, pageIndex: 0, scrollPosition: 0 };
    }
    // Derive the visible page from the DOM at flush time, not from
    // `currentIndex`. IntersectionObserver callbacks are async, so React's
    // `currentIndex` lags real scroll position. A fast close right after
    // scrolling would otherwise persist with a stale index (often 0) and
    // overwrite the saved within-chapter offset.
    const scrollTop = root.scrollTop;
    const centerY = scrollTop + root.clientHeight / 2;
    const slots = root.querySelectorAll<HTMLElement>('.page-slot');
    let activeSlot: HTMLElement | null = null;
    let domIndex = -1;
    for (const slot of slots) {
      const top = slot.offsetTop;
      const bottom = top + slot.offsetHeight;
      if (top <= centerY && centerY < bottom) {
        const parsed = Number(slot.dataset['index']);
        if (Number.isFinite(parsed)) {
          domIndex = parsed;
          activeSlot = slot;
        }
        break;
      }
    }
    const resolvedIndex = domIndex >= 0 ? domIndex : currentIndex;
    const p = pages[resolvedIndex];
    if (!p) {
      return { chapterId: null, pageIndex: 0, scrollPosition: 0 };
    }
    // Persist pageIndex as an offset within the current chapter, not as the
    // flat-list index. The flat list depends on which chapter the session
    // started at (with infinite scroll on), so a flat index is not portable
    // across sessions.
    const chapterStart = pages.findIndex((pg) => pg.chapterId === p.chapterId);
    const pageInChapter = chapterStart >= 0 ? resolvedIndex - chapterStart : 0;
    // Intra-page offset: pixels into the current page slot. Stable across
    // sessions because the slot's intrinsic dimensions are tied to the image,
    // unlike absolute scrollTop which drifts with placeholder heights.
    const intraPageY = activeSlot
      ? Math.max(0, scrollTop - activeSlot.offsetTop)
      : 0;
    return {
      chapterId: p.chapterId,
      pageIndex: Math.max(0, pageInChapter),
      scrollPosition: intraPageY,
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

  const progressPct = Math.min(100, Math.max(0, scrollPct * 100));
  const progressBarPos = settings.progressBarPosition;
  const isVertical = progressBarPos === 'left' || progressBarPos === 'right';

  return (
    <div className="reader-root">
      {settings.progressBarEnabled && (
        <div
          className={`reader-persistent-bar reader-persistent-bar--${progressBarPos}`}
          aria-hidden="true"
        >
          <div
            className="reader-persistent-bar__fill"
            style={isVertical ? { height: `${progressPct}%` } : { width: `${progressPct}%` }}
          />
        </div>
      )}

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
              onSeries={() => navigate({ screen: 'series', seriesId })}
              onHome={() => navigate({ screen: 'home' })}
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
