import { db } from '../db';
import type { ReadingProgress, Series } from '../types';
import { uuid } from '../../lib/uuid';

export async function getProgress(
  profileId: string,
  seriesId: string,
): Promise<ReadingProgress | undefined> {
  return db.readingProgress
    .where('[profileId+seriesId]')
    .equals([profileId, seriesId])
    .first();
}

export async function upsertProgress(input: {
  profileId: string;
  seriesId: string;
  currentChapterId: string;
  pageIndex: number;
  scrollPosition: number;
  manuallyMarked?: boolean;
}): Promise<void> {
  const existing = await getProgress(input.profileId, input.seriesId);
  if (existing?.manuallyMarked && input.manuallyMarked !== true) {
    // Do not overwrite a manually marked progress with scroll-only update.
    return;
  }
  const record: ReadingProgress = {
    id: existing?.id ?? uuid(),
    profileId: input.profileId,
    seriesId: input.seriesId,
    currentChapterId: input.currentChapterId,
    pageIndex: input.pageIndex,
    scrollPosition: input.scrollPosition,
    updatedAt: Date.now(),
    manuallyMarked: input.manuallyMarked ?? existing?.manuallyMarked ?? false,
  };
  await db.readingProgress.put(record);
}

export async function deleteProgress(
  profileId: string,
  seriesId: string,
): Promise<void> {
  await db.readingProgress
    .where('[profileId+seriesId]')
    .equals([profileId, seriesId])
    .delete();
}

export async function clearSeriesProgress(
  profileId: string,
  seriesId: string,
): Promise<void> {
  await db.transaction(
    'rw',
    [db.readingProgress, db.series, db.chapters],
    async () => {
      // Preserve the order of the last-read chapter so that on reimport
      // restoreLastReadFromOrder can resume at the same spot. Chapter IDs
      // change on reimport; `order` is the stable per-series key.
      const progress = await db.readingProgress
        .where('[profileId+seriesId]')
        .equals([profileId, seriesId])
        .first();
      let preservedOrder: number | null = null;
      if (progress) {
        const cur = await db.chapters.get(progress.currentChapterId);
        if (cur) preservedOrder = cur.order;
      }

      await db.readingProgress
        .where('[profileId+seriesId]')
        .equals([profileId, seriesId])
        .delete();

      const patch: Partial<Series> = {
        lastReadChapterId: null,
        lastReadAt: null,
      };
      if (preservedOrder !== null) patch.lastReadChapterOrder = preservedOrder;
      await db.series.update(seriesId, patch);
    },
  );
}

export async function setManuallyMarked(
  profileId: string,
  seriesId: string,
  currentChapterId: string,
  marked: boolean,
): Promise<void> {
  const existing = await getProgress(profileId, seriesId);
  if (existing) {
    await db.readingProgress.update(existing.id, {
      manuallyMarked: marked,
      currentChapterId,
      updatedAt: Date.now(),
    });
  } else {
    await db.readingProgress.add({
      id: uuid(),
      profileId,
      seriesId,
      currentChapterId,
      pageIndex: 0,
      scrollPosition: 0,
      updatedAt: Date.now(),
      manuallyMarked: marked,
    });
  }
}

export async function getProgressForProfile(profileId: string): Promise<ReadingProgress[]> {
  return db.readingProgress.where('profileId').equals(profileId).toArray();
}
