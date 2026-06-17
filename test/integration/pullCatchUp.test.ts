import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';
import { setApiBase } from '../../src/features/sync/piClient';
import { setSyncCreds, clearSyncCreds } from '../../src/features/sync/syncCreds';
import { pullAndReconcile } from '../../src/features/sync/positionSync';

const PROFILE = 'p-pull';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now() });
  setApiBase('http://pi:8080');
  setSyncCreds({ accountId: 'a', deviceId: 'd', deviceToken: 't' });
});
afterEach(() => { vi.unstubAllGlobals(); clearSyncCreds(); localStorage.clear(); });

it('returns a behind candidate from a pulled position', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: 'https://x/a' });
  await createChapter({ seriesId: s.id, profileId: PROFILE, title: 'c30', order: 30, pageCount: 5 });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ positions: [{ sourceUrl: 'https://x/a', chapterOrder: 49, pageIndex: 0, manuallyMarked: false, updatedAt: 't' }] }),
    { status: 200 },
  )));
  const candidates = await pullAndReconcile(PROFILE);
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({ sourceUrl: 'https://x/a', syncedChapter: 49, state: 'behind', initial: true });
});

it('returns [] when not enrolled', async () => {
  clearSyncCreds();
  expect(await pullAndReconcile(PROFILE)).toEqual([]);
});

it('returns a missing-series candidate when no local series has the sourceUrl', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ positions: [{ sourceUrl: 'https://x/new', chapterOrder: 49, pageIndex: 0, manuallyMarked: false, updatedAt: 't' }] }),
    { status: 200 },
  )));
  const candidates = await pullAndReconcile(PROFILE);
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({ sourceUrl: 'https://x/new', state: 'missing', initial: true, seriesId: null });
});

it('re-surfaces a still-behind series on every pull (full classification, no since cursor)', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: 'https://x/a' });
  await createChapter({ seriesId: s.id, profileId: PROFILE, title: 'c30', order: 30, pageCount: 5 });
  const fetchMock = vi.fn(async () => new Response(
    JSON.stringify({ positions: [{ sourceUrl: 'https://x/a', chapterOrder: 49, pageIndex: 0, manuallyMarked: false, updatedAt: 't' }] }),
    { status: 200 },
  ));
  vi.stubGlobal('fetch', fetchMock);
  const first = await pullAndReconcile(PROFILE);
  const second = await pullAndReconcile(PROFILE);
  expect(first).toHaveLength(1);
  expect(second).toHaveLength(1); // still behind (no import happened) → still a candidate
  expect(String(fetchMock.mock.calls[1]![0])).not.toContain('since='); // full fetch, no cursor
});
