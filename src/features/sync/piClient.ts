// Thin client for the Pi `api` service.
import { getSyncCreds } from './syncCreds';
const LOCAL_KEY = 'verreaux:piApiUrl:local';
const REMOTE_KEY = 'verreaux:piApiUrl:remote';
const MODE_KEY = 'verreaux:piApiMode';
const LEGACY_KEY = 'verreaux:piApiBase';

export type PiApiMode = 'auto' | 'local' | 'remote';

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

let autoResolved: 'local' | 'remote' = 'remote';
export function setAutoResolvedTarget(t: 'local' | 'remote'): void { autoResolved = t; }
export function getAutoResolvedTarget(): 'local' | 'remote' { return autoResolved; }

export function getPiApiMode(): PiApiMode {
  migrateLegacy();
  const stored = readKey(MODE_KEY);
  if (stored === 'auto' || stored === 'local' || stored === 'remote') return stored;
  return 'remote';
}
export function setPiApiMode(mode: PiApiMode): void {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
}
export function getPiApiUrl(mode: 'local' | 'remote'): string {
  migrateLegacy();
  return readKey(mode === 'local' ? LOCAL_KEY : REMOTE_KEY);
}
export function setPiApiUrl(mode: 'local' | 'remote', url: string): void {
  writeUrl(mode === 'local' ? LOCAL_KEY : REMOTE_KEY, url);
}

/** The active base URL (active slot). All sync/scrape/download calls use this. */
export function getApiBase(): string {
  const mode = getPiApiMode();
  if (mode === 'auto') return getPiApiUrl(autoResolved);
  return getPiApiUrl(mode);
}
/** Back-compat: write the currently-active slot's URL. */
export function setApiBase(base: string): void {
  const mode = getPiApiMode();
  setPiApiUrl(mode === 'auto' ? 'remote' : mode, base);
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

export interface SearchSourceInfo { id: string; name: string; host: string; searchable: boolean; }
export interface SeriesSearchHit {
  adapterId: string; title: string; seriesUrl: string;
  coverUrl: string | null; coverReferer?: string; latestChapter?: string | null;
}
export interface SearchResponse { results: SeriesSearchHit[]; errors: Array<{ adapterId: string; error: string }>; }

export async function listSearchSources(): Promise<SearchSourceInfo[]> {
  const res = await fetch(`${requireBase()}/adapters`);
  if (!res.ok) throw new Error(`Could not load sources (${res.status}).`);
  return ((await res.json()) as { adapters: SearchSourceInfo[] }).adapters;
}

export async function searchSeries(q: string, sources?: string[]): Promise<SearchResponse> {
  const creds = getSyncCreds();
  if (!creds) throw new Error('This device is not enrolled for sync — enroll to search online.');
  const res = await fetch(`${requireBase()}/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${creds.deviceToken}` },
    body: JSON.stringify(sources && sources.length ? { q, sources } : { q }),
  });
  if (res.status === 401) throw new Error('Search authorization failed — re-enrol this device.');
  if (!res.ok) throw new Error(`Search failed (${res.status}).`);
  return (await res.json()) as SearchResponse;
}
