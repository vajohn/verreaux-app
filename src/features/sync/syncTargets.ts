import { db } from '../../db/db';
import { upsertProgress } from '../../db/repos/progress.repo';
import type { PositionUpdate, LocalPosition } from './reconcile';

/** Map of sourceUrl -> the local current reading position, for series that
 *  have a sourceUrl and a saved progress row. */
export async function localPositionsByUrl(profileId: string): Promise<Map<string, LocalPosition>> {
  const out = new Map<string, LocalPosition>();
  const series = await db.series.where('profileId').equals(profileId).toArray();
  for (const s of series) {
    if (!s.sourceUrl) continue;
    const prog = await db.readingProgress.where('[profileId+seriesId]').equals([profileId, s.id]).first();
    if (!prog) continue;
    const chapter = await db.chapters.get(prog.currentChapterId);
    if (!chapter) continue;
    out.set(s.sourceUrl, { chapterOrder: chapter.order, pageIndex: prog.pageIndex });
  }
  return out;
}

/** Apply a server position to local progress, resolving sourceUrl -> series and
 *  chapterOrder -> chapter. No-op when the series or chapter is not present. */
export async function applyServerPosition(profileId: string, update: PositionUpdate): Promise<void> {
  const series = (await db.series.where('profileId').equals(profileId).toArray()).find((s) => s.sourceUrl === update.sourceUrl);
  if (!series) return;
  const chapter = await db.chapters.where('[seriesId+order]').equals([series.id, update.chapterOrder]).first();
  if (!chapter) return;
  await upsertProgress({
    profileId,
    seriesId: series.id,
    currentChapterId: chapter.id,
    pageIndex: update.pageIndex,
    scrollPosition: 0,
    manuallyMarked: update.manuallyMarked,
    // reconcile only asks to apply server-ahead positions; advance even over a
    // stale local "mark as read".
    force: true,
  });
}
