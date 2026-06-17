import { describe, it, expect } from 'vitest';
import { buildScrapeArgs } from '../../src/features/sync/scrapeArgs';

describe('buildScrapeArgs', () => {
  it('defaults to the full series when both are empty/omitted', () => {
    expect(buildScrapeArgs()).toBe('--from 0 --to latest');
    expect(buildScrapeArgs('', '')).toBe('--from 0 --to latest');
    expect(buildScrapeArgs('  ', '  ')).toBe('--from 0 --to latest');
  });

  it('uses the provided from/to', () => {
    expect(buildScrapeArgs('1', '10')).toBe('--from 1 --to 10');
  });

  it('allows "latest" as an explicit upper bound', () => {
    expect(buildScrapeArgs('5', 'latest')).toBe('--from 5 --to latest');
  });

  it('defaults only the missing side', () => {
    expect(buildScrapeArgs('3', '')).toBe('--from 3 --to latest');
    expect(buildScrapeArgs('', '7')).toBe('--from 0 --to 7');
  });
});
