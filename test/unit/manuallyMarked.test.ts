import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db';
import {
  upsertProgress,
  getProgress,
  setManuallyMarked,
} from '../../src/db/repos/progress.repo';

const PROFILE = 'manually-marked-test';
const SERIES = 'series-mm-1';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({
    id: PROFILE,
    name: 'MMTester',
    avatarColor: 'gold',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  });
});

describe('manuallyMarked prevents scroll-based overwrite', () => {
  it('scroll upsert does NOT overwrite manuallyMarked progress', async () => {
    await setManuallyMarked(PROFILE, SERIES, 'chapter-1', true);
    const before = await getProgress(PROFILE, SERIES);
    expect(before?.manuallyMarked).toBe(true);

    // Simulate a scroll-based upsert (no manuallyMarked flag)
    await upsertProgress({
      profileId: PROFILE,
      seriesId: SERIES,
      currentChapterId: 'chapter-2',
      pageIndex: 42,
      scrollPosition: 9999,
    });

    const after = await getProgress(PROFILE, SERIES);
    // Progress should be unchanged
    expect(after?.manuallyMarked).toBe(true);
    expect(after?.currentChapterId).toBe('chapter-1');
  });

  it('explicit manuallyMarked=true upsert overwrites existing progress', async () => {
    await upsertProgress({
      profileId: PROFILE,
      seriesId: SERIES,
      currentChapterId: 'chapter-1',
      pageIndex: 1,
      scrollPosition: 100,
    });

    await upsertProgress({
      profileId: PROFILE,
      seriesId: SERIES,
      currentChapterId: 'chapter-5',
      pageIndex: 99,
      scrollPosition: 5000,
      manuallyMarked: true,
    });

    const rec = await getProgress(PROFILE, SERIES);
    expect(rec?.currentChapterId).toBe('chapter-5');
    expect(rec?.pageIndex).toBe(99);
    expect(rec?.manuallyMarked).toBe(true);
  });
});
