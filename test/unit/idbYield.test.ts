import { describe, it, expect } from 'vitest';
import { yieldToReads } from '../../src/db/idbYield';

describe('yieldToReads', () => {
  it('resolves on a macrotask, not a microtask', async () => {
    // A microtask-based yield (Promise.resolve) would resolve BEFORE an
    // already-queued 0ms timer. A real macrotask yield resolves AFTER it.
    const events: string[] = [];
    queueMicrotask(() => events.push('microtask'));
    setTimeout(() => events.push('macrotask-0'), 0);

    await yieldToReads();
    events.push('after-yield');

    expect(events).toEqual(['microtask', 'macrotask-0', 'after-yield']);
  });

  it('resolves to undefined', async () => {
    expect(await yieldToReads()).toBeUndefined();
  });
});
