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

export interface ReaderSettings {
  readingMode: 'webtoon';
  pageGap: number;
  autoNextChapter: boolean;
  brightness: number;
}

export type LibrarySort = 'lastRead' | 'title' | 'custom';
export type Theme = 'dark' | 'light';
