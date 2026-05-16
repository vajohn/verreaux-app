import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db';
import {
  upsertProgress,
  getProgress,
  deleteProgress,
  setManuallyMarked,
} from '../../src/db/repos/progress.repo';

const PROFILE = 'test-profile';

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

describe('progress.repo', () => {
  it('upserts and reads progress', async () => {
    await upsertProgress({
      profileId: PROFILE,
      seriesId: 's1',
      currentChapterId: 'c1',
      pageIndex: 5,
      scrollPosition: 1234,
    });
    const rec = await getProgress(PROFILE, 's1');
    expect(rec).toBeDefined();
    expect(rec!.pageIndex).toBe(5);
    expect(rec!.manuallyMarked).toBe(false);
  });

  it('manuallyMarked blocks scroll-based overwrite', async () => {
    await setManuallyMarked(PROFILE, 's1', 'c1', true);
    await upsertProgress({
      profileId: PROFILE,
      seriesId: 's1',
      currentChapterId: 'c1',
      pageIndex: 999,
      scrollPosition: 100,
    });
    const rec = await getProgress(PROFILE, 's1');
    expect(rec!.manuallyMarked).toBe(true);
    expect(rec!.pageIndex).toBe(0); // unchanged
  });

  it('deletes progress for a series scope', async () => {
    await upsertProgress({
      profileId: PROFILE,
      seriesId: 's1',
      currentChapterId: 'c1',
      pageIndex: 1,
      scrollPosition: 1,
    });
    await deleteProgress(PROFILE, 's1');
    expect(await getProgress(PROFILE, 's1')).toBeUndefined();
  });
});
