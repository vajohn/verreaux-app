# Verreaux — Future Ideas / Backlog

Captured 2026-06-17, after the Pi scraper service + PWA source-url/update feature
shipped and the GitHub Actions scrape flow was decommissioned. These are ideas,
not yet specs — brainstorm + write a proper spec (`ai/specs/`) before building.

---

## 1. Cross-site search in the PWA

**Want:** a search box in the PWA that finds a manhwa across the sites the
scraper already supports, so the user picks a result instead of pasting a URL.

**Shape (rough):**
- Scraper side: each adapter that can search exposes a `search(query)` capability
  returning `{ title, seriesUrl, cover, site }[]`. Add a Pi API endpoint
  `GET /search?q=...` (OTP-gated, CORS) that fans the query across adapters.
- PWA side: a search field → calls the Pi `/search` → renders results (cover +
  title + site) → tapping a result runs the existing **Add from URL** flow with
  that `seriesUrl` (full range).
- Adapters vary: some have real search endpoints, others only category/listing
  pages. Start with the adapters that have a search/AJAX endpoint (manhwanex is
  Madara/wp-manga → has search; qimanhwa has an `/api` — check it exposes search).
- Open questions: per-site rate limiting; ranking/merging results across sites;
  de-duping the same series found on multiple sites.

## 2. Adaptive update scheduling (scheduler on the PWA, not the Pi)

**Want:** intelligently re-check series for new chapters based on each series'
*observed* update frequency — and run that scheduling **in the PWA**, so the Pi
stays a dumb request-receiver and isn't overloaded.

**Shape (rough):**
- Per series, track update cadence: timestamps of when new chapters appeared
  (derive from import history / `lastKnownMaxOrder` changes). Estimate a
  next-check interval (e.g. weekly series → check ~daily near the expected drop;
  dormant series → back off to monthly).
- The PWA owns the schedule + decides *when* to act (it already has `sourceUrl`,
  `lastKnownMaxOrder`, and the `updateFromSource` flow). The Pi only receives a
  normal `POST /scrape` when the PWA decides it's time — no cron/scheduler on the
  Pi, no standing load.
- Browser scheduling realities: a web app can't reliably run background jobs when
  closed. Options to evaluate: run checks opportunistically on app open; a
  Periodic Background Sync (limited browser support); or a lightweight
  "due for update" list surfaced when the user opens the app. Keep the Pi
  stateless w.r.t. scheduling regardless.
- Politeness/concurrency: the Pi worker is already strictly serial (one scrape at
  a time) — the PWA should also avoid firing many updates at once; queue/spread
  them so the Pi isn't hammered.
- Open questions: where the cadence model + schedule live (IndexedDB), how to
  show "N series due", manual override, and backoff when a check finds nothing.

## 3. ZIP retention / cleanup on the Pi (gap found in testing)

**Problem (current):** the Pi keeps **every** run's output in
`~/verreaux/data/done/<id>/` forever — there is no cleanup. ZIPs are large
(one qimanhwa series ≈ 356 MB), so the SD card/disk will fill over time. The old
GitHub flow auto-expired artifacts after 7 days; the Pi has no equivalent.

**Shape (rough):**
- Add a retention policy to the worker/api: prune `done/<id>/` entries older than
  N days (and/or once a run's ZIP has been downloaded, and/or cap total size).
- Candidates: a periodic prune in the worker entrypoint (it's already long-lived),
  or a tiny cron in the container; delete on a TTL and/or after a successful
  `GET /output.zip`.
- Decide: delete-after-download vs time-based vs size-cap (or a combination), and
  whether to keep `status.json`/`run.log` longer than the (large) ZIP for
  debugging.
- Until built: periodically clear it manually on the Pi —
  `rm -rf ~/verreaux/data/done/*` (only removes finished outputs).
