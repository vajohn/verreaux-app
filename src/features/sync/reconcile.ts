import type { ServerPosition } from './syncClient';

export interface LocalPosition {
  chapterOrder: number;
  pageIndex: number;
}

export interface PositionUpdate {
  sourceUrl: string;
  chapterOrder: number;
  pageIndex: number;
  manuallyMarked: boolean;
}

/** -1/0/1 by (chapterOrder, then pageIndex). */
function cmp(a: LocalPosition, b: LocalPosition): number {
  if (a.chapterOrder !== b.chapterOrder) return a.chapterOrder < b.chapterOrder ? -1 : 1;
  if (a.pageIndex !== b.pageIndex) return a.pageIndex < b.pageIndex ? -1 : 1;
  return 0;
}

/**
 * Returns the server positions that should be applied locally: those with no
 * local counterpart, or strictly AHEAD of the local position. A pull never
 * regresses local progress (the server already merged authoritatively; any
 * local-ahead value is unsynced progress that the push path will send).
 */
export function reconcilePositions(
  server: ServerPosition[],
  localByUrl: Map<string, LocalPosition>,
): PositionUpdate[] {
  const updates: PositionUpdate[] = [];
  for (const s of server) {
    const local = localByUrl.get(s.sourceUrl);
    if (!local || cmp(s, local) > 0) {
      updates.push({
        sourceUrl: s.sourceUrl,
        chapterOrder: s.chapterOrder,
        pageIndex: s.pageIndex,
        manuallyMarked: s.manuallyMarked,
      });
    }
  }
  return updates;
}
