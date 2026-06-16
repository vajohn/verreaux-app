import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries, deleteSeries, normalizeTitle, setSourceUrl } from '../../src/db/repos/series.repo';
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

  it('defaults sourceUrl to null on create', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'NoSource', coverImageId: null });
    expect(s.sourceUrl).toBeNull();
  });

  it('persists a sourceUrl via createSeries input', async () => {
    const s = await createSeries({
      profileId: PROFILE,
      title: 'WithSource',
      coverImageId: null,
      sourceUrl: 'https://qimanhwa.com/series/x',
    });
    const reloaded = await db.series.get(s.id);
    expect(reloaded?.sourceUrl).toBe('https://qimanhwa.com/series/x');
  });

  it('back-fills sourceUrl on an existing series via setSourceUrl', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'Backfill', coverImageId: null });
    await setSourceUrl(s.id, 'https://manhwanex.com/series/y');
    expect((await db.series.get(s.id))?.sourceUrl).toBe('https://manhwanex.com/series/y');
    await setSourceUrl(s.id, null);
    expect((await db.series.get(s.id))?.sourceUrl).toBeNull();
  });
});
