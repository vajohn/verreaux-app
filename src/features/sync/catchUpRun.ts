import { db } from '../../db/db';
import { deleteChaptersBelowOrder, setCaughtUp } from '../../db/repos/series.repo';
import { upsertProgress } from '../../db/repos/progress.repo';
import { buildScrapeArgs } from './scrapeArgs';
import { computeUpdateArgs } from './updateArgs';
import type { CatchUpCandidate } from './catchUp';
import type { ImportContext } from '../import/typeDetector';
import { log } from '../../lib/log';

export interface CatchUpRunDeps {
  profileId: string;
  /** Token-authed scrape → output ZIP blob (e.g. tokenRunScrape). */
  runScrape: (req: { url: string; args: string }) => Promise<Blob>;
  /** Start an import for the file and resolve when it finishes. */
  runImport: (args: {
    file: File;
    context: ImportContext;
    targetSeriesId?: string;
    activeProfileId: string;
  }) => Promise<void>;
}

/**
 * Compute the scraper CLI args for a catch-up candidate.
 * Initial: fetch syncedChapter→latest. Subsequent: fetch localMax+1→latest.
 */
export function catchUpScrapeArgs(candidate: CatchUpCandidate): string {
  return candidate.initial
    ? buildScrapeArgs(String(candidate.syncedChapter), 'latest')
    : computeUpdateArgs(candidate.maxOrder);
}

/**
 * POST-IMPORT phase: resolve the series, check for the synced chapter, prune
 * (initial only), set position, mark caughtUp (initial only).
 *
 * Returns `'done'` on success. Returns `'incomplete'` when the synced chapter
 * was absent after the fetch (initial only) — no prune is done and caughtUp is
 * NOT set, so the next sync will retry.
 */
export async function finalizeCatchUp(candidate: CatchUpCandidate, profileId: string): Promise<'done' | 'incomplete'> {
  // Resolve the series (a missing candidate now has a row, keyed by sourceUrl).
  const series = candidate.seriesId
    ? await db.series.get(candidate.seriesId)
    : (await db.series.where('profileId').equals(profileId).toArray()).find((s) => s.sourceUrl === candidate.sourceUrl);
  if (!series) throw new Error('Catch-up import did not produce a series.');

  const chapter = await db.chapters
    .where('[seriesId+order]')
    .equals([series.id, candidate.syncedChapter])
    .first();

  if (candidate.initial && !chapter) {
    // The fetched window did not include the synced chapter (e.g. unavailable /
    // locked at the source). Do NOT prune — that would destroy local chapters
    // with no replacement — and do NOT mark caughtUp, so the next sync retries.
    log.warn('sync', 'catch-up: synced chapter missing after fetch; skipping prune', {
      sourceUrl: candidate.sourceUrl,
      syncedChapter: candidate.syncedChapter,
    });
    return 'incomplete';
  }

  // Prune only on the initial catch-up, only after confirming the synced
  // chapter is present (so a failed/short window never leaves a gap).
  if (candidate.initial) {
    await deleteChaptersBelowOrder(series.id, candidate.syncedChapter);
  }

  // Mark the latest page to read at the synced position (clamped to the page
  // count of the now-present chapter). force: advance even over a stale mark.
  if (chapter) {
    await upsertProgress({
      profileId,
      seriesId: series.id,
      currentChapterId: chapter.id,
      pageIndex: Math.min(candidate.syncedPage, Math.max(0, chapter.pageCount - 1)),
      scrollPosition: 0,
      manuallyMarked: false,
      force: true,
    });
  }

  if (candidate.initial) await setCaughtUp(series.id);

  return 'done';
}

/**
 * Fetch + import a catch-up candidate. On an INITIAL catch-up: fetch
 * syncedChapter→latest, then (only after a successful import) prune chapters
 * below the synced chapter, set the reading position to the synced page, and
 * mark the series caughtUp. On a SUBSEQUENT update: fetch localMax+1→latest and
 * set the position — no prune. Throws (without pruning) if the fetch fails.
 *
 * Returns `'done'` when the run fully completed (prune + position + caughtUp
 * set, or subsequent update applied). Returns `'incomplete'` when the synced
 * chapter was absent after the fetch — no prune was done and caughtUp was NOT
 * set, so the next sync will retry. Never returns on a fetch error (rejects).
 */
export async function catchUpRun(candidate: CatchUpCandidate, deps: CatchUpRunDeps): Promise<'done' | 'incomplete'> {
  const args = catchUpScrapeArgs(candidate);

  // Fetch first. If this throws, nothing local is touched.
  const blob = await deps.runScrape({ url: candidate.sourceUrl, args });
  const file = new File([blob], 'catchup.zip', { type: 'application/zip' });

  // Import. 'home' creates a new series for a missing candidate; 'series'
  // merges into the existing one (the import pipeline skips existing orders).
  await deps.runImport({
    file,
    context: candidate.seriesId ? 'series' : 'home',
    ...(candidate.seriesId ? { targetSeriesId: candidate.seriesId } : {}),
    activeProfileId: deps.profileId,
  });

  return finalizeCatchUp(candidate, deps.profileId);
}
