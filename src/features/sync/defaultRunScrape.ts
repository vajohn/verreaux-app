import { runScrapeToBlob, type RunScrapeDeps } from './runScrapeToBlob';
import { postScrape, getRunStatus, getRunZip } from './piClient';

/** A scrape-to-Blob runner shared by both orchestrations (add-from-url and
 *  update-from-source). Lives here so neither orchestrator has to import the
 *  other to get the live client+poller wiring. `onState` receives each polled
 *  run state for progress UI. */
export type ScrapeRunner = (req: {
  url: string;
  args: string;
  otp: string;
}) => Promise<Blob>;

/** Default runner wiring the real piClient + a setTimeout-based poll loop. */
export function defaultRunScrape(onState: (s: string) => void): ScrapeRunner {
  return (req) => {
    const deps: RunScrapeDeps = {
      postScrape,
      getRunStatus,
      getRunZip,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      onState,
    };
    return runScrapeToBlob({ ...req, type: 'scrape' }, deps);
  };
}
