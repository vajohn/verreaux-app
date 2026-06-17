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

## 3. ZIP retention / cleanup on the Pi — DONE (1-day TTL)

**Shipped** (scraper `fbeab6a`): the worker prunes `done/<id>/` dirs older than
`DONE_TTL_HOURS` (default **24h**) on startup + hourly. The 1-day window is
deliberate: it gives a device time to download/sync a fresh scrape to other
devices (see #4/#5) before the large ZIP is reclaimed. Needs the Pi rebuilt
(`git pull && docker compose build && up -d`) to take effect.

Possible later refinements: also delete-after-successful-download, or a total
size cap, and keep `status.json`/`run.log` longer than the ZIP for debugging.

---

## 4. Profiles → multi-user + multi-device (sync foundation)

**Want:** extend the existing local `Profile` concept into authenticated users
that can own multiple devices, so a recent download on one device can be synced
to another.

**Shape (rough):**
- A profile (for now) = **username + passcode**. **Adding or changing a user
  requires the authenticator (TOTP) code** — same gate the scraper already uses.
- Server-side store (the **JSONB** hint ⇒ likely **Postgres**, new — the Pi
  currently only has a per-run SQLite for resume): a `users` row per username,
  with a **`devices` JSONB column** = list of devices belonging to that username.
- Purpose: with the device registry + the 1-day ZIP window (#3), a device can
  pull a sibling device's recent download.
- Architectural note: this turns the Pi from "dumb scraper" into also a small
  **sync hub** (accounts, device registry, reading positions, transient ZIPs).
  Scraping *scheduling* still stays on the PWA (#2) so scrape load doesn't grow;
  only lightweight sync state lives on the Pi.
- Open questions: passcode hashing/storage; how a device registers (and is named)
  in the JSONB list; relation between these server users and the existing local
  IndexedDB `Profile` rows; transport (extend the OTP-gated Pi API).

## 5. Cross-device reading-position sync (conflict rule)

**Want:** sync reading position (series → chapter → page) across a user's
devices, with a specific merge rule — *"the latest page with recent sync status
is king."*

**The rule, from the examples given:**
- **Furthest position generally wins.** Compare by (chapter, then page).
  - Device 2 synced *yesterday* @ ch12 **p21**; Device 1 syncs *today* @ ch12
    **p1** → keep **p21** (device 2's). A more-*recent* sync that is *behind*
    does NOT override a further position.
  - Either device reports ch12 **p25** → update to **p25** (furthest wins).
- **A deliberate regression is honored only from the device that owns the
  current "king" position.**
  - If **device 2** (the one whose p21 is current truth) itself now reports ch12
    **p1** → accept **p1** ("it went back for some reason").
  - (A *different*, behind device reporting an earlier page is ignored — that's
    the device-1 case above.)

**Implementation sketch:** per `(user, series)`, track each device's last-synced
position + which device set the current value. On incoming sync:
1. if `incoming > current` (further) → adopt (record the new owning device);
2. else if `incoming < current` **and** `incoming.device === current.owner` →
   adopt the regression;
3. else → ignore (a behind device).

**Open questions / edge cases to design:** chapters that aren't simple integers
(e.g. 12.5); page counts differing between devices/re-imports; defining "owner"
cleanly; whether `manuallyMarked` progress overrides the rule; and how this rides
on the #4 sync backend + transport.
