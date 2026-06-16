import { describe, it, expect } from 'vitest';
import { computeUpdateArgs } from '../../src/features/sync/updateArgs';

describe('computeUpdateArgs', () => {
  it('starts one past the highest known chapter order', () => {
    expect(computeUpdateArgs(42)).toBe('--from 43 --to latest');
  });
  it('starts at 0 when nothing is known', () => {
    expect(computeUpdateArgs(0)).toBe('--from 1 --to latest');
    expect(computeUpdateArgs(null)).toBe('--from 0 --to latest');
  });
});
