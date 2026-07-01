import type { CatchUpCandidate } from './catchUp';
/** Candidate for adding a NEW series from scratch (download from `from` → latest).
 *  Mirrors the cross-device "missing series" catch-up shape. `from` defaults to 0
 *  (whole series); prune-below-`from` is a no-op at 0. */
export function buildInitialAddCandidate(sourceUrl: string, from = 0): CatchUpCandidate {
  return { sourceUrl, syncedChapter: from, syncedPage: 0, seriesId: null, maxOrder: null, initial: true, state: 'missing' };
}
