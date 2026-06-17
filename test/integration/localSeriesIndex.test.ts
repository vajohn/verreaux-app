import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries, setCaughtUp } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';
import { localSeriesIndexByUrl } from '../../src/features/sync/catchUp';

const PROFILE = 'p-idx';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now() });
});

describe('localSeriesIndexByUrl', () => {
  it('indexes series with a sourceUrl by maxOrder + caughtUp; skips those without a sourceUrl', async () => {
    const a = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: 'https://x/a' });
    await createChapter({ seriesId: a.id, profileId: PROFILE, title: 'c30', order: 30, pageCount: 1 });
    await createChapter({ seriesId: a.id, profileId: PROFILE, title: 'c49', order: 49, pageCount: 1 });
    await setCaughtUp(a.id);
    const b = await createSeries({ profileId: PROFILE, title: 'B', coverImageId: null, sourceUrl: 'https://x/b' }); // no chapters
    await createSeries({ profileId: PROFILE, title: 'C', coverImageId: null }); // no sourceUrl → skipped

    const idx = await localSeriesIndexByUrl(PROFILE);
    expect(idx.size).toBe(2);
    expect(idx.get('https://x/a')).toEqual({ seriesId: a.id, maxOrder: 49, caughtUp: true });
    expect(idx.get('https://x/b')).toEqual({ seriesId: b.id, maxOrder: 0, caughtUp: false });
  });
});
