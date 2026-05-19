import { useEffect, useState } from 'react';
import { db } from '../../db/db';
import type { Series, ReadingProgress, Chapter } from '../../db/types';
import { CoverImage } from './CoverImage';
import { ProgressBar } from '../../ui/ProgressBar';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { navigate } from '../../app/router';
import './ContinueCard.css';

interface ContinueCardProps {
  profileId: string;
  revision?: number;
}

interface ContinueData {
  series: Series;
  progress: ReadingProgress;
  chapter: Chapter | null;
  readChapters: number;
  totalChapters: number;
}

export function ContinueCard({ profileId, revision = 0 }: ContinueCardProps) {
  const [data, setData] = useState<ContinueData | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      if (!profileId) {
        if (!cancelled) setData(null);
        return;
      }
      const records = await db.readingProgress
        .where('profileId')
        .equals(profileId)
        .reverse()
        .sortBy('updatedAt');
      const latest = records[0];
      if (!latest) {
        if (!cancelled) setData(null);
        return;
      }
      const series = await db.series.get(latest.seriesId);
      if (!series) {
        if (!cancelled) setData(null);
        return;
      }
      const chapter = (await db.chapters.get(latest.currentChapterId)) ?? null;
      // Order-space progress: numerator = last-read chapter order,
      // denominator = highest chapter.order (or preserved snapshot if wiped).
      // Matches useSeriesProgress so cards across the app agree.
      const lastChapter = await db.chapters
        .where('[seriesId+order]')
        .between([series.id, -Infinity], [series.id, Infinity])
        .last();
      const liveMax = lastChapter?.order ?? 0;
      const totalChapters =
        liveMax > 0 ? liveMax : series.lastKnownMaxOrder ?? 0;
      const readChapters = series.lastReadChapterOrder ?? 0;
      if (!cancelled) {
        setData({
          series,
          progress: latest,
          chapter,
          readChapters,
          totalChapters,
        });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [profileId, revision]);

  if (!data) return null;
  const blobId = data.series.coverBlobId ?? data.series.coverImageId;
  const pct = data.totalChapters > 0 ? data.readChapters / data.totalChapters : 0;
  return (
    <button
      className="continue-card anim-fade-up"
      onClick={() =>
        navigate({
          screen: 'reader',
          seriesId: data.series.id,
          chapterId: data.progress.currentChapterId,
        })
      }
      aria-label={`Continue reading ${data.series.title}`}
    >
      <div className="continue-card__cover">
        <CoverImage blobId={blobId} alt={data.series.title} className="continue-card__img" />
      </div>
      <div className="continue-card__body">
        <div className="type-section-label continue-card__kicker">Continue Reading</div>
        <div className="type-card-title continue-card__title">{data.series.title}</div>
        {data.chapter && (
          <div className="type-meta-italic continue-card__chapter">{data.chapter.title}</div>
        )}
        <div className="type-progress-count">
          {data.readChapters} / {data.totalChapters}
        </div>
        <ProgressBar value={pct} />
        <div className="type-meta-italic continue-card__time">
          {formatRelativeTime(data.progress.updatedAt)}
        </div>
      </div>
    </button>
  );
}
