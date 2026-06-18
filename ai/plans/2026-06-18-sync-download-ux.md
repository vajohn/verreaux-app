# Sync Download UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sync-driven downloads create the series up-front (retryable from its own page), show progress in the global background bar, survive in-app navigation, pipeline a batch, and resume across app restarts.

**Architecture:** A module-level `runSyncDownload` runner wraps the existing `catchUpRun`; it creates a series shell carrying `sourceUrl` + a durable `pendingCatchUp` marker, tracks progress through the existing single-slot `useBackgroundStore`/`BackgroundTaskBar`, and clears `pendingCatchUp` only on full success. A pipelined `downloadQueue` (Phase 2) keeps one scrape in flight ahead of a serial import lane. Background sync (Phase 3) auto-resumes `pendingCatchUp` series on launch and registers a Service-Worker `sync` nudge.

**Tech Stack:** Vite + React + TypeScript + Dexie + zustand; vitest (jsdom + fake-indexeddb); vite-plugin-pwa (Workbox).

**Spec:** `app/ai/specs/2026-06-18-sync-download-ux-design.md`

**Scope note (writing-plans Scope Check):** Phase 3 (Service Worker background sync) is an arguably-separable subsystem — it touches the PWA build and adds a custom service worker. It is included here per request, sequenced last so Phases 1–2 ship independently if desired. Phases 1 → 2 → 3 are ordered; tasks within a phase are mostly independent.

---

## Phase 1 — Core: series-shell-first + background progress

### Task 1: `Series.pendingCatchUp` field + Dexie v7 + repo setters

**Files:**
- Modify: `src/db/types.ts`, `src/db/db.ts`, `src/db/repos/series.repo.ts`
- Test: `test/integration/pendingCatchUp.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries, setPendingCatchUp } from '../../src/db/repos/series.repo';

const PROFILE = 'p-pcu';
beforeEach(async () => {
  await db.delete(); await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now() });
});

describe('pendingCatchUp', () => {
  it('defaults new series to pendingCatchUp null and round-trips set/clear', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null });
    expect((await db.series.get(s.id))?.pendingCatchUp ?? null).toBeNull();
    await setPendingCatchUp(s.id, { syncedChapter: 49, syncedPage: 2 });
    expect((await db.series.get(s.id))?.pendingCatchUp).toEqual({ syncedChapter: 49, syncedPage: 2 });
    await setPendingCatchUp(s.id, null);
    expect((await db.series.get(s.id))?.pendingCatchUp ?? null).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — FAIL** (`setPendingCatchUp` missing). `npx vitest run test/integration/pendingCatchUp.test.ts`

- [ ] **Step 3: Add the field** in `src/db/types.ts` `Series`, after `caughtUp`:

```ts
  /**
   * Durable marker of an in-flight or failed sync catch-up and its target
   * (chapter order + page). Set when a download starts; cleared on full
   * success. Drives the series-page "Resume download" affordance and lets a
   * resume prune correctly. `null`/absent when no catch-up is pending.
   */
  pendingCatchUp?: { syncedChapter: number; syncedPage: number } | null;
```

- [ ] **Step 4: v7 migration** in `src/db/db.ts`, after the `this.version(6)` block:

```ts
    // v7 — `Series.pendingCatchUp`: in-flight/failed catch-up marker. Non-indexed
    // field; backfill existing rows to null.
    this.version(7).upgrade(async (tx) => {
      await tx.table('series').toCollection().modify((s: Record<string, unknown>) => {
        if (s['pendingCatchUp'] === undefined) s['pendingCatchUp'] = null;
      });
    });
```

- [ ] **Step 5: Default + setter** in `src/db/repos/series.repo.ts`. Add `pendingCatchUp: null,` to the `createSeries` literal (after `caughtUp: false,`), and add:

```ts
export async function setPendingCatchUp(
  seriesId: string,
  target: { syncedChapter: number; syncedPage: number } | null,
): Promise<void> {
  await db.series.update(seriesId, { pendingCatchUp: target });
}
```

- [ ] **Step 6: Run — PASS.** Then `npx vitest run test/integration/ test/unit/series.repo.test.ts` (no regressions) and `npx tsc --noEmit`.

- [ ] **Step 7: Commit** `feat(db): Series.pendingCatchUp + v7 migration + setPendingCatchUp`

---

### Task 2: `titleFromSourceUrl` pure helper

**Files:** Create `src/features/sync/sourceUrlTitle.ts`; Test `test/unit/sourceUrlTitle.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { titleFromSourceUrl } from '../../src/features/sync/sourceUrlTitle';

describe('titleFromSourceUrl', () => {
  it('derives a title-cased name from the last meaningful path segment', () => {
    expect(titleFromSourceUrl('https://qimanhwa.com/manga/solo-leveling')).toBe('Solo Leveling');
    expect(titleFromSourceUrl('https://x.test/series/the_beginning-after-the-end/')).toBe('The Beginning After The End');
    expect(titleFromSourceUrl('https://x.test/comic/9999')).toBe('Comic 9999'); // numeric-only slug falls back to prior segment + id
  });
  it('falls back to the host when no usable path', () => {
    expect(titleFromSourceUrl('https://qimanhwa.com/')).toBe('qimanhwa.com');
    expect(titleFromSourceUrl('not a url')).toBe('New series');
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** `src/features/sync/sourceUrlTitle.ts`:

```ts
/** Best-effort readable title from a series source URL. The import renames the
 *  series from the ZIP manifest on success; this is only the placeholder shown
 *  while a freshly-created shell series is downloading. */
export function titleFromSourceUrl(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return 'New series'; }
  const segs = u.pathname.split('/').filter(Boolean);
  if (segs.length === 0) return u.host;
  const titleCase = (s: string) =>
    s.replace(/[-_]+/g, ' ').trim().replace(/\s+/g, ' ')
      .split(' ').map((w) => w ? w[0]!.toUpperCase() + w.slice(1) : w).join(' ');
  const last = segs[segs.length - 1]!;
  // A purely-numeric final segment (an id) reads better with its parent segment.
  if (/^\d+$/.test(last) && segs.length >= 2) return `${titleCase(segs[segs.length - 2]!)} ${last}`;
  return titleCase(last) || u.host;
}
```

- [ ] **Step 4: Run — PASS.** `npx tsc --noEmit`.

- [ ] **Step 5: Commit** `feat(sync): titleFromSourceUrl placeholder helper`

---

### Task 3: `catchUpRun` returns an outcome

**Files:** Modify `src/features/sync/catchUpRun.ts`; Modify `test/integration/catchUpRun.test.ts`.

The runner must distinguish a full success from the synced-chapter-absent early return, so `runSyncDownload` clears `pendingCatchUp` only on success.

- [ ] **Step 1: Update the type + return values.** Change the signature to `Promise<'done' | 'incomplete'>`. Return `'incomplete'` from the existing synced-chapter-absent early-return branch (the one that `log.warn`s and `return`s); return `'done'` at the end. No other logic changes.

- [ ] **Step 2: Update tests.** In `test/integration/catchUpRun.test.ts`, assert the return value in the relevant cases:
  - initial behind / missing / subsequent success → `expect(await catchUpRun(...)).toBe('done')`
  - synced-chapter-absent → `expect(await catchUpRun(...)).toBe('incomplete')`
  - (the fetch-throw case still `rejects`.)

- [ ] **Step 3: Run — PASS.** `npx vitest run test/integration/catchUpRun.test.ts && npx tsc --noEmit`

- [ ] **Step 4: Commit** `refactor(sync): catchUpRun returns 'done' | 'incomplete'`

---

### Task 4: `runSyncDownload` runner

**Files:** Create `src/features/sync/syncDownload.ts`; Modify `src/features/background/background.store.ts` (add kind); Test `test/integration/syncDownload.test.ts`.

- [ ] **Step 1: Add the task kind.** In `background.store.ts`, add `'sync-download'` to the `BackgroundTaskKind` union.

- [ ] **Step 2: Failing test** `test/integration/syncDownload.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';
import { useBackgroundStore } from '../../src/features/background/background.store';
import { runSyncDownload } from '../../src/features/sync/syncDownload';
import type { CatchUpCandidate } from '../../src/features/sync/catchUp';

const PROFILE = 'p-sd';
const URL_A = 'https://x/a';
beforeEach(async () => {
  await db.delete(); await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now() });
  useBackgroundStore.setState({ current: null });
});
afterEach(() => useBackgroundStore.setState({ current: null }));

const ch = (sid: string, o: number, pc = 5) => createChapter({ seriesId: sid, profileId: PROFILE, title: `c${o}`, order: o, pageCount: pc });

function missing(): CatchUpCandidate {
  return { sourceUrl: URL_A, syncedChapter: 49, syncedPage: 0, seriesId: null, maxOrder: null, initial: true, state: 'missing' };
}

it('missing: creates a shell with sourceUrl + slug title + pendingCatchUp, then clears it on success', async () => {
  let hadPending = false;
  await runSyncDownload(missing(), {
    profileId: PROFILE,
    runScrape: async () => new Blob(['z']),
    runImport: async (args) => {
      // a real import would create/merge the series; emulate the shell already exists (targetSeriesId)
      const sid = args.targetSeriesId!;
      hadPending = (await db.series.get(sid))?.pendingCatchUp != null; // set before import
      await ch(sid, 49);
    },
  });
  const s = (await db.series.where('profileId').equals(PROFILE).toArray()).find((x) => x.sourceUrl === URL_A)!;
  expect(s.title).toBe('A'); // slug from https://x/a
  expect(hadPending).toBe(true);
  expect(s.pendingCatchUp ?? null).toBeNull(); // cleared on success
  expect(s.caughtUp).toBe(true);
  expect(useBackgroundStore.getState().current).toBeNull(); // task finished
});

it('keeps pendingCatchUp + series shell when the scrape throws (retryable)', async () => {
  await expect(runSyncDownload(missing(), {
    profileId: PROFILE,
    runScrape: async () => { throw new Error('scrape failed'); },
    runImport: async () => { throw new Error('no'); },
  })).rejects.toThrow(/scrape failed/);
  const s = (await db.series.where('profileId').equals(PROFILE).toArray()).find((x) => x.sourceUrl === URL_A)!;
  expect(s.sourceUrl).toBe(URL_A);
  expect(s.pendingCatchUp).toEqual({ syncedChapter: 49, syncedPage: 0 });
  expect(useBackgroundStore.getState().current).toBeNull(); // bar released even on failure
});
```

- [ ] **Step 3: Run — FAIL.**

- [ ] **Step 4: Implement** `src/features/sync/syncDownload.ts`:

```ts
import { db } from '../../db/db';
import { createSeries, setPendingCatchUp } from '../../db/repos/series.repo';
import { catchUpRun, type CatchUpRunDeps } from './catchUpRun';
import { titleFromSourceUrl } from './sourceUrlTitle';
import type { CatchUpCandidate } from './catchUp';
import { useBackgroundStore } from '../background/background.store';
import { uuid } from '../../lib/uuid';

export type SyncDownloadDeps = CatchUpRunDeps; // { profileId, runScrape, runImport }

/**
 * Create the series shell up-front (so a failed download is retryable from the
 * series page), track progress in the global background bar, run the catch-up,
 * and clear `pendingCatchUp` only on a full 'done'. The series shell +
 * `pendingCatchUp` survive any failure.
 */
export async function runSyncDownload(candidate: CatchUpCandidate, deps: SyncDownloadDeps): Promise<void> {
  // 1. Ensure a series shell with sourceUrl + pendingCatchUp.
  let seriesId = candidate.seriesId;
  if (!seriesId) {
    const existing = (await db.series.where('profileId').equals(deps.profileId).toArray())
      .find((s) => s.sourceUrl === candidate.sourceUrl);
    if (existing) seriesId = existing.id;
    else {
      const shell = await createSeries({
        profileId: deps.profileId,
        title: titleFromSourceUrl(candidate.sourceUrl),
        coverImageId: null,
        sourceUrl: candidate.sourceUrl,
      });
      seriesId = shell.id;
    }
  }
  await setPendingCatchUp(seriesId, { syncedChapter: candidate.syncedChapter, syncedPage: candidate.syncedPage });

  // The candidate now always targets the shell (so catchUpRun merges into it
  // via context 'series' and never creates a duplicate).
  const resolved: CatchUpCandidate = { ...candidate, seriesId };

  // 2. Track in the global single-slot bar (survives navigation).
  const taskId = `sync-download:${uuid()}`;
  const title = (await db.series.get(seriesId))?.title ?? 'series';
  const bgOwned = useBackgroundStore.getState().start({
    id: taskId, kind: 'sync-download', label: `Downloading ${title}`, subLabel: 'Fetching chapters…', progress: null,
  });

  try {
    // 3-5. Scrape (onState → bar) + import + finalize, via catchUpRun.
    const onScrapeState = (s: string) => {
      if (bgOwned) useBackgroundStore.getState().update({ subLabel: scrapeSubLabel(s) });
    };
    const outcome = await catchUpRun(resolved, {
      profileId: deps.profileId,
      runScrape: (req) => deps.runScrape(req, onScrapeState),
      runImport: deps.runImport,
    });
    if (outcome === 'done') await setPendingCatchUp(seriesId, null);
  } finally {
    if (bgOwned) useBackgroundStore.getState().finish(taskId);
  }
}

function scrapeSubLabel(state: string): string {
  if (state === 'running') return 'Fetching chapters…';
  if (state === 'succeeded') return 'Preparing import…';
  if (state === 'failed') return 'Scrape failed';
  return 'Fetching chapters…';
}
```

NOTE on `runScrape` signature: `CatchUpRunDeps.runScrape` is `(req: { url; args }) => Promise<Blob>`. To thread `onState`, widen the dep used by `runSyncDownload` to `(req, onState) => Promise<Blob>` (see the test's `runScrape: async () => ...` which ignores the 2nd arg). In `catchUpRun`, the `runScrape` it calls stays `(req) => Promise<Blob>`; `runSyncDownload` adapts by closing over `onScrapeState`. So define `SyncDownloadDeps` separately rather than aliasing `CatchUpRunDeps`:

```ts
export interface SyncDownloadDeps {
  profileId: string;
  runScrape: (req: { url: string; args: string }, onState: (s: string) => void) => Promise<Blob>;
  runImport: CatchUpRunDeps['runImport'];
}
```
and call `deps.runScrape(req, onScrapeState)` as above.

- [ ] **Step 5: Run — PASS.** `npx tsc --noEmit`; regression sweep `npx vitest run test/integration/ test/unit/`.

- [ ] **Step 6: Commit** `feat(sync): runSyncDownload (series shell + background-bar tracking + pendingCatchUp lifecycle)`

---

### Task 5: Live wiring + Settings uses `runSyncDownload`

**Files:** Modify `src/features/sync/defaultCatchUp.ts` (add a token+bar runner), `src/features/library/SettingsPanel.tsx`.

- [ ] **Step 1:** In `defaultCatchUp.ts`, replace/augment `runCatchUp` with a `runDownload(candidate, profileId)` that wires the real deps into `runSyncDownload`:

```ts
import { runSyncDownload } from './syncDownload';
import { tokenRunScrape } from './defaultRunScrape';
import { importToCompletion } from '../import/importController';
import type { CatchUpCandidate } from './catchUp';

/** Live sync download: token scrape (onState → caller) + real import worker. */
export function runDownload(candidate: CatchUpCandidate, profileId: string): Promise<void> {
  return runSyncDownload(candidate, {
    profileId,
    runScrape: (req, onState) => tokenRunScrape(onState)(req),
    runImport: importToCompletion,
  });
}
```
(Keep `runCatchUp` if other code references it, else remove it and update callers.)

- [ ] **Step 2:** In `SettingsPanel.tsx`: the catch-up list's Fetch now calls `runDownload(c, activeProfileId)`. Derive the in-progress/disabled state from the background store instead of the local `fetching` flag:

```tsx
const bgBusy = useBackgroundStore((s) => s.current !== null);
// ...
<button disabled={bgBusy} onClick={() => void handleFetchOne(c)}>
  {bgBusy ? 'Working…' : 'Fetch'}
</button>
```
`handleFetchOne` keeps the optimistic `setCatchUps(prev => prev.filter(...))` on success and `setSyncError` on failure, but drops its own `setFetching` (the bar owns progress now). Import `useBackgroundStore` from `'../background/background.store'`.

- [ ] **Step 3:** `npx tsc --noEmit` clean; `npx vitest run` green (no test targets this UI directly).

- [ ] **Step 4: Commit** `feat(sync): Settings catch-up uses runSyncDownload + global progress`

---

### Task 6: Series-page resume + unified auth

**Files:** Modify `src/features/series/SeriesScreen.tsx`.

- [ ] **Step 1:** Read the current "Update from source" handler (around lines 380-405) and the render of its trigger. Add, when `currentSeries.pendingCatchUp` is set, a **"Resume download"** action that calls `runDownload` with a candidate built from the stored marker:

```tsx
import { runDownload } from '../sync/defaultCatchUp';
import { isEnrolled } from '../sync/syncCreds';
// ...
async function handleResumeDownload() {
  const pcu = currentSeries.pendingCatchUp;
  if (!pcu) return;
  const last = await db.chapters.where('[seriesId+order]').between([seriesId, -Infinity], [seriesId, Infinity]).last();
  await runDownload({
    sourceUrl: currentSeries.sourceUrl!,
    syncedChapter: pcu.syncedChapter,
    syncedPage: pcu.syncedPage,
    seriesId,
    maxOrder: last?.order ?? 0,
    initial: !currentSeries.caughtUp,
    state: last ? 'behind' : 'missing',
  }, profileId);
}
```
Render a "Resume download" button (with the existing button styling) when `currentSeries.pendingCatchUp != null`, disabled while `bgRunning`.

- [ ] **Step 2:** Route the existing **"Update from source"** through the same runner so it gets the scrape progress bar. When `isEnrolled()`, build a candidate (`initial: false` since the series is present and not a fresh catch-up — a plain update) and call `runDownload`. When not enrolled, keep the current OTP path (`updateFromSource` + `defaultRunScrape`). Concretely, in the update handler: if `isEnrolled()` → `await runDownload({ sourceUrl, syncedChapter: maxKnownOrder+1, syncedPage: 0, seriesId, maxOrder: maxKnownOrder, initial: false, state: 'behind' }, profileId)` (the `initial:false` path uses `computeUpdateArgs(maxOrder)` → `localMax+1 → latest`, no prune); else the existing OTP flow unchanged.

- [ ] **Step 3:** `npx tsc --noEmit` clean; `npx vitest run` green; manually confirm the screen renders (build).

- [ ] **Step 4: Commit** `feat(series): resume pending catch-up + token-auth update via runSyncDownload`

---

### Task 7: Incomplete-series badge

**Files:** Modify `src/features/library/SeriesCard.tsx` (and/or `ContinueCard.tsx`).

- [ ] **Step 1:** When `series.pendingCatchUp != null`, render a small "Downloading…/Incomplete" badge on the card (reuse the existing badge/cleared-state styling; a shell series has `chapterCount: 0` and may show the `lastKnownMaxOrder` breadcrumb — keep that). No logic beyond the conditional.

- [ ] **Step 2:** `npx tsc --noEmit` clean; `npx vitest run` green; build.

- [ ] **Step 3: Commit** `feat(library): incomplete badge for a pending-catch-up series`

---

## Phase 2 — Pipelined download queue (parallel)

### Task 8: `downloadQueue` module

**Files:** Create `src/features/sync/downloadQueue.ts`; Test `test/integration/downloadQueue.test.ts`.

The queue pipelines: one scrape in flight ahead of a **serial import lane**, a single aggregate `useBackgroundStore` "batch" task, per-item failures don't abort the batch.

- [ ] **Step 1: Failing test** — enqueue 3 candidates with fakes; assert all 3 series end up imported, imports never overlap (a shared "import in progress" flag is never true twice concurrently), one item failing leaves its `pendingCatchUp` set while the others complete, and exactly one background task existed during the batch and is cleared at the end. (Use injected fakes + small awaitable deferreds to assert the scrape-ahead pipeline: item 2's scrape starts before item 1's import resolves.)

```ts
// shape (fill in deferred helpers):
it('pipelines: scrape-ahead of a serial import lane, batch task, failures isolated', async () => {
  // enqueue [a, b, c]; fake runDownloadItem records start/end of scrape & import phases
  // assert: importsOverlapped === false; b.scrapeStart < a.importEnd (pipeline);
  //         a,c imported; b (made to throw in scrape) kept pendingCatchUp; bar cleared.
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** `src/features/sync/downloadQueue.ts`:

```ts
import { useBackgroundStore } from '../background/background.store';
import { uuid } from '../../lib/uuid';
import type { CatchUpCandidate } from './catchUp';

export interface QueueDeps {
  /** Scrape one candidate → blob (token auth); reports state via onState. */
  scrape: (c: CatchUpCandidate, onState: (s: string) => void) => Promise<Blob>;
  /** Import one blob into the (shelled) series; resolves on completion. */
  importBlob: (c: CatchUpCandidate, blob: Blob) => Promise<void>;
  /** Ensure shell + pendingCatchUp before scrape; returns the resolved candidate. */
  prepare: (c: CatchUpCandidate) => Promise<CatchUpCandidate>;
  /** Finalize after import: prune/position/flag + clear pendingCatchUp on done. */
  finalize: (c: CatchUpCandidate) => Promise<void>;
}

interface QueueState { items: CatchUpCandidate[]; done: number; failed: number; }

let running: Promise<void> | null = null;
let pending: CatchUpCandidate[] = [];
let deps: QueueDeps | null = null;

/** Enqueue candidates; starts the pipeline if idle. Returns when the batch ends. */
export function enqueueDownloads(items: CatchUpCandidate[], d: QueueDeps): Promise<void> {
  deps = d;
  pending.push(...items);
  if (!running) running = runBatch().finally(() => { running = null; pending = []; deps = null; });
  return running;
}

async function runBatch(): Promise<void> {
  const d = deps!;
  const total = pending.length;
  const taskId = `sync-download:${uuid()}`;
  const owned = useBackgroundStore.getState().start({
    id: taskId, kind: 'sync-download', label: `Downloading ${total} series`, subLabel: '', progress: 0,
  });
  const st: QueueState = { items: [...pending], done: 0, failed: 0 };

  // Scrape-ahead: prefetch the next blob while the current imports.
  let prefetch: Promise<{ c: CatchUpCandidate; blob: Blob } | { c: CatchUpCandidate; err: unknown }> | null = null;
  const startScrape = (idx: number) => {
    if (idx >= st.items.length) return null;
    const c = st.items[idx]!;
    return (async () => {
      try {
        const resolved = await d.prepare(c);
        const blob = await d.scrape(resolved, (s) => owned && useBackgroundStore.getState().update({ subLabel: `${resolved.sourceUrl} — ${s}` }));
        return { c: resolved, blob };
      } catch (err) { return { c, err }; }
    })();
  };

  try {
    prefetch = startScrape(0);
    for (let i = 0; i < st.items.length; i++) {
      const res = await prefetch!;
      prefetch = startScrape(i + 1); // begin next scrape BEFORE importing current
      if (owned) useBackgroundStore.getState().update({
        label: `Downloading ${i + 1} of ${total}`, progress: i / total,
      });
      if ('err' in res) { st.failed++; continue; } // keeps its pendingCatchUp
      try {
        await d.importBlob(res.c, res.blob); // serial import lane
        await d.finalize(res.c);
        st.done++;
      } catch { st.failed++; }
    }
  } finally {
    if (owned) useBackgroundStore.getState().finish(taskId);
  }
}
```

- [ ] **Step 4: Run — PASS.** `npx tsc --noEmit`.

- [ ] **Step 5: Commit** `feat(sync): pipelined download queue (scrape-ahead + serial import lane)`

---

### Task 9: Wire the queue to "Fetch all" + a live queue adapter

**Files:** Modify `src/features/sync/defaultCatchUp.ts` (queue deps), `src/features/library/SettingsPanel.tsx`.

- [ ] **Step 1:** In `defaultCatchUp.ts`, add `enqueueLiveDownloads(items, profileId)` that builds `QueueDeps` from the real pieces, splitting `runSyncDownload`'s internals into `prepare`/`scrape`/`importBlob`/`finalize` (reuse the same shell-creation + `catchUpRun` finalize logic; factor shared helpers out of `syncDownload.ts` so both the single-run and the queue use them — no duplicated prune/position/flag logic).

- [ ] **Step 2:** In `SettingsPanel.tsx`, `handleFetchAll` calls `enqueueLiveDownloads([...catchUps], activeProfileId)` (one batch) instead of looping `await handleFetchOne`. Single Fetch can stay `runDownload` (a 1-item queue) for a consistent bar. Optimistically clear the list; rely on the next "Sync now" to re-derive.

- [ ] **Step 3:** `npx tsc --noEmit` clean; `npx vitest run` green.

- [ ] **Step 4: Commit** `feat(sync): Fetch all enqueues a pipelined batch`

---

### Task 10: Queue edge tests

**Files:** Extend `test/integration/downloadQueue.test.ts`.

- [ ] **Step 1:** Add tests: empty enqueue is a no-op (no bar); enqueue while a batch runs appends to it (single batch task, not two); a `finalize` returning without clearing pendingCatchUp (incomplete) leaves the marker; the bar `progress` advances monotonically and clears at the end.
- [ ] **Step 2: Run — PASS.** **Commit** `test(sync): download queue edge cases`

---

## Phase 3 — Background sync (resume across app close)

### Task 11: Switch PWA to `injectManifest` + custom `src/sw.ts`

**Files:** Modify `vite.config.*`, create `src/sw.ts`, adjust `src/ui/UpdatePrompt.tsx` if needed.

- [ ] **Step 1:** Change the `VitePWA({...})` options from `strategies: 'generateSW'` to `strategies: 'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.ts'`, keeping `registerType: 'prompt'`. Move the existing `workbox` runtime-caching config into the new SW.

- [ ] **Step 2:** Create `src/sw.ts` that precaches the injected manifest and re-creates the prior runtime caching (Workbox `precacheAndRoute(self.__WB_MANIFEST)` + the existing routes). This is the baseline (no sync handlers yet) — the goal of this task is parity with the current SW under injectManifest.

```ts
/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
declare let self: ServiceWorkerGlobalScope;
precacheAndRoute(self.__WB_MANIFEST);
// re-add the prior runtime caching routes here (port from the old workbox config)
self.addEventListener('message', (e) => { if (e.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
```

- [ ] **Step 3:** `npx vite build` MUST succeed and emit `dist/sw.js` with a precache manifest. Confirm `useRegisterSW` (UpdatePrompt) still works (prompt registration unchanged). Smoke: `npm run preview` if quick, else rely on build output.

- [ ] **Step 4: Commit** `build(pwa): switch to injectManifest with custom src/sw.ts (parity)`

---

### Task 12: Auto-resume pending downloads on launch

**Files:** Create `src/features/sync/resumeDownloads.ts`; wire into app bootstrap (where `startImportBridge`/stores init — likely `src/App.tsx` or a bootstrap effect). Test `test/integration/resumeDownloads.test.ts`.

- [ ] **Step 1: Failing test** — seed two series with `pendingCatchUp` (one with sourceUrl, one without), set creds + base, call `resumePendingDownloads(profileId, enqueueFake)` and assert only the sourceUrl one is enqueued, and nothing enqueues when not enrolled.

- [ ] **Step 2: Implement** `resumeDownloads.ts`:

```ts
import { db } from '../../db/db';
import { isEnrolled } from './syncCreds';
import { getApiBase } from './piClient';
import type { CatchUpCandidate } from './catchUp';

/** Build catch-up candidates from series that have a pending (interrupted)
 *  catch-up, for auto-resume on launch. Best-effort: [] when not enrolled / no base. */
export async function pendingDownloadCandidates(profileId: string): Promise<CatchUpCandidate[]> {
  if (!isEnrolled() || !getApiBase()) return [];
  const series = await db.series.where('profileId').equals(profileId).toArray();
  const out: CatchUpCandidate[] = [];
  for (const s of series) {
    if (!s.pendingCatchUp || !s.sourceUrl) continue;
    const last = await db.chapters.where('[seriesId+order]').between([s.id, -Infinity], [s.id, Infinity]).last();
    out.push({
      sourceUrl: s.sourceUrl, syncedChapter: s.pendingCatchUp.syncedChapter, syncedPage: s.pendingCatchUp.syncedPage,
      seriesId: s.id, maxOrder: last?.order ?? 0, initial: !s.caughtUp, state: last ? 'behind' : 'missing',
    });
  }
  return out;
}
```
Add `resumePendingDownloads(profileId, enqueue)` that calls `pendingDownloadCandidates` and, if non-empty, `enqueue(candidates)`.

- [ ] **Step 3: Wire** into app bootstrap: after the active profile is known on launch, call `resumePendingDownloads(activeProfileId, (items) => enqueueLiveDownloads(items, activeProfileId))`. Fire-and-forget (best-effort). Guard so it runs once per launch.

- [ ] **Step 4: Run — PASS.** `npx tsc --noEmit`; `npx vitest run`.

- [ ] **Step 5: Commit** `feat(sync): auto-resume interrupted downloads on launch`

---

### Task 13: Service Worker sync registration + handler

**Files:** Modify `src/sw.ts`, create `src/features/sync/backgroundSync.ts`, wire registration.

- [ ] **Step 1:** `backgroundSync.ts` — feature-detected registration helpers:

```ts
/** Register a one-off Background Sync to nudge resumption when supported. No-op
 *  where unavailable (e.g. iOS Safari) — auto-resume-on-launch covers those. */
export async function registerResumeSync(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.ready;
    // @ts-expect-error sync is not in the default SW types
    if (reg && 'sync' in reg) await reg.sync.register('verreaux-resume-downloads');
  } catch { /* unsupported — rely on launch resume */ }
}
```
Call `registerResumeSync()` whenever a download is left pending (e.g. at the end of `runBatch`/on failure when any item kept `pendingCatchUp`).

- [ ] **Step 2:** In `src/sw.ts`, add the `sync` handler that wakes/focuses a client so the page resumes (it does NOT run the import):

```ts
self.addEventListener('sync', (event: any) => {
  if (event.tag !== 'verreaux-resume-downloads') return;
  event.waitUntil((async () => {
    const clientsArr = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clientsArr[0]) { await clientsArr[0].focus().catch(() => {}); clientsArr[0].postMessage({ type: 'RESUME_DOWNLOADS' }); }
    // else: a notification could be shown if permission is granted (optional).
  })());
});
```
In the app, listen for `RESUME_DOWNLOADS` from the SW (`navigator.serviceWorker.addEventListener('message', ...)`) and call `resumePendingDownloads(...)`.

- [ ] **Step 3 (optional, feature-detected):** Periodic Background Sync `verreaux-check-updates` registration + `periodicsync` handler that posts a `CHECK_UPDATES` message → app pulls positions. Guard on permission + support; skip cleanly where unavailable.

- [ ] **Step 4:** `npx vite build` succeeds (SW compiles with the handlers). Manual note in the commit that `sync`/`periodicsync` are best-effort and unsupported on some browsers.

- [ ] **Step 5: Commit** `feat(pwa): background-sync nudge to resume downloads`

---

## Self-Review

**Spec coverage:** Series shell + `pendingCatchUp` (T1) → runner with bar tracking (T4) → Settings (T5) → series-page resume + unified token auth (T6) → badge (T7); placeholder title (T2); catchUpRun outcome (T3); parallel pipelined queue (T8-10); background sync — injectManifest (T11), auto-resume (T12), SW sync nudge (T13). All spec sections A–F covered.

**Placeholder scan:** Task 8 Step 1 and Task 10 give test *shapes* with described assertions rather than full code (the deferred-promise pipeline harness is fiddly); the implementer writes the deferreds. Flagged, not hidden. Everything else has concrete code.

**Type consistency:** `CatchUpCandidate` fields are reused unchanged across T4/T6/T8/T12. `runSyncDownload`'s `SyncDownloadDeps.runScrape` is `(req, onState) => Promise<Blob>` (note in T4) vs `catchUpRun`'s `(req) => Promise<Blob>` — adapted via closure. `pendingCatchUp` shape is identical in types.ts, repo, runner, resume. `catchUpRun` returns `'done' | 'incomplete'` (T3) consumed in T4.

**Ordering:** Phases strictly ordered (1→2→3). T9 depends on T8 + T4 refactor; T12/T13 depend on T11 + the queue. Recommended order = task number.
