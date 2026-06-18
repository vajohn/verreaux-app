import { db } from '../../db/db';
import { createSeries, setPendingCatchUp } from '../../db/repos/series.repo';
import { runChunkedCatchUp, type CatchUpRunDeps } from './catchUpRun';
import { titleFromSourceUrl } from './sourceUrlTitle';
import type { CatchUpCandidate } from './catchUp';
import { useBackgroundStore } from '../background/background.store';
import { uuid } from '../../lib/uuid';
import { registerResumeSync } from './backgroundSync';

export interface SyncDownloadDeps {
  profileId: string;
  /** Token-authed scrape → output ZIP blob; reports polled run state via onState. */
  runScrape: (req: { url: string; args: string }, onState: (s: string) => void) => Promise<Blob>;
  /** Start an import for the file and resolve when it finishes. */
  runImport: CatchUpRunDeps['runImport'];
}

function scrapeSubLabel(state: string): string {
  if (state === 'succeeded') return 'Preparing import…';
  if (state === 'failed') return 'Scrape failed';
  return 'Fetching chapters…';
}

/**
 * Ensure a series shell exists for the candidate (create if missing, reuse if
 * found), set `pendingCatchUp` on it, and return a candidate whose `seriesId`
 * is guaranteed non-null (pointing at the shell).
 *
 * The shell + `pendingCatchUp` survive any downstream failure so the download
 * is retryable from the series page.
 */
export async function ensureSeriesShell(candidate: CatchUpCandidate, profileId: string): Promise<CatchUpCandidate> {
  let seriesId = candidate.seriesId;
  if (!seriesId) {
    const existing = (await db.series.where('profileId').equals(profileId).toArray())
      .find((s) => s.sourceUrl === candidate.sourceUrl);
    if (existing) seriesId = existing.id;
    else {
      const shell = await createSeries({
        profileId,
        title: titleFromSourceUrl(candidate.sourceUrl),
        coverImageId: null,
        sourceUrl: candidate.sourceUrl,
      });
      seriesId = shell.id;
    }
  }
  await setPendingCatchUp(seriesId, { syncedChapter: candidate.syncedChapter, syncedPage: candidate.syncedPage });
  void registerResumeSync();

  // Return a candidate that targets the shell (runChunkedCatchUp merges via context 'series').
  return { ...candidate, seriesId };
}

/**
 * Create the series shell up-front (so a failed download is retryable from the
 * series page), track progress in the global background bar, run the catch-up,
 * and clear `pendingCatchUp` only on a full 'done'. The series shell +
 * `pendingCatchUp` survive any failure.
 */
export async function runSyncDownload(candidate: CatchUpCandidate, deps: SyncDownloadDeps): Promise<void> {
  // 1. Ensure a series shell with sourceUrl + pendingCatchUp.
  const resolved = await ensureSeriesShell(candidate, deps.profileId);
  const seriesId = resolved.seriesId!;

  // 2. Track in the global single-slot bar (survives navigation).
  const taskId = `sync-download:${uuid()}`;
  const title = (await db.series.get(seriesId))?.title ?? 'series';
  const bgOwned = useBackgroundStore.getState().start({
    id: taskId, kind: 'sync-download', label: `Downloading ${title}`, subLabel: 'Fetching chapters…', progress: null,
  });

  try {
    const onScrapeState = (s: string) => {
      if (bgOwned) useBackgroundStore.getState().update({ subLabel: scrapeSubLabel(s) });
    };
    const outcome = await runChunkedCatchUp(resolved, {
      profileId: deps.profileId,
      runScrape: (req) => deps.runScrape(req, onScrapeState),
      // Keep the bar slot HELD across the import (it is the serialization guard
      // for the single import worker — freeing it here would let a second
      // download start and terminate this one's worker). Show a static label;
      // the `finally` finishes the task after the whole operation completes.
      runImport: (args) => {
        if (bgOwned) useBackgroundStore.getState().update({ subLabel: 'Importing…' });
        return deps.runImport(args);
      },
      onBatch: (n) => { if (bgOwned) useBackgroundStore.getState().update({ subLabel: `Imported ${n} batch${n === 1 ? '' : 'es'}…` }); },
    });
    if (outcome === 'done') await setPendingCatchUp(seriesId, null);
  } finally {
    if (bgOwned) useBackgroundStore.getState().finish(taskId);
  }
}
