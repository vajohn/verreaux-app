import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { db } from '../../src/db/db';
import {
  useVirtualization,
  WINDOW_SIZE,
  PREFETCH_AHEAD,
  PREFETCH_BEHIND,
} from '../../src/features/reader/useVirtualization';
import type { PageMeta } from '../../src/features/reader/reader.store';

function mkPages(chapterId: string, count: number, base = 0): PageMeta[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${chapterId}-p${i + base}`,
    blobId: `${chapterId}-b${i + base}`,
    chapterId,
    pageNumber: i,
  }));
}

async function seedBlobs(pages: PageMeta[]): Promise<void> {
  for (const p of pages) {
    await db.blobs.put({ id: p.blobId, blob: new Blob([p.id], { type: 'image/jpeg' }) });
  }
}

// jsdom in this project doesn't ship URL.createObjectURL; stub it so the hook
// can record cache hits without a real blob URL.
let urlCounter = 0;
const createdUrls = new Set<string>();
const revokedUrls = new Set<string>();
beforeEach(async () => {
  await db.delete();
  await db.open();
  urlCounter = 0;
  createdUrls.clear();
  revokedUrls.clear();
  globalThis.URL.createObjectURL = vi.fn(() => {
    const url = `blob:mock-${urlCounter++}`;
    createdUrls.add(url);
    return url;
  });
  globalThis.URL.revokeObjectURL = vi.fn((url: string) => {
    revokedUrls.add(url);
  });
});

async function flushAsync(): Promise<void> {
  // Wait two microtask flushes + a macrotask so loadPage's async db.blobs.get
  // resolves and the resulting setState commits.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('useVirtualization', () => {
  it('caches URLs by page id, not by flat index', async () => {
    const chA = mkPages('chA', 20);
    await seedBlobs(chA);
    const { result, rerender } = renderHook(({ pages }) => useVirtualization(pages), {
      initialProps: { pages: chA },
    });

    await flushAsync();
    const urlAtIndex5 = result.current.getObjectUrl(5);
    expect(urlAtIndex5).toMatch(/^blob:mock-/);
    expect(createdUrls.has(urlAtIndex5!)).toBe(true);

    // Replace the pages array with a different chapter sharing the same length
    // but completely different page ids. Index 5 must NOT return the cached
    // URL from chapter A.
    const chB = mkPages('chB', 20);
    await seedBlobs(chB);
    rerender({ pages: chB });
    // Before any flush, the cache should be cleared for chB ids (no URL yet).
    expect(result.current.getObjectUrl(5)).toBeNull();
    // Chapter A's URL should be revoked since none of its ids are present in chB.
    expect(revokedUrls.has(urlAtIndex5!)).toBe(true);

    await flushAsync();
    const urlAtIndex5InB = result.current.getObjectUrl(5);
    expect(urlAtIndex5InB).toMatch(/^blob:mock-/);
    expect(urlAtIndex5InB).not.toBe(urlAtIndex5);
  });

  it('resets currentIndex tracker on chapter switch so leading slots are in window', async () => {
    const chA = mkPages('chA', 60);
    await seedBlobs(chA);
    const { result, rerender } = renderHook(({ pages }) => useVirtualization(pages), {
      initialProps: { pages: chA },
    });
    await flushAsync();
    // Move "scroll" deep into chapter A.
    act(() => result.current.onCurrentIndexChange(55));
    await flushAsync();

    // Switch to chapter B (a different array).
    const chB = mkPages('chB', 20);
    await seedBlobs(chB);
    rerender({ pages: chB });

    // Index 0 of chB MUST be considered in-window post-switch. Pre-fix this
    // returned false because currentIndexRef still pointed at 55.
    expect(result.current.isInRenderWindow(0)).toBe(true);
    // And the tail of the OLD chapter is no longer in window.
    expect(result.current.isInRenderWindow(WINDOW_SIZE + PREFETCH_AHEAD + 1)).toBe(false);
  });

  it('evicts URLs for pages not in the new array', async () => {
    const chA = mkPages('chA', 10);
    await seedBlobs(chA);
    const { result, rerender } = renderHook(({ pages }) => useVirtualization(pages), {
      initialProps: { pages: chA },
    });
    await flushAsync();
    const beforeCount = result.current.liveCount();
    expect(beforeCount).toBeGreaterThan(0);

    rerender({ pages: [] });
    // All previously-cached URLs reference pages that are no longer present →
    // all must be revoked.
    expect(result.current.liveCount()).toBe(0);
    for (const url of createdUrls) {
      expect(revokedUrls.has(url)).toBe(true);
    }
  });

  it('preserves cached URLs for pages that remain across rerenders', async () => {
    const chA = mkPages('chA', 10);
    await seedBlobs(chA);
    const { result, rerender } = renderHook(({ pages }) => useVirtualization(pages), {
      initialProps: { pages: chA },
    });
    await flushAsync();
    const urlBefore = result.current.getObjectUrl(0);
    expect(urlBefore).toMatch(/^blob:mock-/);

    // A new array reference with identical page ids (e.g. autoNextChapter toggle
    // that rebuilds the flat list but keeps current chapter at the head) must
    // NOT revoke cached URLs whose ids are still present.
    const chAClone = [...chA];
    rerender({ pages: chAClone });
    expect(result.current.getObjectUrl(0)).toBe(urlBefore);
    expect(revokedUrls.has(urlBefore!)).toBe(false);
  });

  it('seeds prefetch window around index 0 after chapter switch', async () => {
    const chA = mkPages('chA', 5);
    await seedBlobs(chA);
    const { result, rerender } = renderHook(({ pages }) => useVirtualization(pages), {
      initialProps: { pages: chA },
    });
    await flushAsync();

    const chB = mkPages('chB', 5 + PREFETCH_AHEAD + PREFETCH_BEHIND);
    await seedBlobs(chB);
    rerender({ pages: chB });
    await flushAsync();

    // After a chapter switch, leading slots of the new chapter must have URLs
    // available — without this the user sees placeholders after clicking Next.
    expect(result.current.getObjectUrl(0)).toMatch(/^blob:mock-/);
  });
});
