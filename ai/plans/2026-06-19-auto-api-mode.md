# Auto API Mode (probe Local → fall back to Remote) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Add an **Auto** option to the Local/Remote toggle. In Auto, the app probes the Local URL (cheap, cached) and uses it when reachable, else Remote — so at home everything uses the LAN automatically, and the Funnel only kicks in when off-LAN. Applies to all requests (sync + downloads).

**Architecture:** `getApiBase()` stays synchronous — in Auto it returns a module-level **cached** target that a tiny background prober keeps current (on startup / `online` / foreground / 60 s interval). The prober GETs `<local>/runs/__probe__` with a 1.5 s timeout; any response (even 404) = reachable → `local`; error/timeout/cert-untrusted/DNS-fail → `remote`. Default before the first probe = `remote` (works anywhere). No circular import: the prober (`apiResolver`) imports piClient setters; piClient never imports the resolver.

**Tech:** Vite/React/TS; vitest (jsdom). PWA-only. Authoritative typecheck: `npx tsc -p tsconfig.app.json --noEmit`; build `npm run build`.

---

### Task 1: `'auto'` mode in piClient + the `apiResolver` prober

**Files:**
- Modify: `src/features/sync/piClient.ts`
- Create: `src/features/sync/apiResolver.ts`
- Test: `test/unit/apiResolver.test.ts` (create); extend `test/unit/piApiConfig.test.ts`

- [ ] **Step 1: piClient — accept `'auto'` + a cached auto target.**
  - Change `export type PiApiMode = 'local' | 'remote';` → `'auto' | 'local' | 'remote'`.
  - `getPiApiMode()`: return the stored value if it is one of `'auto'|'local'|'remote'`, else `'remote'`.
  - Add a module-level cached target + accessors:
    ```ts
    let autoResolved: 'local' | 'remote' = 'remote';
    export function setAutoResolvedTarget(t: 'local' | 'remote'): void { autoResolved = t; }
    export function getAutoResolvedTarget(): 'local' | 'remote' { return autoResolved; }
    ```
  - `getApiBase()`:
    ```ts
    export function getApiBase(): string {
      const mode = getPiApiMode();
      if (mode === 'auto') return getPiApiUrl(autoResolved);
      return getPiApiUrl(mode);
    }
    ```
  - `setApiBase(base)` back-compat: if mode is `'auto'`, write to the **remote** slot (the safe default); else write the active slot. (Keeps existing tests green.)
    ```ts
    export function setApiBase(base: string): void {
      const mode = getPiApiMode();
      setPiApiUrl(mode === 'auto' ? 'remote' : mode, base);
    }
    ```

- [ ] **Step 2: `apiResolver.ts`:**
  ```ts
  import { getPiApiMode, getPiApiUrl, setAutoResolvedTarget } from './piClient';

  /** Probe the Local URL: any HTTP response (even 404) = reachable → 'local';
   *  timeout / network / cert-untrusted / DNS-fail → 'remote'. */
  export async function probeLocal(): Promise<'local' | 'remote'> {
    const local = getPiApiUrl('local');
    if (!local) return 'remote';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    try {
      await fetch(`${local}/runs/__probe__`, { signal: ctrl.signal, cache: 'no-store' });
      return 'local';
    } catch {
      return 'remote';
    } finally {
      clearTimeout(timer);
    }
  }

  let inFlight: Promise<void> | null = null;
  /** Re-resolve the Auto target (no-op unless mode === 'auto'). Single-flight. */
  export function refreshApiTarget(): Promise<void> {
    if (getPiApiMode() !== 'auto') return Promise.resolve();
    if (!inFlight) {
      inFlight = probeLocal().then((t) => { setAutoResolvedTarget(t); }).finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  /** Start the background prober: probe now + on network-online + on returning to
   *  foreground + every 60 s while visible. Returns a cleanup function. */
  export function startApiResolver(): () => void {
    void refreshApiTarget();
    const onOnline = () => void refreshApiTarget();
    const onVisible = () => { if (!document.hidden) void refreshApiTarget(); };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(() => { if (!document.hidden) void refreshApiTarget(); }, 60_000);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }
  ```

- [ ] **Step 3: Tests.**
  - `test/unit/piApiConfig.test.ts` — add: `setPiApiMode('auto'); setPiApiUrl('local','http://l'); setPiApiUrl('remote','https://r'); setAutoResolvedTarget('local'); expect(getApiBase()).toBe('http://l'); setAutoResolvedTarget('remote'); expect(getApiBase()).toBe('https://r');` and `getPiApiMode()` returns `'auto'` when stored.
  - `test/unit/apiResolver.test.ts` (new) — stub fetch:
    ```ts
    import { describe, it, expect, vi, afterEach } from 'vitest';
    import { probeLocal, refreshApiTarget } from '../../src/features/sync/apiResolver';
    import { setPiApiMode, setPiApiUrl, getAutoResolvedTarget, setAutoResolvedTarget } from '../../src/features/sync/piClient';

    afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

    it('probeLocal: reachable (any response) → local', async () => {
      setPiApiUrl('local', 'http://l:8443');
      vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 404 })));
      expect(await probeLocal()).toBe('local');
    });
    it('probeLocal: fetch error → remote', async () => {
      setPiApiUrl('local', 'http://l:8443');
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('blocked'); }));
      expect(await probeLocal()).toBe('remote');
    });
    it('probeLocal: no local url → remote', async () => {
      expect(await probeLocal()).toBe('remote');
    });
    it('refreshApiTarget sets the cached target in auto mode', async () => {
      setPiApiMode('auto'); setPiApiUrl('local', 'http://l:8443');
      vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 404 })));
      await refreshApiTarget();
      expect(getAutoResolvedTarget()).toBe('local');
    });
    it('refreshApiTarget is a no-op when mode is not auto', async () => {
      setPiApiMode('remote'); setAutoResolvedTarget('remote'); setPiApiUrl('local', 'http://l:8443');
      vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 404 })));
      await refreshApiTarget();
      expect(getAutoResolvedTarget()).toBe('remote'); // unchanged
    });
    ```

- [ ] **Step 4:** `npx vitest run test/unit/apiResolver.test.ts test/unit/piApiConfig.test.ts test/unit/piClient.test.ts test/unit/syncClient.test.ts` green; `npx tsc -p tsconfig.app.json --noEmit` clean; full `npx vitest run` green.

- [ ] **Step 5: Commit** `feat(sync): auto API mode — probe Local, fall back to Remote (cached)`

---

### Task 2: Wire the resolver + 3-way Settings toggle

**Files:** Modify `src/App.tsx`, `src/features/library/SettingsPanel.tsx`.

- [ ] **Step 1: App.tsx** — start the prober once on mount (alongside the existing `startImportBridge` effect):
  ```tsx
  import { startApiResolver } from './features/sync/apiResolver';
  useEffect(() => startApiResolver(), []);
  ```

- [ ] **Step 2: SettingsPanel.tsx** — make the mode toggle 3-way: `['auto','local','remote']` (the buttons already map over modes; add `'auto'` as the first, label "Auto"). When the active mode is `auto`, show a small muted indicator of what it resolved to, reading `getAutoResolvedTarget()` (e.g. `Auto → Local` / `Auto → Remote`); refresh it by also calling `refreshApiTarget()` when the panel mounts or when the user picks Auto, then re-reading. Keep the Local/Remote URL inputs as-is. Import `getAutoResolvedTarget`, `refreshApiTarget`. Helper line: "Auto uses Local when it's reachable (home), else Remote."

- [ ] **Step 3:** `npx tsc -p tsconfig.app.json --noEmit` clean; full `npx vitest run` green; `npm run build` succeeds.

- [ ] **Step 4: Commit** `feat(settings): Auto/Local/Remote toggle + resolved-target indicator`

---

## Self-Review
- **Spec coverage:** Auto mode resolves via cached probe (T1); prober runs on startup/online/foreground/interval (T1); applies to all requests via `getApiBase()` (T1); 3-way toggle + indicator (T2). ✓
- **Sync `getApiBase()` preserved:** still synchronous; Auto returns the cached target; default `remote` until first probe (safe). ✓
- **No circular import:** `apiResolver` → piClient setters only. ✓
- **Off-LAN / no-CA correctness:** probe fails (DNS/cert/timeout) → `remote`; stale window bounded by the 60 s + online/foreground re-probes. ✓
- **Back-compat:** `PiApiMode` widened; existing `setApiBase`/`getApiBase` callers + tests unaffected (`setApiBase` writes remote in auto). ✓
