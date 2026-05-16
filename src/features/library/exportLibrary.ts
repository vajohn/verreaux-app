/**
 * exportLibrary — generates a verreaux-library-YYYYMMDD.zip via JSZip on the main thread.
 *
 * WARNING: This can OOM on libraries > 2 GB. This is a known limitation; the user
 * is initiating this action explicitly and must ensure enough free RAM.
 *
 * Structure:
 *   <SeriesTitle>/
 *     manifest.json          (series metadata)
 *     <ChapterTitle>/
 *       001.jpg / 001.png    (original page blobs)
 *   progress.json            (reading progress for the active profile)
 */
import JSZip from 'jszip';
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
  const zip = new JSZip();

  const allSeries = await db.series.where('profileId').equals(profileId).toArray();
  const progressRecords = await db.readingProgress.where('profileId').equals(profileId).toArray();

  // Manifest per-series
  const manifestEntries: object[] = [];

  for (const series of allSeries) {
    const seriesFolder = zip.folder(safeFileName(series.title));
    if (!seriesFolder) continue;

    const chapters = await db.chapters.where('seriesId').equals(series.id).sortBy('order');

    manifestEntries.push({
      id: series.id,
      title: series.title,
      originalTitle: series.originalTitle,
      chapterCount: series.chapterCount,
      importedAt: series.importedAt,
      lastReadAt: series.lastReadAt,
    });

    seriesFolder.file(
      'manifest.json',
      JSON.stringify({
        id: series.id,
        title: series.title,
        originalTitle: series.originalTitle,
        chapters: chapters.map((c) => ({ id: c.id, title: c.title, order: c.order, pageCount: c.pageCount })),
      }, null, 2),
    );

    for (const chapter of chapters) {
      const chFolder = seriesFolder.folder(safeFileName(chapter.title));
      if (!chFolder) continue;

      const pages = await db.pages.where('chapterId').equals(chapter.id).sortBy('pageNumber');
      for (const page of pages) {
        const blobRecord = await db.blobs.get(page.blobId);
        if (!blobRecord) continue;
        const ext = blobRecord.blob.type.includes('jpeg') ? 'jpg' : 'png';
        const fname = `${String(page.pageNumber).padStart(3, '0')}.${ext}`;
        const arrayBuffer = await blobRecord.blob.arrayBuffer();
        chFolder.file(fname, arrayBuffer);
      }
    }
  }

  // Root manifest
  zip.file('manifest.json', JSON.stringify(manifestEntries, null, 2));

  // Progress JSON
  zip.file(
    'progress.json',
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
  );

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `verreaux-library-${todayStr()}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a short delay to allow the download to start
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
