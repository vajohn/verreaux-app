const BATCH_KEY = 'verreaux:downloadBatchSize';
// Smaller batches are likelier to finish within a source's rate window, so a
// batch salvages more before hitting a rate-limited partial.
const DEFAULT_BATCH = 5;
const MIN_BATCH = 1;
const MAX_BATCH = 50;

/** Chapters per catch-up batch (configurable in Settings; clamped 1..50). */
export function getDownloadBatchSize(): number {
  try {
    const raw = Number(localStorage.getItem(BATCH_KEY));
    if (Number.isInteger(raw) && raw >= MIN_BATCH && raw <= MAX_BATCH) return raw;
  } catch { /* storage unavailable */ }
  return DEFAULT_BATCH;
}

export function setDownloadBatchSize(n: number): void {
  const t = Math.trunc(n);
  const clamped = Number.isFinite(t) ? Math.min(MAX_BATCH, Math.max(MIN_BATCH, t)) : DEFAULT_BATCH;
  try { localStorage.setItem(BATCH_KEY, String(clamped)); } catch { /* ignore */ }
}

/**
 * True when a scrape failure means "no chapters in the requested range" — the
 * chunk loop's end-of-series terminator — rather than a genuine error to
 * surface/retry. The Pi surfaces selectChapters' ERR_NO_CHAPTERS_IN_RANGE /
 * ERR_EMPTY_RANGE (code + message) through the run's failure message.
 */
export function isEndOfSeriesError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /ERR_EMPTY_RANGE|ERR_NO_CHAPTERS_IN_RANGE|no chapters found in range|is empty \(from > to\)/i.test(m);
}
