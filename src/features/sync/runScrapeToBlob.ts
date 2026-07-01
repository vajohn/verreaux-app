import type { ScrapeRequest, RunStatus } from './piClient';

export interface RunScrapeDeps {
  postScrape: (req: ScrapeRequest) => Promise<string>;
  getRunStatus: (id: string) => Promise<RunStatus>;
  getRunZip: (id: string) => Promise<Blob>;
  sleep: (ms: number) => Promise<void>;
  onState: (state: RunStatus['state']) => void;
}

const POLL_MS = 10_000;
const MAX_MS = 120 * 60 * 1000;

/** Exit code the Pi reports when a scrape was cut short by rate limiting but
 *  still salvaged some chapters into output.zip (a resumable partial). */
const RATE_LIMITED_EXIT = 5;

/** Result of a scrape-to-blob run. `partial` is true for a rate-limited run
 *  that salvaged some chapters (resumable) — the blob still holds real output. */
export interface RunScrapeResult {
  blob: Blob;
  partial: boolean;
}

/** Dispatch a scrape to the Pi, poll to completion, return the output ZIP.
 *  A `failed` run with exitCode 5 + hasOutput is treated as a resumable PARTIAL
 *  (its output is fetched and returned with `partial: true`, not thrown). Any
 *  other `failed` run throws as a hard error. */
export async function runScrapeToBlob(req: ScrapeRequest, deps: RunScrapeDeps): Promise<RunScrapeResult> {
  const id = await deps.postScrape(req);
  const deadline = Date.now() + MAX_MS;
  for (;;) {
    await deps.sleep(POLL_MS);
    const status = await deps.getRunStatus(id);
    deps.onState(status.state);
    if (status.state === 'succeeded') return { blob: await deps.getRunZip(id), partial: false };
    if (status.state === 'failed') {
      if (status.exitCode === RATE_LIMITED_EXIT && status.hasOutput) {
        return { blob: await deps.getRunZip(id), partial: true };
      }
      throw new Error(status.message || 'Remote scrape failed.');
    }
    if (Date.now() > deadline) throw new Error('Timed out waiting for the remote scrape.');
  }
}
