# Dual Pi API URL (Local / Remote toggle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the user store two Pi API URLs — **Local** (LAN, fast, home only) and **Remote** (Funnel, works anywhere) — and a toggle to activate exactly one for all sync/scrape/download, so there's no URL memorizing.

**Architecture:** `getApiBase()` resolves to the active slot's URL. All existing callers (`piClient`, `syncClient`) keep calling `getApiBase()` unchanged. Settings gets two URL inputs + a Local/Remote segmented toggle. A one-time migration copies the existing single URL into the Remote slot (default mode Remote), so nothing changes until the user fills in Local and flips the toggle.

**Tech Stack:** Vite + React + TS; vitest (jsdom). PWA-only, no backend change. Authoritative typecheck: `npx tsc -p tsconfig.app.json --noEmit`; build: `npm run build`.

**Approved design (decisions):** default mode after migration = **Remote**; labels = **"Local" / "Remote"**; manual toggle (no auto-detect).

---

### Task 1: Two-URL + mode API in piClient (+ migration)

**Files:**
- Modify: `src/features/sync/piClient.ts`
- Test: `test/unit/piApiConfig.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import {
  getApiBase, setApiBase,
  getPiApiMode, setPiApiMode, getPiApiUrl, setPiApiUrl,
} from '../../src/features/sync/piClient';

afterEach(() => localStorage.clear());

describe('dual Pi API URL', () => {
  it('per-slot get/set + mode + getApiBase resolves the active slot', () => {
    setPiApiUrl('local', 'http://192.168.1.107:8080/');
    setPiApiUrl('remote', 'https://pi.ts.net');
    expect(getPiApiUrl('local')).toBe('http://192.168.1.107:8080'); // trailing slash stripped
    expect(getPiApiUrl('remote')).toBe('https://pi.ts.net');
    setPiApiMode('remote');
    expect(getApiBase()).toBe('https://pi.ts.net');
    setPiApiMode('local');
    expect(getPiApiMode()).toBe('local');
    expect(getApiBase()).toBe('http://192.168.1.107:8080');
  });

  it('defaults mode to remote and missing URLs to empty', () => {
    expect(getPiApiMode()).toBe('remote');
    expect(getApiBase()).toBe('');
  });

  it('migrates the legacy single key into the Remote slot (mode remote), once', () => {
    localStorage.setItem('verreaux:piApiBase', 'https://legacy.ts.net/');
    expect(getApiBase()).toBe('https://legacy.ts.net');     // migrated → remote, active
    expect(getPiApiUrl('remote')).toBe('https://legacy.ts.net');
    expect(getPiApiMode()).toBe('remote');
    expect(localStorage.getItem('verreaux:piApiBase')).toBeNull(); // legacy cleared
  });

  it('setApiBase (back-compat) writes the active slot', () => {
    setPiApiMode('local');
    setApiBase('http://pi:8080');
    expect(getPiApiUrl('local')).toBe('http://pi:8080');
    expect(getApiBase()).toBe('http://pi:8080');
  });
});
```

- [ ] **Step 2: Run it — FAIL.** `npx vitest run test/unit/piApiConfig.test.ts`

- [ ] **Step 3: Implement.** In `src/features/sync/piClient.ts`, replace the `BASE_KEY`/`getApiBase`/`setApiBase` block with:

```ts
const LOCAL_KEY = 'verreaux:piApiUrl:local';
const REMOTE_KEY = 'verreaux:piApiUrl:remote';
const MODE_KEY = 'verreaux:piApiMode';
const LEGACY_KEY = 'verreaux:piApiBase';

export type PiApiMode = 'local' | 'remote';

function readKey(key: string): string {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}
function writeUrl(key: string, url: string): void {
  try { localStorage.setItem(key, url.replace(/\/+$/, '')); } catch { /* storage unavailable */ }
}

/** One-time: copy a pre-existing single URL into the Remote slot (mode remote).
 *  Idempotent — guarded on the Remote slot being unset; clears the legacy key. */
function migrateLegacy(): void {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy && !localStorage.getItem(REMOTE_KEY)) {
      localStorage.setItem(REMOTE_KEY, legacy.replace(/\/+$/, ''));
      if (!localStorage.getItem(MODE_KEY)) localStorage.setItem(MODE_KEY, 'remote');
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch { /* ignore */ }
}

export function getPiApiMode(): PiApiMode {
  migrateLegacy();
  return readKey(MODE_KEY) === 'local' ? 'local' : 'remote';
}
export function setPiApiMode(mode: PiApiMode): void {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
}
export function getPiApiUrl(mode: PiApiMode): string {
  migrateLegacy();
  return readKey(mode === 'local' ? LOCAL_KEY : REMOTE_KEY);
}
export function setPiApiUrl(mode: PiApiMode, url: string): void {
  writeUrl(mode === 'local' ? LOCAL_KEY : REMOTE_KEY, url);
}

/** The active base URL (active slot). All sync/scrape/download calls use this. */
export function getApiBase(): string {
  return getPiApiUrl(getPiApiMode());
}
/** Back-compat: write the currently-active slot's URL. */
export function setApiBase(base: string): void {
  setPiApiUrl(getPiApiMode(), base);
}
```
(Keep `requireBase`, `postScrape`, `getRunStatus`, `getRunZip`, `ScrapeRequest`, etc. unchanged — they call `getApiBase()`/`requireBase()`.)

- [ ] **Step 4: Run — PASS.** `npx tsc -p tsconfig.app.json --noEmit` clean. Then `npx vitest run test/unit/piClient.test.ts test/unit/syncClient.test.ts` (existing tests that use `setApiBase`/`getApiBase`) — confirm still green.

- [ ] **Step 5: Commit** `feat(sync): dual Pi API URL (local/remote) + active-mode resolution + legacy migration`

---

### Task 2: Settings UI — two URL inputs + Local/Remote toggle

**Files:** Modify `src/features/library/SettingsPanel.tsx`.

- [ ] **Step 1:** Read the current Pi-API-URL field in `SettingsPanel.tsx` (state hooks + markup). It currently uses a single `getApiBase()`/`setApiBase()` input.

- [ ] **Step 2:** Replace it with:
  - State: `const [localUrl, setLocalUrl] = useState(() => getPiApiUrl('local'));` and `remoteUrl` likewise; `const [apiMode, setApiMode] = useState<PiApiMode>(() => getPiApiMode());` (import `getPiApiUrl`, `setPiApiUrl`, `getPiApiMode`, `setPiApiMode`, type `PiApiMode` from `'../sync/piClient'`).
  - Two text inputs (match the existing input styling):
    - **"Local"** — placeholder `http://192.168.1.107:8080`; onChange updates `localUrl` state + `setPiApiUrl('local', value)`.
    - **"Remote"** — placeholder `https://pajohn.tail8f51b4.ts.net`; onChange updates `remoteUrl` + `setPiApiUrl('remote', value)`.
  - A segmented toggle (two buttons, or the panel's existing toggle/segmented pattern) for **[ Local | Remote ]**: clicking sets `apiMode` state + `setPiApiMode(mode)`. Visually mark the active one (e.g. `aria-pressed` / active class, matching how the panel shows other active toggles).
  - A short helper line: "Local = home WiFi (fast); Remote = anywhere (Funnel). Only the selected one is used."
  - The toggle's active selection takes effect immediately for subsequent sync calls (they read `getApiBase()` live) — no save button needed, consistent with the current field.
  - Match the panel's existing label/input/helper classNames; do not restyle.

- [ ] **Step 3:** `npx tsc -p tsconfig.app.json --noEmit` clean; `npx vitest run` full suite green; `npm run build` succeeds (`dist/sw.js` + precache).

- [ ] **Step 4: Commit** `feat(settings): local/remote Pi URL inputs + active toggle`

---

## Self-Review

**Spec coverage:** two URLs + active toggle (T1 API, T2 UI); migration of the existing URL → Remote slot, default Remote (T1); manual toggle (T2). ✓

**Placeholder scan:** none — T1 is complete code; T2 describes UI edits matching existing panel patterns (the only non-pasted part, intentionally, to match the live markup).

**Type consistency:** `PiApiMode = 'local' | 'remote'` exported from piClient and used in SettingsPanel. `getApiBase()`/`setApiBase()` signatures unchanged → all existing callers (`piClient` internals, `syncClient`, tests) keep working. `setApiBase` back-compat keeps the ~10 tests that call it green (verified in T1 Step 4).

**Migration safety:** idempotent (guarded on Remote slot unset); deployed users' Funnel URL lands in Remote + mode Remote → sync unaffected until they opt into Local.
