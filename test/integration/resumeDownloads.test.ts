import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries, setPendingCatchUp } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';
import { setApiBase } from '../../src/features/sync/piClient';
import { setSyncCreds, clearSyncCreds } from '../../src/features/sync/syncCreds';
import { pendingDownloadCandidates } from '../../src/features/sync/resumeDownloads';

const PROFILE = 'p-resume';
beforeEach(async () => {
  await db.delete(); await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now() });
  setApiBase('http://pi:8080');
  setSyncCreds({ accountId: 'a', deviceId: 'd', deviceToken: 't' });
});
afterEach(() => { clearSyncCreds(); localStorage.clear(); vi.unstubAllGlobals(); });

it('returns candidates only for series with a pendingCatchUp AND a sourceUrl', async () => {
  const a = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: 'https://x/a' });
  await createChapter({ seriesId: a.id, profileId: PROFILE, title: 'c30', order: 30, pageCount: 5 });
  await setPendingCatchUp(a.id, { syncedChapter: 49, syncedPage: 1 });
  const b = await createSeries({ profileId: PROFILE, title: 'B', coverImageId: null }); // no sourceUrl
  await setPendingCatchUp(b.id, { syncedChapter: 10, syncedPage: 0 });
  await createSeries({ profileId: PROFILE, title: 'C', coverImageId: null, sourceUrl: 'https://x/c' }); // no pending

  const out = await pendingDownloadCandidates(PROFILE);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ sourceUrl: 'https://x/a', syncedChapter: 49, syncedPage: 1, seriesId: a.id, maxOrder: 30, state: 'behind' });
  expect(out[0]!.initial).toBe(true); // caughtUp falsy
});

it('returns [] when not enrolled', async () => {
  clearSyncCreds();
  const a = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: 'https://x/a' });
  await setPendingCatchUp(a.id, { syncedChapter: 49, syncedPage: 0 });
  expect(await pendingDownloadCandidates(PROFILE)).toEqual([]);
});

it('a pending shell with no chapters yet is a behind candidate with maxOrder 0', async () => {
  const a = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: 'https://x/a' });
  await setPendingCatchUp(a.id, { syncedChapter: 49, syncedPage: 0 });
  const out = await pendingDownloadCandidates(PROFILE);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ state: 'behind', maxOrder: 0, initial: true, seriesId: a.id });
});

it('returns [] when no Pi base is configured (even if enrolled)', async () => {
  setApiBase(''); // clear the base; creds still set from beforeEach
  const a = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: 'https://x/a' });
  await setPendingCatchUp(a.id, { syncedChapter: 49, syncedPage: 0 });
  expect(await pendingDownloadCandidates(PROFILE)).toEqual([]);
});
