/** Args for an incremental update: scrape from one past the highest known
 *  chapter order through the latest. `null` (nothing known) starts at 0. */
export function computeUpdateArgs(maxKnownOrder: number | null): string {
  if (maxKnownOrder == null) return '--from 0 --to latest';
  return `--from ${maxKnownOrder + 1} --to latest`;
}
