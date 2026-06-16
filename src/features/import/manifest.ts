import type { ZipReader } from '../../lib/zip';

const MANIFEST_PATH = 'verreaux.json';

export interface ImportManifest {
  sourceUrl: string | null;
  seriesTitle: string | null;
}

/** Reads the root verreaux.json if present. Never throws — returns null on any
 *  problem (missing, unreadable, malformed) so import proceeds without it. */
export async function readManifest(zip: ZipReader): Promise<ImportManifest | null> {
  if (!zip.has(MANIFEST_PATH)) return null;
  try {
    const obj = JSON.parse(await zip.readText(MANIFEST_PATH)) as Record<string, unknown>;
    const sourceUrl = typeof obj['sourceUrl'] === 'string' ? obj['sourceUrl'] : null;
    const seriesTitle = typeof obj['seriesTitle'] === 'string' ? obj['seriesTitle'] : null;
    return { sourceUrl, seriesTitle };
  } catch {
    return null;
  }
}
