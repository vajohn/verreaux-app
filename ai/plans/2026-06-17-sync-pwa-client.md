# Multi-device Sync — PWA Client Implementation Plan (Spec 1, Part 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the PWA enroll a device with the Pi sync backend and sync reading positions across a user's devices (push on progress changes, pull-and-reconcile on app open).

**Architecture:** Thin, dependency-injected modules under `src/features/sync/`: a credential store (localStorage), a typed sync API client (reusing the existing `getApiBase`), a pure reconcile function (adopt a server position only when it is *ahead* of local), Dexie target-mapping helpers (`sourceUrl→series`, `chapter order→chapter`), and a debounced push manager. Push is hooked into the single progress choke point (`useProgressPersist`); pull runs on library load. UI is a Settings enroll form.

**Tech Stack:** TypeScript, React, Dexie (IndexedDB), Zustand, vitest + jsdom + fake-indexeddb.

**Spec:** `../specs/2026-06-17-multidevice-sync-design.md`. **Prerequisite:** Part 1 (Pi backend) is merged and the Pi runs the Postgres-backed `api` with these endpoints:
- `POST /enroll {username,passcode,otp,deviceName}` → `201 {accountId,deviceId,deviceToken}` (401 bad otp/passcode)
- `PUT /sync/position {sourceUrl,chapterOrder,pageIndex,manuallyMarked}` (Bearer token) → `200 {sourceUrl,chapterOrder,pageIndex,manuallyMarked}` (401 bad token)
- `GET /sync/positions?since=<iso>` (Bearer token) → `200 {positions:[{sourceUrl,chapterOrder,pageIndex,manuallyMarked,updatedAt}]}`

**Existing code this builds on:**
- `src/features/sync/piClient.ts` — `getApiBase()` (the configured Pi URL).
- `src/db/repos/series.repo.ts` — `Series.sourceUrl`, `setSourceUrl`.
- `src/db/repos/progress.repo.ts` — `getProgress(profileId,seriesId)`, `upsertProgress(...)`.
- `src/db/db.ts` — `db.series`, `db.chapters` (index `[seriesId+order]`), `db.readingProgress`.
- `src/features/reader/useProgressPersist.ts` — debounced save (`upsertProgress` + `setLastReadChapter`); the push hook point.
- `src/features/library/library.store.ts` — `loadLibrary()`; the pull hook point.
- `src/features/library/SettingsPanel.tsx` — the existing Pi-API-URL field; the enroll UI goes here.

---

## File Structure

**New (`src/features/sync/`):**
- `syncCreds.ts` — localStorage-backed `{accountId, deviceId, deviceToken}`: `getSyncCreds`, `setSyncCreds`, `clearSyncCreds`, `isEnrolled`.
- `syncClient.ts` — typed API calls: `enroll`, `putPosition`, `getPositions` (reuse `getApiBase`).
- `reconcile.ts` — pure `reconcilePositions(server, localByUrl)` → updates to apply (server-ahead only).
- `syncTargets.ts` — Dexie helpers: `localPositionsByUrl(profileId)`, `applyServerPosition(profileId, update)`.
- `pushQueue.ts` — `createPushQueue(deps)`: debounced enqueue + flush, offline-tolerant.

**Modified:**
- `src/features/reader/useProgressPersist.ts` — enqueue a push after a successful save.
- `src/features/library/library.store.ts` — pull + reconcile inside `loadLibrary` (best-effort).
- `src/features/library/SettingsPanel.tsx` — enroll form + status.
- `README.md` — document enroll + sync.

**New tests (`test/unit/`, `test/integration/`):** `syncCreds.test.ts`, `syncClient.test.ts`, `reconcile.test.ts`, `syncTargets.test.ts`, `pushQueue.test.ts`.

---

## Task 1: Credential store

**Files:** Create `src/features/sync/syncCreds.ts`; Test `test/unit/syncCreds.test.ts`

- [ ] **Step 1: failing test**

```ts
// test/unit/syncCreds.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { getSyncCreds, setSyncCreds, clearSyncCreds, isEnrolled } from '../../src/features/sync/syncCreds';

afterEach(() => localStorage.clear());

describe('syncCreds', () => {
  it('round-trips creds and reports enrolled', () => {
    expect(isEnrolled()).toBe(false);
    expect(getSyncCreds()).toBeNull();
    setSyncCreds({ accountId: 'a1', deviceId: 'd1', deviceToken: 't1' });
    expect(isEnrolled()).toBe(true);
    expect(getSyncCreds()).toEqual({ accountId: 'a1', deviceId: 'd1', deviceToken: 't1' });
  });

  it('clears creds', () => {
    setSyncCreds({ accountId: 'a1', deviceId: 'd1', deviceToken: 't1' });
    clearSyncCreds();
    expect(isEnrolled()).toBe(false);
    expect(getSyncCreds()).toBeNull();
  });

  it('returns null on malformed stored json', () => {
    localStorage.setItem('verreaux:syncCreds', '{not json');
    expect(getSyncCreds()).toBeNull();
  });
});
```

- [ ] **Step 2:** `npx vitest run test/unit/syncCreds.test.ts` → FAIL.

- [ ] **Step 3: implement** `src/features/sync/syncCreds.ts`

```ts
const KEY = 'verreaux:syncCreds';

export interface SyncCreds {
  accountId: string;
  deviceId: string;
  deviceToken: string;
}

export function getSyncCreds(): SyncCreds | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<SyncCreds>;
    if (typeof o.accountId === 'string' && typeof o.deviceId === 'string' && typeof o.deviceToken === 'string') {
      return { accountId: o.accountId, deviceId: o.deviceId, deviceToken: o.deviceToken };
    }
    return null;
  } catch {
    return null;
  }
}

export function setSyncCreds(creds: SyncCreds): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(creds));
  } catch {
    // storage unavailable — ignore
  }
}

export function clearSyncCreds(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function isEnrolled(): boolean {
  return getSyncCreds() !== null;
}
```

- [ ] **Step 4:** `npx vitest run test/unit/syncCreds.test.ts` → PASS (3).
- [ ] **Step 5: commit**

```bash
git add src/features/sync/syncCreds.ts test/unit/syncCreds.test.ts
git commit -m "feat(sync): device credential store (localStorage)"
```

---

## Task 2: Sync API client

**Files:** Create `src/features/sync/syncClient.ts`; Test `test/unit/syncClient.test.ts`

- [ ] **Step 1: failing test**

```ts
// test/unit/syncClient.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { setApiBase } from '../../src/features/sync/piClient';
import { enroll, putPosition, getPositions } from '../../src/features/sync/syncClient';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('syncClient', () => {
  it('enroll posts credentials + otp and returns the ids/token', async () => {
    setApiBase('http://pi:8080');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ accountId: 'a', deviceId: 'd', deviceToken: 't' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await enroll({ username: 'u', passcode: 'p', otp: '123456', deviceName: 'iPad' });
    expect(r).toEqual({ accountId: 'a', deviceId: 'd', deviceToken: 't' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://pi:8080/enroll');
    expect(JSON.parse(init.body)).toEqual({ username: 'u', passcode: 'p', otp: '123456', deviceName: 'iPad' });
  });

  it('enroll throws a friendly error on 401', async () => {
    setApiBase('http://pi:8080');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid passcode' }), { status: 401 })));
    await expect(enroll({ username: 'u', passcode: 'x', otp: '000000', deviceName: 'iPad' })).rejects.toThrow(/passcode|authenticator|401/i);
  });

  it('putPosition sends the bearer token + body', async () => {
    setApiBase('http://pi:8080');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sourceUrl: 's', chapterOrder: 12, pageIndex: 5, manuallyMarked: false }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await putPosition('tok', { sourceUrl: 's', chapterOrder: 12, pageIndex: 5, manuallyMarked: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://pi:8080/sync/position');
    expect(init.method).toBe('PUT');
    expect(init.headers.authorization).toBe('Bearer tok');
  });

  it('getPositions sends the token and parses positions', async () => {
    setApiBase('http://pi:8080');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ positions: [{ sourceUrl: 's', chapterOrder: 1, pageIndex: 0, manuallyMarked: false, updatedAt: 't' }] }), { status: 200 })));
    const out = await getPositions('tok', null);
    expect(out).toHaveLength(1);
    expect(out[0].sourceUrl).toBe('s');
  });

  it('getPositions appends since when provided', async () => {
    setApiBase('http://pi:8080');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ positions: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await getPositions('tok', '2026-06-17T00:00:00Z');
    expect(fetchMock.mock.calls[0][0]).toBe('http://pi:8080/sync/positions?since=2026-06-17T00%3A00%3A00Z');
  });
});
```

- [ ] **Step 2:** `npx vitest run test/unit/syncClient.test.ts` → FAIL.

- [ ] **Step 3: implement** `src/features/sync/syncClient.ts`

```ts
import { getApiBase } from './piClient';

function base(): string {
  const b = getApiBase();
  if (!b) throw new Error('Pi API base URL is not configured. Set it in Settings.');
  return b;
}

export interface EnrollInput { username: string; passcode: string; otp: string; deviceName: string; }
export interface EnrollResult { accountId: string; deviceId: string; deviceToken: string; }

export async function enroll(input: EnrollInput): Promise<EnrollResult> {
  const res = await fetch(`${base()}/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 401) {
    const msg = await res.json().then((b: { error?: string }) => b.error).catch(() => '');
    throw new Error(msg || 'Enrollment rejected (check the code and passcode).');
  }
  if (!res.ok) throw new Error(`Enrollment failed (${res.status}).`);
  return (await res.json()) as EnrollResult;
}

export interface PositionBody {
  sourceUrl: string;
  chapterOrder: number;
  pageIndex: number;
  manuallyMarked: boolean;
}

export interface ServerPosition extends PositionBody {
  updatedAt: string;
}

export async function putPosition(token: string, body: PositionBody): Promise<PositionBody> {
  const res = await fetch(`${base()}/sync/position`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Error('Sync auth failed — re-enroll this device.');
  if (!res.ok) throw new Error(`Position sync failed (${res.status}).`);
  return (await res.json()) as PositionBody;
}

export async function getPositions(token: string, since: string | null): Promise<ServerPosition[]> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : '';
  const res = await fetch(`${base()}/sync/positions${qs}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error('Sync auth failed — re-enroll this device.');
  if (!res.ok) throw new Error(`Could not fetch positions (${res.status}).`);
  return ((await res.json()) as { positions: ServerPosition[] }).positions;
}
```

- [ ] **Step 4:** `npx vitest run test/unit/syncClient.test.ts` → PASS (5).
- [ ] **Step 5: commit**

```bash
git add src/features/sync/syncClient.ts test/unit/syncClient.test.ts
git commit -m "feat(sync): typed sync API client (enroll, putPosition, getPositions)"
```

---

## Task 3: Reconcile (pure, server-ahead-only)

**Files:** Create `src/features/sync/reconcile.ts`; Test `test/unit/reconcile.test.ts`

- [ ] **Step 1: failing test**

```ts
// test/unit/reconcile.test.ts
import { describe, it, expect } from 'vitest';
import { reconcilePositions, type LocalPosition } from '../../src/features/sync/reconcile';

const server = (sourceUrl: string, chapterOrder: number, pageIndex: number) =>
  ({ sourceUrl, chapterOrder, pageIndex, manuallyMarked: false, updatedAt: 't' });

describe('reconcilePositions', () => {
  it('adopts a server position when there is no local one', () => {
    const out = reconcilePositions([server('s', 3, 2)], new Map());
    expect(out).toEqual([{ sourceUrl: 's', chapterOrder: 3, pageIndex: 2, manuallyMarked: false }]);
  });

  it('adopts when server is ahead of local (chapter, then page)', () => {
    const local = new Map<string, LocalPosition>([['s', { chapterOrder: 3, pageIndex: 1 }]]);
    expect(reconcilePositions([server('s', 3, 5)], local)).toHaveLength(1);
    expect(reconcilePositions([server('s', 4, 0)], local)).toHaveLength(1);
  });

  it('skips when local is equal or ahead (never regress local)', () => {
    const local = new Map<string, LocalPosition>([['s', { chapterOrder: 3, pageIndex: 5 }]]);
    expect(reconcilePositions([server('s', 3, 5)], local)).toEqual([]); // equal
    expect(reconcilePositions([server('s', 3, 1)], local)).toEqual([]); // server behind
    expect(reconcilePositions([server('s', 2, 9)], local)).toEqual([]); // server behind by chapter
  });

  it('handles a mix across multiple series", () => {
    const local = new Map<string, LocalPosition>([['a', { chapterOrder: 1, pageIndex: 0 }]]);
    const out = reconcilePositions([server('a', 2, 0), server('b', 1, 0)], local);
    expect(out.map((u) => u.sourceUrl).sort()).toEqual(['a', 'b']);
  });
});
```

NOTE: fix the stray quote in the 4th test title when you paste (`'handles a mix across multiple series'`).

- [ ] **Step 2:** `npx vitest run test/unit/reconcile.test.ts` → FAIL.

- [ ] **Step 3: implement** `src/features/sync/reconcile.ts`

```ts
import type { ServerPosition } from './syncClient';

export interface LocalPosition {
  chapterOrder: number;
  pageIndex: number;
}

export interface PositionUpdate {
  sourceUrl: string;
  chapterOrder: number;
  pageIndex: number;
  manuallyMarked: boolean;
}

/** -1/0/1 by (chapterOrder, then pageIndex). */
function cmp(a: LocalPosition, b: LocalPosition): number {
  if (a.chapterOrder !== b.chapterOrder) return a.chapterOrder < b.chapterOrder ? -1 : 1;
  if (a.pageIndex !== b.pageIndex) return a.pageIndex < b.pageIndex ? -1 : 1;
  return 0;
}

/**
 * Returns the server positions that should be applied locally: those with no
 * local counterpart, or that are strictly AHEAD of the local position. A pull
 * never regresses local progress (the server already merged authoritatively;
 * any local-ahead value is unsynced progress that the push path will send).
 */
export function reconcilePositions(
  server: ServerPosition[],
  localByUrl: Map<string, LocalPosition>,
): PositionUpdate[] {
  const updates: PositionUpdate[] = [];
  for (const s of server) {
    const local = localByUrl.get(s.sourceUrl);
    if (!local || cmp(s, local) > 0) {
      updates.push({ sourceUrl: s.sourceUrl, chapterOrder: s.chapterOrder, pageIndex: s.pageIndex, manuallyMarked: s.manuallyMarked });
    }
  }
  return updates;
}
```

- [ ] **Step 4:** `npx vitest run test/unit/reconcile.test.ts` → PASS (4).
- [ ] **Step 5: commit**

```bash
git add src/features/sync/reconcile.ts test/unit/reconcile.test.ts
git commit -m "feat(sync): reconcile — adopt server positions only when ahead of local"
```

---

## Task 4: Dexie target mapping

**Files:** Create `src/features/sync/syncTargets.ts`; Test `test/integration/syncTargets.test.ts`

- [ ] **Step 1: failing test**

```ts
// test/integration/syncTargets.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries } from '../../src/db/repos/series.repo';
import { createChapter } from '../../src/db/repos/chapters.repo';
import { upsertProgress, getProgress } from '../../src/db/repos/progress.repo';
import { localPositionsByUrl, applyServerPosition } from '../../src/features/sync/syncTargets';

const PROFILE = 'p-sync';
beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({ id: PROFILE, name: 'T', avatarColor: 'gold', createdAt: 1, lastActiveAt: 1 });
});

describe('syncTargets', () => {
  it('builds a sourceUrl -> {chapterOrder,pageIndex} map from local progress', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'X', coverImageId: null, sourceUrl: 'https://x/s' });
    const c = await createChapter({ seriesId: s.id, profileId: PROFILE, title: 'C3', order: 3, pageCount: 10 });
    await upsertProgress({ profileId: PROFILE, seriesId: s.id, currentChapterId: c.id, pageIndex: 4, scrollPosition: 0 });
    const map = await localPositionsByUrl(PROFILE);
    expect(map.get('https://x/s')).toEqual({ chapterOrder: 3, pageIndex: 4 });
  });

  it('applies a server position by resolving sourceUrl->series and order->chapter', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'X', coverImageId: null, sourceUrl: 'https://x/s' });
    const c5 = await createChapter({ seriesId: s.id, profileId: PROFILE, title: 'C5', order: 5, pageCount: 20 });
    await applyServerPosition(PROFILE, { sourceUrl: 'https://x/s', chapterOrder: 5, pageIndex: 7, manuallyMarked: false });
    const prog = await getProgress(PROFILE, s.id);
    expect(prog?.currentChapterId).toBe(c5.id);
    expect(prog?.pageIndex).toBe(7);
  });

  it('skips applying when the series or chapter-order is not present locally', async () => {
    await applyServerPosition(PROFILE, { sourceUrl: 'https://missing', chapterOrder: 1, pageIndex: 0, manuallyMarked: false });
    const s = await createSeries({ profileId: PROFILE, title: 'X', coverImageId: null, sourceUrl: 'https://x/s' });
    await applyServerPosition(PROFILE, { sourceUrl: 'https://x/s', chapterOrder: 99, pageIndex: 0, manuallyMarked: false });
    expect(await getProgress(PROFILE, s.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2:** `npx vitest run test/integration/syncTargets.test.ts` → FAIL.

- [ ] **Step 3: implement** `src/features/sync/syncTargets.ts`

```ts
import { db } from '../../db/db';
import { upsertProgress } from '../../db/repos/progress.repo';
import type { PositionUpdate, LocalPosition } from './reconcile';

/** Map of sourceUrl -> the local current reading position, for series that
 *  have a sourceUrl and a saved progress row. */
export async function localPositionsByUrl(profileId: string): Promise<Map<string, LocalPosition>> {
  const out = new Map<string, LocalPosition>();
  const series = await db.series.where('profileId').equals(profileId).toArray();
  for (const s of series) {
    if (!s.sourceUrl) continue;
    const prog = await db.readingProgress.where('[profileId+seriesId]').equals([profileId, s.id]).first();
    if (!prog) continue;
    const chapter = await db.chapters.get(prog.currentChapterId);
    if (!chapter) continue;
    out.set(s.sourceUrl, { chapterOrder: chapter.order, pageIndex: prog.pageIndex });
  }
  return out;
}

/** Apply a server position to local progress, resolving sourceUrl -> series and
 *  chapterOrder -> chapter. No-op when the series or chapter is not present. */
export async function applyServerPosition(profileId: string, update: PositionUpdate): Promise<void> {
  const series = (await db.series.where('profileId').equals(profileId).toArray()).find((s) => s.sourceUrl === update.sourceUrl);
  if (!series) return;
  const chapter = await db.chapters.where('[seriesId+order]').equals([series.id, update.chapterOrder]).first();
  if (!chapter) return;
  await upsertProgress({
    profileId,
    seriesId: series.id,
    currentChapterId: chapter.id,
    pageIndex: update.pageIndex,
    scrollPosition: 0,
    manuallyMarked: update.manuallyMarked,
  });
}
```

- [ ] **Step 4:** `npx vitest run test/integration/syncTargets.test.ts` → PASS (3). Then `npx tsc -p tsconfig.app.json --noEmit` clean.
- [ ] **Step 5: commit**

```bash
git add src/features/sync/syncTargets.ts test/integration/syncTargets.test.ts
git commit -m "feat(sync): Dexie target mapping (sourceUrl->series, order->chapter)"
```

---

## Task 5: Debounced push queue

**Files:** Create `src/features/sync/pushQueue.ts`; Test `test/unit/pushQueue.test.ts`

- [ ] **Step 1: failing test**

```ts
// test/unit/pushQueue.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createPushQueue } from '../../src/features/sync/pushQueue';

describe('pushQueue', () => {
  it('coalesces rapid enqueues per sourceUrl and flushes the latest', async () => {
    const put = vi.fn(async () => ({ sourceUrl: 's', chapterOrder: 0, pageIndex: 0, manuallyMarked: false }));
    const q = createPushQueue({ put, debounceMs: 0 });
    q.enqueue({ sourceUrl: 's', chapterOrder: 12, pageIndex: 1, manuallyMarked: false });
    q.enqueue({ sourceUrl: 's', chapterOrder: 12, pageIndex: 9, manuallyMarked: false });
    await q.flush();
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith({ sourceUrl: 's', chapterOrder: 12, pageIndex: 9, manuallyMarked: false });
  });

  it('keeps the item queued when put fails (retry on next flush)', async () => {
    const put = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ sourceUrl: 's', chapterOrder: 0, pageIndex: 0, manuallyMarked: false });
    const q = createPushQueue({ put, debounceMs: 0 });
    q.enqueue({ sourceUrl: 's', chapterOrder: 1, pageIndex: 1, manuallyMarked: false });
    await q.flush(); // fails, item retained
    await q.flush(); // succeeds
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('flushes multiple distinct series', async () => {
    const put = vi.fn(async () => ({ sourceUrl: '', chapterOrder: 0, pageIndex: 0, manuallyMarked: false }));
    const q = createPushQueue({ put, debounceMs: 0 });
    q.enqueue({ sourceUrl: 'a', chapterOrder: 1, pageIndex: 0, manuallyMarked: false });
    q.enqueue({ sourceUrl: 'b', chapterOrder: 1, pageIndex: 0, manuallyMarked: false });
    await q.flush();
    expect(put).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2:** `npx vitest run test/unit/pushQueue.test.ts` → FAIL.

- [ ] **Step 3: implement** `src/features/sync/pushQueue.ts`

```ts
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

  async function flush(): Promise<void> {
    const items = [...pending.values()];
    for (const item of items) {
      try {
        await deps.put(item);
        // Only drop if still the same value we sent (no newer enqueue raced in).
        if (pending.get(item.sourceUrl) === item) pending.delete(item.sourceUrl);
      } catch {
        // keep it for the next flush
      }
    }
  }

  function enqueue(body: PositionBody): void {
    pending.set(body.sourceUrl, body);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, deps.debounceMs);
  }

  return { enqueue, flush };
}
```

- [ ] **Step 4:** `npx vitest run test/unit/pushQueue.test.ts` → PASS (3).
- [ ] **Step 5: commit**

```bash
git add src/features/sync/pushQueue.ts test/unit/pushQueue.test.ts
git commit -m "feat(sync): debounced, offline-tolerant push queue"
```

---

## Task 6: Wire push (reader) + pull (library)

UI/integration wiring; verify by `tsc` + build + full suite (no new unit tests — the logic is covered by Tasks 3–5). A module-level singleton push queue ties it together.

**Files:** Create `src/features/sync/positionSync.ts`; Modify `src/features/reader/useProgressPersist.ts`, `src/features/library/library.store.ts`

- [ ] **Step 1: create the orchestration singleton** `src/features/sync/positionSync.ts`

```ts
import { db } from '../../db/db';
import { getSyncCreds } from './syncCreds';
import { putPosition, getPositions } from './syncClient';
import { createPushQueue } from './pushQueue';
import { reconcilePositions } from './reconcile';
import { localPositionsByUrl, applyServerPosition } from './syncTargets';

const queue = createPushQueue({
  put: (body) => {
    const creds = getSyncCreds();
    if (!creds) throw new Error('not enrolled');
    return putPosition(creds.deviceToken, body);
  },
  debounceMs: 4000,
});

let lastPull: string | null = null;

/** Called from the reader after a progress save. Looks up the series' sourceUrl
 *  + chapter order and enqueues a push. No-op if not enrolled or no sourceUrl. */
export async function notifyProgress(profileId: string, seriesId: string, chapterId: string, pageIndex: number, manuallyMarked: boolean): Promise<void> {
  if (!getSyncCreds()) return;
  const series = await db.series.get(seriesId);
  if (!series?.sourceUrl) return;
  const chapter = await db.chapters.get(chapterId);
  if (!chapter) return;
  queue.enqueue({ sourceUrl: series.sourceUrl, chapterOrder: chapter.order, pageIndex, manuallyMarked });
}

/** Flush pending pushes (call on visibility/pagehide). */
export function flushSync(): Promise<void> {
  return queue.flush();
}

/** Pull + reconcile for a profile. Best-effort: swallows network errors. */
export async function pullAndReconcile(profileId: string): Promise<void> {
  const creds = getSyncCreds();
  if (!creds) return;
  try {
    const server = await getPositions(creds.deviceToken, lastPull);
    const local = await localPositionsByUrl(profileId);
    const updates = reconcilePositions(server, local);
    for (const u of updates) await applyServerPosition(profileId, u);
    lastPull = new Date().toISOString();
  } catch {
    // offline / not reachable — try again next time
  }
}
```

- [ ] **Step 2: hook push into the reader.** In `src/features/reader/useProgressPersist.ts`, import `notifyProgress` from `../sync/positionSync`, and after the existing `await upsertProgress({...}); await setLastReadChapter(...)` call, add:

```ts
        void notifyProgress(profileId, seriesId, snap.chapterId, snap.pageIndex, false);
```

Also add a `pagehide`/`visibilitychange` flush. In the same hook (or `ReaderScreen`), add an effect:

```ts
  useEffect(() => {
    const onHide = () => { void flushSync(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);
```

(import `flushSync` from `../sync/positionSync`.)

- [ ] **Step 3: hook pull into the library.** In `src/features/library/library.store.ts`, inside `loadLibrary()` after the local series are loaded, call (fire-and-forget, then reload if anything changed):

```ts
    await pullAndReconcile(profileId);
```

Place it so a reconcile that advances progress is reflected — call `pullAndReconcile` BEFORE the final state set, or re-read progress after. Import `pullAndReconcile` from `../sync/positionSync`. Keep it best-effort (it never throws).

- [ ] **Step 4: verify** `npx tsc -p tsconfig.app.json --noEmit && npm run build && npx vitest run` → all green (no regressions). Manual: enroll on two profiles/browsers, read on one, confirm position appears on the other after a library reload.

- [ ] **Step 5: commit**

```bash
git add src/features/sync/positionSync.ts src/features/reader/useProgressPersist.ts src/features/library/library.store.ts
git commit -m "feat(sync): wire position push (reader) + pull-reconcile (library)"
```

---

## Task 7: Settings enroll UI + docs

**Files:** Modify `src/features/library/SettingsPanel.tsx`, `README.md`

- [ ] **Step 1: enroll UI.** In `SettingsPanel.tsx` (which already has the Pi-API-URL field), add a "Device sync" section:
  - If `isEnrolled()` (from `../sync/syncCreds`): show "Synced as <accountId>" + a "Sign out of sync" button calling `clearSyncCreds()`.
  - Else: a small form (username, passcode, 6-digit OTP, device name) with an "Enroll" button calling:

```tsx
import { enroll } from '../sync/syncClient';
import { setSyncCreds, getSyncCreds, clearSyncCreds, isEnrolled } from '../sync/syncCreds';
// on submit:
try {
  const r = await enroll({ username, passcode, otp, deviceName });
  setSyncCreds(r);
  // show success / re-render
} catch (e) {
  setEnrollError(e instanceof Error ? e.message : 'Enrollment failed.');
}
```
  - Validate OTP is 6 digits before submit (reuse the `/^\d{6}$/` pattern used elsewhere). Match existing settings-row styling.

- [ ] **Step 2: verify** `npx tsc -p tsconfig.app.json --noEmit && npm run build && npx vitest run` → green.

- [ ] **Step 3: docs.** In `README.md` "Source URL & updates" section, add a "Multi-device sync" subsection: configure the Pi API URL, enroll a device (username + passcode + authenticator code), and that reading positions then sync across enrolled devices (furthest-position-wins). Note enroll uses the same authenticator code as scraping.

- [ ] **Step 4: commit**

```bash
git add src/features/library/SettingsPanel.tsx README.md
git commit -m "feat(sync): settings enroll UI + docs"
```

---

## Self-Review

**Spec coverage (PWA half):**
- Device enroll (username/passcode/OTP) + token storage → Tasks 1, 2, 7. ✓
- Typed sync client matching the Part-1 API contract → Task 2. ✓
- Push on chapter change / background / periodic-debounce → Tasks 5, 6 (debounce 4s; flush on visibility/pagehide; enqueue on each progress save). ✓
- Pull + reconcile on app/series open, server-ahead-only, map sourceUrl→series & order→chapter → Tasks 3, 4, 6. ✓
- Only series with a sourceUrl sync → Task 6 `notifyProgress` guard + Task 4 mapping. ✓
- Offline-tolerant, never blocks reading → Task 5 (retain on failure) + Task 6 (best-effort, swallow errors). ✓
- `scrollPosition` not synced (reset to 0 on apply) → Task 4 `applyServerPosition`. ✓

**Placeholder scan:** Logic tasks (1–5) have full code + tests. Tasks 6–7 are wiring/UI against established patterns with the exact calls to add + tsc/build/manual verification. ✓ (One pasted-test typo is flagged in Task 3.)

**Type consistency:** `PositionBody`/`ServerPosition` (syncClient) used by `pushQueue`, `reconcile`, `positionSync`. `LocalPosition`/`PositionUpdate` (reconcile) used by `syncTargets`. `SyncCreds` (syncCreds) used by `positionSync`/`syncClient` callers. `getApiBase` reused from the existing `piClient`. ✓

**Deferred:** device revoke/list UI (backend revoke endpoint is itself deferred in Part 1); multi-profile-per-account (1:1 for now).
