export type AvatarColor = 'gold' | 'steel' | 'ivory';

export interface Profile {
  id: string;
  name: string;
  avatarColor: AvatarColor;
  createdAt: number;
  lastActiveAt: number;
}

export type CoverSource = 'imported' | 'url' | 'fallback';

export interface Series {
  id: string;
  profileId: string;
  title: string;
  originalTitle: string;
  normalizedTitle: string;
  coverImageId: string | null;
  coverBlobId: string | null;
  pendingCoverUrl: string | null;
  coverFetchAttempts: number;
  coverSource: CoverSource;
  chapterCount: number;
  lastReadChapterId: string | null;
  lastReadAt: number | null;
  /**
   * Stable resume pointer that survives `deleteReadChapters` and reimport.
   * Persists the `order` of the last-read chapter so that after read-chapters
   * are deleted and the series is re-imported, we can restore
   * `lastReadChapterId` to the new chapter row with the same order.
   */
  lastReadChapterOrder: number | null;
  /**
   * Snapshot of the highest `chapter.order` in the series at the moment of
   * the last `deleteReadChapters`. Paired with `lastReadChapterOrder`, this
   * lets the cleared-state UI display e.g. "202 / 204" instead of "0 / 0"
   * after all chapters have been wiped, so the user still sees where they
   * left off before reimport. Persists across reimport as a breadcrumb.
   */
  lastKnownMaxOrder: number | null;
  importedAt: number;
  /**
   * Source page URL this series was scraped from (the Pi scraper embeds it in
   * verreaux.json). Null for series imported before this existed or from a
   * manifest-less ZIP; can be back-filled by the user to enable updates.
   */
  sourceUrl: string | null;
  /**
   * Whether this device has completed its one-time sync catch-up for the
   * series. `false` until an initial catch-up runs (which prunes chapters
   * below the synced position); `true` afterward, so later syncs use the
   * no-prune update path. New series and existing rows both default to false.
   */
  caughtUp?: boolean;
  /**
   * Durable marker of an in-flight or failed sync catch-up and its target
   * (chapter order + page). Set when a download starts; cleared on full
   * success. Drives the series-page "Resume download" affordance and lets a
   * resume prune correctly. `null`/absent when no catch-up is pending.
   */
  pendingCatchUp?: { syncedChapter: number; syncedPage: number } | null;
  sortOrder: number;
}

export interface Chapter {
  id: string;
  seriesId: string;
  profileId: string;
  title: string;
  originalTitle: string;
  order: number;
  pageCount: number;
}

export interface Page {
  id: string;
  chapterId: string;
  pageNumber: number;
  blobId: string;
}

export interface BlobRecord {
  id: string;
  blob: Blob;
}

export interface ReadingProgress {
  id: string;
  profileId: string;
  seriesId: string;
  currentChapterId: string;
  pageIndex: number;
  scrollPosition: number;
  updatedAt: number;
  manuallyMarked: boolean;
}

export interface Bookmark {
  id: string;
  profileId: string;
  seriesId: string;
  chapterId: string;
  pageIndex: number;
  scrollOffset: number;
  createdAt: number;
  note: string | null;
}

export type ProgressBarPosition = 'top' | 'left' | 'right';

export interface ReaderSettings {
  readingMode: 'webtoon';
  pageGap: number;
  autoNextChapter: boolean;
  brightness: number;
  progressBarEnabled: boolean;
  progressBarPosition: ProgressBarPosition;
}

export type LibrarySort = 'lastRead' | 'title' | 'custom';
export type Theme = 'dark' | 'light';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  ts: number;
  level: LogLevel;
  source: string;
  msg: string;
  /** Serialized arbitrary context — must be JSON-safe. */
  ctx: string | null;
  /** Correlates entries from a single import / operation. */
  runId: string | null;
}
