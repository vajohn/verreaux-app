import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useBackgroundStore } from '../../src/features/background/background.store';
import { enqueueDownloads } from '../../src/features/sync/downloadQueue';
import type { CatchUpCandidate } from '../../src/features/sync/catchUp';

function cand(url: string): CatchUpCandidate {
  return { sourceUrl: url, syncedChapter: 49, syncedPage: 0, seriesId: url, maxOrder: 0, initial: true, state: 'behind' };
}
function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => useBackgroundStore.setState({ current: null }));
afterEach(() => useBackgroundStore.setState({ current: null }));

it('pipelines scrape-ahead of a serial import lane; isolates a failure; single batch task', async () => {
  const events: string[] = [];
  let importing = false;
  let importsOverlapped = false;
  const finalized: string[] = [];
  const aImport = deferred<void>();

  const deps = {
    prepare: async (c: CatchUpCandidate) => { events.push(`prep:${c.sourceUrl}`); return c; },
    scrape: async (c: CatchUpCandidate) => {
      events.push(`scrape:${c.sourceUrl}`);
      if (c.sourceUrl === 'b') throw new Error('b fails');
      return new Blob([c.sourceUrl]);
    },
    importBlob: async (c: CatchUpCandidate) => {
      if (importing) importsOverlapped = true;
      importing = true;
      events.push(`import-start:${c.sourceUrl}`);
      if (c.sourceUrl === 'a') await aImport.promise; // hold a's import open
      events.push(`import-end:${c.sourceUrl}`);
      importing = false;
    },
    finalize: async (c: CatchUpCandidate) => { finalized.push(c.sourceUrl); },
  };

  const p = enqueueDownloads([cand('a'), cand('b'), cand('c')], deps);
  await new Promise((r) => setTimeout(r, 0)); // let pipeline reach a's import + b's scrape-ahead
  aImport.resolve();
  await p;

  expect(importsOverlapped).toBe(false); // serial import lane
  expect(events.indexOf('scrape:b')).toBeGreaterThanOrEqual(0);
  expect(events.indexOf('scrape:b')).toBeLessThan(events.indexOf('import-end:a')); // b scraped WHILE a imported
  expect(finalized).toEqual(['a', 'c']); // b failed in scrape → isolated, not finalized
  expect(useBackgroundStore.getState().current).toBeNull(); // batch task cleared
});

it('does nothing (no task) for an empty enqueue', async () => {
  await enqueueDownloads([], {
    prepare: async (c) => c, scrape: async () => new Blob([]), importBlob: async () => {}, finalize: async () => {},
  });
  expect(useBackgroundStore.getState().current).toBeNull();
});
