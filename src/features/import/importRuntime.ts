import type JSZip from 'jszip';
import { db } from '../../db/db';
import { uuid } from '../../lib/uuid';
import { walkLibrary, walkChapterUpdate, type SeriesEntry } from './zipWalker';
import { normalizeTitle } from '../../db/repos/series.repo';
import type { ImportType } from './typeDetector';

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
  | { type: 'CANCELLED' };

export type Emit = (msg: WorkerOutMessage) => void;

export interface CancelToken {
  cancelled: boolean;
}

interface NewSeriesContext {
  zip: JSZip;
  activeProfileId: string;
  emit: Emit;
  cancel: CancelToken;
}

export async function runNewSeriesPipeline(
  zip: JSZip,
  importType: ImportType,
  activeProfileId: string,
  emit: Emit,
  cancel: CancelToken = { cancelled: false },
): Promise<number> {
  const seriesList: SeriesEntry[] =
    importType === 'type1' || importType === 'type2' ? await walkLibrary(zip) : [];

  const totalChapters = seriesList.reduce((s, x) => s + x.chapters.length, 0) || 1;
  const startTime = Date.now();
  const counter = { value: 0 };

  for (const entry of seriesList) {
    if (cancel.cancelled) throw new Error('CANCELLED');
    await writeSeriesTransaction({ zip, activeProfileId, emit, cancel }, entry, totalChapters, startTime, counter);
  }

  return seriesList.length;
}

async function writeSeriesTransaction(
  ctx: NewSeriesContext,
  entry: SeriesEntry,
  totalChapters: number,
  startTime: number,
  counter: { value: number },
): Promise<void> {
  const { zip, activeProfileId, emit, cancel } = ctx;
  const incomingNormalized = normalizeTitle(entry.title);

  // Look up an existing series for merge (Type 1 includes-existing handling).
  const existing = await db.series
    .where('[profileId+normalizedTitle]')
    .equals([activeProfileId, incomingNormalized])
    .first();

  // Pre-read all blobs from JSZip OUTSIDE the Dexie transaction. Mixing
  // non-IDB awaits (JSZip's blob() returns a microtask-resolved Promise)
  // inside a Dexie transaction triggers PrematureCommitError because the
  // implicit IDB transaction commits between the await and the next
  // IDB call.
  let coverBlob: Blob | null = null;
  let usedFallbackCover = false;
  if (entry.coverPath) {
    const z = zip.file(entry.coverPath);
    if (z) coverBlob = await z.async('blob');
  } else if (!existing && entry.chapters[0]?.pages[0]) {
    const z = zip.file(entry.chapters[0].pages[0].path);
    if (z) {
      coverBlob = await z.async('blob');
      usedFallbackCover = true;
    }
  }

  interface PreparedPage {
    pageNumber: number;
    blob: Blob;
  }
  interface PreparedChapter {
    title: string;
    order: number;
    pages: PreparedPage[];
  }

  // Skip chapters that already exist when merging.
  const chaptersToWrite: PreparedChapter[] = [];
  const skipExistingOrders = new Set<number>();
  if (existing) {
    const existingChapters = await db.chapters
      .where('seriesId')
      .equals(existing.id)
      .toArray();
    for (const c of existingChapters) skipExistingOrders.add(c.order);
  }

  for (const chapter of entry.chapters) {
    if (cancel.cancelled) throw new Error('CANCELLED');
    if (skipExistingOrders.has(chapter.order)) continue;
    const pages: PreparedPage[] = [];
    for (const page of chapter.pages) {
      if (cancel.cancelled) throw new Error('CANCELLED');
      const z = zip.file(page.path);
      if (!z) continue;
      const blob = await z.async('blob');
      pages.push({ pageNumber: page.pageNumber, blob });
    }
    chaptersToWrite.push({ title: chapter.title, order: chapter.order, pages });
  }

  await db.transaction('rw', [db.series, db.chapters, db.pages, db.blobs], async () => {
    let coverImageId: string | null = existing?.coverImageId ?? null;

    if (coverBlob) {
      const id = uuid();
      await db.blobs.add({ id, blob: coverBlob });
      // Only replace existing cover when we actually got one from the ZIP
      // (cover.* file present, not the chapter-1 fallback for an existing series).
      if (!existing) {
        coverImageId = id;
      } else if (!usedFallbackCover) {
        if (existing.coverImageId && existing.coverImageId !== id) {
          await db.blobs.delete(existing.coverImageId);
        }
        coverImageId = id;
      }
    }

    let seriesId: string;
    if (existing) {
      seriesId = existing.id;
      if (coverImageId && coverImageId !== existing.coverImageId) {
        await db.series.update(seriesId, {
          coverImageId,
          coverSource: 'imported',
        });
      }
    } else {
      seriesId = uuid();
      await db.series.add({
        id: seriesId,
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
        importedAt: Date.now(),
        sortOrder: Date.now(),
      });
    }

    // First, count the chapters skipped (no-op increments to keep counter consistent).
    counter.value += entry.chapters.length - chaptersToWrite.length;

    for (const chapter of chaptersToWrite) {
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

    const newCount = await db.chapters.where('seriesId').equals(seriesId).count();
    await db.series.update(seriesId, { chapterCount: newCount });
  });
}

export async function runChapterMergePipeline(
  zip: JSZip,
  targetSeriesId: string,
  activeProfileId: string,
  emit: Emit,
  cancel: CancelToken = { cancelled: false },
): Promise<void> {
  const chapters = await walkChapterUpdate(zip);
  const totalChapters = chapters.length || 1;
  const startTime = Date.now();
  const counter = { value: 0 };

  // Determine which chapter orders already exist so we skip them during prefetch.
  const existingOrders = new Set<number>();
  const existingChaptersInDb = await db.chapters.where('seriesId').equals(targetSeriesId).toArray();
  for (const c of existingChaptersInDb) existingOrders.add(c.order);

  // Phase 1: Pre-read all page blobs from JSZip OUTSIDE the Dexie transaction.
  // Mixing non-IDB awaits (JSZip's blob() returns a microtask Promise) inside a
  // Dexie transaction triggers PrematureCommitError. Same pattern as writeSeriesTransaction.
  interface PreparedPage {
    pageNumber: number;
    blob: Blob;
  }
  interface PreparedChapter {
    title: string;
    order: number;
    pages: PreparedPage[];
  }

  const chaptersToWrite: PreparedChapter[] = [];
  for (const chapter of chapters) {
    if (cancel.cancelled) throw new Error('CANCELLED');
    if (existingOrders.has(chapter.order)) continue;
    const pages: PreparedPage[] = [];
    for (const page of chapter.pages) {
      if (cancel.cancelled) throw new Error('CANCELLED');
      const z = zip.file(page.path);
      if (!z) continue;
      const blob = await z.async('blob');
      pages.push({ pageNumber: page.pageNumber, blob });
    }
    chaptersToWrite.push({ title: chapter.title, order: chapter.order, pages });
  }

  // Phase 2: Only IDB writes inside the Dexie transaction.
  await db.transaction('rw', [db.series, db.chapters, db.pages, db.blobs], async () => {
    const series = await db.series.get(targetSeriesId);
    if (!series) throw new Error('Target series not found.');

    // Count skipped chapters so the progress counter stays consistent.
    counter.value += chapters.length - chaptersToWrite.length;

    for (const chapter of chaptersToWrite) {
      if (cancel.cancelled) throw new Error('CANCELLED');

      const chapterId = uuid();
      await db.chapters.add({
        id: chapterId,
        seriesId: targetSeriesId,
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

    const newCount = await db.chapters.where('seriesId').equals(targetSeriesId).count();
    await db.series.update(targetSeriesId, { chapterCount: newCount });
  });
}
