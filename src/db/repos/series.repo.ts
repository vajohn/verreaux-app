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
    lastReadChapterOrder: null,
    lastKnownMaxOrder: null,
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
  const chapter = await db.chapters.get(chapterId);
  await db.series.update(seriesId, {
    lastReadChapterId: chapterId,
    lastReadAt: at,
    // Persist the chapter `order` as a stable resume pointer that survives
    // `deleteReadChapters` + reimport. Chapter ids change on reimport; order
    // is the natural per-series key.
    lastReadChapterOrder: chapter ? chapter.order : null,
  });
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

// Blobs and page rows are deleted in chunks (each chunk its own auto-wrapped
// transaction) so no single IDB transaction has to outlive its time budget.
// Earlier we tried batch=500 to halve round-trips, but with very large series
// (~30k pages) the wrapping tx could auto-commit mid-batch and emit
// "Attempt to delete range from database without an in-progress transaction"
// for every remaining op. 250 stays comfortably under the budget on slow
// disks while still cutting round-trips vs the original 100.
const DELETE_BATCH_SIZE = 250;

export interface DeleteProgress {
  phase: 'preparing' | 'blobs' | 'finalizing';
  done: number;
  total: number;
}

export interface SeriesDeletionPreview {
  chapters: number;
  pages: number;
  bytes: number;
}

export async function previewSeriesDeletion(
  seriesId: string,
): Promise<SeriesDeletionPreview> {
  const chapters = await db.chapters.where('seriesId').equals(seriesId).toArray();
  const chapterIds = chapters.map((c) => c.id);
  const pages = await db.pages.where('chapterId').anyOf(chapterIds).toArray();
  let bytes = 0;
  for (const p of pages) {
    const b = await db.blobs.get(p.blobId);
    if (b) bytes += b.blob.size;
  }
  const series = await db.series.get(seriesId);
  if (series?.coverImageId) {
    const b = await db.blobs.get(series.coverImageId);
    if (b) bytes += b.blob.size;
  }
  if (series?.coverBlobId) {
    const b = await db.blobs.get(series.coverBlobId);
    if (b) bytes += b.blob.size;
  }
  return { chapters: chapters.length, pages: pages.length, bytes };
}

export async function deleteSeries(
  seriesId: string,
  onProgress?: (p: DeleteProgress) => void,
): Promise<void> {
  onProgress?.({ phase: 'preparing', done: 0, total: 0 });

  const chapters = await db.chapters.where('seriesId').equals(seriesId).toArray();
  const chapterIds = chapters.map((c) => c.id);

  const pages = await db.pages.where('chapterId').anyOf(chapterIds).toArray();
  const pageBlobIds = pages.map((p) => p.blobId);

  const series = await db.series.get(seriesId);
  const coverBlobIds: string[] = [];
  if (series?.coverImageId) coverBlobIds.push(series.coverImageId);
  if (series?.coverBlobId) coverBlobIds.push(series.coverBlobId);

  const allBlobIds = [...pageBlobIds, ...coverBlobIds];
  const totalBlobs = allBlobIds.length;

  onProgress?.({ phase: 'blobs', done: 0, total: totalBlobs });

  for (let i = 0; i < allBlobIds.length; i += DELETE_BATCH_SIZE) {
    const batch = allBlobIds.slice(i, i + DELETE_BATCH_SIZE);
    await db.blobs.bulkDelete(batch);
    onProgress?.({
      phase: 'blobs',
      done: Math.min(i + DELETE_BATCH_SIZE, totalBlobs),
      total: totalBlobs,
    });
  }

  // Page rows are deleted in chunks OUTSIDE the final records transaction.
  // Doing `db.pages.where('chapterId').anyOf(chapterIds).delete()` for tens of
  // thousands of pages inside a single IDB transaction can overrun the auto-
  // commit budget, causing the rest of the tx (chapters/series/progress) to
  // silently abort with the "no in-progress transaction" error.
  const pageIds = pages.map((p) => p.id);
  for (let i = 0; i < pageIds.length; i += DELETE_BATCH_SIZE) {
    await db.pages.bulkDelete(pageIds.slice(i, i + DELETE_BATCH_SIZE));
  }

  onProgress?.({ phase: 'finalizing', done: totalBlobs, total: totalBlobs });

  // Records-only tx now: a few hundred chapters + a handful of singletons.
  // Stays well inside the IDB budget regardless of series size.
  await db.transaction(
    'rw',
    [db.series, db.chapters, db.readingProgress, db.bookmarks],
    async () => {
      await db.chapters.where('seriesId').equals(seriesId).delete();
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
  onProgress?: (p: DeleteProgress) => void,
): Promise<DeleteReadChaptersResult> {
  onProgress?.({ phase: 'preparing', done: 0, total: 0 });

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

  // bytesFreed is computed up-front by `previewReadChaptersToDelete` for the
  // confirm sheet — don't repeat the full-blob scan here. Doubled the wall
  // time of large deletes for no UI benefit. Return value is best-effort.
  const totalBlobs = blobIds.length;
  onProgress?.({ phase: 'blobs', done: 0, total: totalBlobs });

  for (let i = 0; i < blobIds.length; i += DELETE_BATCH_SIZE) {
    const batch = blobIds.slice(i, i + DELETE_BATCH_SIZE);
    await db.blobs.bulkDelete(batch);
    onProgress?.({
      phase: 'blobs',
      done: Math.min(i + DELETE_BATCH_SIZE, totalBlobs),
      total: totalBlobs,
    });
  }

  // Page rows deleted in chunks outside the records tx — see deleteSeries
  // comment for the IDB transaction-budget rationale.
  const pageIds = pages.map((p) => p.id);
  for (let i = 0; i < pageIds.length; i += DELETE_BATCH_SIZE) {
    await db.pages.bulkDelete(pageIds.slice(i, i + DELETE_BATCH_SIZE));
  }

  onProgress?.({ phase: 'finalizing', done: totalBlobs, total: totalBlobs });

  await db.transaction(
    'rw',
    [db.series, db.chapters, db.bookmarks, db.readingProgress],
    async () => {
      await db.bookmarks.where('chapterId').anyOf(chapterIds).delete();
      await db.chapters.where('id').anyOf(chapterIds).delete();

      await db.readingProgress
        .where('[profileId+seriesId]')
        .equals([profileId, seriesId])
        .delete();

      // Snapshot the highest chapter.order so the cleared-state UI can show
      // "202 / 204" when chapterCount eventually hits 0. Deleted (read)
      // chapters max out at current.order; unread chapters above are still
      // in the table after the delete, so take the max of the two.
      const lastUnread = await db.chapters
        .where('[seriesId+order]')
        .between([seriesId, current.order], [seriesId, Infinity], false, true)
        .last();
      const maxOrder = Math.max(current.order, lastUnread?.order ?? current.order);

      const newCount = await db.chapters.where('seriesId').equals(seriesId).count();
      await db.series.update(seriesId, {
        chapterCount: newCount,
        lastReadChapterId: null,
        lastReadAt: null,
        // Preserve the order of the last-read chapter so that on reimport
        // we can resume at the same chapter. The chapter row itself is being
        // deleted, but its `order` is a stable per-series key.
        lastReadChapterOrder: current.order,
        // Snapshot of max chapter.order at clear-time so the UI can show
        // a meaningful "lastRead / lastKnown" pair after everything is wiped.
        lastKnownMaxOrder: maxOrder,
      });
    },
  );

  return { chaptersDeleted: chapterIds.length, bytesFreed: 0 };
}

/**
 * After an import / chapter-merge, if the series has a preserved
 * `lastReadChapterOrder` (e.g. set by a previous `deleteReadChapters`) and no
 * current `lastReadChapterId`, find the chapter at that order and restore the
 * pointer plus a fresh `readingProgress` row at page 0. No-op if there is
 * already a current chapter set, or no preserved order, or no matching chapter.
 */
export async function restoreLastReadFromOrder(
  profileId: string,
  seriesId: string,
): Promise<void> {
  await db.transaction(
    'rw',
    [db.series, db.chapters, db.readingProgress],
    async () => {
      const series = await db.series.get(seriesId);
      if (!series) return;
      if (series.lastReadChapterId) return;
      const order = series.lastReadChapterOrder;
      if (order == null) return;
      const chapter = await db.chapters
        .where('[seriesId+order]')
        .equals([seriesId, order])
        .first();
      if (!chapter) return;
      await db.series.update(seriesId, { lastReadChapterId: chapter.id });
      const existing = await db.readingProgress
        .where('[profileId+seriesId]')
        .equals([profileId, seriesId])
        .first();
      if (!existing) {
        await db.readingProgress.add({
          id: uuid(),
          profileId,
          seriesId,
          currentChapterId: chapter.id,
          pageIndex: 0,
          scrollPosition: 0,
          updatedAt: Date.now(),
          manuallyMarked: false,
        });
      }
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
