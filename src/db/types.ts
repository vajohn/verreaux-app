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
  importedAt: number;
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
