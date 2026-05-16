import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '../../db/db';
import type { PageMeta } from './reader.store';

export const WINDOW_SIZE = 10;
export const PREFETCH_AHEAD = 5;
export const PREFETCH_BEHIND = 3;
export const ESTIMATED_HEIGHT = 1200;

export interface Virtualization {
  renderRevision: number;
  isInRenderWindow: (index: number) => boolean;
  getObjectUrl: (index: number) => string | null;
  getPlaceholderHeight: (index: number) => number;
  onCurrentIndexChange: (index: number) => void;
  onHeightMeasured: (index: number, height: number) => void;
  liveCount: () => number;
}

export function useVirtualization(pages: PageMeta[]): Virtualization {
  const objectUrls = useRef<Map<number, string>>(new Map());
  const cachedHeights = useRef<Map<number, number>>(new Map());
  const [renderRevision, setRenderRevision] = useState(0);
  const currentIndexRef = useRef(0);

  const forceRender = useCallback(() => setRenderRevision((r) => r + 1), []);

  const loadPage = useCallback(
    async (index: number) => {
      if (objectUrls.current.has(index)) return;
      const page = pages[index];
      if (!page) return;
      try {
        const blobRecord = await db.blobs.get(page.blobId);
        if (!blobRecord) return;
        if (objectUrls.current.has(index)) return; // raced
        const url = URL.createObjectURL(blobRecord.blob);
        objectUrls.current.set(index, url);
        forceRender();
      } catch {
        // ignore — placeholder remains
      }
    },
    [pages, forceRender],
  );

  const evictOutside = useCallback(
    (currentIndex: number) => {
      const keepStart = Math.max(0, currentIndex - WINDOW_SIZE - PREFETCH_BEHIND);
      const keepEnd = Math.min(
        pages.length - 1,
        currentIndex + WINDOW_SIZE + PREFETCH_AHEAD,
      );
      let changed = false;
      for (const [index, url] of objectUrls.current.entries()) {
        if (index < keepStart || index > keepEnd) {
          URL.revokeObjectURL(url);
          objectUrls.current.delete(index);
          changed = true;
        }
      }
      if (changed) forceRender();
    },
    [pages.length, forceRender],
  );

  const prefetchWindow = useCallback(
    (currentIndex: number) => {
      const start = Math.max(0, currentIndex - PREFETCH_BEHIND);
      const end = Math.min(pages.length - 1, currentIndex + PREFETCH_AHEAD);
      for (let i = start; i <= end; i++) {
        void loadPage(i);
      }
    },
    [loadPage, pages.length],
  );

  const onCurrentIndexChange = useCallback(
    (index: number) => {
      currentIndexRef.current = index;
      prefetchWindow(index);
      evictOutside(index);
    },
    [prefetchWindow, evictOutside],
  );

  const onHeightMeasured = useCallback((index: number, height: number) => {
    if (height > 0) {
      cachedHeights.current.set(index, height);
    }
  }, []);

  const isInRenderWindow = useCallback((index: number): boolean => {
    const ci = currentIndexRef.current;
    // Match the eviction window so pages that are URL-alive are also rendered.
    return index >= ci - WINDOW_SIZE - PREFETCH_BEHIND && index <= ci + WINDOW_SIZE + PREFETCH_AHEAD;
  }, []);

  const getObjectUrl = useCallback(
    (index: number): string | null => objectUrls.current.get(index) ?? null,
    [],
  );

  const getPlaceholderHeight = useCallback(
    (index: number): number => cachedHeights.current.get(index) ?? ESTIMATED_HEIGHT,
    [],
  );

  const liveCount = useCallback(() => objectUrls.current.size, []);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      for (const url of urls.values()) {
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  }, []);

  return {
    renderRevision,
    isInRenderWindow,
    getObjectUrl,
    getPlaceholderHeight,
    onCurrentIndexChange,
    onHeightMeasured,
    liveCount,
  };
}

export function computeRenderWindow(
  currentIndex: number,
  total: number,
  windowSize = WINDOW_SIZE,
): { start: number; end: number } {
  return {
    start: Math.max(0, currentIndex - windowSize),
    end: Math.min(total - 1, currentIndex + windowSize),
  };
}
