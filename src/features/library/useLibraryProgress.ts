import { useEffect, useState } from 'react';
import { db } from '../../db/db';

interface LibraryProgress {
  totalChapters: number;
  readChapters: number;
}

export function useLibraryProgress(profileId: string, revision = 0): LibraryProgress {
  const [progress, setProgress] = useState<LibraryProgress>({
    totalChapters: 0,
    readChapters: 0,
  });
  useEffect(() => {
    let cancelled = false;
    async function compute(): Promise<void> {
      if (!profileId) {
        if (!cancelled) setProgress({ totalChapters: 0, readChapters: 0 });
        return;
      }
      const allSeries = await db.series.where('profileId').equals(profileId).toArray();
      const totalChapters = allSeries.reduce((sum, s) => sum + s.chapterCount, 0);
      const progressRecords = await db.readingProgress
        .where('profileId')
        .equals(profileId)
        .toArray();
      let readChapters = 0;
      for (const rec of progressRecords) {
        const cur = await db.chapters.get(rec.currentChapterId);
        if (!cur) continue;
        const countRead = await db.chapters
          .where('[seriesId+order]')
          .between([cur.seriesId, -Infinity], [cur.seriesId, cur.order], true, true)
          .count();
        readChapters += countRead;
      }
      if (!cancelled) setProgress({ totalChapters, readChapters });
    }
    void compute();
    return () => {
      cancelled = true;
    };
  }, [profileId, revision]);
  return progress;
}
