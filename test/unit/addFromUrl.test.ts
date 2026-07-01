import { describe, it, expect, vi } from 'vitest';
import { addFromUrl } from '../../src/features/sync/addFromUrl';

describe('addFromUrl', () => {
  it('scrapes the full range and imports the zip as a new series', async () => {
    const startImport = vi.fn();
    const deps = {
      runScrape: vi.fn(async () => ({ blob: new Blob(['zip'], { type: 'application/zip' }), partial: false })),
      startImport,
      activeProfileId: 'p1',
    };
    await addFromUrl({ url: 'https://qimanhwa.com/series/x', otp: '123456' }, deps);
    expect(deps.runScrape).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://qimanhwa.com/series/x', args: '--from 0 --to latest', otp: '123456' }));
    const arg = startImport.mock.calls[0][0];
    expect(arg.context).toBe('home');
    expect(arg.targetSeriesId).toBeUndefined();
    expect(arg.file).toBeInstanceOf(File);
    expect(arg.activeProfileId).toBe('p1');
  });

  it('passes an explicit from/to range through to the scraper', async () => {
    const startImport = vi.fn();
    const deps = {
      runScrape: vi.fn(async () => ({ blob: new Blob(['zip'], { type: 'application/zip' }), partial: false })),
      startImport,
      activeProfileId: 'p1',
    };
    await addFromUrl({ url: 'https://x.test/s', otp: '123456', from: '1', to: '3' }, deps);
    expect(deps.runScrape).toHaveBeenCalledWith(expect.objectContaining({ args: '--from 1 --to 3' }));
  });
});
