const KEY = 'verreaux:syncCreds';

export interface SyncCreds {
  accountId: string;
  deviceId: string;
  deviceToken: string;
}

export function getSyncCreds(): SyncCreds | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<SyncCreds>;
    if (typeof o.accountId === 'string' && typeof o.deviceId === 'string' && typeof o.deviceToken === 'string') {
      return { accountId: o.accountId, deviceId: o.deviceId, deviceToken: o.deviceToken };
    }
    return null;
  } catch {
    return null;
  }
}

export function setSyncCreds(creds: SyncCreds): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(creds));
  } catch {
    // storage unavailable — ignore
  }
}

export function clearSyncCreds(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function isEnrolled(): boolean {
  return getSyncCreds() !== null;
}
