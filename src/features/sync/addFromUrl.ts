import type { StartArgs } from '../import/importController';
import { buildScrapeArgs } from './scrapeArgs';

export interface AddFromUrlDeps {
  runScrape: (req: { url: string; args: string; otp: string }) => Promise<{ blob: Blob; partial: boolean }>;
  startImport: (args: StartArgs) => void;
  activeProfileId: string;
}

export async function addFromUrl(
  // `from`/`to` are optional; omitted -> full series (--from 0 --to latest).
  input: { url: string; otp: string; from?: string; to?: string },
  deps: AddFromUrlDeps,
): Promise<void> {
  const args = buildScrapeArgs(input.from, input.to);
  // Ephemeral (non-catch-up) path: import whatever came back, including a
  // rate-limited partial (best-effort — it does not resume, but we never
  // throw away salvaged chapters).
  const { blob } = await deps.runScrape({ url: input.url, args, otp: input.otp });
  const file = new File([blob], 'scrape.zip', { type: 'application/zip' });
  deps.startImport({ file, context: 'home', activeProfileId: deps.activeProfileId });
}
