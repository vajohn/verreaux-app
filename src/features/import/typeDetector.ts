import type { ZipReader } from '../../lib/zip';

export type ImportType = 'type1' | 'type2' | 'type3';
export type ImportContext = 'home' | 'series';

const IMAGE_EXTS = new Set(['.webp', '.jpg', '.jpeg', '.png']);

function ext(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

export function isImage(name: string): boolean {
  return IMAGE_EXTS.has(ext(name));
}

/**
 * Returns the list of top-level folder paths (e.g. "Solo Leveling/").
 */
export function getTopLevelFolders(zip: ZipReader): string[] {
  const folders = new Set<string>();
  for (const entry of zip.entries()) {
    const parts = entry.path.split('/').filter(Boolean);
    if (parts.length >= 2) {
      // Has at least one nested entry — top-level is parts[0]
      folders.add(`${parts[0]}/`);
    }
  }
  return Array.from(folders);
}

/**
 * Detects whether `path` (a folder ending in `/`) contains nested folders
 * (so it looks like Series→Chapters), versus only image files (Chapter only).
 */
export function folderHasSubfolders(zip: ZipReader, folder: string): boolean {
  const prefix = folder.endsWith('/') ? folder : `${folder}/`;
  for (const entry of zip.entries()) {
    const path = entry.path;
    if (!path.startsWith(prefix) || path === prefix) continue;
    const rest = path.slice(prefix.length);
    const parts = rest.split('/').filter(Boolean);
    if (parts.length >= 2) return true;
  }
  return false;
}

export function detectImportType(zip: ZipReader, context: ImportContext): ImportType {
  const topFolders = getTopLevelFolders(zip);

  if (context === 'series') {
    // From series context: either a single-chapter ZIP (type3) or a
    // single-series ZIP with subfolders (type2).
    if (topFolders.length === 0) return 'type3';
    const first = topFolders[0]!;
    return folderHasSubfolders(zip, first) ? 'type2' : 'type3';
  }

  if (topFolders.length === 0) {
    throw new Error(
      'No series found. Check that your ZIP contains folders with chapter subfolders.',
    );
  }

  if (topFolders.length === 1) {
    return folderHasSubfolders(zip, topFolders[0]!) ? 'type2' : 'type1';
  }

  return 'type1';
}
