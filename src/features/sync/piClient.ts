// Thin client for the Pi `api` service.
const BASE_KEY = 'verreaux:piApiBase';

export function getApiBase(): string {
  try { return localStorage.getItem(BASE_KEY) ?? ''; } catch { return ''; }
}

export function setApiBase(base: string): void {
  try { localStorage.setItem(BASE_KEY, base.replace(/\/+$/, '')); } catch { /* storage unavailable */ }
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
