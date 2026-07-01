import { computeUpdateArgs } from './updateArgs';
import type { StartArgs } from '../import/importController';

export interface UpdateTarget {
  id: string;
  sourceUrl: string | null;
  maxKnownOrder: number | null;
}

export interface UpdateFromSourceDeps {
  runScrape: (req: { url: string; args: string; otp: string }) => Promise<{ blob: Blob; partial: boolean }>;
  startImport: (args: StartArgs) => void;
  activeProfileId: string;
}

export async function updateFromSource(
  target: UpdateTarget,
  input: { otp: string },
  deps: UpdateFromSourceDeps,
): Promise<void> {
  if (!target.sourceUrl) {
    throw new Error('This series has no source URL. Set one first to enable updates.');
  }
  const args = computeUpdateArgs(target.maxKnownOrder);
  // Import whatever came back, including a rate-limited partial (best-effort).
  const { blob } = await deps.runScrape({ url: target.sourceUrl, args, otp: input.otp });
  const file = new File([blob], 'update.zip', { type: 'application/zip' });
  deps.startImport({ file, context: 'series', targetSeriesId: target.id, activeProfileId: deps.activeProfileId });
}
