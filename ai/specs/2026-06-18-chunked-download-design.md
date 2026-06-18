# Chunked Catch-Up Download — Design

**Date:** 2026-06-18
**Status:** Approved (pending spec review)
**Repo:** `verreaux-app` (PWA). **No backend/Pi change.**

## Problem

A catch-up over a large window downloads as one ZIP — e.g. `70→167` = 98 chapters = **1.18 GB** — which the PWA ingests by fetching the whole file, holding it as one in-memory `Blob`, and importing into IndexedDB. On a phone that reliably OOMs, hits the storage quota, or stalls over the Tailscale Funnel, and the failure is invisible (it's in the browser, not the Pi — confirmed: the Pi produced a valid 1.18 GB ZIP that the device never ingested). The Pi-side cache-assist only avoids *re-scraping*; the device still must ingest the full window.

## Decisions (confirmed)

- **Decompose device-side**, no Pi change — the Pi already serves bounded `--from A --to B` ranges + cache-assist.
- **Batch size N = 10 chapters** (~120 MB at ~12 MB/chapter), exposed as a Settings number.
- **Iterate-until-empty** end discovery — keep requesting ascending batches until one comes back completely empty (`ERR_EMPTY_RANGE`). No probe / no "ask for latest" round-trip. Robust to numbering gaps narrower than N.
- **Read-as-it-arrives** — ascending batches from the synced chapter; the first batch makes the series readable immediately; the rest fill in behind.

## Architecture

The per-series catch-up changes from a single `syncedChapter→latest` scrape into a **sequential batch loop**, `runChunkedCatchUp(candidate, deps)`, which both `runSyncDownload` (single "Fetch" / series-page "Resume") and the queue (`enqueueLiveDownloads` for "Fetch all" / auto-resume) delegate to. The background bar + `pendingCatchUp`/`caughtUp` lifecycle and the queue's serialization are unchanged in shape; only the body that was "one scrape + import + finalize" becomes the loop.

### The batch loop

For an initial catch-up at window start `from` (= `syncedChapter`; on resume, `= localMax+1`):

```
batchStart = from
loop:
  to = batchStart + N - 1
  blob = scrape(--from batchStart --to to)          // token auth; bounded range
  if scrape returned EMPTY (ERR_EMPTY_RANGE):        // no chapters in [batchStart..to]
    break                                            // end of series reached
  import(blob into the series shell)                 // serial; pipeline skips existing
  if the synced chapter is NOT yet present locally:  // i.e. the FIRST batch that brings it in
    prune chapters below syncedChapter (once)
    set reading position to syncedChapter / syncedPage   // ← readable now
  batchStart += N
end loop
setCaughtUp; clear pendingCatchUp                    // full window done
```

- **Bounded `--to`** returns the available subset when it overflows `latest` (e.g. `--from 160 --to 169` with latest 167 → chapters 160-167, a short final batch); only a *fully* out-of-range request (e.g. `--from 170` when latest is 167) yields `ERR_EMPTY_RANGE`, which is the loop's terminator.
- **First-batch prune/position is gated on "synced chapter not yet local"**, not on a batch counter — so a **resume** (where the synced chapter is already imported) correctly skips the prune and just keeps appending. This reuses the existing `finalizeCatchUp` prune+position logic, applied once.
- Each batch's bounded range still benefits from the **Pi cache-assist** (reuses cached chapters in `[batchStart..to]`, scrapes only gaps).
- The synced-chapter-absent guard carries over: if the **first** batch is empty / never brings in the synced chapter, do **not** prune and do **not** `setCaughtUp` — leave `pendingCatchUp` for retry (outcome analogous to today's `'incomplete'`).

### Non-initial (plain update) path

A `caughtUp` series that has fallen behind updates the same way: chunk ascending from `localMax+1`, no prune, no position reset, no `caughtUp` re-flip — just append new chapters in batches until empty.

### Queue integration

`enqueueLiveDownloads` keeps **one item per series**; each item's work is the series' `runChunkedCatchUp` loop (batches run sequentially within a series; the queue serializes across series). The single aggregate background-bar task shows progress as **"Downloading <title> — batch K"** (K increments per imported batch; total is unknown until the empty terminator, so the label counts up rather than showing "of M"). Per-series isolation in the queue is unchanged (a failed series keeps its `pendingCatchUp`, the batch continues to the next series).

*(Cross-batch scrape-ahead — scraping batch K+1 on the Pi while batch K imports on the device — is a possible future optimization. The baseline is strictly sequential per series: reliability and incremental availability are the goals, and the Pi scrapes serially anyway.)*

## Lifecycle & resume

- `pendingCatchUp` (set at start, holds the window's `syncedChapter`/`syncedPage`) persists across all batches; it is cleared (and `caughtUp` set) only when a batch returns the empty terminator. A failure or app-close midway leaves the series with the batches imported so far (**readable from the synced chapter**) + `pendingCatchUp`.
- **Resume** (auto-on-launch or series-page "Resume download") recomputes `from = localMax + 1` (highest local chapter + 1) and re-enters the loop. Already-imported chapters are skipped by the import pipeline; the prune is skipped because the synced chapter is already local. So resume is just "continue from where the local chapters end."
- Per-batch transient failure (network/scrape error that is *not* an empty range) aborts the current series' loop, leaving it resumable from `localMax+1`; it does not corrupt earlier batches (each batch is its own committed import).

## Settings

A "Download batch size (chapters)" number, default **10**, stored in localStorage (alongside the Pi API base / sync settings). `runChunkedCatchUp` reads it; clamps to a sane range (e.g. 1–50).

## Testing

- **Batch range generation:** ascending bounded ranges from `from`, step N; partial final batch; first batch = `from`.
- **Loop termination:** stops on the first fully-empty (`ERR_EMPTY_RANGE`) batch; a short final batch (fewer than N) followed by an empty one ends cleanly.
- **First-batch gating:** prune-below-synced + set-position happen exactly once, on the batch that first brings in the synced chapter; not repeated on later batches; **skipped on resume** when the synced chapter is already local.
- **Read-as-it-arrives:** after the first batch imports, the reading position is set and the chapters are queryable (series readable) before the loop finishes.
- **Resume:** with chapters `70–99` already local + `pendingCatchUp` set, a resume computes `from = 100`, continues, and does not re-prune; clears `pendingCatchUp` + sets `caughtUp` when the tail empties.
- **Empty first batch:** no prune, no `caughtUp`, `pendingCatchUp` retained.
- **Incremental import:** importing one bounded batch never holds more than one batch's blob; the existing import-skips-existing keeps re-fetched boundary chapters from duplicating.
- **Settings batch size:** honored + clamped.
- Existing `runSyncDownload` / queue / `finalizeCatchUp` tests stay green (the refactor is behavior-preserving for the single-batch case where the window ≤ N).

## Out of scope

- **Cross-batch scrape-ahead** pipelining (sequential batches for now).
- **Probe-for-latest** end discovery (iterate-until-empty chosen).
- **Size-based** chunking (chapter-count batches; chapter byte size is unknown until scraped).
- Any backend/Pi change.
