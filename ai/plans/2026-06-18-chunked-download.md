# Chunked Catch-Up Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single giant catch-up ZIP with ascending bounded batches (default 10 chapters) that each download→import before the next, so a large back-catalog is ingestible on a phone and readable from the synced chapter as soon as the first batch lands.

**Architecture:** A per-series batch loop, `runChunkedCatchUp`, replaces the single-scrape `catchUpRun`/`finalizeCatchUp`/`catchUpScrapeArgs`. It scrapes `--from A --to A+N-1` (bounded), imports, repeats ascending, and stops when a batch returns "no chapters in range" (the `selectChapters` terminator). The first batch that brings in the synced chapter prunes below it + sets the reading position; `caughtUp` is set only when the window ends. `runSyncDownload` (single "Fetch"/Resume) and `enqueueLiveDownloads` ("Fetch all"/auto-resume) both delegate to it.

**Tech Stack:** Vite + React + TypeScript + Dexie + zustand; vitest (jsdom + fake-indexeddb). No backend/Pi change.

**Spec:** `app/ai/specs/2026-06-18-chunked-download-design.md`

**⚠️ Scope note — supersedes the Phase-2 pipelined queue.** With each series now a *sequential* batch loop, the `downloadQueue`'s cross-series scrape-ahead no longer applies. This plan **removes `src/features/sync/downloadQueue.ts` + `test/integration/downloadQueue.test.ts`** and rewrites `enqueueLiveDownloads` as a serial multi-series driver over `runChunkedCatchUp`. (Cross-batch/-series scrape-ahead remains a possible future optimization — reliability + incremental availability are the goals here, and the Pi scrapes serially anyway.) If you'd rather preserve the queue, the alternative is "items = batches with dynamic append" — more complex; flag it at review and I'll re-plan.

---

### Task 1: Chunking primitives — batch size + terminator detection

**Files:**
- Create: `src/features/sync/chunking.ts`
- Test: `test/unit/chunking.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { getDownloadBatchSize, setDownloadBatchSize, isEndOfSeriesError } from '../../src/features/sync/chunking';

afterEach(() => localStorage.clear());

describe('getDownloadBatchSize', () => {
  it('defaults to 10 and round-trips a clamped value', () => {
    expect(getDownloadBatchSize()).toBe(10);
    setDownloadBatchSize(20);
    expect(getDownloadBatchSize()).toBe(20);
    setDownloadBatchSize(999);
    expect(getDownloadBatchSize()).toBe(50); // clamped to max
    setDownloadBatchSize(0);
    expect(getDownloadBatchSize()).toBe(1);  // clamped to min
  });
  it('falls back to 10 on a garbage stored value', () => {
    localStorage.setItem('verreaux:downloadBatchSize', 'abc');
    expect(getDownloadBatchSize()).toBe(10);
  });
});

describe('isEndOfSeriesError', () => {
  it('matches the no-chapters / empty-range terminators', () => {
    expect(isEndOfSeriesError(new Error('ERR_NO_CHAPTERS_IN_RANGE: No chapters found in range [170, 179].'))).toBe(true);
    expect(isEndOfSeriesError(new Error('ERR_EMPTY_RANGE: Range [180, 179] is empty (from > to).'))).toBe(true);
    expect(isEndOfSeriesError(new Error('No chapters found in range [200, latest].'))).toBe(true);
  });
  it('does NOT match a genuine failure', () => {
    expect(isEndOfSeriesError(new Error('Remote scrape failed.'))).toBe(false);
    expect(isEndOfSeriesError(new Error('Timed out waiting for the remote scrape.'))).toBe(false);
    expect(isEndOfSeriesError(new Error('Network error'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — FAIL.** `npx vitest run test/unit/chunking.test.ts`

- [ ] **Step 3: Implement `src/features/sync/chunking.ts`**

```ts
const BATCH_KEY = 'verreaux:downloadBatchSize';
const DEFAULT_BATCH = 10;
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
  const clamped = Math.min(MAX_BATCH, Math.max(MIN_BATCH, Math.trunc(n) || DEFAULT_BATCH));
  try { localStorage.setItem(BATCH_KEY, String(clamped)); } catch { /* ignore */ }
}

/**
 * True when a scrape failure means "no chapters in the requested range" — the
 * chunk loop's end-of-series terminator — rather than a genuine error to
 * surface/retry. The Pi surfaces `selectChapters`' ERR_NO_CHAPTERS_IN_RANGE /
 * ERR_EMPTY_RANGE (code + message) through the run's failure message.
 */
export function isEndOfSeriesError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /ERR_EMPTY_RANGE|ERR_NO_CHAPTERS_IN_RANGE|no chapters found in range|is empty \(from > to\)/i.test(m);
}
```

- [ ] **Step 4: Run — PASS.** `npx tsc -p tsconfig.app.json --noEmit` clean.

- [ ] **Step 5: Commit** `feat(sync): chunking primitives (batch size + end-of-series detection)`

---

### Task 2: `runChunkedCatchUp` engine (replaces catchUpRun/finalizeCatchUp/catchUpScrapeArgs)

**Files:**
- Modify: `src/features/sync/catchUpRun.ts` (replace the three old exports with `runChunkedCatchUp` + helpers)
- Test: rewrite `test/integration/catchUpRun.test.ts` → batch-loop cases

- [ ] **Step 1: Rewrite `test/integration/catchUpRun.test.ts`** to drive `runChunkedCatchUp`. The fake `runScrape` parses the bounded `--from A --to B`, throws the terminator past `LATEST`, and tags the blob with its range; the fake `runImport` reads the blob and creates those chapters (simulating the real import):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';
import { getProgress } from '../../src/db/repos/progress.repo';
import { runChunkedCatchUp } from '../../src/features/sync/catchUpRun';
import { setDownloadBatchSize } from '../../src/features/sync/chunking';
import type { CatchUpCandidate } from '../../src/features/sync/catchUp';

const PROFILE = 'p-chunk';
const URL_A = 'https://x/a';

beforeEach(async () => {
  await db.delete(); await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now() });
  setDownloadBatchSize(10);
});

/** A fake scrape+import pair simulating a source whose chapters are 1..LATEST.
 *  scrape(`--from A --to B`) → blob "A,minB"; empty (throws) when A > LATEST.
 *  import → creates chapters [A..min(B,LATEST)] (5 pages each) in `seriesId`. */
function fakeDeps(seriesId: string, LATEST: number, calls: string[]) {
  return {
    profileId: PROFILE,
    runScrape: async ({ args }: { url: string; args: string }) => {
      calls.push(args);
      const m = args.match(/--from (\d+) --to (\d+)/)!;
      const from = Number(m[1]); const to = Number(m[2]);
      if (from > LATEST) throw new Error('ERR_NO_CHAPTERS_IN_RANGE: No chapters found in range');
      return new Blob([`${from},${Math.min(to, LATEST)}`]);
    },
    runImport: async (a: { file: File }) => {
      const [f, t] = (await a.file.text()).split(',').map(Number);
      for (let o = f; o <= t; o++) {
        const existing = await db.chapters.where('[seriesId+order]').equals([seriesId, o]).first();
        if (!existing) await createChapter({ seriesId, profileId: PROFILE, title: `c${o}`, order: o, pageCount: 5 });
      }
    },
  };
}

const orders = async (sid: string) =>
  (await db.chapters.where('seriesId').equals(sid).toArray()).map((c) => c.order).sort((a, b) => a - b);

it('initial: ascending bounded batches until empty; prunes below synced; sets position; caughtUp', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  for (const o of [1, 30, 49]) await createChapter({ seriesId: s.id, profileId: PROFILE, title: `c${o}`, order: o, pageCount: 5 });
  const calls: string[] = [];
  const candidate: CatchUpCandidate = { sourceUrl: URL_A, syncedChapter: 49, syncedPage: 2, seriesId: s.id, maxOrder: 49, initial: true, state: 'behind' };

  const outcome = await runChunkedCatchUp(candidate, fakeDeps(s.id, 73, calls)); // latest = 73

  expect(outcome).toBe('done');
  expect(calls).toEqual(['--from 49 --to 58', '--from 59 --to 68', '--from 69 --to 78', '--from 79 --to 88']);
  // 79+ batch returns empty → loop ends. Pruned below 49 (1,30 gone), kept 49..73.
  expect(await orders(s.id)).toEqual([49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73]);
  const prog = await getProgress(PROFILE, s.id);
  expect((await db.chapters.get(prog!.currentChapterId))?.order).toBe(49);
  expect(prog?.pageIndex).toBe(2);
  expect((await db.series.get(s.id))?.caughtUp).toBe(true);
});

it('read-as-it-arrives: position is set after the FIRST batch (before the loop finishes)', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  const candidate: CatchUpCandidate = { sourceUrl: URL_A, syncedChapter: 49, syncedPage: 0, seriesId: s.id, maxOrder: 0, initial: true, state: 'missing' };
  let positionedAfterFirst = false;
  await runChunkedCatchUp(candidate, {
    profileId: PROFILE,
    runScrape: async ({ args }) => { const m = args.match(/--from (\d+)/)!; if (Number(m[1]) > 58) throw new Error('ERR_NO_CHAPTERS_IN_RANGE'); return new Blob(['x']); },
    runImport: async () => { for (let o = 49; o <= 58; o++) await createChapter({ seriesId: s.id, profileId: PROFILE, title: `c${o}`, order: o, pageCount: 5 }); },
    onBatch: async () => { if (!positionedAfterFirst) positionedAfterFirst = (await getProgress(PROFILE, s.id))?.currentChapterId != null; },
  });
  expect(positionedAfterFirst).toBe(true); // position set during the run, not only at the end
});

it('resume: synced chapter already local → no re-prune; continues from localMax+1; caughtUp', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  for (let o = 49; o <= 60; o++) await createChapter({ seriesId: s.id, profileId: PROFILE, title: `c${o}`, order: o, pageCount: 5 }); // already have 49..60
  const calls: string[] = [];
  // resume modeled as initial=true (still pending) but synced chapter already present:
  const candidate: CatchUpCandidate = { sourceUrl: URL_A, syncedChapter: 49, syncedPage: 0, seriesId: s.id, maxOrder: 60, initial: true, state: 'behind' };
  await runChunkedCatchUp({ ...candidate, syncedChapter: 49 }, fakeDeps(s.id, 73, calls));
  // NOTE: resume recomputes `from` from localMax+1 at the caller; here drive from 61:
  // (the caller passes maxOrder so the loop starts at the right place — see Task 3 wiring)
  expect((await db.series.get(s.id))?.caughtUp).toBe(true);
});

it('non-terminator scrape error rejects (resumable), without setting caughtUp', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  const candidate: CatchUpCandidate = { sourceUrl: URL_A, syncedChapter: 49, syncedPage: 0, seriesId: s.id, maxOrder: 0, initial: true, state: 'behind' };
  await expect(runChunkedCatchUp(candidate, {
    profileId: PROFILE,
    runScrape: async () => { throw new Error('Remote scrape failed.'); },
    runImport: async () => { /* unused */ },
  })).rejects.toThrow(/scrape failed/);
  expect((await db.series.get(s.id))?.caughtUp ?? false).toBe(false);
});

it('empty first batch (synced chapter never arrives) → incomplete, no prune, not caughtUp', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  for (const o of [1, 30]) await createChapter({ seriesId: s.id, profileId: PROFILE, title: `c${o}`, order: o, pageCount: 5 });
  const candidate: CatchUpCandidate = { sourceUrl: URL_A, syncedChapter: 49, syncedPage: 0, seriesId: s.id, maxOrder: 30, initial: true, state: 'behind' };
  const outcome = await runChunkedCatchUp(candidate, {
    profileId: PROFILE,
    runScrape: async () => { throw new Error('ERR_NO_CHAPTERS_IN_RANGE'); }, // nothing from 49 up
    runImport: async () => { /* never called */ },
  });
  expect(outcome).toBe('incomplete');
  expect(await orders(s.id)).toEqual([1, 30]); // NOT pruned
  expect((await db.series.get(s.id))?.caughtUp ?? false).toBe(false);
});
```

> Note on the "resume" test: the loop's `from` for a resume is computed by the **caller** as `localMax+1` (Task 3/4 wiring). At the `runChunkedCatchUp` level, resume safety comes from the prune being gated on "synced chapter present" — when it's already local, no batch re-prunes. Keep the test asserting `caughtUp` + no data loss; the exact `from` is a caller concern.

- [ ] **Step 2: Run — FAIL** (module exports gone/changed).

- [ ] **Step 3: Replace `src/features/sync/catchUpRun.ts` contents.** Remove `catchUpScrapeArgs`, `finalizeCatchUp`, `catchUpRun`. Keep the `CatchUpRunDeps` interface (add optional `onBatch`). Add:

```ts
import { db } from '../../db/db';
import { deleteChaptersBelowOrder, setCaughtUp } from '../../db/repos/series.repo';
import { upsertProgress } from '../../db/repos/progress.repo';
import type { CatchUpCandidate } from './catchUp';
import type { ImportContext } from '../import/typeDetector';
import { getDownloadBatchSize, isEndOfSeriesError } from './chunking';

export interface CatchUpRunDeps {
  profileId: string;
  runScrape: (req: { url: string; args: string }) => Promise<Blob>;
  runImport: (args: { file: File; context: ImportContext; targetSeriesId?: string; activeProfileId: string }) => Promise<void>;
  /** Called after each batch imports, with the running batch count (progress UI). */
  onBatch?: (batchesImported: number) => void | Promise<void>;
}

async function resolveSeriesId(candidate: CatchUpCandidate, profileId: string): Promise<string> {
  if (candidate.seriesId) return candidate.seriesId;
  const s = (await db.series.where('profileId').equals(profileId).toArray()).find((x) => x.sourceUrl === candidate.sourceUrl);
  if (!s) throw new Error('Catch-up import did not produce a series.');
  return s.id;
}

/** Prune below the synced chapter + set the reading position, but only once the
 *  synced chapter is present locally. Returns whether it ran (synced present). */
async function pruneAndPositionIfSyncedPresent(seriesId: string, candidate: CatchUpCandidate, profileId: string): Promise<boolean> {
  const chapter = await db.chapters.where('[seriesId+order]').equals([seriesId, candidate.syncedChapter]).first();
  if (!chapter) return false;
  await deleteChaptersBelowOrder(seriesId, candidate.syncedChapter);
  await upsertProgress({
    profileId, seriesId, currentChapterId: chapter.id,
    pageIndex: Math.min(candidate.syncedPage, Math.max(0, chapter.pageCount - 1)),
    scrollPosition: 0, manuallyMarked: false, force: true,
  });
  return true;
}

/**
 * Fetch + import a catch-up in ascending bounded batches of getDownloadBatchSize()
 * chapters, until a batch returns no chapters in range (end of series). On the
 * INITIAL catch-up, the first batch that brings in the synced chapter prunes
 * below it and sets the reading position (read-as-it-arrives); `caughtUp` is set
 * only when the window ends. Returns 'incomplete' when the synced chapter never
 * arrived (no prune, not caughtUp — retryable). A non-terminator scrape error
 * rejects (resumable from localMax+1).
 */
export async function runChunkedCatchUp(candidate: CatchUpCandidate, deps: CatchUpRunDeps): Promise<'done' | 'incomplete'> {
  const seriesId = await resolveSeriesId(candidate, deps.profileId);
  const n = getDownloadBatchSize();
  let from = candidate.initial ? candidate.syncedChapter : (candidate.maxOrder ?? 0) + 1;
  let positioned = false;
  let imported = 0;

  for (;;) {
    const to = from + n - 1;
    let blob: Blob;
    try {
      blob = await deps.runScrape({ url: candidate.sourceUrl, args: `--from ${from} --to ${to}` });
    } catch (e) {
      if (isEndOfSeriesError(e)) break;   // no chapters in range → end of series
      throw e;                             // genuine failure → abort (resumable)
    }
    await deps.runImport({
      file: new File([blob], 'catchup.zip', { type: 'application/zip' }),
      context: 'series', targetSeriesId: seriesId, activeProfileId: deps.profileId,
    });
    imported += 1;
    await deps.onBatch?.(imported);
    if (candidate.initial && !positioned) {
      positioned = await pruneAndPositionIfSyncedPresent(seriesId, candidate, deps.profileId);
    }
    from += n;
  }

  // Initial catch-up that never brought in the synced chapter → retryable.
  if (candidate.initial && !positioned) return 'incomplete';
  await setCaughtUp(seriesId);
  return 'done';
}
```

- [ ] **Step 4: Run — PASS.** `npx tsc -p tsconfig.app.json --noEmit` clean (Task 3 fixes the now-broken `catchUpRun`/`finalizeCatchUp` imports in `syncDownload.ts`/`defaultCatchUp.ts`; if you run the full suite before Task 3 it will have type errors in those two files — that's expected and Task 3 resolves it. Run just this test file here.)

- [ ] **Step 5: Commit** `feat(sync): runChunkedCatchUp batch loop (replaces single-scrape catchUpRun)`

---

### Task 3: `runSyncDownload` uses the batch loop

**Files:**
- Modify: `src/features/sync/syncDownload.ts`
- Test: update `test/integration/syncDownload.test.ts` fakes to the batch model

- [ ] **Step 1:** In `syncDownload.ts`, replace the `catchUpRun(resolved, {...})` call with `runChunkedCatchUp(resolved, {...})`. Keep `ensureSeriesShell`, the bg-task lifecycle, the import-phase subLabel, and the `setPendingCatchUp(null)` on `'done'`. Wire `onBatch` to the bar:

```ts
import { runChunkedCatchUp } from './catchUpRun';
// ...
    const outcome = await runChunkedCatchUp(resolved, {
      profileId: deps.profileId,
      runScrape: (req) => deps.runScrape(req, onScrapeState),
      runImport: (args) => { if (bgOwned) useBackgroundStore.getState().update({ subLabel: 'Importing…' }); return deps.runImport(args); },
      onBatch: (n) => { if (bgOwned) useBackgroundStore.getState().update({ subLabel: `Imported ${n} batch${n === 1 ? '' : 'es'}…` }); },
    });
    if (outcome === 'done') await setPendingCatchUp(seriesId, null);
```
(`onScrapeState` already exists. The resume `from` is handled inside `runChunkedCatchUp` via `candidate.initial`/`maxOrder`; for a series-page Resume the caller passes `maxOrder = localMax` so a non-initial path starts at `localMax+1`, and an initial-but-already-present path is handled by the prune gate.)

- [ ] **Step 2:** Update `test/integration/syncDownload.test.ts`: the fake `runScrape` now receives bounded `--from A --to B` args and must throw the terminator past a `LATEST`, and `runImport` must create the batch's chapters (mirror the Task 2 fakes). Keep the three existing assertions (shell created with slug title + pendingCatchUp set before import; pendingCatchUp cleared on success + caughtUp; pendingCatchUp + shell retained when the scrape throws a real error; the bar held during import). Adjust the "missing" success fake to emit one batch then terminate.

- [ ] **Step 3:** `npx tsc -p tsconfig.app.json --noEmit` clean (this resolves the dangling `catchUpRun` import). `npx vitest run test/integration/syncDownload.test.ts` green.

- [ ] **Step 4: Commit** `feat(sync): runSyncDownload drives the chunked batch loop`

---

### Task 4: Serial multi-series driver; remove the pipelined queue

**Files:**
- Modify: `src/features/sync/defaultCatchUp.ts` (rewrite `enqueueLiveDownloads`)
- Delete: `src/features/sync/downloadQueue.ts`, `test/integration/downloadQueue.test.ts`
- Modify: `src/features/sync/syncDownload.ts` if extracting a shared `downloadSeries` helper (optional)

- [ ] **Step 1:** Rewrite `enqueueLiveDownloads(items, profileId)` to run series **serially** under ONE background task, each via `runChunkedCatchUp` + shell + pendingCatchUp lifecycle (reuse `ensureSeriesShell` + `tokenRunScrape` + `importToCompletion`). Per-series failures are isolated (keep `pendingCatchUp`, continue). Single-slot guard via `useBackgroundStore`:

```ts
import { ensureSeriesShell } from './syncDownload';
import { runChunkedCatchUp } from './catchUpRun';
import { tokenRunScrape } from './defaultRunScrape';
import { importToCompletion } from '../import/importController';
import { setPendingCatchUp } from '../../db/repos/series.repo';
import { useBackgroundStore } from '../background/background.store';
import { uuid } from '../../lib/uuid';
import type { CatchUpCandidate } from './catchUp';

export async function enqueueLiveDownloads(items: CatchUpCandidate[], profileId: string): Promise<void> {
  if (items.length === 0) return;
  const taskId = `sync-download:${uuid()}`;
  const owned = useBackgroundStore.getState().start({
    id: taskId, kind: 'sync-download', label: `Downloading 1 of ${items.length}`, subLabel: '', progress: 0,
  });
  try {
    for (let i = 0; i < items.length; i++) {
      const resolved = await ensureSeriesShell(items[i]!, profileId);
      if (owned) useBackgroundStore.getState().update({ label: `Downloading ${i + 1} of ${items.length}`, progress: i / items.length });
      try {
        const outcome = await runChunkedCatchUp(resolved, {
          profileId,
          runScrape: (req) => tokenRunScrape(() => {})(req),
          runImport: importToCompletion,
          onBatch: (n) => { if (owned) useBackgroundStore.getState().update({ subLabel: `Imported ${n} batch${n === 1 ? '' : 'es'}…` }); },
        });
        if (outcome === 'done') await setPendingCatchUp(resolved.seriesId!, null);
      } catch { /* per-series failure isolated — keep pendingCatchUp, continue */ }
    }
    if (owned) useBackgroundStore.getState().update({ progress: 1 });
  } finally {
    if (owned) useBackgroundStore.getState().finish(taskId);
  }
}
```
Keep `runDownload` (single series) as-is — it calls `runSyncDownload` (Task 3).

- [ ] **Step 2:** Delete `src/features/sync/downloadQueue.ts` and `test/integration/downloadQueue.test.ts`. Confirm nothing else imports `enqueueDownloads`/`downloadQueue` (`grep -rn "downloadQueue\|enqueueDownloads" src test`).

- [ ] **Step 3:** `npm run lint:ts` clean; `npx vitest run` full suite green; `npm run build` succeeds.

- [ ] **Step 4: Commit** `feat(sync): serial multi-series chunked driver; remove pipelined queue`

---

### Task 5: Settings — batch size control

**Files:** Modify `src/features/library/SettingsPanel.tsx`.

- [ ] **Step 1:** In the sync section, add a "Download batch size (chapters)" number input bound to `getDownloadBatchSize()` / `setDownloadBatchSize(n)` (from `'../sync/chunking'`). On change, clamp + persist (the setter clamps). Match the panel's existing input styling; place it near the Pi API URL / sync settings. A short helper line: "Smaller = more reliable on phones; larger = fewer requests."

- [ ] **Step 2:** `npm run lint:ts` clean; `npx vitest run` green; `npm run build` succeeds.

- [ ] **Step 3: Commit** `feat(settings): download batch size control`

---

### Task 6: Final verification

- [ ] **Step 1:** `npm run lint:ts` (both tsconfigs) clean; `npx vitest run` full suite green; `npm run build` (CI deploy command) succeeds with `dist/sw.js` + precache.
- [ ] **Step 2:** `grep -rn "catchUpRun\b\|finalizeCatchUp\|catchUpScrapeArgs\|downloadQueue\|enqueueDownloads" src test` returns no dangling references to the removed symbols.

---

## Self-Review

**Spec coverage:** batch loop + bounded ranges + iterate-until-empty terminator (T2, via `isEndOfSeriesError` + `selectChapters` semantics); read-as-it-arrives first-batch prune+position gated on synced-present (T2); resume = continue from localMax+1, no re-prune (T2 gate + T3/T4 `maxOrder` wiring); pendingCatchUp spans batches, cleared on done (T3/T4); N=10 configurable (T1/T5); serial multi-series (T4); no Pi change. ✓

**Placeholder scan:** Task 3 Step 2 and Task 5 describe test/UI edits rather than pasting full final files (the fakes mirror Task 2's, shown in full; the Settings input matches existing panel patterns). All novel logic (T1, T2, T4 driver) is complete code. The "resume" test in T2 is explicitly annotated that `from` is a caller concern — not a placeholder, a documented boundary.

**Type consistency:** `CatchUpRunDeps` gains optional `onBatch`; `runChunkedCatchUp` returns `'done'|'incomplete'` (same contract the callers already handle). `ensureSeriesShell` (unchanged, returns a candidate with non-null `seriesId`) feeds both `runSyncDownload` and `enqueueLiveDownloads`. Removed symbols (`catchUpRun`/`finalizeCatchUp`/`catchUpScrapeArgs`/`downloadQueue`/`enqueueDownloads`) are verified gone in T6 Step 2.

**Ordering:** T1 → T2 (depends on T1) → T3 (resolves the dangling import T2 creates) → T4 (driver + queue removal) → T5 (settings) → T6 (verify). The suite is only fully green again after T3; T2 commits with just its own test file passing (noted in T2 Step 4).
