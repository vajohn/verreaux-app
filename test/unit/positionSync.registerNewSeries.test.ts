import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock syncCreds so we can control isEnrolled / getSyncCreds without localStorage.
vi.mock('../../src/features/sync/syncCreds', () => ({
  getSyncCreds: vi.fn(() => null),
  clearSyncCreds: vi.fn(),
  isEnrolled: vi.fn(() => false),
}));

// Mock syncClient so putPosition never makes real network calls.
vi.mock('../../src/features/sync/syncClient', () => ({
  putPosition: vi.fn(async () => ({ sourceUrl: '', chapterOrder: 0, pageIndex: 0, manuallyMarked: false })),
  getPositions: vi.fn(async () => []),
  SyncAuthError: class SyncAuthError extends Error {},
}));

import { registerNewSeries, flushSync } from '../../src/features/sync/positionSync';
import { getSyncCreds, isEnrolled } from '../../src/features/sync/syncCreds';
import { putPosition } from '../../src/features/sync/syncClient';

const mockIsEnrolled = vi.mocked(isEnrolled);
const mockGetSyncCreds = vi.mocked(getSyncCreds);
const mockPutPosition = vi.mocked(putPosition);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: not enrolled.
  mockIsEnrolled.mockReturnValue(false);
  mockGetSyncCreds.mockReturnValue(null);
});

afterEach(() => {
  localStorage.clear();
});

describe('registerNewSeries', () => {
  it('is a no-op when not enrolled', async () => {
    mockIsEnrolled.mockReturnValue(false);
    registerNewSeries('https://example.com/series/x');
    await flushSync();
    expect(mockPutPosition).not.toHaveBeenCalled();
  });

  it('is a no-op when sourceUrl is empty', async () => {
    mockIsEnrolled.mockReturnValue(true);
    mockGetSyncCreds.mockReturnValue({ accountId: 'a', deviceId: 'd', deviceToken: 'T' });
    registerNewSeries('');
    await flushSync();
    expect(mockPutPosition).not.toHaveBeenCalled();
  });

  it('enqueues chapter 0 / page 0 when enrolled and sourceUrl is present', async () => {
    mockIsEnrolled.mockReturnValue(true);
    mockGetSyncCreds.mockReturnValue({ accountId: 'a', deviceId: 'd', deviceToken: 'T' });
    mockPutPosition.mockResolvedValue({ sourceUrl: 'https://example.com/series/x', chapterOrder: 0, pageIndex: 0, manuallyMarked: false, updatedAt: 't' });

    registerNewSeries('https://example.com/series/x');
    await flushSync();

    expect(mockPutPosition).toHaveBeenCalledTimes(1);
    // putPosition is called as putPosition(deviceToken, body) by the queue wrapper.
    expect(mockPutPosition).toHaveBeenCalledWith(
      'T',
      {
        sourceUrl: 'https://example.com/series/x',
        chapterOrder: 0,
        pageIndex: 0,
        manuallyMarked: false,
      },
    );
  });
});
