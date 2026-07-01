import { describe, it, expect, vi } from 'vitest';
import { runScrapeToBlob } from '../../src/features/sync/runScrapeToBlob';

describe('runScrapeToBlob', () => {
  it('posts, polls until succeeded, and resolves the zip blob (not partial)', async () => {
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
    const result = await runScrapeToBlob({ url: 'https://x.test/s', args: '--from 0 --to latest', otp: '123456' }, deps);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.partial).toBe(false);
    expect(deps.getRunZip).toHaveBeenCalledWith('run-9');
  });

  it('returns the partial blob (no throw) on a rate-limited run: failed + exitCode 5 + hasOutput', async () => {
    const deps = {
      postScrape: vi.fn(async () => 'run-rl'),
      getRunStatus: vi.fn(async () => ({ state: 'failed', exitCode: 5, partial: true, hasOutput: true, message: 'rate limited' } as const)),
      getRunZip: vi.fn(async () => new Blob(['partial-zip'])),
      sleep: async () => {},
      onState: () => {},
    };
    const result = await runScrapeToBlob({ url: 'u', args: '', otp: '1' }, deps);
    expect(result.partial).toBe(true);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(deps.getRunZip).toHaveBeenCalledWith('run-rl');
  });

  it('throws with the failure message when the run fails (no output)', async () => {
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

  it('throws on exitCode 5 but no output (hasOutput false)', async () => {
    const deps = {
      postScrape: vi.fn(async () => 'run-y'),
      getRunStatus: vi.fn(async () => ({ state: 'failed', exitCode: 5, partial: true, hasOutput: false, message: 'rate limited, nothing scraped' } as const)),
      getRunZip: vi.fn(),
      sleep: async () => {},
      onState: () => {},
    };
    await expect(runScrapeToBlob({ url: 'u', args: '', otp: '1' }, deps)).rejects.toThrow(/rate limited/);
    expect(deps.getRunZip).not.toHaveBeenCalled();
  });

  it('throws on a failed run with a non-5 exit code even if output exists', async () => {
    const deps = {
      postScrape: vi.fn(async () => 'run-z'),
      getRunStatus: vi.fn(async () => ({ state: 'failed', exitCode: 1, hasOutput: true, message: 'crash' } as const)),
      getRunZip: vi.fn(),
      sleep: async () => {},
      onState: () => {},
    };
    await expect(runScrapeToBlob({ url: 'u', args: '', otp: '1' }, deps)).rejects.toThrow(/crash/);
    expect(deps.getRunZip).not.toHaveBeenCalled();
  });
});
