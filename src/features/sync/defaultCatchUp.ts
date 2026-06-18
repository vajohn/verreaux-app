import { runSyncDownload, ensureSeriesShell } from './syncDownload';
import { runChunkedCatchUp } from './catchUpRun';
import { tokenRunScrape } from './defaultRunScrape';
import { importToCompletion } from '../import/importController';
import { setPendingCatchUp } from '../../db/repos/series.repo';
import { useBackgroundStore } from '../background/background.store';
import { uuid } from '../../lib/uuid';
import type { CatchUpCandidate } from './catchUp';

/** Live single-series sync download (Settings "Fetch" / series-page Resume). */
export function runDownload(candidate: CatchUpCandidate, profileId: string): Promise<void> {
  return runSyncDownload(candidate, {
    profileId,
    runScrape: (req, onState) => tokenRunScrape(onState)(req),
    runImport: importToCompletion,
  });
}

/**
 * Run a batch of catch-ups (Settings "Fetch all" / auto-resume) SERIALLY under
 * one background task. Each series is a chunked batch loop. Per-series failures
 * are isolated (the series keeps its pendingCatchUp; the batch continues).
 */
export async function enqueueLiveDownloads(items: CatchUpCandidate[], profileId: string): Promise<void> {
  if (items.length === 0) return;
  const taskId = `sync-download:${uuid()}`;
  const owned = useBackgroundStore.getState().start({
    id: taskId, kind: 'sync-download', label: `Downloading 1 of ${items.length}`, subLabel: '', progress: 0,
  });
  if (!owned) return;
  try {
    for (let i = 0; i < items.length; i++) {
      useBackgroundStore.getState().update({ label: `Downloading ${i + 1} of ${items.length}`, subLabel: '', progress: i / items.length });
      try {
        const resolved = await ensureSeriesShell(items[i]!, profileId);
        const outcome = await runChunkedCatchUp(resolved, {
          profileId,
          runScrape: (req) => tokenRunScrape(() => {})(req),
          runImport: importToCompletion,
          onBatch: (n) => { useBackgroundStore.getState().update({ subLabel: `Imported ${n} batch${n === 1 ? '' : 'es'}…` }); },
        });
        if (outcome === 'done') await setPendingCatchUp(resolved.seriesId!, null);
      } catch { /* per-series failure isolated — keep pendingCatchUp, continue */ }
    }
    useBackgroundStore.getState().update({ progress: 1 });
  } finally {
    useBackgroundStore.getState().finish(taskId);
  }
}
