import { describe, it, expect, vi } from 'vitest';
import { runScrapeToBlob } from '../../src/features/sync/runScrapeToBlob';

describe('runScrapeToBlob', () => {
  it('posts, polls until succeeded, and resolves the zip blob', async () => {
    const calls: string[] = [];
    const deps = {
      postScrape: vi.fn(async () => 'run-9'),
      getRunStatus: vi.fn(async () => {
        calls.push('poll');
        return { state: calls.length >= 2 ? 'succeeded' : 'running' } as const;
      }),
      getRunZip: vi.fn(async () => new Blob(['zip'])),
      sleep: async () => {},
      onState: () => {},
    };
    const blob = await runScrapeToBlob({ url: 'https://x.test/s', args: '--from 0 --to latest', otp: '123456' }, deps);
    expect(blob.size).toBeGreaterThan(0);
    expect(deps.getRunZip).toHaveBeenCalledWith('run-9');
  });

  it('throws with the failure message when the run fails', async () => {
    const deps = {
      postScrape: vi.fn(async () => 'run-x'),
      getRunStatus: vi.fn(async () => ({ state: 'failed', message: 'boom' } as const)),
      getRunZip: vi.fn(),
      sleep: async () => {},
      onState: () => {},
    };
    await expect(runScrapeToBlob({ url: 'u', args: '', otp: '1' }, deps)).rejects.toThrow(/boom/);
    expect(deps.getRunZip).not.toHaveBeenCalled();
  });
});
