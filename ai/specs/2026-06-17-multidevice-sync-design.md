# Design: Multi-device sync — accounts, device registry & reading-position sync (Spec 1)

**Date:** 2026-06-17
**Status:** Approved in brainstorming (pending spec review)
**Repos:** `verreaux` (PWA client) and `verreaux-scraper` (Pi `api` + new Postgres sidecar)
**Backlog origin:** `ai/future-ideas.md` items #4 (profiles → multi-user/device) and #5
(reading-position sync). Item #3 (1-day ZIP TTL) already shipped and is a dependency
for the deferred download-sharing (Spec 2).

## Problem & goals

A user reads the same series on multiple devices. Today everything is local:
profiles, library, and reading progress live only in each browser's IndexedDB.
We want a device to **sync its reading position** to the user's other devices,
behind a lightweight account, so progress follows the reader across devices.

**Goals (Spec 1):**
- An authenticated **account** (username + passcode) that owns a list of **devices**.
- A device **enrolls once** (gated by the existing authenticator TOTP) and then
  syncs with a long-lived per-device token — no OTP on routine syncs.
- **Reading-position sync** across a user's devices with a specific conflict rule
  ("furthest position wins, but the owning device may deliberately go back").

**Non-goals (deferred to Spec 2):** sharing the large scraped ZIPs between devices.
That reuses this spec's accounts/devices/token + the 1-day ZIP TTL and is its own
spec/plan.

## Key constraints discovered in the codebase

- Local `Profile` rows (`id, name, avatarColor, createdAt, lastActiveAt`) have **no
  auth** today; profile selection is per-browser.
- `ReadingProgress` is keyed by `[profileId+seriesId]` and stores
  `currentChapterId` (a **local UUID**), `pageIndex`, `scrollPosition`, `updatedAt`,
  `manuallyMarked`.
- **`seriesId` and `currentChapterId` are local UUIDs** that differ per device and
  change on re-import. Cross-device sync therefore MUST key on stable identifiers:
  - **Series identity = `sourceUrl`** (added in the prior feature). Series without a
    `sourceUrl` do not sync (local-only until back-filled).
  - **Position = chapter `order` + `pageIndex`.** The codebase already treats chapter
    `order` as the stable per-series resume key (`lastReadChapterOrder`,
    `[seriesId+order]` index).
- The Pi compose stack is currently `worker` + `api` + `flaresolverr`; there is **no
  database service**. The `api` container is Node `http`, CORS-enabled, OTP-gated,
  and Funnel-exposed.

## Decisions (from brainstorming)

| Topic | Decision |
| --- | --- |
| Backend store | **Postgres sidecar** in the Pi compose stack |
| Device auth | **Enroll once (passcode + TOTP) → long-lived device token**; tokens on routine syncs |
| Enrollment gate | Reuses the **existing shared TOTP secret** (same `SCRAPE_TOTP_SECRET`), not per-account TOTP |
| Device storage | **`devices` JSONB column** on the account row (per the requested design) |
| Account ↔ local profile | **1:1** for now (a device links its active profile to the account) |
| Series identity | **`sourceUrl`**; non-sourced series are local-only |
| Position fields synced | **`chapterOrder` + `pageIndex` + `manuallyMarked`**; `scrollPosition` stays local |
| Conflict timestamps | **Server-assigned** `updated_at` (immune to device clock skew); track `owner_device` |
| Cadence | Push on **chapter change + app background/close + periodic flush**; pull on app/series open |
| Scope | Spec 1 = accounts/devices/auth + position sync. Download sharing = Spec 2 |

## Architecture

```
PWA (any device, off-network via Funnel)        Pi
────────────────────────────────────────        ──────────────────────────────────────────
Settings: enroll (username/passcode/OTP)         docker compose:
  store {accountId, deviceToken} locally           api  (Node http) ── new sync endpoints
                                                      │  PG client
reading → on chapter change / background /            ▼
  periodic:  PUT /sync/position (Bearer token)     postgres (sidecar)
on app/series open:  GET /sync/positions?since       accounts(username, passcode_hash, devices JSONB)
  → map sourceUrl→local seriesId,                    reading_positions(account, source_url,
        chapterOrder→local chapterId, reconcile        chapter_order, page_index, owner_device,
                                                        manually_marked, updated_at)
  worker / flaresolverr — unchanged
```

The `api` service owns the sync endpoints + the Postgres connection. The `worker`
and `flaresolverr` are unchanged. Auth for sync endpoints is the device token;
enrollment/account-changes additionally require an OTP from the shared secret.

## Data model (Postgres)

```sql
CREATE TABLE accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT UNIQUE NOT NULL,
  passcode_hash TEXT NOT NULL,            -- scrypt/argon2
  devices       JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reading_positions (
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_url      TEXT NOT NULL,
  chapter_order   NUMERIC NOT NULL,       -- NUMERIC tolerates 12.5-style orders
  page_index      INTEGER NOT NULL,
  owner_device    TEXT NOT NULL,          -- device id that set the current value
  manually_marked BOOLEAN NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, source_url)
);
```

**`devices` JSONB element shape:**
```json
{ "id": "<uuid>", "name": "Johnny's iPad", "token_hash": "<hash>",
  "created_at": "<iso>", "last_seen_at": "<iso>" }
```
Trade-off accepted: a JSONB list (vs a normalized `devices` table) makes revoke /
last-seen updates a JSONB rewrite rather than a row update; acceptable at this scale.

## Auth & enrollment

- **`POST /enroll` `{ username, passcode, otp, deviceName }`**
  1. Validate `otp` against the shared `SCRAPE_TOTP_SECRET` (reuses `src/pi/totp.ts`).
     Invalid → 401.
  2. If `username` exists → verify `passcode` against `passcode_hash` (mismatch → 401).
     Else create the account with `passcode_hash`.
  3. Generate a random `deviceToken`; append `{ id, name: deviceName, token_hash,
     created_at, last_seen_at }` to `accounts.devices`.
  4. Return `{ accountId, deviceId, deviceToken }`. The PWA stores these locally
     (token in plaintext on the device only).
- **Routine sync auth:** `Authorization: Bearer <deviceToken>`. The server hashes the
  presented token and finds the matching account+device in the JSONB list; updates
  `last_seen_at`. No OTP. Unknown/removed token → 401.
- **Account changes** (change passcode, add another username, **revoke a device**)
  require a fresh OTP, same as enrollment.
- Passcodes hashed with scrypt/argon2; device tokens hashed at rest; never logged.

## Reading-position sync

### Endpoints (device-token auth)
- **`PUT /sync/position` `{ sourceUrl, chapterOrder, pageIndex, manuallyMarked }`**
  → runs the merge atomically for `(account, sourceUrl)`; returns the resulting
  authoritative `{ chapterOrder, pageIndex, ownerDevice, manuallyMarked, updatedAt }`.
- **`GET /sync/positions?since=<iso>`** → all positions for the account changed since
  `since` (for app-open pull). Omit `since` for a full snapshot.

### Merge algorithm (pure, server-side, atomic)

Position ordering: compare `chapterOrder`, then `pageIndex` (numeric). Define
`POS(p) = (p.chapterOrder, p.pageIndex)`.

Given `incoming` (with `device`) and the stored `current` (with `owner_device`):
1. **No `current`** → adopt `incoming`; `owner_device = device`.
2. **`POS(incoming) > POS(current)`** → adopt `incoming`; `owner_device = device`.
   *(furthest wins — device-2 p21 over device-1 p1; p25 over p21)*
3. **`POS(incoming) < POS(current)` AND `device === current.owner_device`** → adopt
   `incoming`; keep `owner_device = device`.
   *(the owning device deliberately went back — accept device-2 → p1)*
4. **Otherwise** (a behind, non-owner device, or `POS(incoming) == POS(current)`) →
   keep `current` unchanged.
   *(ignore device-1's stale p1)*

`updated_at` is set by the server on every adopt. Atomicity via
`INSERT … ON CONFLICT … DO UPDATE` guarded by the rule, or a `SELECT … FOR UPDATE`
+ update inside one transaction, so concurrent device writes can't interleave.

`manuallyMarked`: a manual mark sets the position to that chapter (existing app
semantics) and participates in the same comparison — a forward manual mark wins
via rule 2; a backward manual mark only via rule 3 (owner). The merged
`manually_marked` flag travels with the adopted value.

### Edge cases
- **Fractional chapter orders** (e.g. 12.5): `NUMERIC` + numeric compare handles them.
- **Differing page counts** across devices/re-imports: page compared as a raw index;
  if a pulled `pageIndex` exceeds the local chapter's page count, clamp to last page
  on apply (client side).
- **No `sourceUrl`**: series is skipped entirely (local-only).
- **Tie** (`==`): rule 4 keeps current (no churn).

## PWA client integration

New modules under `src/features/sync/`:
- **`accountClient.ts`** — `enroll(...)`, local credential storage
  (`{accountId, deviceId, deviceToken}` in localStorage), `listDevices()`,
  `revokeDevice()`. Injectable `fetch` for tests.
- **`positionSync.ts`** — `pushPosition(...)` (debounced queue, retry, offline-tolerant)
  and `pullPositions(since)` → reconcile. Injectable deps.

Integration points:
- **Settings → "Sync account":** enroll form (username, passcode, OTP, device name);
  show enrolled devices + revoke. Links the active local profile to the account 1:1.
- **Push:** wrap the existing `upsertProgress` / `setManuallyMarked` calls; when the
  series has a `sourceUrl`, enqueue a debounced push. Flushed on **chapter change**,
  **`visibilitychange`/`pagehide`** (app background/close), and a **periodic timer**.
- **Pull/reconcile (app open + series open):** `GET /sync/positions?since=<lastPull>`;
  for each, resolve the local series by `sourceUrl`
  (`series.where('sourceUrl').equals(...)`), resolve the chapter by
  `[seriesId+order]`, and if the server position is "ahead" by the same comparison,
  update local `readingProgress` (reset `scrollPosition` to 0). Server-ahead only —
  never regress local progress from a stale pull (the server already merged).
- The Pi API base URL + enrollment reuse the existing Settings field/flow.

## Error handling

- **401 (bad/revoked token)** → clear local creds, prompt re-enroll.
- **Offline / network error** → position pushes queue and retry with backoff; pulls
  are best-effort. Reading is **never blocked** by sync.
- **Concurrent device writes** → resolved server-side under a row lock/transaction;
  the merge is authoritative.
- **Missing `sourceUrl`** → skip sync for that series.
- **Clock skew** → server timestamps only; the merge never trusts device clocks for
  ordering (it uses position, not time).

## Testing

- **Merge algorithm** — pure function, exhaustive unit tests: the three scenarios from
  the brief (device-2 p21 vs device-1 p1 → keep p21; device-2 → p1 owner regression;
  either → p25), plus no-current, tie, non-owner regression rejected, fractional
  orders, manual-mark forward/backward.
- **Enroll/auth** — OTP gate (bad/good), new vs existing username, passcode verify,
  token issue + verify + revoke, `last_seen_at` update. Run against a test Postgres or
  `pg-mem`.
- **Client** — `accountClient.enroll` stores creds (stubbed fetch); `positionSync`
  debounce + trigger on chapter-change/visibility/periodic; pull-reconcile maps
  `sourceUrl→seriesId` and `order→chapterId` and only advances when server is ahead;
  offline queue + retry.
- **End-to-end (manual, two browser profiles):** read on "device A", confirm position
  appears on "device B" after pull; verify the regression + furthest-wins behaviors.

## Build phasing (within Spec 1)

1. Postgres sidecar in compose + schema/migration; `api` gains a PG client.
2. Enrollment + device-token auth (`/enroll`, token middleware, revoke).
3. Position endpoints + the merge (pure function first, TDD).
4. PWA `accountClient` + Settings enroll UI.
5. PWA `positionSync` push (triggers/debounce) + pull-reconcile.
6. Manual two-device E2E.

## Deferred (Spec 2 — download sharing)

Cross-device sharing of the large scraped ZIPs: a device lists/pulls a sibling
device's recent download within the 1-day TTL window, using the same accounts +
device tokens. Separate spec/plan once Spec 1 ships.

## Confirmed defaults (flagged in review)

- Enrollment/account-changes reuse the **existing shared TOTP secret** (not per-account TOTP).
- **`devices` as a JSONB column** (not a normalized table).
- **Account ↔ local profile is 1:1**.
- **`scrollPosition` is not synced** (chapter + page only).
