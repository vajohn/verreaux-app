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
  // Cache keys are page IDs (stable across chapter switches), not flat indices.
  // Index-keyed caches got poisoned on chapter switch: index 5 in chapter A and
  // index 5 in chapter B point to different blobs, but the Map hit returned the
  // stale URL from A. Page IDs are unique per page record and survive remounts.
  const objectUrls = useRef<Map<string, string>>(new Map());
  const cachedHeights = useRef<Map<string, number>>(new Map());
  const pagesRef = useRef<PageMeta[]>(pages);
  pagesRef.current = pages;
  const [renderRevision, setRenderRevision] = useState(0);
  const currentIndexRef = useRef(0);

  const forceRender = useCallback(() => setRenderRevision((r) => r + 1), []);

  const loadPage = useCallback(
    async (index: number) => {
      const page = pagesRef.current[index];
      if (!page) return;
      if (objectUrls.current.has(page.id)) return;
      try {
        const blobRecord = await db.blobs.get(page.blobId);
        if (!blobRecord) return;
        if (objectUrls.current.has(page.id)) return; // raced
        const url = URL.createObjectURL(blobRecord.blob);
        objectUrls.current.set(page.id, url);
        forceRender();
      } catch {
        // ignore — placeholder remains
      }
    },
    [forceRender],
  );

  const evictOutside = useCallback(
    (currentIndex: number) => {
      const list = pagesRef.current;
      const keepStart = Math.max(0, currentIndex - WINDOW_SIZE - PREFETCH_BEHIND);
      const keepEnd = Math.min(
        list.length - 1,
        currentIndex + WINDOW_SIZE + PREFETCH_AHEAD,
      );
      const keepIds = new Set<string>();
      for (let i = keepStart; i <= keepEnd; i++) {
        const p = list[i];
        if (p) keepIds.add(p.id);
      }
      let changed = false;
      for (const [id, url] of objectUrls.current.entries()) {
        if (!keepIds.has(id)) {
          URL.revokeObjectURL(url);
          objectUrls.current.delete(id);
          changed = true;
        }
      }
      if (changed) forceRender();
    },
    [forceRender],
  );

  const prefetchWindow = useCallback(
    (currentIndex: number) => {
      const list = pagesRef.current;
      const start = Math.max(0, currentIndex - PREFETCH_BEHIND);
      const end = Math.min(list.length - 1, currentIndex + PREFETCH_AHEAD);
      for (let i = start; i <= end; i++) {
        void loadPage(i);
      }
    },
    [loadPage],
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
    if (height <= 0) return;
    const p = pagesRef.current[index];
    if (!p) return;
    cachedHeights.current.set(p.id, height);
  }, []);

  const isInRenderWindow = useCallback((index: number): boolean => {
    const ci = currentIndexRef.current;
    // Match the eviction window so pages that are URL-alive are also rendered.
    return index >= ci - WINDOW_SIZE - PREFETCH_BEHIND && index <= ci + WINDOW_SIZE + PREFETCH_AHEAD;
  }, []);

  const getObjectUrl = useCallback(
    (index: number): string | null => {
      const p = pagesRef.current[index];
      if (!p) return null;
      return objectUrls.current.get(p.id) ?? null;
    },
    [],
  );

  const getPlaceholderHeight = useCallback(
    (index: number): number => {
      const p = pagesRef.current[index];
      if (!p) return ESTIMATED_HEIGHT;
      return cachedHeights.current.get(p.id) ?? ESTIMATED_HEIGHT;
    },
    [],
  );

  const liveCount = useCallback(() => objectUrls.current.size, []);

  // When the pages array identity changes (chapter switch, autoNext toggle,
  // reimport), reset the index tracker, garbage-collect URLs no longer in the
  // new list, and seed prefetch around index 0. Without this, currentIndexRef
  // carries the prior chapter's tail index and isInRenderWindow returns false
  // for the new chapter's leading slots — leaving them rendered as placeholders.
  useEffect(() => {
    const knownIds = new Set(pages.map((p) => p.id));
    let changed = false;
    for (const [id, url] of objectUrls.current.entries()) {
      if (!knownIds.has(id)) {
        URL.revokeObjectURL(url);
        objectUrls.current.delete(id);
        changed = true;
      }
    }
    // Drop cached heights for pages no longer present too — they'd never be
    // reused and just leak memory across long sessions of reimport churn.
    for (const id of cachedHeights.current.keys()) {
      if (!knownIds.has(id)) cachedHeights.current.delete(id);
    }
    currentIndexRef.current = 0;
    if (changed) forceRender();
    if (pages.length > 0) {
      prefetchWindow(0);
    }
  }, [pages, forceRender, prefetchWindow]);

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
