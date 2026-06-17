import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';
import { getProgress } from '../../src/db/repos/progress.repo';
import { catchUpRun } from '../../src/features/sync/catchUpRun';
import type { CatchUpCandidate } from '../../src/features/sync/catchUp';

const PROFILE = 'p-run';
const URL_A = 'https://x/a';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now() });
});

async function ch(seriesId: string, order: number, pageCount = 5) {
  await createChapter({ seriesId, profileId: PROFILE, title: `c${order}`, order, pageCount });
}

it('initial behind catch-up: fetch window, prune below synced, set position, set caughtUp', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  for (const o of [1, 15, 30]) await ch(s.id, o); // local 1..30
  let scraped = '';
  const candidate: CatchUpCandidate = {
    sourceUrl: URL_A, syncedChapter: 49, syncedPage: 2, seriesId: s.id, maxOrder: 30, initial: true, state: 'behind',
  };
  await catchUpRun(candidate, {
    profileId: PROFILE,
    runScrape: async (req) => { scraped = req.args; return new Blob(['zip']); },
    runImport: async () => { await ch(s.id, 49); await ch(s.id, 50); }, // window arrives
  });
  expect(scraped).toBe('--from 49 --to latest');
  const orders = (await db.chapters.where('seriesId').equals(s.id).toArray()).map((c) => c.order).sort((a, b) => a - b);
  expect(orders).toEqual([49, 50]); // 1,15,30 pruned
  const prog = await getProgress(PROFILE, s.id);
  const cur = await db.chapters.get(prog!.currentChapterId);
  expect(cur?.order).toBe(49);
  expect(prog?.pageIndex).toBe(2);
  expect((await db.series.get(s.id))?.caughtUp).toBe(true);
});

it('missing catch-up: import creates the series, no prune, caughtUp set', async () => {
  const candidate: CatchUpCandidate = {
    sourceUrl: URL_A, syncedChapter: 49, syncedPage: 0, seriesId: null, maxOrder: null, initial: true, state: 'missing',
  };
  await catchUpRun(candidate, {
    profileId: PROFILE,
    runScrape: async () => new Blob(['zip']),
    runImport: async () => {
      const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
      await ch(s.id, 49);
    },
  });
  const s = (await db.series.where('profileId').equals(PROFILE).toArray()).find((x) => x.sourceUrl === URL_A);
  expect(s?.caughtUp).toBe(true);
});

it('does NOT prune when the fetch throws', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  for (const o of [1, 15, 30]) await ch(s.id, o);
  const candidate: CatchUpCandidate = {
    sourceUrl: URL_A, syncedChapter: 49, syncedPage: 0, seriesId: s.id, maxOrder: 30, initial: true, state: 'behind',
  };
  await expect(catchUpRun(candidate, {
    profileId: PROFILE,
    runScrape: async () => { throw new Error('scrape failed'); },
    runImport: async () => { throw new Error('should not import'); },
  })).rejects.toThrow(/scrape failed/);
  const orders = (await db.chapters.where('seriesId').equals(s.id).toArray()).map((c) => c.order).sort((a, b) => a - b);
  expect(orders).toEqual([1, 15, 30]); // nothing pruned
});

it('subsequent (caughtUp) update: fetch from localMax+1, no prune', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  await db.series.update(s.id, { caughtUp: true });
  for (const o of [49, 50]) await ch(s.id, o);
  let scraped = '';
  const candidate: CatchUpCandidate = {
    sourceUrl: URL_A, syncedChapter: 70, syncedPage: 1, seriesId: s.id, maxOrder: 50, initial: false, state: 'behind',
  };
  await catchUpRun(candidate, {
    profileId: PROFILE,
    runScrape: async (req) => { scraped = req.args; return new Blob(['zip']); },
    runImport: async () => { await ch(s.id, 70); },
  });
  expect(scraped).toBe('--from 51 --to latest'); // localMax(50)+1
  const orders = (await db.chapters.where('seriesId').equals(s.id).toArray()).map((c) => c.order).sort((a, b) => a - b);
  expect(orders).toEqual([49, 50, 70]); // no prune
});

it('initial: synced chapter absent after fetch → no prune, not caughtUp (retryable)', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  for (const o of [1, 15, 30]) await ch(s.id, o);
  const candidate: CatchUpCandidate = {
    sourceUrl: URL_A, syncedChapter: 49, syncedPage: 0, seriesId: s.id, maxOrder: 30, initial: true, state: 'behind',
  };
  await catchUpRun(candidate, {
    profileId: PROFILE,
    runScrape: async () => new Blob(['zip']),
    runImport: async () => { await ch(s.id, 50); await ch(s.id, 51); }, // 49 itself never arrived
  });
  const orders = (await db.chapters.where('seriesId').equals(s.id).toArray()).map((c) => c.order).sort((a, b) => a - b);
  expect(orders).toEqual([1, 15, 30, 50, 51]); // NOT pruned
  expect((await db.series.get(s.id))?.caughtUp).toBeFalsy(); // retry next sync
});

it('initial: clamps syncedPage to the fetched chapter pageCount', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  await ch(s.id, 30);
  const candidate: CatchUpCandidate = {
    sourceUrl: URL_A, syncedChapter: 49, syncedPage: 10, seriesId: s.id, maxOrder: 30, initial: true, state: 'behind',
  };
  await catchUpRun(candidate, {
    profileId: PROFILE,
    runScrape: async () => new Blob(['zip']),
    runImport: async () => { await ch(s.id, 49, 3); }, // pageCount 3
  });
  const prog = await getProgress(PROFILE, s.id);
  expect(prog?.pageIndex).toBe(2); // min(10, 3-1)
});

it('subsequent: caughtUp stays true (not re-set), no prune', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  await db.series.update(s.id, { caughtUp: true });
  for (const o of [49, 50]) await ch(s.id, o);
  const candidate: CatchUpCandidate = {
    sourceUrl: URL_A, syncedChapter: 70, syncedPage: 0, seriesId: s.id, maxOrder: 50, initial: false, state: 'behind',
  };
  await catchUpRun(candidate, {
    profileId: PROFILE,
    runScrape: async () => new Blob(['zip']),
    runImport: async () => { await ch(s.id, 70); },
  });
  expect((await db.series.get(s.id))?.caughtUp).toBe(true);
  const orders = (await db.chapters.where('seriesId').equals(s.id).toArray()).map((c) => c.order).sort((a, b) => a - b);
  expect(orders).toEqual([49, 50, 70]);
});
