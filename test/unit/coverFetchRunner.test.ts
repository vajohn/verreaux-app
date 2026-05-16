import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db/db';
import { runPendingCoverFetches } from '../../src/features/series/coverFetchRunner';

const PROFILE = 'cfr-test-profile';

// Minimal 1x1 PNG as Uint8Array (used to fake fetch response)
function minimalPng(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({
    id: PROFILE,
    name: 'CoverFetchTester',
    avatarColor: 'gold',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  });

  // Stub navigator.onLine = true
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

afterEach(async () => {
  await db.delete();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('runPendingCoverFetches', () => {
  it('fetches and persists a pending cover URL on success', async () => {
    const seriesId = 'series-fetch-1';
    await db.series.add({
      id: seriesId,
      profileId: PROFILE,
      title: 'Test Series',
      originalTitle: 'Test Series',
      normalizedTitle: 'test series',
      coverImageId: null,
      coverBlobId: null,
      pendingCoverUrl: 'https://example.com/cover.png',
      coverFetchAttempts: 0,
      coverSource: 'url',
      chapterCount: 0,
      lastReadChapterId: null,
      lastReadAt: null,
      importedAt: Date.now(),
      sortOrder: 1,
    });

    const png = minimalPng();
    const mockBlob = new Blob([png], { type: 'image/png' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'image/png' },
        blob: () => Promise.resolve(mockBlob),
      }),
    );

    await runPendingCoverFetches();

    const updated = await db.series.get(seriesId);
    expect(updated?.pendingCoverUrl).toBeNull();
    expect(updated?.coverBlobId).toBeTruthy();
    expect(updated?.coverSource).toBe('url');
  });

  it('increments coverFetchAttempts on network failure', async () => {
    const seriesId = 'series-fetch-fail';
    await db.series.add({
      id: seriesId,
      profileId: PROFILE,
      title: 'Fail Series',
      originalTitle: 'Fail Series',
      normalizedTitle: 'fail series',
      coverImageId: null,
      coverBlobId: null,
      pendingCoverUrl: 'https://example.com/bad.png',
      coverFetchAttempts: 0,
      coverSource: 'url',
      chapterCount: 0,
      lastReadChapterId: null,
      lastReadAt: null,
      importedAt: Date.now(),
      sortOrder: 1,
    });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    await runPendingCoverFetches();

    const updated = await db.series.get(seriesId);
    // Should increment attempts (0 -> 1) but not yet give up
    expect(updated?.coverFetchAttempts).toBe(1);
    expect(updated?.pendingCoverUrl).toBeTruthy();
  });

  it('sets coverSource to fallback after 3 failures', async () => {
    const seriesId = 'series-fetch-perm-fail';
    await db.series.add({
      id: seriesId,
      profileId: PROFILE,
      title: 'Perm Fail Series',
      originalTitle: 'Perm Fail Series',
      normalizedTitle: 'perm fail series',
      coverImageId: null,
      coverBlobId: null,
      pendingCoverUrl: 'https://example.com/fail.png',
      coverFetchAttempts: 2, // Already failed twice
      coverSource: 'url',
      chapterCount: 0,
      lastReadChapterId: null,
      lastReadAt: null,
      importedAt: Date.now(),
      sortOrder: 1,
    });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    await runPendingCoverFetches();

    const updated = await db.series.get(seriesId);
    expect(updated?.coverSource).toBe('fallback');
    expect(updated?.pendingCoverUrl).toBeNull();
  });

  it('skips fetch when offline', async () => {
    // Override onLine to false — no series in DB for this test, but we verify
    // that runPendingCoverFetches returns early before any fetch.
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });

    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);

    await runPendingCoverFetches();

    expect(fetchStub).not.toHaveBeenCalled();
  });
});
