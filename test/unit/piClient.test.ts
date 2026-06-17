import { describe, it, expect, vi, afterEach } from 'vitest';
import { setApiBase, getApiBase, postScrape, getRunStatus, getRunZip } from '../../src/features/sync/piClient';
// NOTE: afterEach at module level also applies to the describe blocks below.

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
    await expect(postScrape({ url: 'https://x.test/s', args: '', otp: '000000' })).rejects.toThrow(/Invalid authenticator code or device token/i);
  });

  it('reads run status', async () => {
    setApiBase('http://pi:8080');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: 'succeeded' }), { status: 200 })));
    expect((await getRunStatus('run-1')).state).toBe('succeeded');
  });

  it('downloads the zip as a Blob', async () => {
    setApiBase('http://pi:8080');
    // Use a string body (not a jsdom Blob): undici's Response.blob() reads the
    // body via .stream(), which a jsdom Blob lacks on some Node versions
    // ("object.stream is not a function"). A string body blobs cross-version.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('zip-bytes', { status: 200 })));
    const blob = await getRunZip('run-1');
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('postScrape device token', () => {
  it('sends Authorization: Bearer when deviceToken is provided', async () => {
    setApiBase('http://pi:8080');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'job1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const id = await postScrape({ url: 'https://x/s', args: '--from 49 --to latest', otp: '', deviceToken: 'tok-plain' });
    expect(id).toBe('job1');
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-plain');
  });

  it('omits Authorization when no deviceToken', async () => {
    setApiBase('http://pi:8080');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'job2' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await postScrape({ url: 'https://x/s', args: '', otp: '123456' });
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });
});
