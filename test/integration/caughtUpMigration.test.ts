import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries } from '../../src/db/repos/series.repo';

const PROFILE = 'p-mig';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({
    id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now(),
  });
});

describe('caughtUp field', () => {
  it('defaults new series to caughtUp=false', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null });
    const fresh = await db.series.get(s.id);
    expect(fresh?.caughtUp).toBe(false);
  });
});
