import { runScrapeToBlob, type RunScrapeDeps } from './runScrapeToBlob';
import { postScrape, getRunStatus, getRunZip } from './piClient';
import type { StartArgs } from '../import/importController';

export interface AddFromUrlDeps {
  runScrape: (req: { url: string; args: string; otp: string }) => Promise<Blob>;
  startImport: (args: StartArgs) => void;
  activeProfileId: string;
}

/** Default deps wiring the real client + poller (used by the UI). */
export function defaultRunScrape(onState: (s: string) => void) {
  return (req: { url: string; args: string; otp: string }): Promise<Blob> => {
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

export async function addFromUrl(
  input: { url: string; otp: string },
  deps: AddFromUrlDeps,
): Promise<void> {
  const blob = await deps.runScrape({ url: input.url, args: '--from 0 --to latest', otp: input.otp });
  const file = new File([blob], 'scrape.zip', { type: 'application/zip' });
  deps.startImport({ file, context: 'home', activeProfileId: deps.activeProfileId });
}
