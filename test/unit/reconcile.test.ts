import { describe, it, expect } from 'vitest';
import { reconcilePositions, type LocalPosition } from '../../src/features/sync/reconcile';

const server = (sourceUrl: string, chapterOrder: number, pageIndex: number) =>
  ({ sourceUrl, chapterOrder, pageIndex, manuallyMarked: false, updatedAt: 't' });

describe('reconcilePositions', () => {
  it('adopts a server position when there is no local one', () => {
    const out = reconcilePositions([server('s', 3, 2)], new Map());
    expect(out).toEqual([{ sourceUrl: 's', chapterOrder: 3, pageIndex: 2, manuallyMarked: false }]);
  });

  it('adopts when server is ahead of local (chapter, then page)', () => {
    const local = new Map<string, LocalPosition>([['s', { chapterOrder: 3, pageIndex: 1 }]]);
    expect(reconcilePositions([server('s', 3, 5)], local)).toHaveLength(1);
    expect(reconcilePositions([server('s', 4, 0)], local)).toHaveLength(1);
  });

  it('skips when local is equal or ahead (never regress local)', () => {
    const local = new Map<string, LocalPosition>([['s', { chapterOrder: 3, pageIndex: 5 }]]);
    expect(reconcilePositions([server('s', 3, 5)], local)).toEqual([]);
    expect(reconcilePositions([server('s', 3, 1)], local)).toEqual([]);
    expect(reconcilePositions([server('s', 2, 9)], local)).toEqual([]);
  });

  it('handles a mix across multiple series', () => {
    const local = new Map<string, LocalPosition>([['a', { chapterOrder: 1, pageIndex: 0 }]]);
    const out = reconcilePositions([server('a', 2, 0), server('b', 1, 0)], local);
    expect(out.map((u) => u.sourceUrl).sort()).toEqual(['a', 'b']);
  });
});
