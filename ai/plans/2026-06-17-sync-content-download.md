# Sync-Driven Content Download (PWA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a device pulls a synced reading position for a series it is **missing** or **behind** on, let the user download the content via the carried `sourceUrl` — fetching `syncedChapter → latest`, pruning chapters below the synced chapter on the first (initial) catch-up, and reusing the existing update path on later syncs.

**Architecture:** A pure classifier turns pulled server positions + a local series index into catch-up candidates (missing / behind). The sync UI lists them with per-series **Fetch** + **Fetch all**. A catch-up orchestrator fetches with the device token (no OTP — see Plan A), awaits the import worker, then — only on a series' initial catch-up — prunes chapters below the synced chapter, sets the reading position, and marks the series `caughtUp`. Later syncs of a `caughtUp` series fetch `localMax+1 → latest` with no prune.

**Tech Stack:** TypeScript (Vite, no-extension imports), Dexie, zustand, React, vitest (jsdom + fake-indexeddb).

**Depends on Plan A** (`scraper/ai/plans/2026-06-17-scrape-device-token-auth.md`): the `/scrape` device-token auth must be deployed for token-authed catch-up downloads to succeed against the live Pi. The PWA code can be built and unit-tested before the Pi is redeployed.

**Spec:** `app/ai/specs/2026-06-17-sync-content-download-design.md`

---

### Task 1: `Series.caughtUp` field + Dexie v6 migration

**Files:**
- Modify: `src/db/types.ts` (Series interface)
- Modify: `src/db/db.ts` (add version 6)
- Test: `test/integration/caughtUpMigration.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/integration/caughtUpMigration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries } from '../../src/db/repos/series.repo';

const PROFILE = 'p-mig';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({
    id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now(),
  });
});

describe('caughtUp field', () => {
  it('defaults new series to caughtUp=false', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null });
    const fresh = await db.series.get(s.id);
    expect(fresh?.caughtUp).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/JLAJ9408/Documents/Verreaux/app && npx vitest run test/integration/caughtUpMigration.test.ts`
Expected: FAIL — `caughtUp` is `undefined` (field/default not added yet).

- [ ] **Step 3: Add the field to `src/db/types.ts`**

In the `Series` interface, after the `sourceUrl` field, add:

```ts
  /**
   * Whether this device has completed its one-time sync catch-up for the
   * series. `false` until an initial catch-up runs (which prunes chapters
   * below the synced position); `true` afterward, so later syncs use the
   * no-prune update path. New series and existing rows both default to false.
   */
  caughtUp?: boolean;
```

- [ ] **Step 4: Add the v6 migration to `src/db/db.ts`**

After the `this.version(5)...` block (and before the closing `}` of the constructor), add:

```ts
    // v6 — `Series.caughtUp`: marks a series' one-time sync catch-up as done.
    // Non-indexed field; backfill existing rows to false (not yet caught up),
    // so a series that is genuinely behind a shared position still gets its
    // initial windowed catch-up. A pace-setter is never behind, so this never
    // causes an unwanted prune.
    this.version(6).upgrade(async (tx) => {
      await tx
        .table('series')
        .toCollection()
        .modify((s: Record<string, unknown>) => {
          if (s['caughtUp'] === undefined) s['caughtUp'] = false;
        });
    });
```

- [ ] **Step 5: Default the field in `createSeries` (`src/db/repos/series.repo.ts`)**

In the `series` object literal inside `createSeries`, after `sourceUrl: input.sourceUrl ?? null,` add:

```ts
    caughtUp: false,
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd /Users/JLAJ9408/Documents/Verreaux/app && npx vitest run test/integration/caughtUpMigration.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/JLAJ9408/Documents/Verreaux/app
git add src/db/types.ts src/db/db.ts src/db/repos/series.repo.ts test/integration/caughtUpMigration.test.ts
git commit -m "feat(db): add Series.caughtUp + v6 migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Repo primitives — `setCaughtUp` + `deleteChaptersBelowOrder`

**Files:**
- Modify: `src/db/repos/series.repo.ts` (add `setCaughtUp`, `deleteChaptersBelowOrder`)
- Test: `test/integration/deleteChaptersBelowOrder.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/integration/deleteChaptersBelowOrder.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries, setCaughtUp, deleteChaptersBelowOrder } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';

const PROFILE = 'p-prune';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now() });
});

async function seedChapter(seriesId: string, order: number) {
  const ch = await createChapter({ seriesId, profileId: PROFILE, title: `c${order}`, order, pageCount: 1 });
  const blobId = `blob-${seriesId}-${order}`;
  await db.blobs.add({ id: blobId, blob: new Blob(['x']) });
  await db.pages.add({ id: `pg-${seriesId}-${order}`, chapterId: ch.id, pageNumber: 0, blobId });
  return ch;
}

describe('deleteChaptersBelowOrder', () => {
  it('deletes chapters strictly below the order, keeping the synced chapter and above', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null });
    for (const o of [1, 30, 49, 60]) await seedChapter(s.id, o);
    await db.series.update(s.id, { chapterCount: 4 });

    const removed = await deleteChaptersBelowOrder(s.id, 49);

    expect(removed).toBe(2); // orders 1 and 30
    const orders = (await db.chapters.where('seriesId').equals(s.id).toArray()).map((c) => c.order).sort((a, b) => a - b);
    expect(orders).toEqual([49, 60]);
    expect(await db.blobs.count()).toBe(2); // blobs for 1 and 30 gone
    expect((await db.series.get(s.id))?.chapterCount).toBe(2);
  });

  it('is a no-op when nothing is below the order', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'B', coverImageId: null });
    await seedChapter(s.id, 49);
    expect(await deleteChaptersBelowOrder(s.id, 49)).toBe(0);
  });

  it('setCaughtUp flips the flag', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'C', coverImageId: null });
    await setCaughtUp(s.id);
    expect((await db.series.get(s.id))?.caughtUp).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/JLAJ9408/Documents/Verreaux/app && npx vitest run test/integration/deleteChaptersBelowOrder.test.ts`
Expected: FAIL — `setCaughtUp` / `deleteChaptersBelowOrder` not exported.

- [ ] **Step 3: Implement both in `src/db/repos/series.repo.ts`**

Add near `setSourceUrl` (after it):

```ts
export async function setCaughtUp(seriesId: string): Promise<void> {
  await db.series.update(seriesId, { caughtUp: true });
}
```

Add after `deleteReadChapters` (it reuses `DELETE_BATCH_SIZE`, `yieldToReads`, both already in scope):

```ts
/**
 * Delete every chapter in the series whose `order` is STRICTLY BELOW `order`
 * (the synced chapter is kept). Used by the initial sync catch-up to keep only
 * the window from the synced position onward. Mirrors deleteReadChapters'
 * chunked blob/page deletion + records-tx pattern. Returns chapters removed.
 */
export async function deleteChaptersBelowOrder(
  seriesId: string,
  order: number,
): Promise<number> {
  // [-Infinity, order) — lower-inclusive, upper-exclusive: keeps `order`.
  const doomed = await db.chapters
    .where('[seriesId+order]')
    .between([seriesId, -Infinity], [seriesId, order], true, false)
    .toArray();
  const chapterIds = doomed.map((c) => c.id);
  if (chapterIds.length === 0) return 0;

  const pages = await db.pages.where('chapterId').anyOf(chapterIds).toArray();
  const blobIds = pages.map((p) => p.blobId);

  for (let i = 0; i < blobIds.length; i += DELETE_BATCH_SIZE) {
    await db.blobs.bulkDelete(blobIds.slice(i, i + DELETE_BATCH_SIZE));
    await yieldToReads();
  }
  const pageIds = pages.map((p) => p.id);
  for (let i = 0; i < pageIds.length; i += DELETE_BATCH_SIZE) {
    await db.pages.bulkDelete(pageIds.slice(i, i + DELETE_BATCH_SIZE));
    await yieldToReads();
  }

  await db.transaction('rw', [db.series, db.chapters, db.bookmarks], async () => {
    await db.bookmarks.where('chapterId').anyOf(chapterIds).delete();
    await db.chapters.where('id').anyOf(chapterIds).delete();
    const newCount = await db.chapters.where('seriesId').equals(seriesId).count();
    await db.series.update(seriesId, { chapterCount: newCount });
  });

  return chapterIds.length;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/JLAJ9408/Documents/Verreaux/app && npx vitest run test/integration/deleteChaptersBelowOrder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/JLAJ9408/Documents/Verreaux/app
git add src/db/repos/series.repo.ts test/integration/deleteChaptersBelowOrder.test.ts
git commit -m "feat(db): setCaughtUp + deleteChaptersBelowOrder primitives

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Device-token scrape path in the client

**Files:**
- Modify: `src/features/sync/piClient.ts` (`ScrapeRequest`, `postScrape`)
- Modify: `src/features/sync/defaultRunScrape.ts` (add `tokenRunScrape`)
- Test: `test/unit/piClient.test.ts` (extend; create if absent)

- [ ] **Step 1: Write the failing test**

Add to `test/unit/piClient.test.ts` (use a string body so the mock works on CI Node — a prior bug was using a jsdom Blob whose `.stream()` is missing):

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { setApiBase, postScrape } from '../../src/features/sync/piClient';

afterEach(() => { vi.unstubAllGlobals(); });

describe('postScrape device token', () => {
  it('sends Authorization: Bearer when deviceToken is provided', async () => {
    setApiBase('http://pi:8080');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'job1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const id = await postScrape({ url: 'https://x/s', args: '--from 49 --to latest', otp: '', deviceToken: 'tok-plain' });
    expect(id).toBe('job1');
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-plain');
  });

  it('omits Authorization when no deviceToken', async () => {
    setApiBase('http://pi:8080');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'job2' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await postScrape({ url: 'https://x/s', args: '', otp: '123456' });
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/JLAJ9408/Documents/Verreaux/app && npx vitest run test/unit/piClient.test.ts`
Expected: FAIL — `deviceToken` not on `ScrapeRequest`, header never set.

- [ ] **Step 3: Add `deviceToken` to `postScrape` (`src/features/sync/piClient.ts`)**

Replace the `ScrapeRequest` interface and `postScrape` with:

```ts
export interface ScrapeRequest {
  url: string;
  args: string;
  otp: string;
  type?: 'scrape' | 'probe';
  /** When set, sent as `Authorization: Bearer` so the Pi authorizes the scrape
   *  by device token (sync-driven catch-up) instead of an OTP. */
  deviceToken?: string;
}

export async function postScrape(req: ScrapeRequest): Promise<string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (req.deviceToken) headers.authorization = `Bearer ${req.deviceToken}`;
  const res = await fetch(`${requireBase()}/scrape`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: req.url, args: req.args, type: req.type ?? 'scrape', otp: req.otp }),
  });
  if (res.status === 401) throw new Error('Invalid authenticator code or device token.');
  if (!res.ok) throw new Error(`Scrape request failed (${res.status}).`);
  return ((await res.json()) as { id: string }).id;
}
```

- [ ] **Step 4: Add `tokenRunScrape` to `src/features/sync/defaultRunScrape.ts`**

Append (keeps `defaultRunScrape` untouched for the OTP flows):

```ts
import { getSyncCreds } from './syncCreds';

/** A catch-up runner authenticated by the enrolled device's sync token (no OTP).
 *  Throws if the device is not enrolled. `onState` receives each polled state. */
export function tokenRunScrape(
  onState: (s: string) => void,
): (req: { url: string; args: string }) => Promise<Blob> {
  return (req) => {
    const creds = getSyncCreds();
    if (!creds) throw new Error('This device is not enrolled for sync.');
    const deps: RunScrapeDeps = {
      postScrape,
      getRunStatus,
      getRunZip,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      onState,
    };
    return runScrapeToBlob(
      { url: req.url, args: req.args, otp: '', type: 'scrape', deviceToken: creds.deviceToken },
      deps,
    );
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/JLAJ9408/Documents/Verreaux/app && npx vitest run test/unit/piClient.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/JLAJ9408/Documents/Verreaux/app
git add src/features/sync/piClient.ts src/features/sync/defaultRunScrape.ts test/unit/piClient.test.ts
git commit -m "feat(sync): device-token scrape path (tokenRunScrape)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Pure catch-up classifier + local series index

**Files:**
- Create: `src/features/sync/catchUp.ts`
- Test: `test/unit/catchUp.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/unit/catchUp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyCatchUp, type LocalSeriesInfo } from '../../src/features/sync/catchUp';
import type { ServerPosition } from '../../src/features/sync/syncClient';

function srv(sourceUrl: string, chapterOrder: number): ServerPosition {
  return { sourceUrl, chapterOrder, pageIndex: 3, manuallyMarked: false, updatedAt: 't' };
}

describe('classifyCatchUp', () => {
  it('flags a missing series (no local row) as an initial missing candidate', () => {
    const out = classifyCatchUp([srv('u/a', 49)], new Map());
    expect(out).toEqual([
      { sourceUrl: 'u/a', syncedChapter: 49, syncedPage: 3, seriesId: null, maxOrder: null, initial: true, state: 'missing' },
    ]);
  });

  it('flags a behind series (synced > localMax) as a candidate; initial = !caughtUp', () => {
    const idx = new Map<string, LocalSeriesInfo>([['u/a', { seriesId: 's1', maxOrder: 30, caughtUp: false }]]);
    expect(classifyCatchUp([srv('u/a', 49)], idx)).toEqual([
      { sourceUrl: 'u/a', syncedChapter: 49, syncedPage: 3, seriesId: 's1', maxOrder: 30, initial: true, state: 'behind' },
    ]);
    const idx2 = new Map<string, LocalSeriesInfo>([['u/a', { seriesId: 's1', maxOrder: 30, caughtUp: true }]]);
    expect(classifyCatchUp([srv('u/a', 49)], idx2)[0].initial).toBe(false);
  });

  it('does NOT flag a series that is at or ahead of the synced position', () => {
    const idx = new Map<string, LocalSeriesInfo>([['u/a', { seriesId: 's1', maxOrder: 60, caughtUp: false }]]);
    expect(classifyCatchUp([srv('u/a', 49)], idx)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/JLAJ9408/Documents/Verreaux/app && npx vitest run test/unit/catchUp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/features/sync/catchUp.ts`**

```ts
import { db } from '../../db/db';
import type { ServerPosition } from './syncClient';

export interface LocalSeriesInfo {
  seriesId: string;
  /** Highest local chapter order; 0 when the series has no chapters. */
  maxOrder: number;
  caughtUp: boolean;
}

export interface CatchUpCandidate {
  sourceUrl: string;
  syncedChapter: number;
  syncedPage: number;
  /** null when the series is missing locally. */
  seriesId: string | null;
  /** null when missing. */
  maxOrder: number | null;
  /** true → initial windowed catch-up (prune below synced); false → plain update. */
  initial: boolean;
  state: 'missing' | 'behind';
}

/**
 * Classify pulled server positions into catch-up candidates. A position is a
 * candidate when the series is missing locally, or the synced chapter is
 * strictly ahead of the local maximum (behind). A series at or ahead of the
 * synced position is the pace-setter and is left alone. `initial` is true for
 * missing series and for behind series this device has not yet caught up.
 */
export function classifyCatchUp(
  server: ServerPosition[],
  index: Map<string, LocalSeriesInfo>,
): CatchUpCandidate[] {
  const out: CatchUpCandidate[] = [];
  for (const s of server) {
    const local = index.get(s.sourceUrl);
    if (!local) {
      out.push({
        sourceUrl: s.sourceUrl, syncedChapter: s.chapterOrder, syncedPage: s.pageIndex,
        seriesId: null, maxOrder: null, initial: true, state: 'missing',
      });
    } else if (s.chapterOrder > local.maxOrder) {
      out.push({
        sourceUrl: s.sourceUrl, syncedChapter: s.chapterOrder, syncedPage: s.pageIndex,
        seriesId: local.seriesId, maxOrder: local.maxOrder, initial: !local.caughtUp, state: 'behind',
      });
    }
    // else: local is at/ahead of synced — pace-setter, nothing to do.
  }
  return out;
}

/** Build the {sourceUrl -> info} index for a profile (series that have a
 *  sourceUrl). maxOrder is the highest chapter order, or 0 for an empty series. */
export async function localSeriesIndexByUrl(profileId: string): Promise<Map<string, LocalSeriesInfo>> {
  const out = new Map<string, LocalSeriesInfo>();
  const series = await db.series.where('profileId').equals(profileId).toArray();
  for (const s of series) {
    if (!s.sourceUrl) continue;
    const top = await db.chapters
      .where('[seriesId+order]')
      .between([s.id, -Infinity], [s.id, Infinity])
      .last();
    out.set(s.sourceUrl, { seriesId: s.id, maxOrder: top?.order ?? 0, caughtUp: s.caughtUp ?? false });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/JLAJ9408/Documents/Verreaux/app && npx vitest run test/unit/catchUp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/JLAJ9408/Documents/Verreaux/app
git add src/features/sync/catchUp.ts test/unit/catchUp.test.ts
git commit -m "feat(sync): catch-up classifier + local series index

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Catch-up orchestration

**Files:**
- Create: `src/features/sync/catchUpRun.ts`
- Modify: `src/features/import/importController.ts` (export `importToCompletion`)
- Test: `test/integration/catchUpRun.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/integration/catchUpRun.test.ts`. The fake `runImport` writes chapters directly (standing in for the worker), so we can assert prune + position + flag without a real ZIP:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';
import { getProgress } from '../../src/db/repos/progress.repo';
import { catchUpRun } from '../../src/features/sync/catchUpRun';
import type { CatchUpCandidate } from '../../src/features/sync/catchUp';

const PROFILE = 'p-run';
const URL_A = 'https://x/a';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now() });
});

async function ch(seriesId: string, order: number, pageCount = 5) {
  await createChapter({ seriesId, profileId: PROFILE, title: `c${order}`, order, pageCount });
}

it('initial behind catch-up: fetch window, prune below synced, set position, set caughtUp', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  for (const o of [1, 15, 30]) await ch(s.id, o); // local 1..30
  let scraped = '';
  const candidate: CatchUpCandidate = {
    sourceUrl: URL_A, syncedChapter: 49, syncedPage: 2, seriesId: s.id, maxOrder: 30, initial: true, state: 'behind',
  };
  await catchUpRun(candidate, {
    profileId: PROFILE,
    runScrape: async (req) => { scraped = req.args; return new Blob(['zip']); },
    runImport: async () => { await ch(s.id, 49); await ch(s.id, 50); }, // window arrives
  });
  expect(scraped).toBe('--from 49 --to latest');
  const orders = (await db.chapters.where('seriesId').equals(s.id).toArray()).map((c) => c.order).sort((a, b) => a - b);
  expect(orders).toEqual([49, 50]); // 1,15,30 pruned
  const prog = await getProgress(PROFILE, s.id);
  const cur = await db.chapters.get(prog!.currentChapterId);
  expect(cur?.order).toBe(49);
  expect(prog?.pageIndex).toBe(2);
  expect((await db.series.get(s.id))?.caughtUp).toBe(true);
});

it('missing catch-up: import creates the series, no prune, caughtUp set', async () => {
  const candidate: CatchUpCandidate = {
    sourceUrl: URL_A, syncedChapter: 49, syncedPage: 0, seriesId: null, maxOrder: null, initial: true, state: 'missing',
  };
  await catchUpRun(candidate, {
    profileId: PROFILE,
    runScrape: async () => new Blob(['zip']),
    runImport: async () => {
      const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
      await ch(s.id, 49);
    },
  });
  const s = (await db.series.where('profileId').equals(PROFILE).toArray()).find((x) => x.sourceUrl === URL_A);
  expect(s?.caughtUp).toBe(true);
});

it('does NOT prune when the fetch throws', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  for (const o of [1, 15, 30]) await ch(s.id, o);
  const candidate: CatchUpCandidate = {
    sourceUrl: URL_A, syncedChapter: 49, syncedPage: 0, seriesId: s.id, maxOrder: 30, initial: true, state: 'behind',
  };
  await expect(catchUpRun(candidate, {
    profileId: PROFILE,
    runScrape: async () => { throw new Error('scrape failed'); },
    runImport: async () => { throw new Error('should not import'); },
  })).rejects.toThrow(/scrape failed/);
  const orders = (await db.chapters.where('seriesId').equals(s.id).toArray()).map((c) => c.order).sort((a, b) => a - b);
  expect(orders).toEqual([1, 15, 30]); // nothing pruned
});

it('subsequent (caughtUp) update: fetch from localMax+1, no prune', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: URL_A });
  await db.series.update(s.id, { caughtUp: true });
  for (const o of [49, 50]) await ch(s.id, o);
  let scraped = '';
  const candidate: CatchUpCandidate = {
    sourceUrl: URL_A, syncedChapter: 70, syncedPage: 1, seriesId: s.id, maxOrder: 50, initial: false, state: 'behind',
  };
  await catchUpRun(candidate, {
    profileId: PROFILE,
    runScrape: async (req) => { scraped = req.args; return new Blob(['zip']); },
    runImport: async () => { await ch(s.id, 70); },
  });
  expect(scraped).toBe('--from 51 --to latest'); // localMax(50)+1
  const orders = (await db.chapters.where('seriesId').equals(s.id).toArray()).map((c) => c.order).sort((a, b) => a - b);
  expect(orders).toEqual([49, 50, 70]); // no prune
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/JLAJ9408/Documents/Verreaux/app && npx vitest run test/integration/catchUpRun.test.ts`
Expected: FAIL — `catchUpRun` module not found.

- [ ] **Step 3: Export `importToCompletion` from `src/features/import/importController.ts`**

Add at the end of the file (reuses `useImportStore` + `startImport` already in this module):

```ts
/**
 * Start an import and resolve when it finishes, reject on error / quota stall.
 * Used by the sync catch-up orchestrator, which must run prune + position
 * updates AFTER the import worker has written the fetched chapters.
 */
export function importToCompletion(args: StartArgs): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const unsub = useImportStore.subscribe((store) => {
      const st = store.state.status;
      if (st === 'success') { unsub(); resolve(); }
      else if (st === 'error') { unsub(); reject(new Error((store.state as { message?: string }).message ?? 'Import failed.')); }
      else if (st === 'cancelled') { unsub(); reject(new Error('Import cancelled.')); }
      else if (st === 'quota-warning') { unsub(); reject(new Error('Not enough storage to import. Free space and retry.')); }
    });
    startImport(args);
  });
}
```

- [ ] **Step 4: Implement `src/features/sync/catchUpRun.ts`**

```ts
import { db } from '../../db/db';
import { deleteChaptersBelowOrder, setCaughtUp } from '../../db/repos/series.repo';
import { upsertProgress } from '../../db/repos/progress.repo';
import { buildScrapeArgs } from './scrapeArgs';
import { computeUpdateArgs } from './updateArgs';
import type { CatchUpCandidate } from './catchUp';
import type { ImportContext } from '../import/typeDetector';

export interface CatchUpRunDeps {
  profileId: string;
  /** Token-authed scrape → output ZIP blob (e.g. tokenRunScrape). */
  runScrape: (req: { url: string; args: string }) => Promise<Blob>;
  /** Start an import for the file and resolve when it finishes. */
  runImport: (args: {
    file: File;
    context: ImportContext;
    targetSeriesId?: string;
    activeProfileId: string;
  }) => Promise<void>;
}

/**
 * Fetch + import a catch-up candidate. On an INITIAL catch-up: fetch
 * syncedChapter→latest, then (only after a successful import) prune chapters
 * below the synced chapter, set the reading position to the synced page, and
 * mark the series caughtUp. On a SUBSEQUENT update: fetch localMax+1→latest and
 * set the position — no prune. Throws (without pruning) if the fetch fails.
 */
export async function catchUpRun(candidate: CatchUpCandidate, deps: CatchUpRunDeps): Promise<void> {
  const args = candidate.initial
    ? buildScrapeArgs(String(candidate.syncedChapter), 'latest')
    : computeUpdateArgs(candidate.maxOrder);

  // Fetch first. If this throws, nothing local is touched.
  const blob = await deps.runScrape({ url: candidate.sourceUrl, args });
  const file = new File([blob], 'catchup.zip', { type: 'application/zip' });

  // Import. 'home' creates a new series for a missing candidate; 'series'
  // merges into the existing one (the import pipeline skips existing orders).
  await deps.runImport({
    file,
    context: candidate.seriesId ? 'series' : 'home',
    ...(candidate.seriesId ? { targetSeriesId: candidate.seriesId } : {}),
    activeProfileId: deps.profileId,
  });

  // Resolve the series (a missing candidate now has a row, keyed by sourceUrl).
  const series = candidate.seriesId
    ? await db.series.get(candidate.seriesId)
    : (await db.series.where('profileId').equals(deps.profileId).toArray()).find((s) => s.sourceUrl === candidate.sourceUrl);
  if (!series) throw new Error('Catch-up import did not produce a series.');

  // Prune only on the initial catch-up, only after a successful import.
  if (candidate.initial) {
    await deleteChaptersBelowOrder(series.id, candidate.syncedChapter);
  }

  // Mark the latest page to read at the synced position (clamped to the page
  // count of the now-present chapter). force: advance even over a stale mark.
  const chapter = await db.chapters
    .where('[seriesId+order]')
    .equals([series.id, candidate.syncedChapter])
    .first();
  if (chapter) {
    await upsertProgress({
      profileId: deps.profileId,
      seriesId: series.id,
      currentChapterId: chapter.id,
      pageIndex: Math.min(candidate.syncedPage, Math.max(0, chapter.pageCount - 1)),
      scrollPosition: 0,
      manuallyMarked: false,
      force: true,
    });
  }

  if (candidate.initial) await setCaughtUp(series.id);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/JLAJ9408/Documents/Verreaux/app && npx vitest run test/integration/catchUpRun.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 6: Commit**

```bash
cd /Users/JLAJ9408/Documents/Verreaux/app
git add src/features/sync/catchUpRun.ts src/features/import/importController.ts test/integration/catchUpRun.test.ts
git commit -m "feat(sync): catch-up orchestration (fetch, prune-on-initial, set position)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Surface candidates from `pullAndReconcile` + default catch-up wiring

**Files:**
- Modify: `src/features/sync/positionSync.ts` (`pullAndReconcile` returns candidates)
- Create: `src/features/sync/defaultCatchUp.ts`
- Test: `test/integration/pullCatchUp.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/integration/pullCatchUp.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';
import { setApiBase } from '../../src/features/sync/piClient';
import { setSyncCreds, clearSyncCreds } from '../../src/features/sync/syncCreds';
import { pullAndReconcile } from '../../src/features/sync/positionSync';

const PROFILE = 'p-pull';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: Date.now(), lastActiveAt: Date.now() });
  setApiBase('http://pi:8080');
  setSyncCreds({ accountId: 'a', deviceId: 'd', deviceToken: 't' });
});
afterEach(() => { vi.unstubAllGlobals(); clearSyncCreds(); localStorage.clear(); });

it('returns a behind candidate from a pulled position', async () => {
  const s = await createSeries({ profileId: PROFILE, title: 'A', coverImageId: null, sourceUrl: 'https://x/a' });
  await createChapter({ seriesId: s.id, profileId: PROFILE, title: 'c30', order: 30, pageCount: 5 });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ positions: [{ sourceUrl: 'https://x/a', chapterOrder: 49, pageIndex: 0, manuallyMarked: false, updatedAt: 't' }] }),
    { status: 200 },
  )));
  const candidates = await pullAndReconcile(PROFILE);
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({ sourceUrl: 'https://x/a', syncedChapter: 49, state: 'behind', initial: true });
});

it('returns [] when not enrolled', async () => {
  clearSyncCreds();
  expect(await pullAndReconcile(PROFILE)).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/JLAJ9408/Documents/Verreaux/app && npx vitest run test/integration/pullCatchUp.test.ts`
Expected: FAIL — `pullAndReconcile` returns `void`.

- [ ] **Step 3: Make `pullAndReconcile` return candidates (`src/features/sync/positionSync.ts`)**

Add to the imports at the top:

```ts
import { classifyCatchUp, localSeriesIndexByUrl, type CatchUpCandidate } from './catchUp';
```

Replace the whole `pullAndReconcile` function with:

```ts
/** Pull + reconcile for a profile, returning catch-up candidates (series this
 *  device is missing or behind on). Best-effort: returns [] on error / when not
 *  enrolled. */
export async function pullAndReconcile(profileId: string): Promise<CatchUpCandidate[]> {
  const creds = getSyncCreds();
  if (!creds) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PULL_TIMEOUT_MS);
  try {
    const since = lastPullByProfile.get(profileId) ?? null;
    const server = await getPositions(creds.deviceToken, since, controller.signal);
    const local = await localPositionsByUrl(profileId);
    const updates = reconcilePositions(server, local);
    for (const u of updates) await applyServerPosition(profileId, u);
    lastPullByProfile.set(profileId, new Date().toISOString());
    // Classify AFTER applying: positions don't change chapter content, but this
    // keeps the index read consistent with the just-applied state.
    return classifyCatchUp(server, await localSeriesIndexByUrl(profileId));
  } catch (e) {
    if (e instanceof SyncAuthError) clearSyncCreds();
    return [];
  } finally {
    clearTimeout(timer);
  }
}
```

Note: `since` is `null` only on the first pull of a profile; afterward a `since` filter means `server` omits unchanged positions, so a candidate is surfaced the pull after a position first advances. This matches the position-sync behavior already in place (the candidate shows once there is a *new* server position to act on). The Settings "Sync now" button always pulls and re-shows whatever the server returns for that window.

- [ ] **Step 4: Create `src/features/sync/defaultCatchUp.ts`**

```ts
import { catchUpRun } from './catchUpRun';
import { tokenRunScrape } from './defaultRunScrape';
import { importToCompletion } from '../import/importController';
import type { CatchUpCandidate } from './catchUp';

/** Run one catch-up candidate with live wiring: token-authed scrape + the real
 *  import worker (awaited to completion). `onState` receives polled scrape
 *  states for progress UI. */
export function runCatchUp(
  candidate: CatchUpCandidate,
  profileId: string,
  onState: (s: string) => void = () => {},
): Promise<void> {
  return catchUpRun(candidate, {
    profileId,
    runScrape: tokenRunScrape(onState),
    runImport: importToCompletion,
  });
}
```

- [ ] **Step 5: Fix the `void`-return caller in `src/features/library/library.store.ts`**

`loadLibrary` calls `await pullAndReconcile(profileId);` for its side effects only. It now returns a value, which is fine to ignore — but to keep intent explicit, change line ~58 from:

```ts
    await pullAndReconcile(profileId);
```

to:

```ts
    await pullAndReconcile(profileId); // catch-up candidates are surfaced via Settings → Sync
```

(No behavioral change; the returned array is intentionally unused here.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd /Users/JLAJ9408/Documents/Verreaux/app && npx vitest run test/integration/pullCatchUp.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/JLAJ9408/Documents/Verreaux/app
git add src/features/sync/positionSync.ts src/features/sync/defaultCatchUp.ts src/features/library/library.store.ts test/integration/pullCatchUp.test.ts
git commit -m "feat(sync): pullAndReconcile surfaces catch-up candidates + default wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Catch-up list UI in Settings

**Files:**
- Modify: `src/features/library/SettingsPanel.tsx` (sync section: capture candidates from `handleSyncNow`, render list with Fetch / Fetch all)
- Test: manual (UI) — covered by build + a typecheck; logic is unit-tested in Tasks 4-6.

- [ ] **Step 1: Read the current sync section**

Read `src/features/library/SettingsPanel.tsx` around the sync state (lines ~60-115) and `handleSyncNow` (line ~195-205) so the new state/handlers match the existing style.

- [ ] **Step 2: Add candidate state + imports**

Add to the imports:

```tsx
import { runCatchUp } from '../sync/defaultCatchUp';
import type { CatchUpCandidate } from '../sync/catchUp';
```

Add state near the other sync `useState`s:

```tsx
const [catchUps, setCatchUps] = useState<CatchUpCandidate[]>([]);
const [fetching, setFetching] = useState<string | null>(null); // sourceUrl in progress
```

- [ ] **Step 3: Capture candidates in `handleSyncNow`**

Change the pull call from:

```tsx
      await pullAndReconcile(activeProfileId);
```

to:

```tsx
      const candidates = await pullAndReconcile(activeProfileId);
      setCatchUps(candidates);
```

- [ ] **Step 4: Add the fetch handlers (near `handleSyncNow`)**

```tsx
  const handleFetchOne = async (c: CatchUpCandidate) => {
    setFetching(c.sourceUrl);
    try {
      await runCatchUp(c, activeProfileId);
      setCatchUps((prev) => prev.filter((x) => x.sourceUrl !== c.sourceUrl));
      await useLibraryStore.getState().loadLibrary();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setFetching(null);
    }
  };

  const handleFetchAll = async () => {
    // Serial: the import worker handles one ZIP at a time.
    for (const c of [...catchUps]) await handleFetchOne(c);
  };
```

(Use whatever the panel's existing error setter is named — match the `setSyncError`/equivalent already present; if the panel uses a single `syncError` state, reuse it. Import `useLibraryStore` from `'../library/library.store'` if not already imported.)

- [ ] **Step 5: Render the list (inside the enrolled block, below the "Sync now" button)**

```tsx
{catchUps.length > 0 && (
  <div className="sync-catchups">
    <p>{catchUps.length} series can be downloaded to this device:</p>
    <ul>
      {catchUps.map((c) => (
        <li key={c.sourceUrl}>
          <span>{c.state === 'missing' ? 'New series' : `Behind — from ch. ${c.syncedChapter}`}</span>
          <button disabled={fetching !== null} onClick={() => void handleFetchOne(c)}>
            {fetching === c.sourceUrl ? 'Downloading…' : 'Fetch'}
          </button>
        </li>
      ))}
    </ul>
    <button disabled={fetching !== null} onClick={() => void handleFetchAll()}>Fetch all</button>
  </div>
)}
```

(Match the panel's existing class-name / button styling conventions; the markup above is the structure, not a style mandate.)

- [ ] **Step 6: Typecheck + run the full suite**

Run: `cd /Users/JLAJ9408/Documents/Verreaux/app && npx tsc --noEmit && npx vitest run`
Expected: typecheck clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/JLAJ9408/Documents/Verreaux/app
git add src/features/library/SettingsPanel.tsx
git commit -m "feat(sync): catch-up download list in Settings (Fetch / Fetch all)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Classification at pull time (missing/behind) → Task 4 (`classifyCatchUp`) + Task 6 (`pullAndReconcile`). ✓
- Initial catch-up: fetch window, prune below synced (fetch-first/prune-second), set position, set `caughtUp` → Task 5. ✓
- Subsequent update reuses `localMax+1→latest`, no prune → Task 5 (`!initial` branch via `computeUpdateArgs`). ✓
- `caughtUp` field + migration default false → Task 1. ✓
- Device-token `/scrape` auth on the client → Task 3 (backend half is Plan A). ✓
- Trigger UX: surfaced in Settings with per-series Fetch + Fetch all, nothing automatic → Task 7. ✓
- Error handling: prune only after successful import; fetch failure throws before prune → Task 5 (test: "does NOT prune when the fetch throws"). 401 handling stays in the sync client / `postScrape` message. ✓

**Placeholder scan:** None. Task 7 markup is explicitly structural (styling matched to the existing panel), not a TODO.

**Type consistency:** `CatchUpCandidate` fields (`sourceUrl`, `syncedChapter`, `syncedPage`, `seriesId`, `maxOrder`, `initial`, `state`) are defined in Task 4 and consumed identically in Tasks 5-7. `pullAndReconcile` return type changes `void → CatchUpCandidate[]`; the only other caller (`library.store.ts`) is updated in Task 6 Step 5. `tokenRunScrape` returns `(req:{url,args})=>Promise<Blob>`, matching `CatchUpRunDeps.runScrape`. `ScrapeRequest.deviceToken` (Task 3) flows through `runScrapeToBlob`'s `{...req}` spread into `postScrape`.

**Ordering note:** Task 7 depends on Tasks 4-6; Tasks 1-3 are independent and can be done in any order. Recommended order: 1 → 2 → 3 → 4 → 5 → 6 → 7.
