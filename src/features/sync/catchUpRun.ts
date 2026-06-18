import { db } from '../../db/db';
import { deleteChaptersBelowOrder, setCaughtUp } from '../../db/repos/series.repo';
import { upsertProgress, getProgress } from '../../db/repos/progress.repo';
import type { CatchUpCandidate } from './catchUp';
import type { ImportContext } from '../import/typeDetector';
import { getDownloadBatchSize, isEndOfSeriesError } from './chunking';

export interface CatchUpRunDeps {
  profileId: string;
  runScrape: (req: { url: string; args: string }) => Promise<Blob>;
  runImport: (args: { file: File; context: ImportContext; targetSeriesId?: string; activeProfileId: string }) => Promise<void>;
  /** Called after each batch imports, with the running batch count (progress UI). */
  onBatch?: (batchesImported: number) => void | Promise<void>;
}

async function resolveSeriesId(candidate: CatchUpCandidate, profileId: string): Promise<string> {
  if (candidate.seriesId) return candidate.seriesId;
  const s = (await db.series.where('profileId').equals(profileId).toArray()).find((x) => x.sourceUrl === candidate.sourceUrl);
  if (!s) throw new Error('Catch-up import did not produce a series.');
  return s.id;
}

async function localMaxOrder(seriesId: string): Promise<number> {
  const top = await db.chapters.where('[seriesId+order]').between([seriesId, -Infinity], [seriesId, Infinity]).last();
  // floor: scraper chapter numbers are integers; a fractional order (manual insert) shouldn't push the resume window past the next integer chapter.
  return top ? Math.floor(top.order) : 0;
}

/** Prune below the synced chapter and set the reading position to the synced
 *  page — but only once the synced chapter is present locally, and only setting
 *  the position when it ADVANCES (never regress a position the user moved past,
 *  e.g. on a resume). Returns whether the synced chapter is present. */
async function pruneAndPositionIfSyncedPresent(seriesId: string, candidate: CatchUpCandidate, profileId: string): Promise<boolean> {
  const chapter = await db.chapters.where('[seriesId+order]').equals([seriesId, candidate.syncedChapter]).first();
  if (!chapter) return false;
  await deleteChaptersBelowOrder(seriesId, candidate.syncedChapter);
  const prog = await getProgress(profileId, seriesId);
  const cur = prog ? await db.chapters.get(prog.currentChapterId) : undefined;
  const curOrder = cur?.order ?? -Infinity;
  if (curOrder < candidate.syncedChapter) {
    await upsertProgress({
      profileId, seriesId, currentChapterId: chapter.id,
      pageIndex: Math.min(candidate.syncedPage, Math.max(0, chapter.pageCount - 1)),
      scrollPosition: 0, manuallyMarked: false, force: true,
    });
  }
  return true;
}

/**
 * Fetch + import a catch-up in ascending bounded batches of getDownloadBatchSize()
 * chapters, until a batch returns no chapters in range (end of series). The start
 * is clamped to localMax+1 so a resume never re-fetches local chapters. On the
 * INITIAL catch-up, the first batch with the synced chapter present prunes below
 * it and sets the reading position (only advancing it, never regressing);
 * `caughtUp` is set only when the window ends. Returns 'incomplete' if the synced
 * chapter never arrived (no prune, not caughtUp — retryable). A non-terminator
 * scrape error rejects (resumable).
 *
 * Requires the series to exist already — callers create the shell (with sourceUrl)
 * via ensureSeriesShell first, so candidate.seriesId is set and the first batch
 * imports with context 'series' into that (possibly empty) shell. A 'missing'
 * candidate that has passed through ensureSeriesShell carries the shell's seriesId.
 */
export async function runChunkedCatchUp(candidate: CatchUpCandidate, deps: CatchUpRunDeps): Promise<'done' | 'incomplete'> {
  const seriesId = await resolveSeriesId(candidate, deps.profileId);
  const n = getDownloadBatchSize();
  const windowStart = candidate.initial ? candidate.syncedChapter : (candidate.maxOrder ?? 0) + 1;
  let from = Math.max(windowStart, (await localMaxOrder(seriesId)) + 1);
  let positioned = false;
  let imported = 0;

  for (;;) {
    const to = from + n - 1;
    let blob: Blob;
    try {
      blob = await deps.runScrape({ url: candidate.sourceUrl, args: `--from ${from} --to ${to}` });
    } catch (e) {
      if (isEndOfSeriesError(e)) break;   // no chapters in range → end of series
      throw e;                             // genuine failure → abort (resumable)
    }
    await deps.runImport({
      file: new File([blob], 'catchup.zip', { type: 'application/zip' }),
      context: 'series', targetSeriesId: seriesId, activeProfileId: deps.profileId,
    });
    imported += 1;
    from += n;
    if (candidate.initial && !positioned) {
      positioned = await pruneAndPositionIfSyncedPresent(seriesId, candidate, deps.profileId);
    }
    await deps.onBatch?.(imported);
  }

  if (candidate.initial && !positioned) return 'incomplete';
  await setCaughtUp(seriesId);
  return 'done';
}
