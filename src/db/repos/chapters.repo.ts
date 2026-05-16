import { db } from '../db';
import type { Chapter } from '../types';
import { uuid } from '../../lib/uuid';

export async function createChapter(input: {
  seriesId: string;
  profileId: string;
  title: string;
  order: number;
  pageCount: number;
}): Promise<Chapter> {
  const chapter: Chapter = {
    id: uuid(),
    seriesId: input.seriesId,
    profileId: input.profileId,
    title: input.title,
    originalTitle: input.title,
    order: input.order,
    pageCount: input.pageCount,
  };
  await db.chapters.add(chapter);
  return chapter;
}

export async function getChaptersBySeriesId(seriesId: string): Promise<Chapter[]> {
  return db.chapters
    .where('seriesId')
    .equals(seriesId)
    .sortBy('order');
}

export async function getChapterById(id: string): Promise<Chapter | undefined> {
  return db.chapters.get(id);
}

export async function updateChapterTitle(id: string, title: string): Promise<void> {
  await db.chapters.update(id, { title });
}

export async function getChapterCount(seriesId: string): Promise<number> {
  return db.chapters.where('seriesId').equals(seriesId).count();
}
