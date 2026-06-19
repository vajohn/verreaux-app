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
