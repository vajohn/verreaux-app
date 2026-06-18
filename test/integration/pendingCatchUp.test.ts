import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries, setPendingCatchUp } from '../../src/db/repos/series.repo';

const PROFILE = 'p-pcu';
beforeEach(async () => {
  await db.delete(); await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now() });
});

describe('pendingCatchUp', () => {
  it('defaults new series to pendingCatchUp null and round-trips set/clear', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null });
    expect((await db.series.get(s.id))?.pendingCatchUp ?? null).toBeNull();
    await setPendingCatchUp(s.id, { syncedChapter: 49, syncedPage: 2 });
    expect((await db.series.get(s.id))?.pendingCatchUp).toEqual({ syncedChapter: 49, syncedPage: 2 });
    await setPendingCatchUp(s.id, null);
    expect((await db.series.get(s.id))?.pendingCatchUp ?? null).toBeNull();
  });
});
