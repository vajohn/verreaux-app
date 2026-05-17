/**
 * coverFetchRunner — attempts to fetch and persist any series.pendingCoverUrl entries.
 *
 * Called on:
 *   - document visibilitychange to "visible"
 *   - window "online" event
 *
 * Retries up to 3 times per series. On permanent failure sets coverSource = 'fallback'.
 */
import { db } from '../../db/db';
import { addBlob } from '../../db/repos/blobs.repo';
import { setCoverBlobOverride } from '../../db/repos/series.repo';
import { sniffImageType } from './imageSniff';

const MAX_ATTEMPTS = 3;
const MAX_BYTES = 5 * 1024 * 1024;

async function attemptFetch(seriesId: string, url: string): Promise<boolean> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return false;
    const blob = await resp.blob();
    if (blob.size === 0 || blob.size > MAX_BYTES) return false;
    const sniff = await sniffImageType(blob);
    if (sniff.kind === 'unsupported') return false;
    const blobId = await addBlob(blob);
    await setCoverBlobOverride(seriesId, blobId, 'url');
    return true;
  } catch {
    return false;
  }
}

export async function runPendingCoverFetches(): Promise<void> {
  if (!navigator.onLine) return;
  const pending = await db.series
    .filter((s) => s.pendingCoverUrl !== null && s.pendingCoverUrl !== undefined)
    .toArray();

  for (const series of pending) {
    if (!series.pendingCoverUrl) continue;
    const attempts = series.coverFetchAttempts ?? 0;

    if (attempts >= MAX_ATTEMPTS) {
      // Permanent failure — clear pending and mark fallback.
      await db.series.update(series.id, {
        pendingCoverUrl: null,
        coverSource: 'fallback',
      });
      continue;
    }

    const success = await attemptFetch(series.id, series.pendingCoverUrl);
    if (!success) {
      await db.series.update(series.id, {
        coverFetchAttempts: attempts + 1,
      });
      if (attempts + 1 >= MAX_ATTEMPTS) {
        await db.series.update(series.id, {
          pendingCoverUrl: null,
          coverSource: 'fallback',
        });
      }
    }
    // On success, setCoverBlobOverride already cleared pendingCoverUrl
  }
}

/**
 * Register event listeners for online and visibility-change events.
 * Call once at app startup.
 */
export function registerCoverFetchListeners(): () => void {
  function run(): void {
    void runPendingCoverFetches();
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'visible') run();
  }

  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
