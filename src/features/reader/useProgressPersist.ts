import { useEffect, useRef } from 'react';
import { upsertProgress } from '../../db/repos/progress.repo';
import { setLastReadChapter } from '../../db/repos/series.repo';
import { notifyProgress, flushSync } from '../sync/positionSync';

interface ProgressSnapshot {
  chapterId: string | null;
  pageIndex: number;
  scrollPosition: number;
}

export function useProgressPersist(
  profileId: string,
  seriesId: string,
  getCurrentProgress: () => ProgressSnapshot,
) {
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize to a no-op so that a visibilitychange firing before the first
  // useEffect run never writes stale initial-render state (pageIndex: 0,
  // undefined chapterId) to IndexedDB.
  const persist = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    persist.current = async () => {
      const snap = getCurrentProgress();
      // Guard against writing meaningless progress before the reader has
      // loaded pages or determined the current chapter.
      if (!snap.chapterId) return;
      await upsertProgress({
        profileId,
        seriesId,
        currentChapterId: snap.chapterId,
        pageIndex: snap.pageIndex,
        scrollPosition: snap.scrollPosition,
      });
      await setLastReadChapter(seriesId, snap.chapterId, Date.now());
      void notifyProgress(profileId, seriesId, snap.chapterId, snap.pageIndex, false);
    };
  }, [profileId, seriesId, getCurrentProgress]);

  const onScroll = (): void => {
    if (pendingRef.current) clearTimeout(pendingRef.current);
    pendingRef.current = setTimeout(() => {
      void persist.current();
    }, 500);
  };

  useEffect(() => {
    const flush = (): void => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
      void persist.current();
      void flushSync();
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  return { onScroll };
}
