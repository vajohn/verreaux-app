import { db } from '../../db/db';
import { isEnrolled } from './syncCreds';
import { getApiBase } from './piClient';
import type { CatchUpCandidate } from './catchUp';

/** Build catch-up candidates from series that have an interrupted (pending)
 *  catch-up, for auto-resume on launch. Best-effort: [] when not enrolled / no base. */
export async function pendingDownloadCandidates(profileId: string): Promise<CatchUpCandidate[]> {
  if (!isEnrolled() || !getApiBase()) return [];
  const series = await db.series.where('profileId').equals(profileId).toArray();
  const out: CatchUpCandidate[] = [];
  for (const s of series) {
    if (!s.pendingCatchUp || !s.sourceUrl) continue;
    const last = await db.chapters
      .where('[seriesId+order]')
      .between([s.id, -Infinity], [s.id, Infinity])
      .last();
    out.push({
      sourceUrl: s.sourceUrl,
      syncedChapter: s.pendingCatchUp.syncedChapter,
      syncedPage: s.pendingCatchUp.syncedPage,
      seriesId: s.id,
      maxOrder: last?.order ?? 0,
      initial: !s.caughtUp,
      state: 'behind', // the shell row exists; a no-chapters shell is 'behind' (maxOrder 0), never 'missing'
    });
  }
  return out;
}

const resumedProfiles = new Set<string>();

/** Resume all interrupted downloads for a profile (fire-and-forget on launch). */
export async function resumePendingDownloads(
  profileId: string,
  enqueue: (items: CatchUpCandidate[]) => Promise<void>,
): Promise<void> {
  if (resumedProfiles.has(profileId)) return;
  resumedProfiles.add(profileId);
  try {
    const items = await pendingDownloadCandidates(profileId);
    if (items.length > 0) await enqueue(items);
  } catch (e) {
    console.warn('resumePendingDownloads failed', e); // best-effort
  }
}
