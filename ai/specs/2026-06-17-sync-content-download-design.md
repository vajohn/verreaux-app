# Sync-Driven Content Download — Design

**Date:** 2026-06-17
**Status:** Approved (pending spec review)
**Repos touched:** `verreaux-app` (PWA, primary), `verreaux-scraper` (Pi backend, one auth change)

## Problem

Multi-device position sync already works: a device pushes its furthest reading
position and pulls others' via the Pi. But when a secondary device pulls a
position for a series it **doesn't have** (or is **behind** on), the position is
useless — there are no chapters to open. Because the sync payload already carries
the series `sourceUrl`, the device can fetch the content itself.

The user's reading model is **linear, storage-conscious**: a device keeps a
sliding window from where it's reading up to the latest chapter, and discards
chapters it has already read once it joins the shared position.

## Behavior

### Classification (at pull time)

For each pulled server position, match the local series by `sourceUrl`:

| Local state                         | Classification     |
|-------------------------------------|--------------------|
| No local series for `sourceUrl`     | **catch-up candidate** (missing) |
| Local max chapter < synced chapter  | **catch-up candidate** (behind)  |
| Local max chapter ≥ synced chapter  | nothing to offer   |

A "catch-up candidate" is surfaced in the sync UI. Nothing downloads
automatically.

Whether a candidate is shown depends only on **content to fetch** (missing or
behind). Whether the fetch **prunes** depends on a separate once-only per-series
`caughtUp` flag — a candidate carries `initial = !series.caughtUp`.

### Fetch — two paths

**Initial catch-up** (`initial === true`: this device has not yet caught up on
this series). Logical effect: fetch `syncedChapter → latest` and keep only the
window from the synced chapter onward. **Execution order is fetch-first,
prune-second** so a failed download never destroys chapters:

1. **Fetch** `syncedChapter → latest`, skipping chapters already present
   (the existing import pipeline already skips existing chapter orders).
2. **Prune** — only after a successful import — every local chapter whose order
   is **below** the synced chapter.
3. **Set** the reading position to the synced page (forced, bypassing the
   manually-marked guard).
4. **Mark** the series `caughtUp = true`.

**Every later sync** (`initial === false`: series already `caughtUp`): route to
the existing `updateFromSource` path — fetch `localMax+1 → latest`, advance the
read pointer, **no pruning**. This path already exists and is unchanged.

### Worked examples (user-provided)

Each row is the series' **initial** catch-up (`caughtUp` still false):

| Local   | Synced | Candidate? | Fetch     | Prune       | Result    |
|---------|--------|------------|-----------|-------------|-----------|
| 1–30    | 49     | yes (behind)  | 49→latest | delete 1–30 | 49→latest |
| none    | 49     | yes (missing) | 49→latest | —           | 49→latest |
| 1–60    | 49     | **no** (max 60 ≥ 49) | — | — | 1–60 unchanged |

The third row is a device whose local content is **ahead of** the synced
position — by the classifier rule (offer only when `synced > localMax` or
missing) it is **not** a candidate, so nothing is fetched and nothing is pruned.
This is the deliberate resolution of "pruning only kicks in on a device syncing
to catch up": a device that is at or ahead of the shared position is the
pace-setter, never the catcher-up, so it is left alone. (This supersedes the
earlier reading of this row as a prune-to-window — that reading conflicted with
the pace-setter rule.)

## Trigger UX

After a pull, the sync UI shows the catch-up candidates, e.g.
*"3 series can be downloaded to this device,"* with a per-series **Fetch** action
and a **Fetch all**. Rationale:

- A catch-up can be dozens of chapters (bandwidth/time) — the user should choose.
- The initial catch-up is the **destructive prune** moment — the user must see
  what will happen before it does.

## Authentication

The Pi's `POST /scrape` is currently OTP-gated (a 6-digit code per scrape). For a
sync-driven download to feel automatic, extend `/scrape` to **also** accept
`Authorization: Bearer <deviceToken>`, reusing the same `resolveDevice` lookup
that already guards `/sync/*`. The OTP path stays for manual scrapes from the Mac
CLI / Settings panel. Catch-up downloads carry the device's existing sync token
and need no prompt.

## Components

### Backend (`verreaux-scraper`)

- **`src/pi/api.ts`** — in the `/scrape` route, if an `Authorization: Bearer`
  header is present and `resolveDevice` accepts it, authorize the scrape;
  otherwise fall back to the existing OTP check. No change to the job-queue
  drop-folder mechanics.
- (`resolveDevice` in `src/pi/syncHandlers.ts` already exists and is reused
  as-is.)
- **ZIP reuse (speed optimization, wraps the scrape — pipeline untouched):** a
  catch-up scrape consults the recent run ZIPs already in `done/` for the same
  `sourceUrl`. From the freshest cached ZIP it takes the contiguous chapter run
  starting at the requested `from` (`F..K`), narrows the scrape to
  `--from K+1 --to latest`, and assembles `output.zip` from the cached `F..K`
  chapters + the freshly-scraped delta + a recomputed `verreaux.json`. Nothing
  cached → behaves exactly as today. Reuse is keyed on `(sourceUrl, order)` and
  is safe because a published chapter's images do not change; it is bounded by
  the existing 1-day `done/` TTL. New modules: `zipIndex`, `cachePlan`,
  `zipAssemble`, `cacheAssist` (orchestrator wired into the worker's scrape
  callback). Detailed in `scraper/ai/plans/2026-06-17-scrape-device-token-auth.md`
  (Tasks 2-5). This is deferrable independently of the device-side feature.

### PWA (`verreaux-app`)

- **`src/db/types.ts` + `src/db/db.ts`** — add `Series.caughtUp?: boolean` and a
  Dexie schema version bump. The flag distinguishes a series' **initial**
  catch-up (prune) from later updates (no prune); it does **not** decide whether
  a series is offered. Both new series (`createSeries`) and existing rows
  (migration) default to `false` ("not yet caught up"), so the first time a
  series is genuinely behind a shared position it gets the window treatment, and
  every sync after that uses the no-prune update path. A pace-setting device is
  never behind, so the flag never causes it to prune.
- **`src/db/repos/series.repo.ts`** — `setCaughtUp(seriesId)`; helper to read the
  flag.
- **`src/db/repos/chapter.repo.ts`** (or equivalent) — `deleteChaptersBelow(seriesId, order)`
  for the prune step.
- **`src/features/sync/catchUp.ts`** (new) — pure classifier
  `classifyCatchUp(serverPositions, localSeriesByUrl)` → list of
  `{ sourceUrl, syncedChapter, syncedPage, state: 'missing' | 'behind' }`.
- **`src/features/sync/catchUpRun.ts`** (new) — orchestration for a single
  candidate: initial path (prune → fetch `syncedChapter→latest` → set position →
  set `caughtUp`) vs. delegate to `updateFromSource` when already `caughtUp`.
  Reuses `runScrapeToBlob` + the import pipeline + `upsertProgress(..., force)`.
- **`src/features/sync/piClient.ts`** — `postScrape` sends the device bearer token
  (when enrolled) so the backend's new auth path accepts it.
- **`src/features/library/SettingsPanel.tsx`** (or the sync surface) — render the
  catch-up candidate list with per-series **Fetch** and **Fetch all**, wired to
  `catchUpRun`.
- **`src/features/sync/positionSync.ts` / `reconcile.ts`** — `pullAndReconcile`
  returns (or exposes) the classified catch-up candidates so the UI can show them.

## Data flow

```
loadLibrary / Sync now
  └─ pullAndReconcile()
       ├─ getPositions(token, since)        // existing
       ├─ reconcilePositions(...)           // existing: applies server-ahead positions
       └─ classifyCatchUp(server, localByUrl) → candidates  // NEW
  └─ UI shows candidates (Fetch / Fetch all)                // NEW

User taps Fetch (one candidate)
  └─ catchUpRun(candidate)                                  // NEW
       if !series.caughtUp (initial):
         prune chapters < syncedChapter
         scrape syncedChapter→latest (device-token auth) → import (skips existing)
         upsertProgress(syncedChapter, syncedPage, { force: true })
         setCaughtUp(series)
       else:
         updateFromSource(series)            // existing path, no prune
```

## Error handling

- **Scrape fails** (e.g. `ERR_EMPTY_RANGE`, locked chapters): surface the run's
  failure message (the runner already extracts it); do **not** prune if the fetch
  did not succeed. Prune only after a successful import so a failed catch-up never
  destroys chapters and leaves a gap.
  → Ordering: **fetch + import first, prune second**, within the initial path.
- **Auth 401 on `/scrape`** (token rejected/expired): same handling as the sync
  client — clear creds / prompt re-enroll.
- **Pull timeout / offline:** candidates simply aren't shown; existing pull
  behavior unchanged.

## Testing

- **Backend:** `/scrape` accepts a valid device bearer token; rejects an invalid
  one; still accepts a valid OTP; rejects when neither is present.
- **`classifyCatchUp`:** the three worked-example rows + the "caught up already"
  no-op; missing vs. behind classification.
- **`catchUpRun` initial path:** prunes below synced, imports the fetched window,
  sets the forced position, sets `caughtUp`; **does not prune on a failed fetch**.
- **`catchUpRun` subsequent path:** delegates to `updateFromSource`, no prune,
  `caughtUp` already set.
- **Dexie migration:** existing series default to `caughtUp = true` (not
  re-pruned on next sync).

## Out of scope (YAGNI)

- Automatic/background catch-up (explicitly chosen against — user wants to see the
  prune).
- Re-downloading pruned chapters on backtrack beyond a normal `updateFromSource`.
- Any change to the position-merge conflict rule or the job-queue mechanics.
