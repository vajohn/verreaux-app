/**
 * exportLibrary — generates a verreaux-library-YYYYMMDD.zip via @zip.js/zip.js.
 *
 * Memory model: zip.js's ZipWriter streams entries as they're added — no
 * intermediate full-archive buffer. Each blob is read into a BlobReader (which
 * uses Blob.slice random access internally) and piped into the underlying
 * BlobWriter. Old page blobs go out of scope after each `add()` resolves, so
 * even very large libraries don't pile up in memory.
 *
 * Structure:
 *   <SeriesTitle>/
 *     manifest.json          (series metadata)
 *     <ChapterTitle>/
 *       001.jpg / 001.png    (original page blobs)
 *   progress.json            (reading progress for the active profile)
 */
import { BlobReader, BlobWriter, TextReader, ZipWriter } from '../../lib/zip';
import { db } from '../../db/db';

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function safeFileName(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, '_').slice(0, 80);
}

export async function exportLibrary(profileId: string): Promise<void> {
  const blobWriter = new BlobWriter('application/zip');
  // level: 0 = STORED. Page blobs are already-compressed images (webp/jpg/png)
  // so re-deflating wastes CPU for negligible savings.
  const zipWriter = new ZipWriter(blobWriter, { level: 0 });

  try {
    const allSeries = await db.series.where('profileId').equals(profileId).toArray();
    const progressRecords = await db.readingProgress.where('profileId').equals(profileId).toArray();

    const manifestEntries: object[] = [];

    for (const series of allSeries) {
      const seriesDir = safeFileName(series.title);
      const chapters = await db.chapters.where('seriesId').equals(series.id).sortBy('order');

      manifestEntries.push({
        id: series.id,
        title: series.title,
        originalTitle: series.originalTitle,
        chapterCount: series.chapterCount,
        importedAt: series.importedAt,
        lastReadAt: series.lastReadAt,
      });

      const seriesManifest = JSON.stringify(
        {
          id: series.id,
          title: series.title,
          originalTitle: series.originalTitle,
          chapters: chapters.map((c) => ({
            id: c.id,
            title: c.title,
            order: c.order,
            pageCount: c.pageCount,
          })),
        },
        null,
        2,
      );
      await zipWriter.add(`${seriesDir}/manifest.json`, new TextReader(seriesManifest));

      for (const chapter of chapters) {
        const chDir = `${seriesDir}/${safeFileName(chapter.title)}`;
        const pages = await db.pages.where('chapterId').equals(chapter.id).sortBy('pageNumber');
        for (const page of pages) {
          const blobRecord = await db.blobs.get(page.blobId);
          if (!blobRecord) continue;
          const ext = blobRecord.blob.type.includes('jpeg') ? 'jpg' : 'png';
          const fname = `${String(page.pageNumber).padStart(3, '0')}.${ext}`;
          await zipWriter.add(`${chDir}/${fname}`, new BlobReader(blobRecord.blob));
        }
      }
    }

    await zipWriter.add('manifest.json', new TextReader(JSON.stringify(manifestEntries, null, 2)));
    await zipWriter.add(
      'progress.json',
      new TextReader(
        JSON.stringify(
          progressRecords.map((r) => ({
            seriesId: r.seriesId,
            currentChapterId: r.currentChapterId,
            pageIndex: r.pageIndex,
            manuallyMarked: r.manuallyMarked,
            updatedAt: r.updatedAt,
          })),
          null,
          2,
        ),
      ),
    );

    const blob = await zipWriter.close();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `verreaux-library-${todayStr()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    // Best-effort cleanup; close() is idempotent-ish but may throw if already closed.
    try {
      await zipWriter.close();
    } catch {
      // ignore
    }
    throw err;
  }
}
