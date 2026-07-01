import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';
import { getProgress, upsertProgress } from '../../src/db/repos/progress.repo';
import { runChunkedCatchUp } from '../../src/features/sync/catchUpRun';
import { setDownloadBatchSize } from '../../src/features/sync/chunking';
import type { CatchUpCandidate } from '../../src/features/sync/catchUp';

const PROFILE = 'p-chunk';
const URL_A = 'https://x/a';

beforeEach(async () => {
  await db.delete(); await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now() });
  setDownloadBatchSize(10);
});

const mk = (sid: string, o: number) => createChapter({ seriesId: sid, profileId: PROFILE, title: `c${o}`, order: o, pageCount: 5 });
const orders = async (sid: string) => (await db.chapters.where('seriesId').equals(sid).toArray()).map((c) => c.order).sort((a, b) => a - b);

/** Fake scrape+import for a source with chapters 1..LATEST. scrape(`--from A --to B`)
 *  records args, throws the terminator when A > LATEST, else returns a blob tagged
 *  "A,min(B,LATEST)"; import creates those chapters (skipping existing). */
function fakeDeps(sid: string, LATEST: number, calls: string[]) {
  return {
    profileId: PROFILE,
    runScrape: async ({ args }: { url: string; args: string }) => {
      calls.push(args);
      const m = args.match(/--from (\d+) --to (\d+)/)!;
      const from = Number(m[1]); const to = Number(m[2]);
      if (from > LATEST) throw new Error('ERR_NO_CHAPTERS_IN_RANGE: No chapters found in range');
      return { blob: new Blob([`${from},${Math.min(to, LATEST)}`]), partial: false };
    },
    runImport: async (a: { file: File }) => {
      const [f, t] = (await a.file.text()).split(',').map(Number);
      for (let o = f; o <= t; o++) {
        const ex = await db.chapters.where('[seriesId+order]').equals([sid, o]).first();
        if (!ex) await mk(sid, o);
      }
    },
  };
}

it('initial behind: bounded batches from synced until empty; prunes below synced; position; caughtUp', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  for (const o of [1, 30]) await mk(s.id, o); // behind: local 1,30; synced 49
  const calls: string[] = [];
  const c: CatchUpCandidate = { sourceUrl: URL_A, syncedChapter: 49, syncedPage: 2, seriesId: s.id, maxOrder: 30, initial: true, state: 'behind' };
  const outcome = await runChunkedCatchUp(c, fakeDeps(s.id, 73, calls));
  expect(outcome).toBe('done');
  expect(calls).toEqual(['--from 49 --to 58', '--from 59 --to 68', '--from 69 --to 78', '--from 79 --to 88']);
  expect(await orders(s.id)).toEqual(Array.from({ length: 25 }, (_, i) => 49 + i)); // 49..73; 1,30 pruned
  const prog = await getProgress(PROFILE, s.id);
  expect((await db.chapters.get(prog!.currentChapterId))?.order).toBe(49);
  expect(prog?.pageIndex).toBe(2);
  expect((await db.series.get(s.id))?.caughtUp).toBe(true);
});

it('read-as-it-arrives: position set after the FIRST batch, before the loop ends', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  // 'missing' state, but seriesId is the shell's — ensureSeriesShell ran upstream.
  const c: CatchUpCandidate = { sourceUrl: URL_A, syncedChapter: 49, syncedPage: 0, seriesId: s.id, maxOrder: 0, initial: true, state: 'missing' };
  let posAfterFirst = false;
  await runChunkedCatchUp(c, {
    profileId: PROFILE,
    runScrape: async ({ args }: { url: string; args: string }) => { const f = Number(args.match(/--from (\d+)/)![1]); if (f > 58) throw new Error('ERR_NO_CHAPTERS_IN_RANGE'); return { blob: new Blob([`${f},${f + 9}`]), partial: false }; },
    runImport: async (a: { file: File }) => { const [f, t] = (await a.file.text()).split(',').map(Number); for (let o = f; o <= t; o++) await mk(s.id, o); },
    onBatch: async () => { if (!posAfterFirst) posAfterFirst = (await getProgress(PROFILE, s.id))?.currentChapterId != null; },
  });
  expect(posAfterFirst).toBe(true);
});

it('resume: starts at localMax+1 (no re-fetch), does not regress position, sets caughtUp', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  for (let o = 49; o <= 60; o++) await mk(s.id, o); // already have 49..60
  const ch55 = await db.chapters.where('[seriesId+order]').equals([s.id, 55]).first();
  await upsertProgress({ profileId: PROFILE, seriesId: s.id, currentChapterId: ch55!.id, pageIndex: 1, scrollPosition: 0 }); // user advanced to 55
  const calls: string[] = [];
  const c: CatchUpCandidate = { sourceUrl: URL_A, syncedChapter: 49, syncedPage: 0, seriesId: s.id, maxOrder: 60, initial: true, state: 'behind' };
  await runChunkedCatchUp(c, fakeDeps(s.id, 73, calls));
  expect(calls[0]).toBe('--from 61 --to 70'); // resume starts past local 60, no re-fetch of 49..60
  const prog = await getProgress(PROFILE, s.id);
  expect((await db.chapters.get(prog!.currentChapterId))?.order).toBe(55); // NOT regressed to 49
  expect((await db.series.get(s.id))?.caughtUp).toBe(true);
  expect(await orders(s.id)).toEqual(Array.from({ length: 25 }, (_, i) => 49 + i)); // 49..73
});

it('non-terminator scrape error rejects (resumable); caughtUp not set', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  const c: CatchUpCandidate = { sourceUrl: URL_A, syncedChapter: 49, syncedPage: 0, seriesId: s.id, maxOrder: 0, initial: true, state: 'behind' };
  await expect(runChunkedCatchUp(c, {
    profileId: PROFILE,
    runScrape: async () => { throw new Error('Remote scrape failed.'); },
    runImport: async () => {},
  })).rejects.toThrow(/scrape failed/);
  expect((await db.series.get(s.id))?.caughtUp ?? false).toBe(false);
});

it('empty first batch (synced never arrives) → incomplete, no prune, not caughtUp', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  for (const o of [1, 30]) await mk(s.id, o);
  const c: CatchUpCandidate = { sourceUrl: URL_A, syncedChapter: 49, syncedPage: 0, seriesId: s.id, maxOrder: 30, initial: true, state: 'behind' };
  const outcome = await runChunkedCatchUp(c, {
    profileId: PROFILE,
    runScrape: async () => { throw new Error('ERR_NO_CHAPTERS_IN_RANGE'); },
    runImport: async () => {},
  });
  expect(outcome).toBe('incomplete');
  expect(await orders(s.id)).toEqual([1, 30]); // NOT pruned
  expect((await db.series.get(s.id))?.caughtUp ?? false).toBe(false);
});

it('partial batch (rate limited): imports it, advances localMax, stops WITHOUT setting caughtUp (resumable)', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  for (const o of [1, 30]) await mk(s.id, o); // behind: local 1,30; synced 49
  const calls: string[] = [];
  // First batch (49..58) comes back PARTIAL: only 49..52 imported, then the loop must stop.
  const outcome = await runChunkedCatchUp(
    { sourceUrl: URL_A, syncedChapter: 49, syncedPage: 2, seriesId: s.id, maxOrder: 30, initial: true, state: 'behind' },
    {
      profileId: PROFILE,
      runScrape: async ({ args }: { url: string; args: string }) => {
        calls.push(args);
        return { blob: new Blob(['49,52']), partial: true };
      },
      runImport: async (a: { file: File }) => {
        const [f, t] = (await a.file.text()).split(',').map(Number);
        for (let o = f; o <= t; o++) await mk(s.id, o);
      },
    },
  );
  expect(outcome).toBe('partial');
  expect(calls).toEqual(['--from 49 --to 58']); // stopped after the one partial batch
  expect(await orders(s.id)).toEqual([49, 50, 51, 52]); // imported + pruned below synced 49
  const prog = await getProgress(PROFILE, s.id);
  expect((await db.chapters.get(prog!.currentChapterId))?.order).toBe(49); // positioned at synced
  expect((await db.series.get(s.id))?.caughtUp ?? false).toBe(false); // NOT caught up — resumable
});

it('non-initial update: starts at maxOrder+1, no prune, sets caughtUp, done', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  await db.series.update(s.id, { caughtUp: true });
  for (let o = 49; o <= 60; o++) await mk(s.id, o);
  const calls: string[] = [];
  const c: CatchUpCandidate = { sourceUrl: URL_A, syncedChapter: 70, syncedPage: 0, seriesId: s.id, maxOrder: 60, initial: false, state: 'behind' };
  const outcome = await runChunkedCatchUp(c, fakeDeps(s.id, 73, calls));
  expect(outcome).toBe('done');
  expect(calls[0]).toBe('--from 61 --to 70'); // maxOrder+1 = 61, clamped == localMax+1
  expect(await orders(s.id)).toEqual(Array.from({ length: 25 }, (_, i) => 49 + i)); // 49..73, nothing pruned
  expect((await db.series.get(s.id))?.caughtUp).toBe(true);
});
