import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries, deleteSeries, normalizeTitle } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';

const PROFILE = 'p-test';

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
});

describe('normalizeTitle', () => {
  it('lowercases and trims', () => {
    expect(normalizeTitle('  Solo Leveling  ')).toBe('solo leveling');
  });
});

describe('series.repo', () => {
  it('cascades delete down to chapters and blobs', async () => {
    const blobId = 'blob-1';
    await db.blobs.add({ id: blobId, blob: new Blob(['hi']) });
    const s = await createSeries({
      profileId: PROFILE,
      title: 'Demo',
      coverImageId: blobId,
      chapterCount: 1,
    });
    await createChapter({
      seriesId: s.id,
      profileId: PROFILE,
      title: 'Chapter 1',
      order: 1,
      pageCount: 0,
    });
    await deleteSeries(s.id);
    expect(await db.series.get(s.id)).toBeUndefined();
    expect(await db.chapters.where('seriesId').equals(s.id).count()).toBe(0);
    expect(await db.blobs.get(blobId)).toBeUndefined();
  });
});
