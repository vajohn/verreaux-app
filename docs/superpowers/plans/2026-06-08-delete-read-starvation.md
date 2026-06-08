# Cooperative IDB Delete Yielding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop large-series background deletes from starving concurrent reader reads, so the user can open another series and read while a delete runs.

**Architecture:** Add one tiny helper, `yieldToReads()`, that resolves on a macrotask (`setTimeout`), and `await` it after every chunked `bulkDelete` batch in all four cascading-delete functions. This inserts a real task-queue gap between write-transaction batches so the IndexedDB scheduler can run queued reader read transactions. Batch sizes and transaction structure are unchanged — the change is purely additive.

**Tech Stack:** TypeScript, Dexie 4 (IndexedDB), Vitest + fake-indexeddb (jsdom env, `test/setup.ts` already loads `fake-indexeddb/auto`).

**Why these tests:** Wall-clock latency assertions were calibrated and found flaky (the stall is phase-dependent and the scheduler produces outliers). The deterministic, non-flaky strategy is: (1) prove the helper yields a real macrotask, and (2) prove each delete loop awaits it once per batch. The behavioral proof (read latency 1600ms→~0ms, reads-served-during-delete 29→146) lives in `tmp/repro_delete_contention.mjs` / `tmp/repro_delete_contention_FIXED.mjs` and the spec evidence table.

---

## File Structure

- **Create** `src/db/idbYield.ts` — the `yieldToReads()` helper. Single responsibility: a macrotask gap. No DB imports.
- **Modify** `src/db/repos/series.repo.ts` — add `await yieldToReads();` in the two loops of each of `deleteSeries`, `deleteReadChapters`, `mergeSeries`. Add the import.
- **Modify** `src/db/repos/profiles.repo.ts` — add `await yieldToReads();` in the two loops of `deleteProfile`. Add the import.
- **Create** `test/unit/idbYield.test.ts` — proves the helper crosses the macrotask boundary.
- **Create** `test/integration/delete-yield.test.ts` — proves each of the four delete functions calls `yieldToReads` once per batch (via a mocked helper + spy).

---

## Task 1: `yieldToReads()` helper

**Files:**
- Create: `src/db/idbYield.ts`
- Test: `test/unit/idbYield.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/integration/../unit/idbYield.test.ts` with exactly:

```ts
import { describe, it, expect } from 'vitest';
import { yieldToReads } from '../../src/db/idbYield';

describe('yieldToReads', () => {
  it('resolves on a macrotask, not a microtask', async () => {
    // A microtask-based yield (Promise.resolve) would resolve BEFORE an
    // already-queued 0ms timer. A real macrotask yield resolves AFTER it.
    const events: string[] = [];
    queueMicrotask(() => events.push('microtask'));
    setTimeout(() => events.push('macrotask-0'), 0);

    await yieldToReads();
    events.push('after-yield');

    expect(events).toEqual(['microtask', 'macrotask-0', 'after-yield']);
  });

  it('resolves to undefined', async () => {
    expect(await yieldToReads()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/idbYield.test.ts`
Expected: FAIL — cannot resolve import `../../src/db/idbYield` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `src/db/idbYield.ts` with exactly:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/idbYield.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/db/idbYield.ts test/unit/idbYield.test.ts
git commit -m "feat(db): add yieldToReads macrotask helper for chunked deletes"
```

---

## Task 2: Wire `yieldToReads` into `deleteSeries`

**Files:**
- Modify: `src/db/repos/series.repo.ts` (import; two loops in `deleteSeries` at ~line 176 and ~line 194)
- Test: `test/integration/delete-yield.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/integration/delete-yield.test.ts` with exactly (this file gains more cases in later tasks; the seed helper is shared):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Replace the real macrotask yield with a fast spy so we assert WIRING
// (called once per batch) deterministically, without timing flakiness.
vi.mock('../../src/db/idbYield', () => ({
  yieldToReads: vi.fn(() => Promise.resolve()),
}));

import { db } from '../../src/db/db';
import { yieldToReads } from '../../src/db/idbYield';
import { createSeries, deleteSeries } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';

const PROFILE = 'p-test';
const yieldSpy = vi.mocked(yieldToReads);

// 300 pages => 2 blob batches + 2 page batches at batch size 250.
const PAGES = 300;
const BATCHES_PER_PHASE = Math.ceil(PAGES / 250); // 2

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({
    id: PROFILE,
    name: 'Tester',
    avatarColor: 'gold',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  });
  yieldSpy.mockClear();
});

/** Seed one series with one chapter holding `n` pages (each with its own blob). */
async function seedSeriesWithPages(n: number) {
  const series = await createSeries({
    profileId: PROFILE,
    title: 'Big Series',
    coverImageId: null,
    chapterCount: 1,
  });
  const chapter = await createChapter({
    seriesId: series.id,
    profileId: PROFILE,
    title: 'Chapter 1',
    order: 1,
    pageCount: n,
  });
  const pages = [];
  const blobs = [];
  for (let i = 0; i < n; i++) {
    const blobId = `b-${series.id}-${i}`;
    blobs.push({ id: blobId, blob: new Blob(['x']) });
    pages.push({ id: `p-${series.id}-${i}`, chapterId: chapter.id, pageNumber: i, blobId });
  }
  await db.blobs.bulkAdd(blobs);
  await db.pages.bulkAdd(pages);
  return { series, chapter };
}

describe('deleteSeries yields between batches', () => {
  it('awaits yieldToReads once per blob batch and once per page batch', async () => {
    const { series } = await seedSeriesWithPages(PAGES);

    await deleteSeries(series.id);

    // No cover blob seeded, so blob batches == page batches == BATCHES_PER_PHASE.
    expect(yieldSpy).toHaveBeenCalledTimes(BATCHES_PER_PHASE * 2);
    // Sanity: the delete still actually deleted everything.
    expect(await db.series.get(series.id)).toBeUndefined();
    expect(await db.pages.count()).toBe(0);
    expect(await db.blobs.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/delete-yield.test.ts`
Expected: FAIL — `yieldSpy` called 0 times (expected 4). `deleteSeries` does not call `yieldToReads` yet.

- [ ] **Step 3: Add the import to `series.repo.ts`**

At the top of `src/db/repos/series.repo.ts`, below the existing imports, add:

```ts
import { yieldToReads } from '../idbYield';
```

(The existing imports are `import { db } from '../db';`, `import type { Series, CoverSource } from '../types';`, `import { uuid } from '../../lib/uuid';` — add the new line after them.)

- [ ] **Step 4: Add the yield in `deleteSeries`' blob loop**

In `deleteSeries`, the blob loop currently reads:

```ts
  for (let i = 0; i < allBlobIds.length; i += DELETE_BATCH_SIZE) {
    const batch = allBlobIds.slice(i, i + DELETE_BATCH_SIZE);
    await db.blobs.bulkDelete(batch);
    onProgress?.({
      phase: 'blobs',
      done: Math.min(i + DELETE_BATCH_SIZE, totalBlobs),
      total: totalBlobs,
    });
  }
```

Add `await yieldToReads();` immediately after the `onProgress?.(...)` call, before the closing `}`:

```ts
  for (let i = 0; i < allBlobIds.length; i += DELETE_BATCH_SIZE) {
    const batch = allBlobIds.slice(i, i + DELETE_BATCH_SIZE);
    await db.blobs.bulkDelete(batch);
    onProgress?.({
      phase: 'blobs',
      done: Math.min(i + DELETE_BATCH_SIZE, totalBlobs),
      total: totalBlobs,
    });
    await yieldToReads();
  }
```

- [ ] **Step 5: Add the yield in `deleteSeries`' page loop**

In `deleteSeries`, the page loop currently reads:

```ts
  for (let i = 0; i < pageIds.length; i += DELETE_BATCH_SIZE) {
    await db.pages.bulkDelete(pageIds.slice(i, i + DELETE_BATCH_SIZE));
    onProgress?.({
      phase: 'pages',
      done: Math.min(i + DELETE_BATCH_SIZE, totalPages),
      total: totalPages,
    });
  }
```

Add `await yieldToReads();` after the `onProgress?.(...)` call:

```ts
  for (let i = 0; i < pageIds.length; i += DELETE_BATCH_SIZE) {
    await db.pages.bulkDelete(pageIds.slice(i, i + DELETE_BATCH_SIZE));
    onProgress?.({
      phase: 'pages',
      done: Math.min(i + DELETE_BATCH_SIZE, totalPages),
      total: totalPages,
    });
    await yieldToReads();
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/integration/delete-yield.test.ts`
Expected: PASS (1 passed).

- [ ] **Step 7: Commit**

```bash
git add src/db/repos/series.repo.ts test/integration/delete-yield.test.ts
git commit -m "fix(delete): yield to reads between deleteSeries batches"
```

---

## Task 3: Wire `yieldToReads` into `deleteReadChapters`

**Files:**
- Modify: `src/db/repos/series.repo.ts` (two loops in `deleteReadChapters` at ~line 287 and ~line 302)
- Test: `test/integration/delete-yield.test.ts` (append a case)

- [ ] **Step 1: Write the failing test (append)**

Append this `describe` block to `test/integration/delete-yield.test.ts`. It needs the additional imports — add `deleteReadChapters` to the existing `series.repo` import and add the `uuid` import at the top of the file:

Change the existing import line:
```ts
import { createSeries, deleteSeries } from '../../src/db/repos/series.repo';
```
to:
```ts
import {
  createSeries,
  deleteSeries,
  deleteReadChapters,
  mergeSeries,
} from '../../src/db/repos/series.repo';
```
and add near the other imports:
```ts
import { uuid } from '../../src/lib/uuid';
```

Then append:

```ts
describe('deleteReadChapters yields between batches', () => {
  it('awaits yieldToReads once per blob batch and once per page batch', async () => {
    // Read chapter (order 1, 300 pages) + current chapter (order 2, 1 page).
    // deleteReadChapters removes chapters strictly below the current one.
    const series = await createSeries({
      profileId: PROFILE,
      title: 'Read Backlog',
      coverImageId: null,
      chapterCount: 2,
    });
    const readCh = await createChapter({
      seriesId: series.id,
      profileId: PROFILE,
      title: 'Chapter 1',
      order: 1,
      pageCount: PAGES,
    });
    const currentCh = await createChapter({
      seriesId: series.id,
      profileId: PROFILE,
      title: 'Chapter 2',
      order: 2,
      pageCount: 1,
    });
    const blobs = [];
    const pages = [];
    for (let i = 0; i < PAGES; i++) {
      const blobId = `rb-${i}`;
      blobs.push({ id: blobId, blob: new Blob(['x']) });
      pages.push({ id: `rp-${i}`, chapterId: readCh.id, pageNumber: i, blobId });
    }
    await db.blobs.bulkAdd(blobs);
    await db.pages.bulkAdd(pages);
    await db.readingProgress.add({
      id: uuid(),
      profileId: PROFILE,
      seriesId: series.id,
      currentChapterId: currentCh.id,
      pageIndex: 0,
      scrollPosition: 0,
      updatedAt: Date.now(),
      manuallyMarked: false,
    });

    await deleteReadChapters(PROFILE, series.id);

    expect(yieldSpy).toHaveBeenCalledTimes(BATCHES_PER_PHASE * 2);
    // Read chapter gone, current chapter preserved.
    expect(await db.chapters.get(readCh.id)).toBeUndefined();
    expect(await db.chapters.get(currentCh.id)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/delete-yield.test.ts -t "deleteReadChapters"`
Expected: FAIL — `yieldSpy` called 0 times (expected 4).

- [ ] **Step 3: Add the yield in `deleteReadChapters`' blob loop**

In `deleteReadChapters`, the blob loop currently reads:

```ts
  for (let i = 0; i < blobIds.length; i += DELETE_BATCH_SIZE) {
    const batch = blobIds.slice(i, i + DELETE_BATCH_SIZE);
    await db.blobs.bulkDelete(batch);
    onProgress?.({
      phase: 'blobs',
      done: Math.min(i + DELETE_BATCH_SIZE, totalBlobs),
      total: totalBlobs,
    });
  }
```

Add `await yieldToReads();` after the `onProgress?.(...)` call:

```ts
  for (let i = 0; i < blobIds.length; i += DELETE_BATCH_SIZE) {
    const batch = blobIds.slice(i, i + DELETE_BATCH_SIZE);
    await db.blobs.bulkDelete(batch);
    onProgress?.({
      phase: 'blobs',
      done: Math.min(i + DELETE_BATCH_SIZE, totalBlobs),
      total: totalBlobs,
    });
    await yieldToReads();
  }
```

- [ ] **Step 4: Add the yield in `deleteReadChapters`' page loop**

In `deleteReadChapters`, the page loop currently reads:

```ts
  for (let i = 0; i < pageIds.length; i += DELETE_BATCH_SIZE) {
    await db.pages.bulkDelete(pageIds.slice(i, i + DELETE_BATCH_SIZE));
    onProgress?.({
      phase: 'pages',
      done: Math.min(i + DELETE_BATCH_SIZE, totalPages),
      total: totalPages,
    });
  }
```

Add `await yieldToReads();` after the `onProgress?.(...)` call:

```ts
  for (let i = 0; i < pageIds.length; i += DELETE_BATCH_SIZE) {
    await db.pages.bulkDelete(pageIds.slice(i, i + DELETE_BATCH_SIZE));
    onProgress?.({
      phase: 'pages',
      done: Math.min(i + DELETE_BATCH_SIZE, totalPages),
      total: totalPages,
    });
    await yieldToReads();
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/integration/delete-yield.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add src/db/repos/series.repo.ts test/integration/delete-yield.test.ts
git commit -m "fix(delete): yield to reads between deleteReadChapters batches"
```

---

## Task 4: Wire `yieldToReads` into `mergeSeries`

**Files:**
- Modify: `src/db/repos/series.repo.ts` (two loops in `mergeSeries` at ~line 463 and ~line 466)
- Test: `test/integration/delete-yield.test.ts` (append a case)

- [ ] **Step 1: Write the failing test (append)**

Append this `describe` block to `test/integration/delete-yield.test.ts` (`mergeSeries` is already imported from Task 3):

```ts
describe('mergeSeries yields between batches', () => {
  it('awaits yieldToReads once per loser-blob batch and once per loser-page batch', async () => {
    // Source has a chapter at order 1 with 300 pages; target has a chapter at
    // the SAME order 1. Resolution 'target' makes the SOURCE chapter the loser,
    // so its 300 pages + blobs are chunk-deleted.
    const target = await createSeries({
      profileId: PROFILE,
      title: 'Target',
      coverImageId: null,
      chapterCount: 1,
    });
    await createChapter({
      seriesId: target.id,
      profileId: PROFILE,
      title: 'T Ch1',
      order: 1,
      pageCount: 1,
    });
    const source = await createSeries({
      profileId: PROFILE,
      title: 'Source',
      coverImageId: null,
      chapterCount: 1,
    });
    const sourceCh = await createChapter({
      seriesId: source.id,
      profileId: PROFILE,
      title: 'S Ch1',
      order: 1,
      pageCount: PAGES,
    });
    const blobs = [];
    const pages = [];
    for (let i = 0; i < PAGES; i++) {
      const blobId = `mb-${i}`;
      blobs.push({ id: blobId, blob: new Blob(['x']) });
      pages.push({ id: `mp-${i}`, chapterId: sourceCh.id, pageNumber: i, blobId });
    }
    await db.blobs.bulkAdd(blobs);
    await db.pages.bulkAdd(pages);

    // resolution 'target' => source chapter (order 1) is the loser.
    await mergeSeries(target.id, source.id, new Map([[1, 'target']]));

    expect(yieldSpy).toHaveBeenCalledTimes(BATCHES_PER_PHASE * 2);
    expect(await db.series.get(source.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/delete-yield.test.ts -t "mergeSeries"`
Expected: FAIL — `yieldSpy` called 0 times (expected 4).

- [ ] **Step 3: Add the yield in `mergeSeries`' blob loop**

In `mergeSeries` (Phase 2), the blob loop currently reads:

```ts
  const allBlobIds = [...loserBlobIds, ...coverBlobIds];
  for (let i = 0; i < allBlobIds.length; i += DELETE_BATCH_SIZE) {
    await db.blobs.bulkDelete(allBlobIds.slice(i, i + DELETE_BATCH_SIZE));
  }
```

Add `await yieldToReads();` inside the loop after the `bulkDelete`:

```ts
  const allBlobIds = [...loserBlobIds, ...coverBlobIds];
  for (let i = 0; i < allBlobIds.length; i += DELETE_BATCH_SIZE) {
    await db.blobs.bulkDelete(allBlobIds.slice(i, i + DELETE_BATCH_SIZE));
    await yieldToReads();
  }
```

- [ ] **Step 4: Add the yield in `mergeSeries`' page loop**

The page loop currently reads:

```ts
  for (let i = 0; i < loserPageIds.length; i += DELETE_BATCH_SIZE) {
    await db.pages.bulkDelete(loserPageIds.slice(i, i + DELETE_BATCH_SIZE));
  }
```

Add `await yieldToReads();` inside the loop:

```ts
  for (let i = 0; i < loserPageIds.length; i += DELETE_BATCH_SIZE) {
    await db.pages.bulkDelete(loserPageIds.slice(i, i + DELETE_BATCH_SIZE));
    await yieldToReads();
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/integration/delete-yield.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add src/db/repos/series.repo.ts test/integration/delete-yield.test.ts
git commit -m "fix(delete): yield to reads between mergeSeries cleanup batches"
```

---

## Task 5: Wire `yieldToReads` into `deleteProfile`

**Files:**
- Modify: `src/db/repos/profiles.repo.ts` (import; two loops in `deleteProfile` at ~line 71 and ~line 74)
- Test: `test/integration/delete-yield.test.ts` (append a case)

- [ ] **Step 1: Write the failing test (append)**

Add `deleteProfile` to the imports at the top of `test/integration/delete-yield.test.ts`:

```ts
import { deleteProfile } from '../../src/db/repos/profiles.repo';
```

Append this `describe` block:

```ts
describe('deleteProfile yields between batches', () => {
  it('awaits yieldToReads once per blob batch and once per page batch', async () => {
    // The PROFILE seeded in beforeEach owns one series with 300 pages.
    const { series } = await seedSeriesWithPages(PAGES);
    expect(series).toBeDefined();

    await deleteProfile(PROFILE);

    expect(yieldSpy).toHaveBeenCalledTimes(BATCHES_PER_PHASE * 2);
    expect(await db.profiles.get(PROFILE)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/delete-yield.test.ts -t "deleteProfile"`
Expected: FAIL — `yieldSpy` called 0 times (expected 4).

- [ ] **Step 3: Add the import to `profiles.repo.ts`**

At the top of `src/db/repos/profiles.repo.ts`, after the existing imports, add:

```ts
import { yieldToReads } from '../idbYield';
```

- [ ] **Step 4: Add the yield in `deleteProfile`' blob loop**

In `deleteProfile` (Phase 2), the blob loop currently reads:

```ts
  const allBlobIds = [...pageBlobIds, ...coverBlobIds];
  for (let i = 0; i < allBlobIds.length; i += DELETE_BATCH_SIZE) {
    await db.blobs.bulkDelete(allBlobIds.slice(i, i + DELETE_BATCH_SIZE));
  }
```

Add `await yieldToReads();` inside the loop:

```ts
  const allBlobIds = [...pageBlobIds, ...coverBlobIds];
  for (let i = 0; i < allBlobIds.length; i += DELETE_BATCH_SIZE) {
    await db.blobs.bulkDelete(allBlobIds.slice(i, i + DELETE_BATCH_SIZE));
    await yieldToReads();
  }
```

- [ ] **Step 5: Add the yield in `deleteProfile`' page loop**

The page loop currently reads:

```ts
  for (let i = 0; i < pageIds.length; i += DELETE_BATCH_SIZE) {
    await db.pages.bulkDelete(pageIds.slice(i, i + DELETE_BATCH_SIZE));
  }
```

Add `await yieldToReads();` inside the loop:

```ts
  for (let i = 0; i < pageIds.length; i += DELETE_BATCH_SIZE) {
    await db.pages.bulkDelete(pageIds.slice(i, i + DELETE_BATCH_SIZE));
    await yieldToReads();
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/integration/delete-yield.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 7: Commit**

```bash
git add src/db/repos/profiles.repo.ts test/integration/delete-yield.test.ts
git commit -m "fix(delete): yield to reads between deleteProfile batches"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit/integration suite**

Run: `npm test`
Expected: PASS — all existing tests plus the new `idbYield` and `delete-yield` tests green. In particular `test/unit/series.repo.test.ts` and `test/integration/mergeSeries.test.ts` must still pass (the yield is additive and must not change delete outcomes).

- [ ] **Step 2: Typecheck**

Run: `npm run lint:ts`
Expected: no errors.

- [ ] **Step 3: Commit (only if Steps 1–2 surfaced fixes; otherwise skip)**

```bash
git add -A
git commit -m "test: verify delete yielding does not regress existing delete behavior"
```

---

## Manual verification (optional, real browser)

fake-indexeddb approximates but does not perfectly model Chromium's IDB transaction scheduler. To confirm in a real browser: build (`npm run build && npm run preview`), import a large series (thousands of pages), delete it, and while the background delete bar is running, open a different series and open a chapter — it should load promptly instead of hanging. This mirrors the original bug report.
