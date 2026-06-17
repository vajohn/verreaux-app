import { db } from '../../db/db';
import type { ServerPosition } from './syncClient';

export interface LocalSeriesInfo {
  seriesId: string;
  /** Highest local chapter order; 0 when the series has no chapters. */
  maxOrder: number;
  caughtUp: boolean;
}

export interface CatchUpCandidate {
  sourceUrl: string;
  syncedChapter: number;
  syncedPage: number;
  /** null when the series is missing locally. */
  seriesId: string | null;
  /** null when missing. */
  maxOrder: number | null;
  /** true → initial windowed catch-up (prune below synced); false → plain update. */
  initial: boolean;
  state: 'missing' | 'behind';
}

/**
 * Classify pulled server positions into catch-up candidates. A position is a
 * candidate when the series is missing locally, or the synced chapter is
 * strictly ahead of the local maximum (behind). A series at or ahead of the
 * synced position is the pace-setter and is left alone. `initial` is true for
 * missing series and for behind series this device has not yet caught up.
 */
export function classifyCatchUp(
  server: ServerPosition[],
  index: Map<string, LocalSeriesInfo>,
): CatchUpCandidate[] {
  const out: CatchUpCandidate[] = [];
  for (const s of server) {
    const local = index.get(s.sourceUrl);
    if (!local) {
      out.push({
        sourceUrl: s.sourceUrl, syncedChapter: s.chapterOrder, syncedPage: s.pageIndex,
        seriesId: null, maxOrder: null, initial: true, state: 'missing',
      });
    } else if (s.chapterOrder > local.maxOrder) {
      out.push({
        sourceUrl: s.sourceUrl, syncedChapter: s.chapterOrder, syncedPage: s.pageIndex,
        seriesId: local.seriesId, maxOrder: local.maxOrder, initial: !local.caughtUp, state: 'behind',
      });
    }
    // else: local is at/ahead of synced — pace-setter, nothing to do.
  }
  return out;
}

/** Build the {sourceUrl -> info} index for a profile (series that have a
 *  sourceUrl). maxOrder is the highest chapter order, or 0 for an empty series. */
export async function localSeriesIndexByUrl(profileId: string): Promise<Map<string, LocalSeriesInfo>> {
  const out = new Map<string, LocalSeriesInfo>();
  const series = await db.series.where('profileId').equals(profileId).toArray();
  for (const s of series) {
    if (!s.sourceUrl) continue;
    const top = await db.chapters
      .where('[seriesId+order]')
      .between([s.id, -Infinity], [s.id, Infinity])
      .last();
    // Invariant: sourceUrl is unique per profile. If two series shared one url, the later wins.
    out.set(s.sourceUrl, { seriesId: s.id, maxOrder: top?.order ?? 0, caughtUp: s.caughtUp ?? false });
  }
  return out;
}
