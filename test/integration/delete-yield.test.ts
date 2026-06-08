import { describe, it, expect, beforeEach, vi } from 'vitest';

// Replace the real macrotask yield with a fast spy so we assert WIRING
// (called once per batch) deterministically, without timing flakiness.
vi.mock('../../src/db/idbYield', () => ({
  yieldToReads: vi.fn(() => Promise.resolve()),
}));

import { db } from '../../src/db/db';
import { yieldToReads } from '../../src/db/idbYield';
import { createSeries, deleteSeries } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';

const PROFILE = 'p-test';
const yieldSpy = vi.mocked(yieldToReads);

// 300 pages => 2 blob batches + 2 page batches at batch size 250.
const PAGES = 300;
const BATCHES_PER_PHASE = Math.ceil(PAGES / 250); // 2

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({
    id: PROFILE,
    name: 'Tester',
    avatarColor: 'gold',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  });
  yieldSpy.mockClear();
});

/** Seed one series with one chapter holding `n` pages (each with its own blob). */
async function seedSeriesWithPages(n: number) {
  const series = await createSeries({
    profileId: PROFILE,
    title: 'Big Series',
    coverImageId: null,
    chapterCount: 1,
  });
  const chapter = await createChapter({
    seriesId: series.id,
    profileId: PROFILE,
    title: 'Chapter 1',
    order: 1,
    pageCount: n,
  });
  const pages = [];
  const blobs = [];
  for (let i = 0; i < n; i++) {
    const blobId = `b-${series.id}-${i}`;
    blobs.push({ id: blobId, blob: new Blob(['x']) });
    pages.push({ id: `p-${series.id}-${i}`, chapterId: chapter.id, pageNumber: i, blobId });
  }
  await db.blobs.bulkAdd(blobs);
  await db.pages.bulkAdd(pages);
  return { series, chapter };
}

describe('deleteSeries yields between batches', () => {
  it('awaits yieldToReads once per blob batch and once per page batch', async () => {
    const { series } = await seedSeriesWithPages(PAGES);

    await deleteSeries(series.id);

    // No cover blob seeded, so blob batches == page batches == BATCHES_PER_PHASE.
    expect(yieldSpy).toHaveBeenCalledTimes(BATCHES_PER_PHASE * 2);
    // Sanity: the delete still actually deleted everything.
    expect(await db.series.get(series.id)).toBeUndefined();
    expect(await db.pages.count()).toBe(0);
    expect(await db.blobs.count()).toBe(0);
  });
});
