// Macrotask gap between chunked IDB writes so concurrent reader reads on the
// same object stores aren't starved during a large background delete. A
// microtask yield (Promise.resolve / queueMicrotask) stays inside the same
// task and does NOT let the IndexedDB scheduler run queued read transactions;
// setTimeout hands control back to the task queue. See the repros in
// tmp/repro_delete_contention*.mjs and docs/superpowers/specs for evidence.
const IDB_YIELD_MS = 4;

export function yieldToReads(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, IDB_YIELD_MS));
}
