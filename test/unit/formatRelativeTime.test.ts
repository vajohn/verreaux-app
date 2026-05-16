import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../../src/lib/formatRelativeTime';

describe('formatRelativeTime', () => {
  const now = Date.now();
  it('returns "Just now" for < 60s', () => {
    expect(formatRelativeTime(now - 30_000)).toBe('Just now');
  });
  it('returns "1 min ago" for exactly 60s', () => {
    expect(formatRelativeTime(now - 60_000)).toBe('1 min ago');
  });
  it('returns "2 mins ago" for 120s', () => {
    expect(formatRelativeTime(now - 120_000)).toBe('2 mins ago');
  });
  it('returns "1 hour ago" at 1h boundary', () => {
    expect(formatRelativeTime(now - 60 * 60_000)).toBe('1 hour ago');
  });
  it('returns "Yesterday" for 36h', () => {
    expect(formatRelativeTime(now - 36 * 3600_000)).toBe('Yesterday');
  });
  it('returns "3 days ago" for 3 days', () => {
    expect(formatRelativeTime(now - 3 * 86400_000)).toBe('3 days ago');
  });
  it('returns "1 week ago" for 8 days', () => {
    expect(formatRelativeTime(now - 8 * 86400_000)).toBe('1 week ago');
  });
  it('returns "2 weeks ago" for 15 days', () => {
    expect(formatRelativeTime(now - 15 * 86400_000)).toBe('2 weeks ago');
  });
  it('returns "1 month ago" for ~31 days', () => {
    expect(formatRelativeTime(now - 31 * 86400_000)).toBe('1 month ago');
  });
  it('returns "1 year ago" for ~370 days', () => {
    expect(formatRelativeTime(now - 370 * 86400_000)).toBe('1 year ago');
  });
});
