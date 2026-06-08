# Cooperative yielding for chunked IndexedDB deletes

**Date:** 2026-06-08
**Status:** Approved design

## Problem

Deleting a large series leaves the app unable to open another series — the
reader gets stuck on a blank "loading the chapter" screen for the entire
duration of the delete (seconds to minutes for a large series).

### Root cause

`deleteSeries` runs as a fire-and-forget background task
(`SeriesScreen.tsx`). It cleans up in two phases, each a tight `await` loop of
hundreds of sequential IndexedDB write transactions:

1. **blobs phase** — `db.blobs.bulkDelete(...)` × ~N/250 batches (page images)
2. **pages phase** — `db.pages.bulkDelete(...)` × ~N/250 batches (page rows)

Meanwhile, opening another series mounts `ReaderScreen`, whose load effect
reads **page rows** (`getPagesByChapterId` → `pages` store) and then **page
image blobs** (via `PageSlot` → `blobs` store) — exactly the two stores the
delete loop is hammering. The reader renders blank until `pages.length > 0`,
so any stall on those reads looks like "stuck loading the chapter."

The loop is microtask-tight: `await bulkDelete` resolves on request success
and the next batch is created in the next microtask, leaving no real gap for
the browser's IndexedDB scheduler to run queued reader read transactions. The
result is that concurrent reads on the contended store are starved for the
whole delete, not just one batch.

### Evidence

Reproduction using the project's own Dexie + fake-indexeddb (large series =
6000 pages deleting in the background, reader-style reads of a small series
issued during it):

| metric                          | current (no yield) | with 4ms yield |
| ------------------------------- | ------------------ | -------------- |
| reader page-query latency       | ~1600ms → 100ms    | 0–1ms          |
| reader blob (image) fetch       | 22–25ms            | 0–6ms          |
| reads completed during delete   | 29                 | 146            |
| total delete time               | 20575ms            | 20457ms        |

The cooperative yield fully eliminates the starvation with no meaningful
increase in delete duration. Repros preserved at
`tmp/repro_delete_contention.mjs` (bug) and
`tmp/repro_delete_contention_FIXED.mjs` (validated fix).

### Hypotheses ruled out

- **Stuck loading flag / leftover state** — `loadSeries` and the reader effect
  clear and reset state correctly.
- **Dangling/shared blobs** — `importRuntime.ts` assigns a fresh `uuid()` per
  blob with no dedup, so deleting one series cannot remove another's blobs.
- **FIFO interleaving makes the delay brief** — falsified by the reproduction;
  reads are starved for the whole delete, not one batch.

## Fix

Insert a real macrotask yield between chunked delete batches so the IDB
scheduler can run queued reader transactions.

### Components

1. **New helper** — `src/db/idbYield.ts`:

   ```ts
   // Macrotask gap between chunked IDB writes so concurrent reader reads on
   // the same object stores aren't starved during a large background delete.
   // setTimeout (not a microtask) is required — a microtask yield stays inside
   // the same task and doesn't let the IDB scheduler run queued read
   // transactions. See tmp/repro_delete_contention*.mjs for the evidence.
   const IDB_YIELD_MS = 4;

   export function yieldToReads(): Promise<void> {
     return new Promise((resolve) => setTimeout(resolve, IDB_YIELD_MS));
   }
   ```

2. **Call sites** — add `await yieldToReads();` after each `bulkDelete` in all
   eight chunked-delete loops:
   - `series.repo.ts` — `deleteSeries` (blobs loop, pages loop)
   - `series.repo.ts` — `deleteReadChapters` (blobs loop, pages loop)
   - `series.repo.ts` — `mergeSeries` (blobs loop, pages loop)
   - `profiles.repo.ts` — `deleteProfile` (blobs loop, pages loop)

   Batch size (250) and transaction structure are unchanged — the change is
   purely additive, preserving the IDB-budget behavior tuned by prior commits.

### Testing

A Vitest regression test (using the existing `fake-indexeddb` setup) that:

1. Seeds a large series + a small series.
2. Kicks off `deleteSeries(largeId)` without awaiting it (background).
3. Asserts a concurrent `getPagesByChapterId(smallSeriesChapterId)` resolves
   quickly (e.g. under 200ms) rather than being delayed for the whole delete.

The test fails on current code and passes after the fix.

## Out of scope (YAGNI)

- **Reader-active backoff signalling** — evidence shows the yield alone
  suffices; cross-feature coupling is unwarranted.
- **`previewSeriesDeletion` memory cost** — it loads every blob to sum sizes,
  but runs *before* the delete on the series screen, so it is not part of this
  bug.
