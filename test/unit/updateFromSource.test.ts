import { describe, it, expect, vi } from 'vitest';
import { updateFromSource } from '../../src/features/sync/updateFromSource';

describe('updateFromSource', () => {
  it('scrapes only new chapters and merges into the target series', async () => {
    const startImport = vi.fn();
    const deps = {
      runScrape: vi.fn(async () => new Blob(['zip'], { type: 'application/zip' })),
      startImport,
      activeProfileId: 'p1',
    };
    await updateFromSource(
      { id: 's1', sourceUrl: 'https://qimanhwa.com/series/x', maxKnownOrder: 42 },
      { otp: '123456' },
      deps,
    );
    expect(deps.runScrape).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://qimanhwa.com/series/x', args: '--from 43 --to latest', otp: '123456' }));
    const arg = startImport.mock.calls[0][0];
    expect(arg.context).toBe('series');
    expect(arg.targetSeriesId).toBe('s1');
  });

  it('refuses to run when the series has no sourceUrl', async () => {
    const deps = { runScrape: vi.fn(), startImport: vi.fn(), activeProfileId: 'p1' };
    await expect(
      updateFromSource({ id: 's1', sourceUrl: null, maxKnownOrder: 0 }, { otp: '1' }, deps),
    ).rejects.toThrow(/source url/i);
    expect(deps.runScrape).not.toHaveBeenCalled();
  });
});
