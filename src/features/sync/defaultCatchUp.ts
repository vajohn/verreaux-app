import { runSyncDownload, ensureSeriesShell } from './syncDownload';
import { catchUpScrapeArgs, finalizeCatchUp } from './catchUpRun';
import { tokenRunScrape } from './defaultRunScrape';
import { importToCompletion } from '../import/importController';
import { setPendingCatchUp } from '../../db/repos/series.repo';
import { enqueueDownloads } from './downloadQueue';
import type { CatchUpCandidate } from './catchUp';

/** Live sync download: series shell + global progress bar + token scrape + real
 *  import worker. The single entry point used by Settings and the series page. */
export function runDownload(candidate: CatchUpCandidate, profileId: string): Promise<void> {
  return runSyncDownload(candidate, {
    profileId,
    runScrape: (req, onState) => tokenRunScrape(onState)(req),
    runImport: importToCompletion,
  });
}

/** Enqueue a pipelined batch of live downloads (token scrape + serial import). */
export function enqueueLiveDownloads(items: CatchUpCandidate[], profileId: string): Promise<void> {
  return enqueueDownloads(items, {
    prepare: (c) => ensureSeriesShell(c, profileId),
    // Scrape-state events are intentionally discarded in the batch path: the
    // queue shows aggregate "N of M" progress instead of a per-item sub-label.
    scrape: (c) => tokenRunScrape(() => {})({ url: c.sourceUrl, args: catchUpScrapeArgs(c) }),
    importBlob: (c, blob) => importToCompletion({
      file: new File([blob], 'catchup.zip', { type: 'application/zip' }),
      context: 'series',
      targetSeriesId: c.seriesId!,        // ensureSeriesShell guarantees a seriesId
      activeProfileId: profileId,
    }),
    finalize: async (c) => {
      const outcome = await finalizeCatchUp(c, profileId);
      if (outcome === 'done') await setPendingCatchUp(c.seriesId!, null);
    },
  });
}
