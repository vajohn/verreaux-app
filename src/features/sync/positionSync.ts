import { db } from '../../db/db';
import { getSyncCreds } from './syncCreds';
import { putPosition, getPositions } from './syncClient';
import { createPushQueue } from './pushQueue';
import { reconcilePositions } from './reconcile';
import { localPositionsByUrl, applyServerPosition } from './syncTargets';

const queue = createPushQueue({
  put: (body) => {
    const creds = getSyncCreds();
    if (!creds) throw new Error('not enrolled');
    return putPosition(creds.deviceToken, body);
  },
  debounceMs: 4000,
});

// Per-profile pull cursor so switching profiles doesn't suppress a profile's
// never-seen positions via a stale `since`.
const lastPullByProfile = new Map<string, string>();
// Bound the pull so an unreachable Pi can't freeze loadLibrary (which awaits it).
const PULL_TIMEOUT_MS = 5000;

/** Called from the reader after a progress save. Looks up the series' sourceUrl
 *  + chapter order and enqueues a push. No-op if not enrolled or no sourceUrl. */
export async function notifyProgress(
  _profileId: string,
  seriesId: string,
  chapterId: string,
  pageIndex: number,
  manuallyMarked: boolean,
): Promise<void> {
  if (!getSyncCreds()) return;
  const series = await db.series.get(seriesId);
  if (!series?.sourceUrl) return;
  const chapter = await db.chapters.get(chapterId);
  if (!chapter) return;
  queue.enqueue({ sourceUrl: series.sourceUrl, chapterOrder: chapter.order, pageIndex, manuallyMarked });
}

/** Flush pending pushes (call on visibility/pagehide). */
export function flushSync(): Promise<void> {
  return queue.flush();
}

/** Pull + reconcile for a profile. Best-effort: swallows network errors. */
export async function pullAndReconcile(profileId: string): Promise<void> {
  const creds = getSyncCreds();
  if (!creds) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PULL_TIMEOUT_MS);
  try {
    const since = lastPullByProfile.get(profileId) ?? null;
    const server = await getPositions(creds.deviceToken, since, controller.signal);
    const local = await localPositionsByUrl(profileId);
    const updates = reconcilePositions(server, local);
    for (const u of updates) await applyServerPosition(profileId, u);
    lastPullByProfile.set(profileId, new Date().toISOString());
  } catch {
    // offline / unreachable / timed out — try again next time
  } finally {
    clearTimeout(timer);
  }
}
