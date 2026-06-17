import { describe, it, expect, vi, afterEach } from 'vitest';
import { setApiBase } from '../../src/features/sync/piClient';
import { enroll, putPosition, getPositions } from '../../src/features/sync/syncClient';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('syncClient', () => {
  it('enroll posts credentials + otp and returns the ids/token', async () => {
    setApiBase('http://pi:8080');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ accountId: 'a', deviceId: 'd', deviceToken: 't' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await enroll({ username: 'u', passcode: 'p', otp: '123456', deviceName: 'iPad' });
    expect(r).toEqual({ accountId: 'a', deviceId: 'd', deviceToken: 't' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://pi:8080/enroll');
    expect(JSON.parse(init.body)).toEqual({ username: 'u', passcode: 'p', otp: '123456', deviceName: 'iPad' });
  });

  it('enroll throws a friendly error on 401', async () => {
    setApiBase('http://pi:8080');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid passcode' }), { status: 401 })));
    await expect(enroll({ username: 'u', passcode: 'x', otp: '000000', deviceName: 'iPad' })).rejects.toThrow(/passcode|authenticator|401/i);
  });

  it('enroll uses the friendly fallback message when the 401 body has no error field', async () => {
    setApiBase('http://pi:8080');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await expect(enroll({ username: 'u', passcode: 'x', otp: '000000', deviceName: 'iPad' })).rejects.toThrow(/Enrollment rejected/i);
  });

  it('putPosition sends the bearer token + body', async () => {
    setApiBase('http://pi:8080');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sourceUrl: 's', chapterOrder: 12, pageIndex: 5, manuallyMarked: false }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await putPosition('tok', { sourceUrl: 's', chapterOrder: 12, pageIndex: 5, manuallyMarked: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://pi:8080/sync/position');
    expect(init.method).toBe('PUT');
    expect(init.headers.authorization).toBe('Bearer tok');
  });

  it('getPositions sends the token and parses positions', async () => {
    setApiBase('http://pi:8080');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ positions: [{ sourceUrl: 's', chapterOrder: 1, pageIndex: 0, manuallyMarked: false, updatedAt: 't' }] }), { status: 200 })));
    const out = await getPositions('tok', null);
    expect(out).toHaveLength(1);
    expect(out[0].sourceUrl).toBe('s');
  });

  it('getPositions appends since when provided', async () => {
    setApiBase('http://pi:8080');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ positions: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await getPositions('tok', '2026-06-17T00:00:00Z');
    expect(fetchMock.mock.calls[0][0]).toBe('http://pi:8080/sync/positions?since=2026-06-17T00%3A00%3A00Z');
  });
});
