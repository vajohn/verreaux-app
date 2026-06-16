# PWA Source URL & Update-From-Source Implementation Plan (Subsystem B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Verreaux PWA a second import path — add or update a series directly from its source URL by triggering the Pi scraper over HTTP — and persist each series' `sourceUrl` (captured from the ZIP's `verreaux.json`, or back-filled by the user on existing series) so updates can fetch only new chapters.

**Architecture:** Add `sourceUrl` to the `Series` model (Dexie v5). The existing ZIP-import worker reads the new `verreaux.json` manifest and stores `sourceUrl`. A small `piClient` talks to the Pi `api` service (`POST /scrape`, `GET /runs/:id`, `GET /runs/:id/output.zip`) with an OTP. Two orchestrations — `addFromUrl` (new series, full range) and `updateFromSource` (incremental, reusing the existing chapter-merge pipeline) — download the resulting ZIP and feed it through the unchanged import pipeline. A back-fill action attaches `sourceUrl` to series imported before this feature.

**Tech Stack:** TypeScript, React, Dexie (IndexedDB), Zustand stores, `@zip.js/zip.js`, vitest + jsdom + fake-indexeddb.

**Spec:** `../../../scraper/docs/superpowers/specs/2026-06-16-scraper-pi-migration-design.md` (shared spec; this repo implements the PWA half).

> **⬅️ Prerequisite:** Plan A (Subsystem A — Pi scraper service, in the `verreaux-scraper` repo) must be implemented and its Task 14 E2E passed. This plan depends on Plan A's `verreaux.json` manifest (Plan A Task 4) and HTTP API (Plan A Task 7). Have the Pi API base URL (LAN `http://pajohn.local:8080` or the Tailscale Funnel HTTPS URL from Plan A Task 14 Step 6) ready for Task 3.

---

## File Structure

**Modified:**
- `src/db/types.ts` — add `sourceUrl: string | null` to `Series`.
- `src/db/db.ts` — Dexie `version(5)` upgrade backfilling `sourceUrl = null`.
- `src/db/repos/series.repo.ts` — `CreateSeriesInput.sourceUrl`, set it in `createSeries`, add `setSourceUrl`.
- `src/lib/zip.ts` — add `readText(path)` to `ZipReader`.
- `src/features/import/importRuntime.ts` — thread `sourceUrl` into `runNewSeriesPipeline` / `importSeries`.
- `src/features/import/import.worker.ts` — read the manifest, pass `sourceUrl` down.
- `src/features/series/SeriesScreen.tsx` — "Set source URL" + "Update from source" actions.
- `src/features/library/LibraryScreen.tsx` — "Add from URL" entry.
- `README.md` — document both new flows.

**New:**
- `src/features/import/manifest.ts` — `readManifest(zip)`.
- `src/features/sync/piClient.ts` — Pi API client + base-URL/OTP config.
- `src/features/sync/updateArgs.ts` — pure `computeUpdateArgs(maxOrder)`.
- `src/features/sync/addFromUrl.ts` — new-series orchestration (testable, injected deps).
- `src/features/sync/updateFromSource.ts` — incremental-update orchestration (testable).
- Tests under `test/unit/` and `test/integration/`.

---

## Task 1: Add `sourceUrl` to the Series model (type + repo + Dexie v5)

**Files:**
- Modify: `src/db/types.ts`
- Modify: `src/db/db.ts`
- Modify: `src/db/repos/series.repo.ts`
- Test: `test/unit/series.repo.test.ts`

- [ ] **Step 1: Write the failing tests** (append inside `describe('series.repo', …)` in `test/unit/series.repo.test.ts`)

```ts
  it('defaults sourceUrl to null on create', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'NoSource', coverImageId: null });
    expect(s.sourceUrl).toBeNull();
  });

  it('persists a sourceUrl via createSeries input', async () => {
    const s = await createSeries({
      profileId: PROFILE,
      title: 'WithSource',
      coverImageId: null,
      sourceUrl: 'https://qimanhwa.com/series/x',
    });
    const reloaded = await db.series.get(s.id);
    expect(reloaded?.sourceUrl).toBe('https://qimanhwa.com/series/x');
  });

  it('back-fills sourceUrl on an existing series via setSourceUrl', async () => {
    const s = await createSeries({ profileId: PROFILE, title: 'Backfill', coverImageId: null });
    await setSourceUrl(s.id, 'https://manhwanex.com/series/y');
    expect((await db.series.get(s.id))?.sourceUrl).toBe('https://manhwanex.com/series/y');
    await setSourceUrl(s.id, null);
    expect((await db.series.get(s.id))?.sourceUrl).toBeNull();
  });
```

Add `setSourceUrl` to the import at the top of the test file:

```ts
import { createSeries, deleteSeries, normalizeTitle, setSourceUrl } from '../../src/db/repos/series.repo';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/series.repo.test.ts`
Expected: FAIL — `setSourceUrl` is not exported / `sourceUrl` missing on type.

- [ ] **Step 3: Add the field to the type**

In `src/db/types.ts`, add to the `Series` interface (after `importedAt: number;`):

```ts
  /**
   * Source page URL this series was scraped from (the Pi scraper embeds it in
   * verreaux.json). Null for series imported before this existed or imported
   * from a manifest-less ZIP; can be back-filled by the user to enable updates.
   */
  sourceUrl: string | null;
```

- [ ] **Step 4: Add the Dexie v5 migration**

In `src/db/db.ts`, after the `this.version(4)…` block (before the closing `}` of the constructor):

```ts
    // v5 — `Series.sourceUrl`: provenance link used by update-from-source.
    // Non-indexed field; backfill existing rows to null explicitly.
    this.version(5).upgrade(async (tx) => {
      await tx
        .table('series')
        .toCollection()
        .modify((s: Record<string, unknown>) => {
          if (s['sourceUrl'] === undefined) s['sourceUrl'] = null;
        });
    });
```

- [ ] **Step 5: Update the repo**

In `src/db/repos/series.repo.ts`, extend `CreateSeriesInput`:

```ts
export interface CreateSeriesInput {
  profileId: string;
  title: string;
  coverImageId: string | null;
  chapterCount?: number;
  sourceUrl?: string | null;
}
```

In `createSeries`, add to the `series` object literal (after `coverSource: 'imported',`):

```ts
    sourceUrl: input.sourceUrl ?? null,
```

Add a new exported function (near `updateSeriesTitle`):

```ts
export async function setSourceUrl(id: string, url: string | null): Promise<void> {
  await db.series.update(id, { sourceUrl: url });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/unit/series.repo.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 7: Commit**

```bash
git add src/db/types.ts src/db/db.ts src/db/repos/series.repo.ts test/unit/series.repo.test.ts
git commit -m "feat(db): add Series.sourceUrl (Dexie v5) + setSourceUrl"
```

---

## Task 2: Read `verreaux.json` and store sourceUrl on import

**Files:**
- Modify: `src/lib/zip.ts` (add `readText`)
- Create: `src/features/import/manifest.ts`
- Modify: `src/features/import/importRuntime.ts`
- Modify: `src/features/import/import.worker.ts`
- Test: `test/unit/manifest.test.ts`, `test/integration/importToRead.test.ts`

- [ ] **Step 1: Write the failing manifest test**

```ts
// test/unit/manifest.test.ts
import { describe, it, expect } from 'vitest';
import { ZipWriter, BlobWriter, TextReader } from '@zip.js/zip.js';
import { openZip } from '../../src/lib/zip';
import { readManifest } from '../../src/features/import/manifest';

async function zipWith(files: Record<string, string>): Promise<Uint8Array> {
  const zw = new ZipWriter(new BlobWriter('application/zip'));
  for (const [name, text] of Object.entries(files)) await zw.add(name, new TextReader(text));
  const blob = await zw.close();
  return new Uint8Array(await blob.arrayBuffer());
}

describe('readManifest', () => {
  it('returns the sourceUrl from a verreaux.json at the zip root', async () => {
    const bytes = await zipWith({
      'verreaux.json': JSON.stringify({ schema: 1, sourceUrl: 'https://qimanhwa.com/series/x', seriesTitle: 'X' }),
      'X/Chapter 1/001.png': 'x',
    });
    const zip = await openZip(bytes);
    expect((await readManifest(zip))?.sourceUrl).toBe('https://qimanhwa.com/series/x');
    await zip.close();
  });

  it('returns null when there is no manifest', async () => {
    const bytes = await zipWith({ 'X/Chapter 1/001.png': 'x' });
    const zip = await openZip(bytes);
    expect(await readManifest(zip)).toBeNull();
    await zip.close();
  });

  it('returns null for a malformed manifest rather than throwing', async () => {
    const bytes = await zipWith({ 'verreaux.json': '{not json' });
    const zip = await openZip(bytes);
    expect(await readManifest(zip)).toBeNull();
    await zip.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/manifest.test.ts`
Expected: FAIL — `readText`/`readManifest` not found.

- [ ] **Step 3: Add `readText` to the ZipReader**

In `src/lib/zip.ts`, add to the `ZipReader` interface (after `readBlob`):

```ts
  readText(path: string): Promise<string>;
```

Add to `ZipReaderImpl` (after `readBlob`):

```ts
  async readText(path: string): Promise<string> {
    if (this.closed) throw new Error('ZipReader closed');
    const entry = this.entriesByPath.get(path);
    if (!entry) throw new Error(`Entry not found: ${path}`);
    const fileEntry = entry as Entry & {
      getData: (writer: TextWriter) => Promise<string>;
    };
    return fileEntry.getData(new TextWriter());
  }
```

Update the zip.js import to include `TextWriter`:

```ts
import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  ZipReader as ZipJsReader,
  ZipWriter,
  configure,
  type Entry,
} from '@zip.js/zip.js';
```

And extend the re-export line at the bottom:

```ts
export { BlobReader, BlobWriter, TextReader, TextWriter, ZipWriter };
```

- [ ] **Step 4: Create the manifest reader**

```ts
// src/features/import/manifest.ts
import type { ZipReader } from '../../lib/zip';

const MANIFEST_PATH = 'verreaux.json';

export interface ImportManifest {
  sourceUrl: string | null;
  seriesTitle: string | null;
}

/** Reads the root verreaux.json if present. Never throws — returns null on any
 *  problem (missing, unreadable, malformed) so import proceeds without it. */
export async function readManifest(zip: ZipReader): Promise<ImportManifest | null> {
  if (!zip.has(MANIFEST_PATH)) return null;
  try {
    const obj = JSON.parse(await zip.readText(MANIFEST_PATH)) as Record<string, unknown>;
    const sourceUrl = typeof obj.sourceUrl === 'string' ? obj.sourceUrl : null;
    const seriesTitle = typeof obj.seriesTitle === 'string' ? obj.seriesTitle : null;
    return { sourceUrl, seriesTitle };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run manifest test to verify it passes**

Run: `npx vitest run test/unit/manifest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Thread sourceUrl through the new-series pipeline**

In `src/features/import/importRuntime.ts`, add an optional `sourceUrl` parameter to `runNewSeriesPipeline` and pass it into `importSeries`. Change the signature:

```ts
export async function runNewSeriesPipeline(
  zip: ZipReader,
  importType: ImportType,
  activeProfileId: string,
  emit: Emit,
  cancel: CancelToken = { cancelled: false },
  log: WorkerLogger = NULL_LOGGER,
  sourceUrl: string | null = null,
): Promise<number> {
```

In its loop, change the `importSeries(...)` call to pass `sourceUrl`:

```ts
      await importSeries(zip, entry, activeProfileId, emit, cancel, log, totalChapters, startTime, counter, sourceUrl);
```

Change `importSeries`'s signature (add the trailing param):

```ts
async function importSeries(
  zip: ZipReader,
  entry: SeriesEntry,
  activeProfileId: string,
  emit: Emit,
  cancel: CancelToken,
  log: WorkerLogger,
  totalChapters: number,
  startTime: number,
  counter: { value: number },
  sourceUrl: string | null,
): Promise<void> {
```

In the new-series branch of the series-level transaction, set `sourceUrl` on insert — change the `await db.series.add({ … importedAt: Date.now(), sortOrder: Date.now(), });` to include:

```ts
        importedAt: Date.now(),
        sortOrder: Date.now(),
        sourceUrl,
```

And in the `existing` branch, back-fill if it was missing — replace the `if (existing) { … return existing.id; }` block with:

```ts
      if (existing) {
        const patch: Record<string, unknown> = {};
        if (coverImageId && coverImageId !== existing.coverImageId) {
          patch.coverImageId = coverImageId;
          patch.coverSource = 'imported';
        }
        if (sourceUrl && !existing.sourceUrl) patch.sourceUrl = sourceUrl;
        if (Object.keys(patch).length) await db.series.update(existing.id, patch);
        return existing.id;
      }
```

- [ ] **Step 7: Read the manifest in the worker and pass it down**

In `src/features/import/import.worker.ts`, import the reader:

```ts
import { readManifest } from './manifest';
```

Inside the `START` handler, after `const importType = detectImportType(reader, context);`, add:

```ts
    const manifest = await readManifest(reader);
    logger.info('detect', 'manifest', { sourceUrl: manifest?.sourceUrl ?? null });
```

Pass it into `runNewSeriesPipeline`:

```ts
      seriesCount = await runNewSeriesPipeline(
        reader,
        importType,
        activeProfileId,
        post,
        cancelToken,
        logger,
        manifest?.sourceUrl ?? null,
      );
```

- [ ] **Step 8: Write the integration test for sourceUrl persistence**

```ts
// test/integration/importSourceUrl.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ZipWriter, BlobWriter, TextReader } from '@zip.js/zip.js';
import { openZip } from '../../src/lib/zip';
import { runNewSeriesPipeline } from '../../src/features/import/importRuntime';
import { db } from '../../src/db/db';

const PROFILE = 'p-src';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function makeType2Zip(): Promise<Uint8Array> {
  const zw = new ZipWriter(new BlobWriter('application/zip'));
  await zw.add('verreaux.json', new TextReader(JSON.stringify({ schema: 1, sourceUrl: 'https://qimanhwa.com/series/x', seriesTitle: 'Series X' })));
  await zw.add('Series X/Chapter 1/001.png', new TextReader('img-bytes'));
  const blob = await zw.close();
  return new Uint8Array(await blob.arrayBuffer());
}

describe('import stores sourceUrl from manifest', () => {
  it('sets sourceUrl on the created series', async () => {
    const zip = await openZip(await makeType2Zip());
    await runNewSeriesPipeline(zip, 'type2', PROFILE, () => {}, { cancelled: false }, undefined, 'https://qimanhwa.com/series/x');
    await zip.close();
    const series = await db.series.where('profileId').equals(PROFILE).first();
    expect(series?.sourceUrl).toBe('https://qimanhwa.com/series/x');
  });
});
```

- [ ] **Step 9: Run the full import test suite**

Run: `npx vitest run test/unit/manifest.test.ts test/integration/importSourceUrl.test.ts test/integration/importToRead.test.ts`
Expected: PASS (new tests + existing import integration unaffected).

- [ ] **Step 10: Commit**

```bash
git add src/lib/zip.ts src/features/import/manifest.ts src/features/import/importRuntime.ts src/features/import/import.worker.ts test/unit/manifest.test.ts test/integration/importSourceUrl.test.ts
git commit -m "feat(import): read verreaux.json and persist Series.sourceUrl"
```

---

## Task 3: Pi API client + config (`src/features/sync/piClient.ts`)

**Files:**
- Create: `src/features/sync/piClient.ts`
- Test: `test/unit/piClient.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/piClient.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { setApiBase, getApiBase, postScrape, getRunStatus, getRunZip } from '../../src/features/sync/piClient';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('piClient', () => {
  it('persists and reads the API base', () => {
    setApiBase('http://pajohn.local:8080');
    expect(getApiBase()).toBe('http://pajohn.local:8080');
  });

  it('POSTs /scrape with url, args, otp and returns the id', async () => {
    setApiBase('http://pi:8080');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'run-1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const id = await postScrape({ url: 'https://x.test/s', args: '--from 0 --to latest', otp: '123456' });
    expect(id).toBe('run-1');
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('http://pi:8080/scrape');
    expect(JSON.parse(init.body)).toEqual({ url: 'https://x.test/s', args: '--from 0 --to latest', type: 'scrape', otp: '123456' });
  });

  it('throws a clear error on 401', async () => {
    setApiBase('http://pi:8080');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid authenticator code' }), { status: 401 })));
    await expect(postScrape({ url: 'https://x.test/s', args: '', otp: '000000' })).rejects.toThrow(/authenticator/i);
  });

  it('reads run status', async () => {
    setApiBase('http://pi:8080');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: 'succeeded' }), { status: 200 })));
    expect((await getRunStatus('run-1')).state).toBe('succeeded');
  });

  it('downloads the zip as a Blob', async () => {
    setApiBase('http://pi:8080');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['zip-bytes']), { status: 200 })));
    const blob = await getRunZip('run-1');
    expect(blob.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/piClient.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the client**

```ts
// src/features/sync/piClient.ts
// Thin client for the Pi `api` service (see scraper Plan A, Task 7).
const BASE_KEY = 'verreaux:piApiBase';

export function getApiBase(): string {
  try {
    return localStorage.getItem(BASE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setApiBase(base: string): void {
  try {
    localStorage.setItem(BASE_KEY, base.replace(/\/+$/, ''));
  } catch {
    // ignore — storage unavailable
  }
}

function requireBase(): string {
  const base = getApiBase();
  if (!base) throw new Error('Pi API base URL is not configured. Set it in Settings.');
  return base;
}

export interface ScrapeRequest {
  url: string;
  args: string;
  otp: string;
  type?: 'scrape' | 'probe';
}

export async function postScrape(req: ScrapeRequest): Promise<string> {
  const res = await fetch(`${requireBase()}/scrape`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: req.url, args: req.args, type: req.type ?? 'scrape', otp: req.otp }),
  });
  if (res.status === 401) throw new Error('Invalid authenticator code.');
  if (!res.ok) throw new Error(`Scrape request failed (${res.status}).`);
  return ((await res.json()) as { id: string }).id;
}

export interface RunStatus {
  state: 'running' | 'succeeded' | 'failed';
  exitCode?: number | null;
  message?: string | null;
}

export async function getRunStatus(id: string): Promise<RunStatus> {
  const res = await fetch(`${requireBase()}/runs/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Could not read run status (${res.status}).`);
  return (await res.json()) as RunStatus;
}

export async function getRunZip(id: string): Promise<Blob> {
  const res = await fetch(`${requireBase()}/runs/${encodeURIComponent(id)}/output.zip`);
  if (!res.ok) throw new Error(`Could not download output (${res.status}).`);
  return res.blob();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/piClient.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/sync/piClient.ts test/unit/piClient.test.ts
git commit -m "feat(sync): Pi API client + base-url config"
```

---

## Task 4: Update-args helper + shared run-poller

**Files:**
- Create: `src/features/sync/updateArgs.ts`
- Create: `src/features/sync/runScrapeToBlob.ts`
- Test: `test/unit/updateArgs.test.ts`, `test/unit/runScrapeToBlob.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/updateArgs.test.ts
import { describe, it, expect } from 'vitest';
import { computeUpdateArgs } from '../../src/features/sync/updateArgs';

describe('computeUpdateArgs', () => {
  it('starts one past the highest known chapter order', () => {
    expect(computeUpdateArgs(42)).toBe('--from 43 --to latest');
  });
  it('starts at 0 when nothing is known', () => {
    expect(computeUpdateArgs(0)).toBe('--from 1 --to latest');
    expect(computeUpdateArgs(null)).toBe('--from 0 --to latest');
  });
});
```

```ts
// test/unit/runScrapeToBlob.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runScrapeToBlob } from '../../src/features/sync/runScrapeToBlob';

describe('runScrapeToBlob', () => {
  it('posts, polls until succeeded, and resolves the zip blob', async () => {
    const calls: string[] = [];
    const deps = {
      postScrape: vi.fn(async () => 'run-9'),
      getRunStatus: vi.fn(async () => {
        calls.push('poll');
        return { state: calls.length >= 2 ? 'succeeded' : 'running' } as const;
      }),
      getRunZip: vi.fn(async () => new Blob(['zip'])),
      sleep: async () => {},
      onState: () => {},
    };
    const blob = await runScrapeToBlob({ url: 'https://x.test/s', args: '--from 0 --to latest', otp: '123456' }, deps);
    expect(blob.size).toBeGreaterThan(0);
    expect(deps.getRunZip).toHaveBeenCalledWith('run-9');
  });

  it('throws with the failure message when the run fails', async () => {
    const deps = {
      postScrape: vi.fn(async () => 'run-x'),
      getRunStatus: vi.fn(async () => ({ state: 'failed', message: 'boom' } as const)),
      getRunZip: vi.fn(),
      sleep: async () => {},
      onState: () => {},
    };
    await expect(runScrapeToBlob({ url: 'u', args: '', otp: '1' }, deps)).rejects.toThrow(/boom/);
    expect(deps.getRunZip).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/updateArgs.test.ts test/unit/runScrapeToBlob.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the helper + poller**

```ts
// src/features/sync/updateArgs.ts
/** Args for an incremental update: scrape from one past the highest known
 *  chapter order through the latest. `null` (nothing known) starts at 0. */
export function computeUpdateArgs(maxKnownOrder: number | null): string {
  if (maxKnownOrder == null) return '--from 0 --to latest';
  return `--from ${maxKnownOrder + 1} --to latest`;
}
```

```ts
// src/features/sync/runScrapeToBlob.ts
import type { ScrapeRequest, RunStatus } from './piClient';

export interface RunScrapeDeps {
  postScrape: (req: ScrapeRequest) => Promise<string>;
  getRunStatus: (id: string) => Promise<RunStatus>;
  getRunZip: (id: string) => Promise<Blob>;
  sleep: (ms: number) => Promise<void>;
  onState: (state: RunStatus['state']) => void;
}

const POLL_MS = 10_000;
const MAX_MS = 120 * 60 * 1000;

/** Dispatch a scrape to the Pi, poll to completion, return the output ZIP. */
export async function runScrapeToBlob(req: ScrapeRequest, deps: RunScrapeDeps): Promise<Blob> {
  const id = await deps.postScrape(req);
  const deadline = Date.now() + MAX_MS;
  for (;;) {
    await deps.sleep(POLL_MS);
    const status = await deps.getRunStatus(id);
    deps.onState(status.state);
    if (status.state === 'succeeded') return deps.getRunZip(id);
    if (status.state === 'failed') throw new Error(status.message || 'Remote scrape failed.');
    if (Date.now() > deadline) throw new Error('Timed out waiting for the remote scrape.');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/updateArgs.test.ts test/unit/runScrapeToBlob.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/sync/updateArgs.ts src/features/sync/runScrapeToBlob.ts test/unit/updateArgs.test.ts test/unit/runScrapeToBlob.test.ts
git commit -m "feat(sync): update-args helper + run-to-blob poller"
```

---

## Task 5: Add-from-URL and Update-from-source orchestrations

Both reuse `runScrapeToBlob` and hand the resulting ZIP to the existing import pipeline (via an injected `startImport`), so they are testable without UI or network.

**Files:**
- Create: `src/features/sync/addFromUrl.ts`
- Create: `src/features/sync/updateFromSource.ts`
- Test: `test/unit/addFromUrl.test.ts`, `test/unit/updateFromSource.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/addFromUrl.test.ts
import { describe, it, expect, vi } from 'vitest';
import { addFromUrl } from '../../src/features/sync/addFromUrl';

describe('addFromUrl', () => {
  it('scrapes the full range and imports the zip as a new series', async () => {
    const startImport = vi.fn();
    const deps = {
      runScrape: vi.fn(async () => new Blob(['zip'], { type: 'application/zip' })),
      startImport,
      activeProfileId: 'p1',
    };
    await addFromUrl({ url: 'https://qimanhwa.com/series/x', otp: '123456' }, deps);
    expect(deps.runScrape).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://qimanhwa.com/series/x', args: '--from 0 --to latest', otp: '123456' }));
    const arg = startImport.mock.calls[0][0];
    expect(arg.context).toBe('home');
    expect(arg.targetSeriesId).toBeUndefined();
    expect(arg.file).toBeInstanceOf(File);
    expect(arg.activeProfileId).toBe('p1');
  });
});
```

```ts
// test/unit/updateFromSource.test.ts
import { describe, it, expect, vi } from 'vitest';
import { updateFromSource } from '../../src/features/sync/updateFromSource';

describe('updateFromSource', () => {
  it('scrapes only new chapters and merges into the target series', async () => {
    const startImport = vi.fn();
    const deps = {
      runScrape: vi.fn(async () => new Blob(['zip'], { type: 'application/zip' })),
      startImport,
      activeProfileId: 'p1',
    };
    await updateFromSource(
      { id: 's1', sourceUrl: 'https://qimanhwa.com/series/x', maxKnownOrder: 42 },
      { otp: '123456' },
      deps,
    );
    expect(deps.runScrape).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://qimanhwa.com/series/x', args: '--from 43 --to latest', otp: '123456' }));
    const arg = startImport.mock.calls[0][0];
    expect(arg.context).toBe('series');
    expect(arg.targetSeriesId).toBe('s1');
  });

  it('refuses to run when the series has no sourceUrl', async () => {
    const deps = { runScrape: vi.fn(), startImport: vi.fn(), activeProfileId: 'p1' };
    await expect(
      updateFromSource({ id: 's1', sourceUrl: null, maxKnownOrder: 0 }, { otp: '1' }, deps),
    ).rejects.toThrow(/source url/i);
    expect(deps.runScrape).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/addFromUrl.test.ts test/unit/updateFromSource.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the orchestrations**

```ts
// src/features/sync/addFromUrl.ts
import type { Blob as _Blob } from 'node:buffer';
import { runScrapeToBlob, type RunScrapeDeps } from './runScrapeToBlob';
import { postScrape, getRunStatus, getRunZip } from './piClient';
import type { StartArgs } from '../import/importController';

export interface AddFromUrlDeps {
  runScrape: (req: { url: string; args: string; otp: string }) => Promise<Blob>;
  startImport: (args: StartArgs) => void;
  activeProfileId: string;
}

/** Default deps wiring the real client + poller (used by the UI). */
export function defaultRunScrape(onState: (s: string) => void) {
  return (req: { url: string; args: string; otp: string }): Promise<Blob> => {
    const deps: RunScrapeDeps = {
      postScrape,
      getRunStatus,
      getRunZip,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      onState,
    };
    return runScrapeToBlob({ ...req, type: 'scrape' }, deps);
  };
}

export async function addFromUrl(
  input: { url: string; otp: string },
  deps: AddFromUrlDeps,
): Promise<void> {
  const blob = await deps.runScrape({ url: input.url, args: '--from 0 --to latest', otp: input.otp });
  const file = new File([blob], 'scrape.zip', { type: 'application/zip' });
  deps.startImport({ file, context: 'home', activeProfileId: deps.activeProfileId });
}
```

```ts
// src/features/sync/updateFromSource.ts
import { computeUpdateArgs } from './updateArgs';
import type { StartArgs } from '../import/importController';

export interface UpdateTarget {
  id: string;
  sourceUrl: string | null;
  maxKnownOrder: number | null;
}

export interface UpdateFromSourceDeps {
  runScrape: (req: { url: string; args: string; otp: string }) => Promise<Blob>;
  startImport: (args: StartArgs) => void;
  activeProfileId: string;
}

export async function updateFromSource(
  target: UpdateTarget,
  input: { otp: string },
  deps: UpdateFromSourceDeps,
): Promise<void> {
  if (!target.sourceUrl) {
    throw new Error('This series has no source URL. Set one first to enable updates.');
  }
  const args = computeUpdateArgs(target.maxKnownOrder);
  const blob = await deps.runScrape({ url: target.sourceUrl, args, otp: input.otp });
  const file = new File([blob], 'update.zip', { type: 'application/zip' });
  deps.startImport({ file, context: 'series', targetSeriesId: target.id, activeProfileId: deps.activeProfileId });
}
```

(Delete the unused `import type { Blob as _Blob }` line in `addFromUrl.ts` if your lint flags it — it's not needed in the browser; `Blob`/`File` are global.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/addFromUrl.test.ts test/unit/updateFromSource.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/sync/addFromUrl.ts src/features/sync/updateFromSource.ts test/unit/addFromUrl.test.ts test/unit/updateFromSource.test.ts
git commit -m "feat(sync): add-from-url + update-from-source orchestrations"
```

---

## Task 6: UI — Settings field, Add-from-URL, Set-source-URL, Update-from-source

UI wiring follows the existing sheet patterns (`coverUrlSheet` in `SeriesScreen.tsx`, `ImportZone` for file import). These are thin; correctness of the underlying logic is covered by Tasks 1–5. Verify by build + lint + manual run.

**Files:**
- Modify: `src/features/library/SettingsPanel.tsx` (Pi API base URL field)
- Modify: `src/features/library/LibraryScreen.tsx` (Add-from-URL entry + sheet)
- Modify: `src/features/series/SeriesScreen.tsx` (Set-source-URL + Update-from-source in the overflow sheet)

- [ ] **Step 1: Settings — Pi API base URL**

In `src/features/library/SettingsPanel.tsx`, add a text field bound to `getApiBase()`/`setApiBase()` from `../sync/piClient`. Persisted on blur. Label: "Pi scraper API URL", helper text: "e.g. http://pajohn.local:8080 or your Tailscale Funnel URL".

- [ ] **Step 2: Library — Add from URL**

In `src/features/library/LibraryScreen.tsx`, add an "Add from URL" button next to the existing import entry. On tap, open a sheet collecting a series URL + a 6-digit OTP. On submit:

```tsx
import { addFromUrl, defaultRunScrape } from '../sync/addFromUrl';
import { startImport } from '../import/importController';
// inside the submit handler (activeProfileId from useLibraryStore):
await addFromUrl(
  { url, otp },
  { runScrape: defaultRunScrape((s) => setRemoteState(s)), startImport, activeProfileId },
);
```

The existing import progress UI (`useImportStore`) then drives the rest, exactly like a file import.

- [ ] **Step 3: Series — Set source URL (back-fill) + Update from source**

In `src/features/series/SeriesScreen.tsx`, add two items to the overflow sheet:

- **"Set source URL"** — opens a sheet (mirror the `coverUrlSheet` markup) with a URL input prefilled from `series.sourceUrl ?? ''`; on save calls `setSourceUrl(series.id, url.trim() || null)` from `../../db/repos/series.repo`, then refreshes the library store.
- **"Update from source"** — visible only when `series.sourceUrl` is set. Opens a sheet collecting the OTP; on submit:

```tsx
import { updateFromSource } from '../sync/updateFromSource';
import { defaultRunScrape } from '../sync/addFromUrl';
import { startImport } from '../import/importController';
import { db } from '../../db/db';

const last = await db.chapters.where('[seriesId+order]')
  .between([series.id, -Infinity], [series.id, Infinity]).last();
const maxKnownOrder = last?.order ?? series.lastKnownMaxOrder ?? null;
await updateFromSource(
  { id: series.id, sourceUrl: series.sourceUrl, maxKnownOrder },
  { otp },
  { runScrape: defaultRunScrape((s) => setRemoteState(s)), startImport, activeProfileId },
);
```

- [ ] **Step 4: Build, lint, and full test run**

Run: `npm run build && npx vitest run && npm run lint`
Expected: build, all tests, and lint PASS.

- [ ] **Step 5: Manual verification (with Plan A's Pi stack running)**

- In Settings, set the Pi API URL.
- **Add from URL:** paste a `manhwanex` series URL + a current OTP → series appears in the library with chapters; confirm `sourceUrl` is set (DevTools → IndexedDB → series row).
- **Set source URL:** on a pre-existing series with no source, set its URL → "Update from source" becomes available.
- **Update from source:** after new chapters publish (or by setting an artificially low max), run it → only new chapters are added, existing ones untouched.

- [ ] **Step 6: Commit**

```bash
git add src/features/library/SettingsPanel.tsx src/features/library/LibraryScreen.tsx src/features/series/SeriesScreen.tsx
git commit -m "feat(ui): add-from-url, set-source-url back-fill, update-from-source"
```

---

## Task 7: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the two import paths** — add a "Source URL & updates" section: configuring the Pi API URL in Settings, adding a series from URL, back-filling a source URL on an existing series, and updating from source (incremental). Note the OTP requirement and that `sourceUrl` comes from the ZIP's `verreaux.json`.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document source-url import + update-from-source flows"
```

---

## Self-Review

**Spec coverage (PWA half of the unified spec):**
- `Series.sourceUrl` field → Task 1. ✓
- Dexie v5 migration backfilling null → Task 1 Step 4. ✓
- ZIP import reads `verreaux.json` → Task 2. ✓
- Back-fill sourceUrl on existing series (incl. via re-import) → Task 1 (`setSourceUrl`), Task 2 Step 6 (existing-series patch), Task 6 Step 3 (UI). ✓
- Pi API client (POST /scrape + OTP, GET /runs/:id, output.zip) → Task 3. ✓
- Add-from-URL (new series, full range) → Tasks 4–6. ✓
- Update-from-source (incremental `--from max+1`, merge by order via existing chapter-merge pipeline) → Tasks 4–6. ✓
- OTP prompt in the PWA → Tasks 3, 6. ✓

**Placeholder scan:** Logic tasks (1–5) have complete code + tests. Task 6 (UI) is intentionally描述-level wiring against established sheet patterns, with exact handler code for the non-obvious parts and build/lint/manual verification — consistent with how this codebase's UI is structured and tested. ✓

**Type consistency:** `StartArgs` (from `importController`) reused unchanged by both orchestrations — `{ file, context, targetSeriesId?, activeProfileId }` matches `importController.ts`. `RunStatus.state` union (`running|succeeded|failed`) consistent across `piClient`, `runScrapeToBlob`, tests. `computeUpdateArgs(number|null)` signature matches its callers. `runNewSeriesPipeline`'s new trailing `sourceUrl` param is optional (default null) so the existing call in `import.worker.ts` and existing tests stay valid until updated in Task 2. ✓

**Note — incremental update reuses the proven path:** `updateFromSource` imports with `context: 'series'` + `targetSeriesId`, which routes to the existing `runChapterMergePipeline`, which already skips chapter orders present on the target. No new merge logic is introduced; this matches the spec's "merge by order" decision and the confirmed "update = incremental" assumption.
