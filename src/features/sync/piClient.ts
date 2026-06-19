// Thin client for the Pi `api` service.
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
  /** When set, sent as `Authorization: Bearer` so the Pi authorizes the scrape
   *  by device token (sync-driven catch-up) instead of an OTP. */
  deviceToken?: string;
}

export async function postScrape(req: ScrapeRequest): Promise<string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (req.deviceToken) headers.authorization = `Bearer ${req.deviceToken}`;
  const res = await fetch(`${requireBase()}/scrape`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: req.url, args: req.args, type: req.type ?? 'scrape', otp: req.otp }),
  });
  if (res.status === 401) throw new Error('Invalid authenticator code or device token.');
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
