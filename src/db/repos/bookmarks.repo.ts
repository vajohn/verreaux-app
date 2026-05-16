import { db } from '../db';
import type { Bookmark } from '../types';
import { uuid } from '../../lib/uuid';

export async function addBookmark(input: {
  profileId: string;
  seriesId: string;
  chapterId: string;
  pageIndex: number;
  scrollOffset: number;
  note?: string | null;
}): Promise<Bookmark> {
  const record: Bookmark = {
    id: uuid(),
    profileId: input.profileId,
    seriesId: input.seriesId,
    chapterId: input.chapterId,
    pageIndex: input.pageIndex,
    scrollOffset: input.scrollOffset,
    createdAt: Date.now(),
    note: input.note ?? null,
  };
  await db.bookmarks.add(record);
  return record;
}

export async function getBookmarksBySeriesId(
  profileId: string,
  seriesId: string,
): Promise<Bookmark[]> {
  return db.bookmarks
    .where('[profileId+seriesId]')
    .equals([profileId, seriesId])
    .toArray();
}

export async function deleteBookmark(id: string): Promise<void> {
  await db.bookmarks.delete(id);
}
