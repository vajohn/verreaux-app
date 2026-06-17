/** Args for an incremental update: scrape from one past the highest known
 *  chapter order through the latest. `null` (nothing known) starts at 0.
 *  Assumes chapter orders are the scraper's 1-based integers; the merge
 *  pipeline's skip-existing guard means re-fetching a boundary chapter is
 *  harmless even if this estimate is off by one. */
export function computeUpdateArgs(maxKnownOrder: number | null): string {
  if (maxKnownOrder == null) return '--from 0 --to latest';
  return `--from ${maxKnownOrder + 1} --to latest`;
}
