import type { PositionBody } from './syncClient';

export interface PushQueueDeps {
  put: (body: PositionBody) => Promise<unknown>;
  /** Debounce window before an auto-flush after enqueue. */
  debounceMs: number;
}

export interface PushQueue {
  enqueue: (body: PositionBody) => void;
  flush: () => Promise<void>;
}

/** Coalesces pending pushes by sourceUrl (latest wins) and flushes them.
 *  A failed put keeps the item for the next flush (offline-tolerant). */
export function createPushQueue(deps: PushQueueDeps): PushQueue {
  const pending = new Map<string, PositionBody>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;

  async function doFlush(): Promise<void> {
    const items = [...pending.values()];
    for (const item of items) {
      try {
        await deps.put(item);
        // Only drop if no newer enqueue replaced this value mid-flush.
        if (pending.get(item.sourceUrl) === item) pending.delete(item.sourceUrl);
      } catch {
        // keep it for the next flush
      }
    }
  }

  /** Coalesce overlapping flushes onto one in-flight run so an item can't be
   *  sent twice (e.g. the debounce timer firing during a manual flush). */
  function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!inflight) {
      inflight = doFlush().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  }

  function enqueue(body: PositionBody): void {
    pending.set(body.sourceUrl, body);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void flush();
    }, deps.debounceMs);
  }

  return { enqueue, flush };
}
