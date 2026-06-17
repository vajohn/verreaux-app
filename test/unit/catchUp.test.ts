import { describe, it, expect } from 'vitest';
import { classifyCatchUp, type LocalSeriesInfo } from '../../src/features/sync/catchUp';
import type { ServerPosition } from '../../src/features/sync/syncClient';

function srv(sourceUrl: string, chapterOrder: number): ServerPosition {
  return { sourceUrl, chapterOrder, pageIndex: 3, manuallyMarked: false, updatedAt: 't' };
}

describe('classifyCatchUp', () => {
  it('flags a missing series (no local row) as an initial missing candidate', () => {
    const out = classifyCatchUp([srv('u/a', 49)], new Map());
    expect(out).toEqual([
      { sourceUrl: 'u/a', syncedChapter: 49, syncedPage: 3, seriesId: null, maxOrder: null, initial: true, state: 'missing' },
    ]);
  });

  it('flags a behind series (synced > localMax) as a candidate; initial = !caughtUp', () => {
    const idx = new Map<string, LocalSeriesInfo>([['u/a', { seriesId: 's1', maxOrder: 30, caughtUp: false }]]);
    expect(classifyCatchUp([srv('u/a', 49)], idx)).toEqual([
      { sourceUrl: 'u/a', syncedChapter: 49, syncedPage: 3, seriesId: 's1', maxOrder: 30, initial: true, state: 'behind' },
    ]);
    const idx2 = new Map<string, LocalSeriesInfo>([['u/a', { seriesId: 's1', maxOrder: 30, caughtUp: true }]]);
    expect(classifyCatchUp([srv('u/a', 49)], idx2)[0].initial).toBe(false);
  });

  it('does NOT flag a series that is at or ahead of the synced position', () => {
    const idx = new Map<string, LocalSeriesInfo>([['u/a', { seriesId: 's1', maxOrder: 60, caughtUp: false }]]);
    expect(classifyCatchUp([srv('u/a', 49)], idx)).toEqual([]);
  });

  it('handles a mixed batch: emits missing and behind in order, suppresses ahead', () => {
    const idx = new Map<string, LocalSeriesInfo>([
      ['u/b', { seriesId: 's1', maxOrder: 30, caughtUp: false }], // behind
      ['u/c', { seriesId: 's2', maxOrder: 60, caughtUp: false }], // ahead → suppressed
    ]);
    const out = classifyCatchUp([srv('u/a', 49), srv('u/b', 49), srv('u/c', 49)], idx);
    expect(out).toHaveLength(2);
    expect(out[0]!.state).toBe('missing');
    expect(out[0]!.sourceUrl).toBe('u/a');
    expect(out[1]!.state).toBe('behind');
    expect(out[1]!.sourceUrl).toBe('u/b');
  });
});
