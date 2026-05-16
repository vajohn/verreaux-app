import { useEffect, useState } from 'react';
import { db } from '../../db/db';

interface SeriesProgress {
  readChapters: number;
  totalChapters: number;
  lastReadAt: number | null;
}

export function useSeriesProgress(
  profileId: string,
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
      const rec = await db.readingProgress
        .where('[profileId+seriesId]')
        .equals([profileId, seriesId])
        .first();
      if (!rec) {
        if (!cancelled) setProgress({ readChapters: 0, totalChapters: chapterCount, lastReadAt });
        return;
      }
      const cur = await db.chapters.get(rec.currentChapterId);
      if (!cur) {
        if (!cancelled) setProgress({ readChapters: 0, totalChapters: chapterCount, lastReadAt });
        return;
      }
      const readChapters = await db.chapters
        .where('[seriesId+order]')
        .between([cur.seriesId, -Infinity], [cur.seriesId, cur.order], true, true)
        .count();
      if (!cancelled) setProgress({ readChapters, totalChapters: chapterCount, lastReadAt });
    }
    void compute();
    return () => {
      cancelled = true;
    };
  }, [profileId, seriesId, chapterCount, lastReadAt, revision]);
  return progress;
}
