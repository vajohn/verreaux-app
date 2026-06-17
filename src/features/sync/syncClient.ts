import { getApiBase } from './piClient';

function base(): string {
  const b = getApiBase();
  if (!b) throw new Error('Pi API base URL is not configured. Set it in Settings.');
  return b;
}

export interface EnrollInput { username: string; passcode: string; otp: string; deviceName: string; }
export interface EnrollResult { accountId: string; deviceId: string; deviceToken: string; }

export async function enroll(input: EnrollInput): Promise<EnrollResult> {
  const res = await fetch(`${base()}/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 401) {
    const msg = await res.json().then((b: { error?: string }) => b.error).catch(() => '');
    throw new Error(msg || 'Enrollment rejected (check the code and passcode).');
  }
  if (!res.ok) throw new Error(`Enrollment failed (${res.status}).`);
  return (await res.json()) as EnrollResult;
}

export interface PositionBody {
  sourceUrl: string;
  chapterOrder: number;
  pageIndex: number;
  manuallyMarked: boolean;
}

export interface ServerPosition extends PositionBody {
  updatedAt: string;
}

export async function putPosition(token: string, body: PositionBody): Promise<PositionBody> {
  const res = await fetch(`${base()}/sync/position`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Error('Sync auth failed — re-enroll this device.');
  if (!res.ok) throw new Error(`Position sync failed (${res.status}).`);
  return (await res.json()) as PositionBody;
}

export async function getPositions(token: string, since: string | null): Promise<ServerPosition[]> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : '';
  const res = await fetch(`${base()}/sync/positions${qs}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error('Sync auth failed — re-enroll this device.');
  if (!res.ok) throw new Error(`Could not fetch positions (${res.status}).`);
  return ((await res.json()) as { positions: ServerPosition[] }).positions;
}
