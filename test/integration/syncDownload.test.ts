import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';
import { useBackgroundStore } from '../../src/features/background/background.store';
import { runSyncDownload } from '../../src/features/sync/syncDownload';
import type { CatchUpCandidate } from '../../src/features/sync/catchUp';

const PROFILE = 'p-sd';
const URL_A = 'https://x/a';
beforeEach(async () => {
  await db.delete(); await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now() });
  useBackgroundStore.setState({ current: null });
});
afterEach(() => useBackgroundStore.setState({ current: null }));

const ch = (sid: string, o: number, pc = 5) => createChapter({ seriesId: sid, profileId: PROFILE, title: `c${o}`, order: o, pageCount: pc });

function missing(): CatchUpCandidate {
  return { sourceUrl: URL_A, syncedChapter: 49, syncedPage: 0, seriesId: null, maxOrder: null, initial: true, state: 'missing' };
}

it('missing: creates a shell with sourceUrl + slug title + pendingCatchUp, then clears it on success', async () => {
  let hadPending = false;
  let barDuringImport: unknown = 'unset';
  await runSyncDownload(missing(), {
    profileId: PROFILE,
    runScrape: async () => new Blob(['z']),
    runImport: async (args) => {
      const sid = args.targetSeriesId!;
      hadPending = (await db.series.get(sid))?.pendingCatchUp != null; // set before import
      barDuringImport = useBackgroundStore.getState().current; // should be null — slot handed off
      await ch(sid, 49);
    },
  });
  const s = (await db.series.where('profileId').equals(PROFILE).toArray()).find((x) => x.sourceUrl === URL_A)!;
  expect(s.title).toBe('A'); // slug from https://x/a
  expect(hadPending).toBe(true);
  expect(s.pendingCatchUp ?? null).toBeNull(); // cleared on success
  expect(s.caughtUp).toBe(true);
  expect(useBackgroundStore.getState().current).toBeNull(); // task finished
  expect(barDuringImport).toBeNull(); // scrape task finished before import → importBridge can take the slot
});

it('keeps pendingCatchUp + series shell when the scrape throws (retryable)', async () => {
  await expect(runSyncDownload(missing(), {
    profileId: PROFILE,
    runScrape: async () => { throw new Error('scrape failed'); },
    runImport: async () => { throw new Error('no'); },
  })).rejects.toThrow(/scrape failed/);
  const s = (await db.series.where('profileId').equals(PROFILE).toArray()).find((x) => x.sourceUrl === URL_A)!;
  expect(s.sourceUrl).toBe(URL_A);
  expect(s.pendingCatchUp).toEqual({ syncedChapter: 49, syncedPage: 0 });
  expect(useBackgroundStore.getState().current).toBeNull(); // bar released even on failure
});

it('incomplete outcome (synced chapter never arrives) keeps pendingCatchUp', async () => {
  await runSyncDownload(missing(), {
    profileId: PROFILE,
    runScrape: async () => new Blob(['z']),
    runImport: async (args) => { await ch(args.targetSeriesId!, 50); }, // 49 never arrives
  });
  const s = (await db.series.where('profileId').equals(PROFILE).toArray()).find((x) => x.sourceUrl === URL_A)!;
  expect(s.pendingCatchUp).toEqual({ syncedChapter: 49, syncedPage: 0 }); // NOT cleared
  expect(s.caughtUp ?? false).toBe(false);
});
