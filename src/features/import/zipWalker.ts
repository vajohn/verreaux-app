import type JSZip from 'jszip';
import { extractSortKey, extOf, stemOf } from '../../lib/naturalSort';
import { isImage, getTopLevelFolders } from './typeDetector';

export interface PageEntry {
  path: string;
  pageNumber: number;
}

export interface ChapterEntry {
  title: string;
  order: number;
  pages: PageEntry[];
}

export interface SeriesEntry {
  title: string;
  coverPath: string | null;
  chapters: ChapterEntry[];
}

interface DirectChildren {
  files: string[];
  folders: string[];
}

function getDirectChildren(zip: JSZip, folder: string): DirectChildren {
  const prefix = folder.endsWith('/') ? folder : `${folder}/`;
  const files = new Set<string>();
  const folders = new Set<string>();
  zip.forEach((path) => {
    if (!path.startsWith(prefix) || path === prefix) return;
    const rest = path.slice(prefix.length);
    const parts = rest.split('/');
    if (parts.length === 1 && parts[0]) {
      files.add(`${prefix}${parts[0]}`);
    } else if (parts.length >= 2 && parts[0]) {
      folders.add(`${prefix}${parts[0]}/`);
    }
  });
  return { files: Array.from(files), folders: Array.from(folders) };
}

const COVER_RE = /^cover\.(webp|jpg|jpeg|png)$/i;

export async function walkChapter(
  zip: JSZip,
  chapterPath: string,
  order: number,
): Promise<ChapterEntry> {
  const title = chapterPath.replace(/\/$/, '').split('/').pop() ?? 'Chapter';
  const { files } = getDirectChildren(zip, chapterPath);
  const IMAGE_EXTS = new Set(['.webp', '.jpg', '.jpeg', '.png']);
  const imageFiles: PageEntry[] = files
    .filter((f) => IMAGE_EXTS.has(extOf(f)))
    .map((f) => ({
      path: f,
      pageNumber: extractSortKey(stemOf(f.split('/').pop() ?? '')),
    }))
    .sort((a, b) => a.pageNumber - b.pageNumber);
  return { title, order, pages: imageFiles };
}

export async function walkSeries(zip: JSZip, seriesPath: string): Promise<SeriesEntry> {
  const title = seriesPath.replace(/\/$/, '').split('/').pop() ?? 'Series';
  const { files, folders } = getDirectChildren(zip, seriesPath);
  const coverFile =
    files.find((f) => COVER_RE.test((f.split('/').pop() ?? '').toLowerCase())) ?? null;

  const chapterFolders = folders
    .map((folder) => ({
      folder,
      order: extractSortKey(folder.replace(/\/$/, '').split('/').pop() ?? ''),
    }))
    .sort((a, b) => a.order - b.order);

  const chapters = await Promise.all(
    chapterFolders.map(({ folder, order }) => walkChapter(zip, folder, order)),
  );

  return {
    title,
    coverPath: coverFile,
    chapters: chapters.filter((c) => c.pages.length > 0),
  };
}

export async function walkLibrary(zip: JSZip): Promise<SeriesEntry[]> {
  const topFolders = getTopLevelFolders(zip);
  return Promise.all(topFolders.map((f) => walkSeries(zip, f)));
}

/**
 * Walks a single-chapter ZIP (Type 3): images directly inside one or many
 * top-level folders, each folder being a chapter. Falls back to images in the
 * ZIP root grouped under one synthetic chapter when there are no folders.
 */
export async function walkChapterUpdate(zip: JSZip): Promise<ChapterEntry[]> {
  const topFolders = getTopLevelFolders(zip);
  if (topFolders.length === 0) {
    // Images at root — treat as a single chapter named "Chapter 1".
    const rootFiles: string[] = [];
    zip.forEach((path) => {
      if (path.includes('/')) return;
      if (isImage(path)) rootFiles.push(path);
    });
    const pages = rootFiles
      .map((f) => ({ path: f, pageNumber: extractSortKey(stemOf(f)) }))
      .sort((a, b) => a.pageNumber - b.pageNumber);
    if (pages.length === 0) return [];
    return [{ title: 'Chapter 1', order: 1, pages }];
  }
  const chapters: ChapterEntry[] = [];
  for (const folder of topFolders) {
    const order = extractSortKey(folder.replace(/\/$/, ''));
    chapters.push(await walkChapter(zip, folder, order));
  }
  return chapters.filter((c) => c.pages.length > 0).sort((a, b) => a.order - b.order);
}
