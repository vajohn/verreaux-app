import { describe, it, expect, afterEach } from 'vitest';
import { getSyncCreds, setSyncCreds, clearSyncCreds, isEnrolled } from '../../src/features/sync/syncCreds';

afterEach(() => localStorage.clear());

describe('syncCreds', () => {
  it('round-trips creds and reports enrolled', () => {
    expect(isEnrolled()).toBe(false);
    expect(getSyncCreds()).toBeNull();
    setSyncCreds({ accountId: 'a1', deviceId: 'd1', deviceToken: 't1' });
    expect(isEnrolled()).toBe(true);
    expect(getSyncCreds()).toEqual({ accountId: 'a1', deviceId: 'd1', deviceToken: 't1' });
  });

  it('clears creds', () => {
    setSyncCreds({ accountId: 'a1', deviceId: 'd1', deviceToken: 't1' });
    clearSyncCreds();
    expect(isEnrolled()).toBe(false);
    expect(getSyncCreds()).toBeNull();
  });

  it('returns null on malformed stored json', () => {
    localStorage.setItem('verreaux:syncCreds', '{not json');
    expect(getSyncCreds()).toBeNull();
  });

  it('returns null on a structurally incomplete object', () => {
    localStorage.setItem('verreaux:syncCreds', JSON.stringify({ accountId: 'a', deviceId: 'd' })); // no deviceToken
    expect(getSyncCreds()).toBeNull();
    expect(isEnrolled()).toBe(false);
  });
});
