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

/** Dispatch a scrape to the Pi, poll to completion, return the output ZIP. */
export async function runScrapeToBlob(req: ScrapeRequest, deps: RunScrapeDeps): Promise<Blob> {
  const id = await deps.postScrape(req);
  const deadline = Date.now() + MAX_MS;
  for (;;) {
    await deps.sleep(POLL_MS);
    const status = await deps.getRunStatus(id);
    deps.onState(status.state);
    if (status.state === 'succeeded') return deps.getRunZip(id);
    if (status.state === 'failed') throw new Error(status.message || 'Remote scrape failed.');
    if (Date.now() > deadline) throw new Error('Timed out waiting for the remote scrape.');
  }
}
