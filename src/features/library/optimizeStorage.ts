import { db } from '../../db/db';
import { compressImageBlob } from '../import/imageCompressor';

export interface OptimizeProgress {
  processed: number;
  total: number;
  bytesBefore: number;
  bytesAfter: number;
  skipped: number;
}

export interface OptimizeOptions {
  profileId: string;
  onProgress?: (p: OptimizeProgress) => void;
  signal?: AbortSignal;
}

const BATCH_SIZE = 5;

export async function runOptimizeStorage({
  profileId,
  onProgress,
  signal,
}: OptimizeOptions): Promise<OptimizeProgress> {
  const chapters = await db.chapters.where('profileId').equals(profileId).toArray();
  const chapterIds = chapters.map((c) => c.id);

  const progress: OptimizeProgress = {
    processed: 0,
    total: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    skipped: 0,
  };

  if (chapterIds.length === 0) {
    onProgress?.({ ...progress });
    return progress;
  }

  const pages = await db.pages.where('chapterId').anyOf(chapterIds).toArray();
  progress.total = pages.length;
  onProgress?.({ ...progress });

  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    if (signal?.aborted) break;
    const batch = pages.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (p) => {
        try {
          const rec = await db.blobs.get(p.blobId);
          if (!rec) {
            progress.skipped += 1;
            return;
          }
          const original = rec.blob;
          progress.bytesBefore += original.size;
          if (!original.type.startsWith('image/')) {
            progress.bytesAfter += original.size;
            progress.skipped += 1;
            return;
          }
          const compressed = await compressImageBlob(original);
          if (compressed.size < original.size) {
            await db.blobs.put({ id: p.blobId, blob: compressed });
            progress.bytesAfter += compressed.size;
          } else {
            progress.bytesAfter += original.size;
            progress.skipped += 1;
          }
        } catch {
          progress.skipped += 1;
        }
      }),
    );
    progress.processed = Math.min(i + BATCH_SIZE, pages.length);
    onProgress?.({ ...progress });
    await new Promise<void>((r) => setTimeout(r, 0));
  }

  return progress;
}
