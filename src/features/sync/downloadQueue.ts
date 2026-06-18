import { useBackgroundStore } from '../background/background.store';
import { uuid } from '../../lib/uuid';
import type { CatchUpCandidate } from './catchUp';

export interface QueueDeps {
  /** Ensure shell + pendingCatchUp before scrape; returns the resolved candidate. */
  prepare: (c: CatchUpCandidate) => Promise<CatchUpCandidate>;
  /** Scrape one candidate → blob (token auth). */
  scrape: (c: CatchUpCandidate) => Promise<Blob>;
  /** Import one blob into the (shelled) series; resolves on completion. */
  importBlob: (c: CatchUpCandidate, blob: Blob) => Promise<void>;
  /** Finalize after import: prune/position/flag + clear pendingCatchUp on done. */
  finalize: (c: CatchUpCandidate) => Promise<void>;
}

let running: Promise<void> | null = null;
let pending: CatchUpCandidate[] = [];
let deps: QueueDeps | null = null;

/**
 * Enqueue candidates onto the pipelined download queue. Starts the pipeline if
 * idle, otherwise appends to the running batch and returns the same promise.
 * No-op for an empty list when idle.
 *
 * NOTE: when a batch is already running, `d` is IGNORED — the active batch keeps
 * the deps it captured at start, including for appended items. Callers must pass
 * compatible deps.
 */
export function enqueueDownloads(items: CatchUpCandidate[], d: QueueDeps): Promise<void> {
  if (items.length > 0) {
    deps = d;
    pending.push(...items);
  }
  if (!running) {
    if (pending.length === 0) return Promise.resolve();
    running = runBatch().finally(() => { running = null; pending = []; deps = null; });
  }
  return running;
}

type ScrapeResult = { c: CatchUpCandidate; blob: Blob } | { c: CatchUpCandidate; err: unknown };

async function runBatch(): Promise<void> {
  const d = deps!;
  const taskId = `sync-download:${uuid()}`;
  const owned = useBackgroundStore.getState().start({
    id: taskId, kind: 'sync-download', label: 'Downloading…', subLabel: '', progress: 0,
  });

  const startScrape = (idx: number): Promise<ScrapeResult> => (async () => {
    const c0 = pending[idx]!;
    try {
      const c = await d.prepare(c0);
      const blob = await d.scrape(c);
      return { c, blob };
    } catch (err) { return { c: c0, err }; }
  })();

  let i = 0;
  let ahead: Promise<ScrapeResult> | null = pending.length ? startScrape(0) : null;
  try {
    while (i < pending.length) {
      const res = await ahead!;
      // begin the NEXT scrape before importing the current (the pipeline)
      ahead = i + 1 < pending.length ? startScrape(i + 1) : null;
      const total = pending.length;
      if (owned) useBackgroundStore.getState().update({
        label: `Downloading ${i + 1} of ${total}`, progress: total ? i / total : 0,
      });
      if ('err' in res) {
        // isolated failure: keep its pendingCatchUp (finalize not called), continue
      } else {
        try {
          await d.importBlob(res.c, res.blob); // serial import lane
          await d.finalize(res.c);
        } catch { /* import/finalize failure: isolated, keep pendingCatchUp */ }
      }
      if (owned) useBackgroundStore.getState().update({ progress: (i + 1) / total });
      i++;
      // pick up any items appended while this batch was running
      if (!ahead && i < pending.length) ahead = startScrape(i);
    }
    if (owned) useBackgroundStore.getState().update({ progress: 1 });
  } finally {
    if (owned) useBackgroundStore.getState().finish(taskId);
  }
}
