import { catchUpRun } from './catchUpRun';
import { tokenRunScrape } from './defaultRunScrape';
import { importToCompletion } from '../import/importController';
import type { CatchUpCandidate } from './catchUp';

/** Run one catch-up candidate with live wiring: token-authed scrape + the real
 *  import worker (awaited to completion). `onState` receives polled scrape
 *  states for progress UI. */
export function runCatchUp(
  candidate: CatchUpCandidate,
  profileId: string,
  onState: (s: string) => void = () => {},
): Promise<void> {
  return catchUpRun(candidate, {
    profileId,
    runScrape: tokenRunScrape(onState),
    runImport: importToCompletion,
  });
}
