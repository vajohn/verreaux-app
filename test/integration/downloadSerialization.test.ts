import { it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db/db';
import { useBackgroundStore } from '../../src/features/background/background.store';
import { enqueueLiveDownloads } from '../../src/features/sync/defaultCatchUp';
import type { CatchUpCandidate } from '../../src/features/sync/catchUp';

const PROFILE = 'p-serial';
const URL_A = 'https://x/a';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now() });
  useBackgroundStore.setState({ current: null });
});

afterEach(() => {
  useBackgroundStore.setState({ current: null });
});

function missingCandidate(): CatchUpCandidate {
  return { sourceUrl: URL_A, syncedChapter: 49, syncedPage: 0, seriesId: null, maxOrder: null, initial: true, state: 'missing' };
}

/**
 * When the bg slot is already occupied, enqueueLiveDownloads must early-return
 * without running any import — no chapters should be created, no series shell.
 */
it('enqueueLiveDownloads is a no-op when the bg slot is busy', async () => {
  // Occupy the single slot manually.
  const occupied = useBackgroundStore.getState().start({ id: 'busy', kind: 'import', label: 'busy', progress: null });
  expect(occupied).toBe(true);

  const candidate = missingCandidate();

  await enqueueLiveDownloads([candidate], PROFILE);

  // No series shells created.
  const series = await db.series.where('profileId').equals(PROFILE).toArray();
  expect(series).toHaveLength(0);

  // The original slot is still held (our early-return did not finish it).
  expect(useBackgroundStore.getState().current?.id).toBe('busy');
});
