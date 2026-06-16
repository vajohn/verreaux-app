import { describe, it, expect, vi, afterEach } from 'vitest';
import { setApiBase, getApiBase, postScrape, getRunStatus, getRunZip } from '../../src/features/sync/piClient';

// clear() before unstubbing: vi.unstubAllGlobals() can restore Node 25's
// non-functional localStorage stub, so clear the jsdom Storage first.
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe('piClient', () => {
  it('persists and reads the API base', () => {
    setApiBase('http://pajohn.local:8080');
    expect(getApiBase()).toBe('http://pajohn.local:8080');
  });

  it('throws a configuration error when the base URL is unset', async () => {
    localStorage.clear();
    await expect(postScrape({ url: 'https://x.test/s', args: '', otp: '1' })).rejects.toThrow(/not configured/i);
  });

  it('POSTs /scrape with url, args, otp and returns the id', async () => {
    setApiBase('http://pi:8080');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'run-1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const id = await postScrape({ url: 'https://x.test/s', args: '--from 0 --to latest', otp: '123456' });
    expect(id).toBe('run-1');
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('http://pi:8080/scrape');
    expect(JSON.parse(init.body)).toEqual({ url: 'https://x.test/s', args: '--from 0 --to latest', type: 'scrape', otp: '123456' });
  });

  it('throws a clear error on 401', async () => {
    setApiBase('http://pi:8080');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid authenticator code' }), { status: 401 })));
    await expect(postScrape({ url: 'https://x.test/s', args: '', otp: '000000' })).rejects.toThrow(/authenticator/i);
  });

  it('reads run status', async () => {
    setApiBase('http://pi:8080');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: 'succeeded' }), { status: 200 })));
    expect((await getRunStatus('run-1')).state).toBe('succeeded');
  });

  it('downloads the zip as a Blob', async () => {
    setApiBase('http://pi:8080');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['zip-bytes']), { status: 200 })));
    const blob = await getRunZip('run-1');
    expect(blob.size).toBeGreaterThan(0);
  });
});
