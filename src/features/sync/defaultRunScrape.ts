import { runScrapeToBlob, type RunScrapeDeps } from './runScrapeToBlob';
import { postScrape, getRunStatus, getRunZip } from './piClient';
import { getSyncCreds } from './syncCreds';

/** A scrape-to-Blob runner shared by both orchestrations (add-from-url and
 *  update-from-source). Lives here so neither orchestrator has to import the
 *  other to get the live client+poller wiring. `onState` receives each polled
 *  run state for progress UI. */
export type ScrapeRunner = (req: {
  url: string;
  args: string;
  otp: string;
}) => Promise<Blob>;

function makeRunScrapeDeps(onState: (s: string) => void): RunScrapeDeps {
  return {
    postScrape,
    getRunStatus,
    getRunZip,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    onState,
  };
}

/** Default runner wiring the real piClient + a setTimeout-based poll loop. */
export function defaultRunScrape(onState: (s: string) => void): ScrapeRunner {
  return (req) => {
    const deps = makeRunScrapeDeps(onState);
    return runScrapeToBlob({ ...req, type: 'scrape' }, deps);
  };
}

/** A catch-up runner authenticated by the enrolled device's sync token (no OTP).
 *  Throws if the device is not enrolled. `onState` receives each polled state. */
export function tokenRunScrape(
  onState: (s: string) => void,
): (req: { url: string; args: string }) => Promise<Blob> {
  return async (req) => {
    const creds = getSyncCreds();
    if (!creds) throw new Error('This device is not enrolled for sync.');
    const deps = makeRunScrapeDeps(onState);
    return runScrapeToBlob(
      { url: req.url, args: req.args, otp: '', type: 'scrape', deviceToken: creds.deviceToken },
      deps,
    );
  };
}
