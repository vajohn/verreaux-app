import { runSyncDownload } from './syncDownload';
import { tokenRunScrape } from './defaultRunScrape';
import { importToCompletion } from '../import/importController';
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
