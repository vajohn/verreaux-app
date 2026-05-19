import { useEffect, useState } from 'react';
import { db } from '../../db/db';

interface SeriesProgress {
  readChapters: number;
  totalChapters: number;
  lastReadAt: number | null;
}

/**
 * Returns reading progress in **chapter-number space**, not row-count space:
 *   - totalChapters = the highest `chapter.order` present for the series,
 *     falling back to the preserved `lastKnownMaxOrder` when chapters have
 *     been wiped (so the cleared / partially-cleared UI keeps showing a
 *     meaningful denominator).
 *   - readChapters  = the series' `lastReadChapterOrder` (already maintained
 *     by `setLastReadChapter` and preserved through `deleteReadChapters`).
 *
 * Picking order over row count makes sparse imports (e.g. only chapters
 * 529–530 of a 530-chapter series) display "0 / 530" instead of the
 * misleading "0 / 2", and partial re-imports after a delete display
 * "254 / 258" instead of "0 / 4".
 */
export function useSeriesProgress(
  _profileId: string,
  seriesId: string,
  chapterCount: number,
  lastReadAt: number | null,
  revision = 0,
): SeriesProgress {
  const [progress, setProgress] = useState<SeriesProgress>({
    readChapters: 0,
    totalChapters: chapterCount,
    lastReadAt,
  });
  useEffect(() => {
    let cancelled = false;
    async function compute(): Promise<void> {
      const lastChapter = await db.chapters
        .where('[seriesId+order]')
        .between([seriesId, -Infinity], [seriesId, Infinity])
        .last();
      const series = await db.series.get(seriesId);
      const liveMax = lastChapter?.order ?? 0;
      const totalChapters =
        liveMax > 0 ? liveMax : series?.lastKnownMaxOrder ?? 0;
      const readChapters = series?.lastReadChapterOrder ?? 0;
      if (!cancelled) {
        setProgress({ readChapters, totalChapters, lastReadAt });
      }
    }
    void compute();
    return () => {
      cancelled = true;
    };
  }, [seriesId, chapterCount, lastReadAt, revision]);
  return progress;
}
