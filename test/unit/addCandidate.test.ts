import { describe, it, expect } from 'vitest';
import { buildInitialAddCandidate } from '../../src/features/sync/addCandidate';
describe('buildInitialAddCandidate', () => {
  it('builds a missing/initial candidate from chapter 0 by default', () => {
    expect(buildInitialAddCandidate('https://x/s')).toEqual({ sourceUrl: 'https://x/s', syncedChapter: 0, syncedPage: 0, seriesId: null, maxOrder: null, initial: true, state: 'missing' });
  });
  it('honors an explicit from', () => {
    expect(buildInitialAddCandidate('https://x/s', 5).syncedChapter).toBe(5);
  });
});
