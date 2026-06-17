import { db } from '../../db/db';
import { getSyncCreds, clearSyncCreds } from './syncCreds';
import { putPosition, getPositions, SyncAuthError } from './syncClient';
import { createPushQueue } from './pushQueue';
import { reconcilePositions } from './reconcile';
import { localPositionsByUrl, applyServerPosition } from './syncTargets';
import { classifyCatchUp, localSeriesIndexByUrl, type CatchUpCandidate } from './catchUp';

const queue = createPushQueue({
  put: async (body) => {
    const creds = getSyncCreds();
    if (!creds) throw new Error('not enrolled');
    try {
      return await putPosition(creds.deviceToken, body);
    } catch (e) {
      // Revoked/invalid token: drop creds so the UI prompts re-enroll and we
      // stop retrying a dead token.
      if (e instanceof SyncAuthError) clearSyncCreds();
      throw e;
    }
  },
  debounceMs: 4000,
});

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

/** Pull + reconcile for a profile, returning catch-up candidates (series this
 *  device is missing or behind on). Best-effort: returns [] on error / when not
 *  enrolled. */
export async function pullAndReconcile(profileId: string): Promise<CatchUpCandidate[]> {
  const creds = getSyncCreds();
  if (!creds) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PULL_TIMEOUT_MS);
  try {
    // Always pull the FULL position set (not a since-delta): catch-up
    // classification needs the device's complete divergence from the synced
    // positions, and reconcile is idempotent — it only applies server-ahead
    // values, so re-seeing unchanged positions is a no-op.
    const server = await getPositions(creds.deviceToken, null, controller.signal);
    const local = await localPositionsByUrl(profileId);
    const updates = reconcilePositions(server, local);
    for (const u of updates) await applyServerPosition(profileId, u);
    return classifyCatchUp(server, await localSeriesIndexByUrl(profileId));
  } catch (e) {
    if (e instanceof SyncAuthError) clearSyncCreds();
    return [];
  } finally {
    clearTimeout(timer);
  }
}
