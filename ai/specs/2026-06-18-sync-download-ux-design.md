# Sync Download UX — Design

**Date:** 2026-06-18
**Status:** Approved (pending spec review)
**Repo:** `verreaux-app` (PWA). No backend change.

## Problem

The catch-up download shipped in `2026-06-17-sync-content-download` works, but its UX is weak:

1. **No visible/background progress.** `runCatchUp` is a fire-and-forget promise held in `SettingsPanel` local React state. The long **scrape phase** (minutes of polling in `runScrapeToBlob`) discards its `onState`, so it shows nothing; the import phase only surfaces where the import UI is mounted; and leaving Settings drops the panel's `catchUps`/`fetching` state, so a running download appears to fail silently. (The series-page "Update from source" has the *same* discarded-`onState` gap.)
2. **The series doesn't exist until success.** For a **missing** series there is no library entry until the import completes, so a failed download leaves nothing to retry from except Settings' ephemeral list.

## Decisions (confirmed)

1. **Placeholder title** — a missing series is created immediately with a readable name derived from the source URL slug; the import renames it from the ZIP manifest on success.
2. **Unify progress** — one tracker for both the Settings-initiated catch-up *and* the series-page "Update from source", so both get the scrape progress bar.
3. **Background scope** — in-app background (a module-level runner + the existing global store that survives navigation). True cross-app-close background (Service Worker Background Sync) is out of scope, noted as a follow-up.

## Existing infrastructure we build on

- **`useBackgroundStore`** (`src/features/background/background.store.ts`) — a **single-slot** tracker (`start`/`update`/`finish`, `current: { id, kind, label, subLabel, progress }`). `start` returns `false` when a task is already running. Lives at module scope, so it already survives navigation.
- **`BackgroundTaskBar`** — mounted globally in `src/App.tsx`, renders `useBackgroundStore.current` as a progress bar on every screen.
- **`importBridge`** (`src/features/background/importBridge.ts`) — mirrors the import store into the background bar (import phase progress already shows).
- **`updateFromSource`** / **`tokenRunScrape`** / **`runScrapeToBlob`** (the latter calls `onState(state)` each poll — currently fed a no-op everywhere).

The single-slot model is a feature here: catch-ups run **serially** ("Fetch all" loops), and the slot guards against colliding with imports/deletes.

## Architecture

### A. Series shell first + `pendingCatchUp` marker

Add `Series.pendingCatchUp?: { syncedChapter: number; syncedPage: number } | null` (Dexie **v7** migration backfills existing rows to `null`).

When a download starts:
- **Missing series:** create a `Series` row now — `sourceUrl` set, `title` = a slug derived from the URL (e.g. `qimanhwa.com/manga/solo-leveling` → "Solo Leveling"), `caughtUp: false`, `pendingCatchUp: { syncedChapter, syncedPage }`. It appears in the library immediately as an "incomplete" entry.
- **Behind series:** set `pendingCatchUp` on the existing row.

`pendingCatchUp` is the durable record of an in-flight/failed catch-up and its target. It is **cleared on success**. It drives the series-page "Resume" affordance and lets a resume prune correctly (it carries the synced chapter; `initial` is still `!caughtUp`).

The download imports into this row (`context: 'series'`, `targetSeriesId`) for both missing and behind — so no duplicate series is created and a failure leaves the shell intact.

### B. The download runner (module-level, tracked, resilient)

A module-level `runSyncDownload(target, opts?)` in `src/features/sync/syncDownload.ts` replaces the inline `runCatchUp` call path:

1. Ensure the series shell exists with `sourceUrl` + `pendingCatchUp` (section A).
2. `useBackgroundStore.start({ kind: 'sync-download', label: 'Downloading <title>', progress: null })`. If it returns `false` (slot busy), the caller (e.g. "Fetch all") awaits and retries — downloads are serial.
3. **Scrape** via `tokenRunScrape(onState)` where `onState` now calls `useBackgroundStore.update(...)` — `subLabel` reflects the polled run state ("Fetching chapters…", indeterminate progress). On scrape completion, `finish()` this task so the **import phase** is shown by the existing `importBridge` (the bar hands off scrape → import seamlessly).
4. **Import** the blob (awaited via `importToCompletion`).
5. **Finalize:** prune-below-synced on `initial`, set the reading position to the synced page (forced, clamped), `setCaughtUp` on `initial`, and **clear `pendingCatchUp`**. The synced-chapter-absent guard from the existing `catchUpRun` is retained: if the fetched window lacks the synced chapter, do not prune, do not clear `pendingCatchUp`, leave it retryable. To distinguish these, `catchUpRun` gains a return value (e.g. `'done' | 'incomplete'`); `runSyncDownload` clears `pendingCatchUp` only on `'done'`.
6. **On any failure:** `finish()` the bar task with a surfaced error; the series shell + `pendingCatchUp` remain, so it is retryable.

`runSyncDownload` is the single entry point for Settings catch-ups, "Fetch all", and series-page resume/update. Because the runner and the background store are module-level, navigating away from Settings does not interrupt or hide it.

`catchUpRun` (the existing fetch→import→prune→position→flag orchestration) is reused as the core of step 3-5; `runSyncDownload` wraps it with the shell creation, background-store tracking, and `pendingCatchUp` lifecycle.

### C. Series-page resume + unified auth

- The **SeriesScreen** shows, when `series.pendingCatchUp != null`, an "incomplete — Resume download" affordance that calls `runSyncDownload` for that series (using the stored `pendingCatchUp` target).
- The series-page **"Update from source"** is routed through the same runner so it gets the scrape progress bar. When the device is **enrolled**, it uses **device-token auth** (`tokenRunScrape`, no OTP prompt); when not enrolled, it falls back to the existing OTP path. (Catch-up downloads are always token-authed.)
- A new series shell with no chapters renders in the library with an "incomplete/downloading" indicator (reuse the existing cleared-state UI pattern, e.g. the `lastKnownMaxOrder` "N / M" breadcrumb, plus a pending badge).

### D. Settings list

`SettingsPanel`'s catch-up list now calls `runSyncDownload` (not the inline `runCatchUp`) and reads the active task from `useBackgroundStore` for the in-progress/disabled state, instead of its own `fetching` flag. The optimistic list-item removal stays; the next "Sync now" re-derives the list from the full pull (already fixed).

## Components

**New:**
- `src/db` migration **v7** + `Series.pendingCatchUp` field (`types.ts`, `db.ts`).
- `src/db/repos/series.repo.ts` — `setPendingCatchUp(id, target | null)`, `createSeriesShell({ profileId, sourceUrl, title })` (or extend `createSeries`).
- `src/features/sync/sourceUrlTitle.ts` — pure `titleFromSourceUrl(url): string` (slug → title-case).
- `src/features/sync/syncDownload.ts` — `runSyncDownload(target, opts?)` (the runner; background-store tracking + shell + `pendingCatchUp` lifecycle, wrapping `catchUpRun`).

**Modified:**
- `src/features/background/background.store.ts` — add `'sync-download'` to `BackgroundTaskKind`.
- `src/features/sync/catchUpRun.ts` — expose enough for `runSyncDownload` to reuse (or `runSyncDownload` calls `catchUpRun` with a `runImport` that bridges; the shell + flag lifecycle moves to `runSyncDownload`).
- `src/features/sync/defaultRunScrape.ts` — `tokenRunScrape` already takes `onState`; no change beyond confirming it threads through.
- `src/features/library/SettingsPanel.tsx` — call `runSyncDownload`; derive busy state from `useBackgroundStore`.
- `src/features/series/SeriesScreen.tsx` — "Resume download" when `pendingCatchUp`; route "Update from source" through `runSyncDownload`; prefer token auth when enrolled.
- `src/features/library/SeriesCard.tsx` (and/or `ContinueCard`) — pending/incomplete badge for a shell series.

## Data flow

```
Settings → "Fetch" (or series page → "Resume")
  └─ runSyncDownload(target)
       ├─ ensure series shell (create missing w/ slug title + sourceUrl; set pendingCatchUp)
       ├─ bg.start('sync-download', 'Downloading <title>')
       ├─ scrape (tokenRunScrape, onState → bg.update)   ← scrape progress now visible
       ├─ bg.finish(scrape task)  → importBridge shows import progress
       ├─ importToCompletion(blob into targetSeriesId)
       ├─ on success: prune-on-initial → set position → setCaughtUp → clear pendingCatchUp
       └─ on failure: bg.finish + surface error; shell + pendingCatchUp remain (retryable)
```

## Error handling

- Scrape/import failure: error surfaced (bar finishes; Settings/series show the message). Series shell + `pendingCatchUp` persist → retry from the series page or Settings.
- Synced chapter absent after fetch (initial): no prune, `pendingCatchUp` kept (retryable), not `caughtUp`. (Carried over from existing `catchUpRun` hardening.)
- 401 (token revoked): clears creds (existing `SyncAuthError` handling), surfaces re-enroll.
- Background slot busy: serial — caller awaits; no overlap with imports/deletes.

## Testing

- `titleFromSourceUrl` — pure, several URL shapes.
- v7 migration backfills `pendingCatchUp: null`; `setPendingCatchUp` round-trips and clears.
- `runSyncDownload` (integration, fakes for scrape/import + a fake background store or the real one):
  - missing → creates shell with sourceUrl + slug title + pendingCatchUp; on success clears pendingCatchUp + sets caughtUp + position; bar started/finished.
  - behind → sets pendingCatchUp; success path as above; no duplicate series.
  - scrape failure → shell + pendingCatchUp remain; bar finished with error; not caughtUp.
  - synced-chapter-absent → no prune, pendingCatchUp kept.
  - serial: `start` returns false while a task runs → second call waits/guards.
- `onState → bg.update` wiring asserted (scrape progress reflected in the bar).
- SeriesScreen: "Resume" shown only when `pendingCatchUp` set (component test or logic-level).

## Extended scope

These were initially deferred; now in scope, built as later phases on top of the core.

### E. Parallel downloads — a pipelined download queue

The single-slot model is replaced (for sync downloads) by a module-level FIFO **download queue** that **pipelines** rather than truly parallelises: the Pi worker is itself serial (concurrent `POST /scrape` just queue there) and imports must stay serialized on the one import worker + IndexedDB. So the queue keeps **one scrape in flight ahead** of the **serial import lane** — while series A imports, series B can be scraping on the Pi; when both are ready, B imports next.

- The queue owns a **single** `useBackgroundStore` "batch" task ("Downloading 2 of 5 — Solo Leveling"); per-item scrape state and import progress are mirrored into that one task, so the single-slot store and `BackgroundTaskBar` are unchanged. Other ops (manual import/delete) still see the slot as busy → no IDB contention.
- Imports remain **strictly serial** (the existing import worker; never two ZIPs importing at once).
- Scrape-ahead concurrency cap = 1 (one Pi job queued ahead; configurable constant). Higher caps add no speedup because the Pi serializes.
- "Fetch all" enqueues all candidates at once (instead of awaiting each); per-series **failures don't abort the batch** — they're recorded (the series keeps its `pendingCatchUp`) and the queue continues.

### F. Background sync — resume across app close

Built on the durable `pendingCatchUp` markers (the persistent work-list) rather than running the import inside the Service Worker (a SW running the Dexie import pipeline is the deep version; out of scope). Two mechanisms:

1. **Auto-resume on launch.** On app start, enqueue every series with a non-null `pendingCatchUp` into the download queue, so an interrupted download resumes the next time the app opens. Guarded by `isEnrolled()` + a configured Pi base; silent best-effort (failures just leave `pendingCatchUp` for the next launch).
2. **Background Sync registration.** When a download is pending, register a one-off Background Sync tag (`verreaux-resume-downloads`) via `ServiceWorkerRegistration.sync.register(...)` where supported. The custom SW `sync` handler does **not** run the import; it wakes/focuses an existing client (or shows a notification when permitted) so the in-page queue resumes. Where **Periodic Background Sync** is available and permission granted, register `verreaux-check-updates` to periodically pull positions and surface new catch-ups. Feature-detected; a no-op (relying on auto-resume-on-launch) where unsupported (e.g. iOS Safari).

The PWA build switches from vite-plugin-pwa `generateSW` to **`injectManifest`** with a custom `src/sw.ts` so we can add the `sync`/`periodicsync` handlers while keeping Workbox precaching.

## Out of scope

- **SW-side execution of the import** (scraping + Dexie import running entirely in the Service Worker while the app is closed) — the deep version of background sync; the `pendingCatchUp` queue + auto-resume + Background Sync nudge above deliver most of the value without it.
- **True N-way parallel imports** — intentionally serialized (IDB write safety).
- No backend/Pi changes.
