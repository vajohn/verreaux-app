import { describe, it, expect, afterEach } from 'vitest';
import { getDownloadBatchSize, setDownloadBatchSize, isEndOfSeriesError } from '../../src/features/sync/chunking';

afterEach(() => localStorage.clear());

describe('getDownloadBatchSize', () => {
  it('defaults to 5 and round-trips a clamped value', () => {
    expect(getDownloadBatchSize()).toBe(5);
    setDownloadBatchSize(20);
    expect(getDownloadBatchSize()).toBe(20);
    setDownloadBatchSize(999);
    expect(getDownloadBatchSize()).toBe(50); // clamped to max
    setDownloadBatchSize(0);
    expect(getDownloadBatchSize()).toBe(1);  // clamped to min
  });
  it('falls back to 5 on a garbage stored value', () => {
    localStorage.setItem('verreaux:downloadBatchSize', 'abc');
    expect(getDownloadBatchSize()).toBe(5);
  });
});

describe('isEndOfSeriesError', () => {
  it('matches the no-chapters / empty-range terminators', () => {
    expect(isEndOfSeriesError(new Error('ERR_NO_CHAPTERS_IN_RANGE: No chapters found in range [170, 179].'))).toBe(true);
    expect(isEndOfSeriesError(new Error('ERR_EMPTY_RANGE: Range [180, 179] is empty (from > to).'))).toBe(true);
    expect(isEndOfSeriesError(new Error('No chapters found in range [200, latest].'))).toBe(true);
  });
  it('does NOT match a genuine failure', () => {
    expect(isEndOfSeriesError(new Error('Remote scrape failed.'))).toBe(false);
    expect(isEndOfSeriesError(new Error('Timed out waiting for the remote scrape.'))).toBe(false);
    expect(isEndOfSeriesError(new Error('Network error'))).toBe(false);
  });
});
