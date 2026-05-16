import { db } from '../db';
import type { Page } from '../types';

export async function getPagesByChapterId(chapterId: string): Promise<Page[]> {
  return db.pages
    .where('chapterId')
    .equals(chapterId)
    .sortBy('pageNumber');
}

export async function getPage(id: string): Promise<Page | undefined> {
  return db.pages.get(id);
}
