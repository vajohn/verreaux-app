import type { StartArgs } from '../import/importController';

export interface AddFromUrlDeps {
  runScrape: (req: { url: string; args: string; otp: string }) => Promise<Blob>;
  startImport: (args: StartArgs) => void;
  activeProfileId: string;
}

export async function addFromUrl(
  input: { url: string; otp: string },
  deps: AddFromUrlDeps,
): Promise<void> {
  const blob = await deps.runScrape({ url: input.url, args: '--from 0 --to latest', otp: input.otp });
  const file = new File([blob], 'scrape.zip', { type: 'application/zip' });
  deps.startImport({ file, context: 'home', activeProfileId: deps.activeProfileId });
}
