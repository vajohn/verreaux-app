import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';
import { upsertProgress, getProgress } from '../../src/db/repos/progress.repo';
import { localPositionsByUrl, applyServerPosition } from '../../src/features/sync/syncTargets';

const PROFILE = 'p-sync';
beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: 1, lastActiveAt: 1 });
});

describe('syncTargets', () => {
  it('builds a sourceUrl -> {chapterOrder,pageIndex} map from local progress', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'X', coverImageId: null, sourceUrl: 'https://x/s' });
    const c = await createChapter({ seriesId: s.id, profileId: PROFILE, title: 'C3', order: 3, pageCount: 10 });
    await upsertProgress({ profileId: PROFILE, seriesId: s.id, currentChapterId: c.id, pageIndex: 4, scrollPosition: 0 });
    const map = await localPositionsByUrl(PROFILE);
    expect(map.get('https://x/s')).toEqual({ chapterOrder: 3, pageIndex: 4 });
  });

  it('applies a server position by resolving sourceUrl->series and order->chapter', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'X', coverImageId: null, sourceUrl: 'https://x/s' });
    const c5 = await createChapter({ seriesId: s.id, profileId: PROFILE, title: 'C5', order: 5, pageCount: 20 });
    await applyServerPosition(PROFILE, { sourceUrl: 'https://x/s', chapterOrder: 5, pageIndex: 7, manuallyMarked: false });
    const prog = await getProgress(PROFILE, s.id);
    expect(prog?.currentChapterId).toBe(c5.id);
    expect(prog?.pageIndex).toBe(7);
  });

  it('skips applying when the series or chapter-order is not present locally', async () => {
    await applyServerPosition(PROFILE, { sourceUrl: 'https://missing', chapterOrder: 1, pageIndex: 0, manuallyMarked: false });
    const s = await createSeries({ profileId: PROFILE, title: 'X', coverImageId: null, sourceUrl: 'https://x/s' });
    await applyServerPosition(PROFILE, { sourceUrl: 'https://x/s', chapterOrder: 99, pageIndex: 0, manuallyMarked: false });
    expect(await getProgress(PROFILE, s.id)).toBeUndefined();
  });
});
