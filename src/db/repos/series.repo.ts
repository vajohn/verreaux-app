import { db } from '../db';
import type { Series, CoverSource } from '../types';
import { uuid } from '../../lib/uuid';

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

export interface CreateSeriesInput {
  profileId: string;
  title: string;
  coverImageId: string | null;
  chapterCount?: number;
}

export async function createSeries(input: CreateSeriesInput): Promise<Series> {
  const series: Series = {
    id: uuid(),
    profileId: input.profileId,
    title: input.title,
    originalTitle: input.title,
    normalizedTitle: normalizeTitle(input.title),
    coverImageId: input.coverImageId,
    coverBlobId: null,
    pendingCoverUrl: null,
    coverFetchAttempts: 0,
    coverSource: 'imported',
    chapterCount: input.chapterCount ?? 0,
    lastReadChapterId: null,
    lastReadAt: null,
    importedAt: Date.now(),
    sortOrder: Date.now(),
  };
  await db.series.add(series);
  return series;
}

export async function getAllSeries(profileId: string): Promise<Series[]> {
  return db.series.where('profileId').equals(profileId).toArray();
}

export async function getSeriesById(id: string): Promise<Series | undefined> {
  return db.series.get(id);
}

export async function findSeriesByNormalizedTitle(
  profileId: string,
  title: string,
): Promise<Series | undefined> {
  return db.series
    .where('[profileId+normalizedTitle]')
    .equals([profileId, normalizeTitle(title)])
    .first();
}

export async function updateSeriesTitle(id: string, title: string): Promise<void> {
  await db.series.update(id, { title, normalizedTitle: normalizeTitle(title) });
}

export async function setLastReadChapter(
  seriesId: string,
  chapterId: string,
  at: number = Date.now(),
): Promise<void> {
  await db.series.update(seriesId, { lastReadChapterId: chapterId, lastReadAt: at });
}

export async function setCoverBlobOverride(
  seriesId: string,
  coverBlobId: string,
  source: CoverSource,
): Promise<void> {
  await db.series.update(seriesId, {
    coverBlobId,
    coverSource: source,
    pendingCoverUrl: null,
    coverFetchAttempts: 0,
  });
}

export async function clearCoverOverride(seriesId: string): Promise<void> {
  const s = await db.series.get(seriesId);
  if (!s) return;
  if (s.coverBlobId) await db.blobs.delete(s.coverBlobId);
  await db.series.update(seriesId, {
    coverBlobId: null,
    coverSource: 'imported',
    pendingCoverUrl: null,
    coverFetchAttempts: 0,
  });
}

export async function setSortOrder(seriesId: string, sortOrder: number): Promise<void> {
  await db.series.update(seriesId, { sortOrder });
}

export async function deleteSeries(seriesId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.series, db.chapters, db.pages, db.blobs, db.readingProgress, db.bookmarks],
    async () => {
      const chapters = await db.chapters.where('seriesId').equals(seriesId).toArray();
      const chapterIds = chapters.map((c) => c.id);

      const pages = await db.pages.where('chapterId').anyOf(chapterIds).toArray();
      const pageBlobIds = pages.map((p) => p.blobId);

      await db.blobs.bulkDelete(pageBlobIds);
      await db.pages.where('chapterId').anyOf(chapterIds).delete();
      await db.chapters.where('seriesId').equals(seriesId).delete();

      const series = await db.series.get(seriesId);
      const coverBlobIds: string[] = [];
      if (series?.coverImageId) coverBlobIds.push(series.coverImageId);
      if (series?.coverBlobId) coverBlobIds.push(series.coverBlobId);
      if (coverBlobIds.length > 0) await db.blobs.bulkDelete(coverBlobIds);

      await db.series.delete(seriesId);
      await db.readingProgress.where('seriesId').equals(seriesId).delete();
      await db.bookmarks.where('seriesId').equals(seriesId).delete();
    },
  );
}

export interface DeleteReadChaptersResult {
  chaptersDeleted: number;
  bytesFreed: number;
}

export async function previewReadChaptersToDelete(
  profileId: string,
  seriesId: string,
): Promise<DeleteReadChaptersResult> {
  const progress = await db.readingProgress
    .where('[profileId+seriesId]')
    .equals([profileId, seriesId])
    .first();
  if (!progress) return { chaptersDeleted: 0, bytesFreed: 0 };
  const current = await db.chapters.get(progress.currentChapterId);
  if (!current) return { chaptersDeleted: 0, bytesFreed: 0 };
  const readChapters = await db.chapters
    .where('[seriesId+order]')
    .between([seriesId, -Infinity], [seriesId, current.order], true, true)
    .toArray();
  const chapterIds = readChapters.map((c) => c.id);
  if (chapterIds.length === 0) return { chaptersDeleted: 0, bytesFreed: 0 };
  const pages = await db.pages.where('chapterId').anyOf(chapterIds).toArray();
  let bytesFreed = 0;
  for (const p of pages) {
    const b = await db.blobs.get(p.blobId);
    if (b) bytesFreed += b.blob.size;
  }
  return { chaptersDeleted: chapterIds.length, bytesFreed };
}

export async function deleteReadChapters(
  profileId: string,
  seriesId: string,
): Promise<DeleteReadChaptersResult> {
  return db.transaction(
    'rw',
    [db.series, db.chapters, db.pages, db.blobs, db.readingProgress, db.bookmarks],
    async () => {
      const progress = await db.readingProgress
        .where('[profileId+seriesId]')
        .equals([profileId, seriesId])
        .first();
      if (!progress) return { chaptersDeleted: 0, bytesFreed: 0 };

      const current = await db.chapters.get(progress.currentChapterId);
      if (!current) return { chaptersDeleted: 0, bytesFreed: 0 };

      const readChapters = await db.chapters
        .where('[seriesId+order]')
        .between([seriesId, -Infinity], [seriesId, current.order], true, true)
        .toArray();
      const chapterIds = readChapters.map((c) => c.id);
      if (chapterIds.length === 0) return { chaptersDeleted: 0, bytesFreed: 0 };

      const pages = await db.pages.where('chapterId').anyOf(chapterIds).toArray();
      const blobIds = pages.map((p) => p.blobId);

      let bytesFreed = 0;
      for (const id of blobIds) {
        const b = await db.blobs.get(id);
        if (b) bytesFreed += b.blob.size;
      }

      await db.blobs.bulkDelete(blobIds);
      await db.pages.where('chapterId').anyOf(chapterIds).delete();
      await db.bookmarks.where('chapterId').anyOf(chapterIds).delete();
      await db.chapters.where('id').anyOf(chapterIds).delete();

      await db.readingProgress
        .where('[profileId+seriesId]')
        .equals([profileId, seriesId])
        .delete();

      const newCount = await db.chapters.where('seriesId').equals(seriesId).count();
      await db.series.update(seriesId, {
        chapterCount: newCount,
        lastReadChapterId: null,
        lastReadAt: null,
      });

      return { chaptersDeleted: chapterIds.length, bytesFreed };
    },
  );
}

/* Manual merge primitives (NICE TO HAVE — kept lean here) */

export interface MergeConflict {
  order: number;
  sourceChapter: { id: string; title: string; pageCount: number };
  targetChapter: { id: string; title: string; pageCount: number };
}

export interface MergePlan {
  sourceSeriesId: string;
  targetSeriesId: string;
  conflicts: MergeConflict[];
  sourceOnlyOrders: number[];
}

export async function mergeSeries(
  targetSeriesId: string,
  sourceSeriesId: string,
  conflictResolutions: Map<number, 'target' | 'source'>,
): Promise<void> {
  await db.transaction(
    'rw',
    [db.series, db.chapters, db.pages, db.blobs, db.readingProgress, db.bookmarks],
    async () => {
      const sourceChapters = await db.chapters
        .where('seriesId')
        .equals(sourceSeriesId)
        .toArray();
      const targetChapters = await db.chapters
        .where('seriesId')
        .equals(targetSeriesId)
        .toArray();
      const targetOrderMap = new Map(targetChapters.map((c) => [c.order, c]));

      for (const sc of sourceChapters) {
        const tc = targetOrderMap.get(sc.order);
        if (tc) {
          // Conflict: honour resolution.
          // resolution='target' means keep target chapter (tc), delete source chapter (sc).
          // resolution='source' means keep source chapter (sc), delete target chapter (tc).
          const resolution = conflictResolutions.get(sc.order) ?? 'target';
          const loser = resolution === 'target' ? sc : tc;
          const winner = resolution === 'target' ? tc : sc;
          // Delete loser's pages + blobs
          const loserPages = await db.pages.where('chapterId').equals(loser.id).toArray();
          await db.blobs.bulkDelete(loserPages.map((p) => p.blobId));
          await db.pages.where('chapterId').equals(loser.id).delete();
          await db.chapters.delete(loser.id);
          // If winner is from source, reparent it to target series
          if (resolution === 'source') {
            await db.chapters.update(winner.id, { seriesId: targetSeriesId });
          }
        } else {
          // No conflict: adopt source chapter into target series
          await db.chapters.update(sc.id, { seriesId: targetSeriesId });
        }
      }

      // Remap readingProgress that pointed at source series to target
      const srcProgress = await db.readingProgress
        .where('seriesId')
        .equals(sourceSeriesId)
        .toArray();
      for (const rp of srcProgress) {
        await db.readingProgress.update(rp.id, { seriesId: targetSeriesId });
      }

      // Remap bookmarks
      await db.bookmarks
        .where('seriesId')
        .equals(sourceSeriesId)
        .modify({ seriesId: targetSeriesId });

      // Update chapterCount on target series
      const newCount = await db.chapters.where('seriesId').equals(targetSeriesId).count();
      await db.series.update(targetSeriesId, { chapterCount: newCount });

      // Delete source series record
      const sourceSeries = await db.series.get(sourceSeriesId);
      if (sourceSeries) {
        const coverIds: string[] = [];
        if (sourceSeries.coverImageId) coverIds.push(sourceSeries.coverImageId);
        if (sourceSeries.coverBlobId) coverIds.push(sourceSeries.coverBlobId);
        if (coverIds.length > 0) await db.blobs.bulkDelete(coverIds);
      }
      await db.series.delete(sourceSeriesId);
    },
  );
}

export async function computeMergePlan(
  sourceSeriesId: string,
  targetSeriesId: string,
): Promise<MergePlan> {
  const sourceChapters = await db.chapters.where('seriesId').equals(sourceSeriesId).toArray();
  const targetChapters = await db.chapters.where('seriesId').equals(targetSeriesId).toArray();
  const targetOrderMap = new Map(targetChapters.map((c) => [c.order, c]));
  const conflicts: MergeConflict[] = [];
  const sourceOnlyOrders: number[] = [];
  for (const sc of sourceChapters) {
    const tc = targetOrderMap.get(sc.order);
    if (tc) {
      conflicts.push({
        order: sc.order,
        sourceChapter: { id: sc.id, title: sc.title, pageCount: sc.pageCount },
        targetChapter: { id: tc.id, title: tc.title, pageCount: tc.pageCount },
      });
    } else {
      sourceOnlyOrders.push(sc.order);
    }
  }
  return { sourceSeriesId, targetSeriesId, conflicts, sourceOnlyOrders };
}
