import type { ZipReader } from '../../lib/zip';
import { db } from '../../db/db';
import { uuid } from '../../lib/uuid';
import { walkLibrary, walkChapterUpdate, type SeriesEntry, type ChapterEntry } from './zipWalker';
import { normalizeTitle, restoreLastReadFromOrder } from '../../db/repos/series.repo';
import type { ImportType } from './typeDetector';
import type { LogEntry } from '../../db/types';

export type WorkerOutMessage =
  | { type: 'QUOTA_WARNING'; estimatedBytes: number; availableBytes: number }
  | {
      type: 'PROGRESS';
      seriesName: string;
      chapterIndex: number;
      chapterTotal: number;
      pct: number;
      eta: number | null;
    }
  | { type: 'SUCCESS'; seriesCount: number }
  | { type: 'ERROR'; message: string }
  | { type: 'CANCELLED' }
  | { type: 'LOG'; entry: Omit<LogEntry, 'id'> };

export type Emit = (msg: WorkerOutMessage) => void;

export interface CancelToken {
  cancelled: boolean;
}

export interface WorkerLogger {
  info(source: string, msg: string, ctx?: unknown): void;
  warn(source: string, msg: string, ctx?: unknown): void;
  error(source: string, msg: string, ctx?: unknown): void;
}

const NULL_LOGGER: WorkerLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

interface PreparedPage {
  pageNumber: number;
  blob: Blob;
}

/**
 * Reads every page blob for a chapter and returns them in memory. The caller
 * must drop the returned array before reading the next chapter so the GC can
 * reclaim the blob memory — that is the entire point of doing one chapter at
 * a time on a memory-constrained device like iOS Safari.
 */
async function preparePages(
  zip: ZipReader,
  chapter: ChapterEntry,
  cancel: CancelToken,
  log: WorkerLogger,
  source: string,
): Promise<PreparedPage[]> {
  const pages: PreparedPage[] = [];
  let missing = 0;
  for (const page of chapter.pages) {
    if (cancel.cancelled) throw new Error('CANCELLED');
    if (!zip.has(page.path)) {
      missing++;
      continue;
    }
    try {
      const blob = await zip.readBlob(page.path);
      pages.push({ pageNumber: page.pageNumber, blob });
    } catch (err) {
      log.error('blob', `page readBlob failed (${source})`, {
        path: page.path,
        chapter: chapter.title,
        error: err,
      });
      throw err;
    }
  }
  if (missing > 0) {
    log.warn('blob', `missing page entries in zip (${source})`, {
      chapter: chapter.title,
      missing,
      ofTotal: chapter.pages.length,
    });
  }
  return pages;
}

/**
 * Writes one chapter + its pages + its blobs as a single Dexie transaction.
 * Pages are passed in already-read so the txn contains only IDB work — mixing
 * non-IDB awaits in a Dexie txn triggers PrematureCommitError.
 */
async function writeChapterTransaction(
  seriesId: string,
  activeProfileId: string,
  chapter: { title: string; order: number; pages: PreparedPage[] },
  cancel: CancelToken,
): Promise<void> {
  await db.transaction('rw', [db.chapters, db.pages, db.blobs], async () => {
    if (cancel.cancelled) throw new Error('CANCELLED');
    const chapterId = uuid();
    await db.chapters.add({
      id: chapterId,
      seriesId,
      profileId: activeProfileId,
      title: chapter.title,
      originalTitle: chapter.title,
      order: chapter.order,
      pageCount: chapter.pages.length,
    });
    for (const page of chapter.pages) {
      const blobId = uuid();
      await db.blobs.add({ id: blobId, blob: page.blob });
      await db.pages.add({
        id: uuid(),
        chapterId,
        pageNumber: page.pageNumber,
        blobId,
      });
    }
  });
}

export async function runNewSeriesPipeline(
  zip: ZipReader,
  importType: ImportType,
  activeProfileId: string,
  emit: Emit,
  cancel: CancelToken = { cancelled: false },
  log: WorkerLogger = NULL_LOGGER,
): Promise<number> {
  const seriesList: SeriesEntry[] =
    importType === 'type1' || importType === 'type2' ? await walkLibrary(zip) : [];

  log.info('walk', 'walkLibrary done', {
    seriesCount: seriesList.length,
    totalChapters: seriesList.reduce((s, x) => s + x.chapters.length, 0),
  });

  const totalChapters = seriesList.reduce((s, x) => s + x.chapters.length, 0) || 1;
  const startTime = Date.now();
  const counter = { value: 0 };

  for (const entry of seriesList) {
    if (cancel.cancelled) throw new Error('CANCELLED');
    log.info('series', 'begin', {
      title: entry.title,
      chapters: entry.chapters.length,
      hasCover: !!entry.coverPath,
    });
    try {
      await importSeries(zip, entry, activeProfileId, emit, cancel, log, totalChapters, startTime, counter);
      log.info('series', 'done', { title: entry.title });
    } catch (err) {
      log.error('series', 'failed', { title: entry.title, error: err });
      throw err;
    }
  }

  return seriesList.length;
}

async function importSeries(
  zip: ZipReader,
  entry: SeriesEntry,
  activeProfileId: string,
  emit: Emit,
  cancel: CancelToken,
  log: WorkerLogger,
  totalChapters: number,
  startTime: number,
  counter: { value: number },
): Promise<void> {
  const incomingNormalized = normalizeTitle(entry.title);

  // Resolve existing series for merge (Type 1 includes-existing handling).
  const existing = await db.series
    .where('[profileId+normalizedTitle]')
    .equals([activeProfileId, incomingNormalized])
    .first();

  // Read cover blob outside any txn. Cover is small and held only across this
  // series; goes out of scope once this function returns.
  let coverBlob: Blob | null = null;
  let usedFallbackCover = false;
  if (entry.coverPath && zip.has(entry.coverPath)) {
    coverBlob = await zip.readBlob(entry.coverPath);
  } else if (!existing && entry.chapters[0]?.pages[0] && zip.has(entry.chapters[0].pages[0].path)) {
    coverBlob = await zip.readBlob(entry.chapters[0].pages[0].path);
    usedFallbackCover = true;
  }

  // Skip-set for chapters that already exist when merging.
  const skipExistingOrders = new Set<number>();
  if (existing) {
    const existingChapters = await db.chapters
      .where('seriesId')
      .equals(existing.id)
      .toArray();
    for (const c of existingChapters) skipExistingOrders.add(c.order);
  }

  // Series-level txn: create or update the series row + cover blob.
  const seriesId = await db.transaction(
    'rw',
    [db.series, db.blobs],
    async (): Promise<string> => {
      let coverImageId: string | null = existing?.coverImageId ?? null;
      if (coverBlob) {
        const id = uuid();
        await db.blobs.add({ id, blob: coverBlob });
        if (!existing) {
          coverImageId = id;
        } else if (!usedFallbackCover) {
          if (existing.coverImageId && existing.coverImageId !== id) {
            await db.blobs.delete(existing.coverImageId);
          }
          coverImageId = id;
        }
      }
      if (existing) {
        if (coverImageId && coverImageId !== existing.coverImageId) {
          await db.series.update(existing.id, {
            coverImageId,
            coverSource: 'imported',
          });
        }
        return existing.id;
      }
      const newId = uuid();
      await db.series.add({
        id: newId,
        profileId: activeProfileId,
        title: entry.title,
        originalTitle: entry.title,
        normalizedTitle: incomingNormalized,
        coverImageId,
        coverBlobId: null,
        pendingCoverUrl: null,
        coverFetchAttempts: 0,
        coverSource: 'imported',
        chapterCount: 0,
        lastReadChapterId: null,
        lastReadAt: null,
        lastReadChapterOrder: null,
        importedAt: Date.now(),
        sortOrder: Date.now(),
      });
      return newId;
    },
  );

  // Release the cover reference now that it's persisted.
  coverBlob = null;

  // Count chapters skipped so the progress counter stays consistent.
  const skippedHere = entry.chapters.filter((c) => skipExistingOrders.has(c.order)).length;
  counter.value += skippedHere;

  // Per-chapter loop: read this chapter's blobs, write them in one txn, then
  // drop them. iOS can reclaim the memory before we start the next chapter.
  for (const chapter of entry.chapters) {
    if (cancel.cancelled) throw new Error('CANCELLED');
    if (skipExistingOrders.has(chapter.order)) continue;

    const pages = await preparePages(zip, chapter, cancel, log, 'new-series');
    await writeChapterTransaction(
      seriesId,
      activeProfileId,
      { title: chapter.title, order: chapter.order, pages },
      cancel,
    );

    counter.value++;
    const elapsed = Math.max(1, Date.now() - startTime);
    const rate = counter.value / elapsed;
    const remaining = totalChapters - counter.value;
    const eta = rate > 0 ? Math.round(remaining / rate) : null;

    emit({
      type: 'PROGRESS',
      seriesName: entry.title,
      chapterIndex: counter.value,
      chapterTotal: totalChapters,
      pct: Math.round((counter.value / totalChapters) * 100),
      eta,
    });
  }

  // Final small txn: refresh chapterCount.
  await db.transaction('rw', [db.series, db.chapters], async () => {
    const newCount = await db.chapters.where('seriesId').equals(seriesId).count();
    await db.series.update(seriesId, { chapterCount: newCount });
  });

  // Restore the last-read chapter pointer if it was preserved by a prior
  // delete-read-chapters operation. No-op when nothing was preserved.
  await restoreLastReadFromOrder(activeProfileId, seriesId);
}

export async function runChapterMergePipeline(
  zip: ZipReader,
  targetSeriesId: string,
  activeProfileId: string,
  emit: Emit,
  cancel: CancelToken = { cancelled: false },
  log: WorkerLogger = NULL_LOGGER,
): Promise<void> {
  const chapters = await walkChapterUpdate(zip);
  log.info('walk', 'walkChapterUpdate done', { chapters: chapters.length });
  const totalChapters = chapters.length || 1;
  const startTime = Date.now();
  const counter = { value: 0 };

  const series = await db.series.get(targetSeriesId);
  if (!series) throw new Error('Target series not found.');

  // Skip chapter orders that already exist on the target series.
  const existingOrders = new Set<number>();
  const existingChaptersInDb = await db.chapters.where('seriesId').equals(targetSeriesId).toArray();
  for (const c of existingChaptersInDb) existingOrders.add(c.order);

  const skippedHere = chapters.filter((c) => existingOrders.has(c.order)).length;
  counter.value += skippedHere;

  for (const chapter of chapters) {
    if (cancel.cancelled) throw new Error('CANCELLED');
    if (existingOrders.has(chapter.order)) continue;

    const pages = await preparePages(zip, chapter, cancel, log, 'merge');
    await writeChapterTransaction(
      targetSeriesId,
      activeProfileId,
      { title: chapter.title, order: chapter.order, pages },
      cancel,
    );

    counter.value++;
    const elapsed = Math.max(1, Date.now() - startTime);
    const rate = counter.value / elapsed;
    const remaining = totalChapters - counter.value;
    const eta = rate > 0 ? Math.round(remaining / rate) : null;
    emit({
      type: 'PROGRESS',
      seriesName: series.title,
      chapterIndex: counter.value,
      chapterTotal: totalChapters,
      pct: Math.round((counter.value / totalChapters) * 100),
      eta,
    });
  }

  await db.transaction('rw', [db.series, db.chapters], async () => {
    const newCount = await db.chapters.where('seriesId').equals(targetSeriesId).count();
    await db.series.update(targetSeriesId, { chapterCount: newCount });
  });

  await restoreLastReadFromOrder(activeProfileId, targetSeriesId);
}
