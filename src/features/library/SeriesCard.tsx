import type { Series } from '../../db/types';
import { CoverImage } from './CoverImage';
import { ProgressBar } from '../../ui/ProgressBar';
import { useSeriesProgress } from './useSeriesProgress';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { navigate } from '../../app/router';

interface SeriesCardProps {
  series: Series;
  profileId: string;
  showTimestamp?: boolean;
}

export function SeriesCard({ series, profileId, showTimestamp = false }: SeriesCardProps) {
  const blobId = series.coverBlobId ?? series.coverImageId;
  const progress = useSeriesProgress(
    profileId,
    series.id,
    series.chapterCount,
    series.lastReadAt,
  );
  const pct = progress.totalChapters > 0 ? progress.readChapters / progress.totalChapters : 0;
  return (
    <button
      className="series-card anim-fade-up"
      onClick={() => navigate({ screen: 'series', seriesId: series.id })}
      aria-label={`Open ${series.title}`}
    >
      <div className="series-card__cover">
        <CoverImage blobId={blobId} alt={series.title} className="series-card__img" />
        {series.pendingCatchUp != null && (
          <span className="series-card__badge">Downloading…</span>
        )}
      </div>
      <div className="series-card__title type-card-title">{series.title}</div>
      <div className="type-progress-count series-card__count">
        {progress.readChapters} / {progress.totalChapters}
      </div>
      <ProgressBar value={pct} />
      {showTimestamp && series.lastReadAt && (
        <div className="series-card__time type-meta-italic">
          {formatRelativeTime(series.lastReadAt)}
        </div>
      )}
    </button>
  );
}
