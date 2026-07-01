import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';
import { useBackgroundStore } from '../../src/features/background/background.store';
import { runSyncDownload } from '../../src/features/sync/syncDownload';
import { setDownloadBatchSize } from '../../src/features/sync/chunking';
import type { CatchUpCandidate } from '../../src/features/sync/catchUp';

const PROFILE = 'p-sd';
const URL_A = 'https://x/a';
beforeEach(async () => {
  await db.delete(); await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now() });
  useBackgroundStore.setState({ current: null });
  setDownloadBatchSize(10);
});
afterEach(() => useBackgroundStore.setState({ current: null }));

const ch = (sid: string, o: number, pc = 5) => createChapter({ seriesId: sid, profileId: PROFILE, title: `c${o}`, order: o, pageCount: pc });

function missing(): CatchUpCandidate {
  return { sourceUrl: URL_A, syncedChapter: 49, syncedPage: 0, seriesId: null, maxOrder: null, initial: true, state: 'missing' };
}

it('missing: creates a shell with sourceUrl + slug title + pendingCatchUp, then clears it on success', async () => {
  let hadPending = false;
  let barDuringImport: unknown = 'unset';
  // Fake: source has chapters up to 58 (one batch: 49..58), then empty.
  const LATEST = 58;
  await runSyncDownload(missing(), {
    profileId: PROFILE,
    runScrape: async (req, _onState) => {
      const m = req.args.match(/--from (\d+) --to (\d+)/)!;
      const from = Number(m[1]); const to = Number(m[2]);
      if (from > LATEST) throw new Error('ERR_NO_CHAPTERS_IN_RANGE: No chapters found in range');
      return { blob: new Blob([`${from},${Math.min(to, LATEST)}`]), partial: false };
    },
    runImport: async (args) => {
      const sid = args.targetSeriesId!;
      hadPending = (await db.series.get(sid))?.pendingCatchUp != null; // set before import
      barDuringImport = useBackgroundStore.getState().current; // slot must stay held during import
      const [f, t] = (await args.file.text()).split(',').map(Number);
      for (let o = f; o <= t; o++) await ch(sid, o);
    },
  });
  const s = (await db.series.where('profileId').equals(PROFILE).toArray()).find((x) => x.sourceUrl === URL_A)!;
  expect(s.title).toBe('A'); // slug from https://x/a
  expect(hadPending).toBe(true);
  expect(s.pendingCatchUp ?? null).toBeNull(); // cleared on success
  expect(s.caughtUp).toBe(true);
  expect(useBackgroundStore.getState().current).toBeNull(); // task finished
  expect(barDuringImport).not.toBeNull();              // slot stays held → serializes the worker
  expect((barDuringImport as { kind?: string } | null)?.kind).toBe('sync-download');
});

it('keeps pendingCatchUp + series shell when the scrape throws (retryable)', async () => {
  await expect(runSyncDownload(missing(), {
    profileId: PROFILE,
    runScrape: async (_req, _onState) => { throw new Error('scrape failed'); },
    runImport: async () => { throw new Error('no'); },
  })).rejects.toThrow(/scrape failed/);
  const s = (await db.series.where('profileId').equals(PROFILE).toArray()).find((x) => x.sourceUrl === URL_A)!;
  expect(s.sourceUrl).toBe(URL_A);
  expect(s.pendingCatchUp).toEqual({ syncedChapter: 49, syncedPage: 0 });
  expect(useBackgroundStore.getState().current).toBeNull(); // bar released even on failure
});

it('partial (rate-limited) batch imports what arrived and keeps pendingCatchUp for resume', async () => {
  await runSyncDownload(missing(), {
    profileId: PROFILE,
    // Rate-limited: the run comes back partial with chapters 49..52.
    runScrape: async (_req, _onState) => ({ blob: new Blob(['49,52']), partial: true }),
    runImport: async (args) => {
      const sid = args.targetSeriesId!;
      const [f, t] = (await args.file.text()).split(',').map(Number);
      for (let o = f; o <= t; o++) await ch(sid, o);
    },
  });
  const s = (await db.series.where('profileId').equals(PROFILE).toArray()).find((x) => x.sourceUrl === URL_A)!;
  const chapters = (await db.chapters.where('seriesId').equals(s.id).toArray()).map((c) => c.order).sort((a, b) => a - b);
  expect(chapters).toEqual([49, 50, 51, 52]); // partial imported
  expect(s.pendingCatchUp).toEqual({ syncedChapter: 49, syncedPage: 0 }); // NOT cleared → resumable
  expect(s.caughtUp ?? false).toBe(false);
});

it('incomplete outcome (synced chapter never arrives) keeps pendingCatchUp', async () => {
  // Source has chapters 50..58 (one batch), but syncedChapter 49 never arrives.
  const LATEST = 58;
  await runSyncDownload(missing(), {
    profileId: PROFILE,
    runScrape: async (req, _onState) => {
      const m = req.args.match(/--from (\d+) --to (\d+)/)!;
      const from = Number(m[1]); const to = Number(m[2]);
      if (from > LATEST) throw new Error('ERR_NO_CHAPTERS_IN_RANGE: No chapters found in range');
      return { blob: new Blob([`${from},${Math.min(to, LATEST)}`]), partial: false };
    },
    runImport: async (args) => {
      const sid = args.targetSeriesId!;
      const [f, t] = (await args.file.text()).split(',').map(Number);
      for (let o = f; o <= t; o++) {
        if (o !== 49) await ch(sid, o); // 49 (syncedChapter) never arrives
      }
    },
  });
  const s = (await db.series.where('profileId').equals(PROFILE).toArray()).find((x) => x.sourceUrl === URL_A)!;
  expect(s.pendingCatchUp).toEqual({ syncedChapter: 49, syncedPage: 0 }); // NOT cleared
  expect(s.caughtUp ?? false).toBe(false);
});
