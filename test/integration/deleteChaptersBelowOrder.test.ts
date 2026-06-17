import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries, setCaughtUp, deleteChaptersBelowOrder } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';

const PROFILE = 'p-prune';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now() });
});

async function seedChapter(seriesId: string, order: number) {
  const ch = await createChapter({ seriesId, profileId: PROFILE, title: `c${order}`, order, pageCount: 1 });
  const blobId = `blob-${seriesId}-${order}`;
  await db.blobs.add({ id: blobId, blob: new Blob(['x']) });
  await db.pages.add({ id: `pg-${seriesId}-${order}`, chapterId: ch.id, pageNumber: 0, blobId });
  return ch;
}

describe('deleteChaptersBelowOrder', () => {
  it('deletes chapters strictly below the order, keeping the synced chapter and above', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null });
    for (const o of [1, 30, 49, 60]) await seedChapter(s.id, o);
    await db.series.update(s.id, { chapterCount: 4 });

    const removed = await deleteChaptersBelowOrder(s.id, 49);

    expect(removed).toBe(2); // orders 1 and 30
    const orders = (await db.chapters.where('seriesId').equals(s.id).toArray()).map((c) => c.order).sort((a, b) => a - b);
    expect(orders).toEqual([49, 60]);
    expect(await db.blobs.count()).toBe(2); // blobs for 1 and 30 gone
    expect(await db.pages.count()).toBe(2); // page rows for orders 1 and 30 removed
    expect((await db.series.get(s.id))?.chapterCount).toBe(2);
  });

  it('is a no-op when nothing is below the order', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'B', coverImageId: null });
    await seedChapter(s.id, 49);
    expect(await deleteChaptersBelowOrder(s.id, 49)).toBe(0);
  });

  it('setCaughtUp flips the flag', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'C', coverImageId: null });
    await setCaughtUp(s.id);
    expect((await db.series.get(s.id))?.caughtUp).toBe(true);
  });

  it('deletes a fractional chapter below the boundary', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'F', coverImageId: null });
    for (const o of [48.5, 49, 50]) await seedChapter(s.id, o);
    const removed = await deleteChaptersBelowOrder(s.id, 49);
    expect(removed).toBe(1); // 48.5 only
    const orders = (await db.chapters.where('seriesId').equals(s.id).toArray()).map((c) => c.order).sort((a, b) => a - b);
    expect(orders).toEqual([49, 50]);
  });

  it('removes bookmarks belonging to pruned chapters', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'BM', coverImageId: null });
    const below = await seedChapter(s.id, 30);
    const kept = await seedChapter(s.id, 49);
    await db.bookmarks.add({ id: 'bm-below', profileId: PROFILE, seriesId: s.id, chapterId: below.id, pageIndex: 0, scrollOffset: 0, createdAt: Date.now(), note: null });
    await db.bookmarks.add({ id: 'bm-kept', profileId: PROFILE, seriesId: s.id, chapterId: kept.id, pageIndex: 0, scrollOffset: 0, createdAt: Date.now(), note: null });
    await deleteChaptersBelowOrder(s.id, 49);
    expect(await db.bookmarks.get('bm-below')).toBeUndefined();
    expect(await db.bookmarks.get('bm-kept')).toBeTruthy();
  });
});
