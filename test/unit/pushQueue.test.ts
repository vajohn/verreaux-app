import { describe, it, expect, vi } from 'vitest';
import { createPushQueue } from '../../src/features/sync/pushQueue';

describe('pushQueue', () => {
  it('coalesces rapid enqueues per sourceUrl and flushes the latest', async () => {
    const put = vi.fn(async () => ({ sourceUrl: 's', chapterOrder: 0, pageIndex: 0, manuallyMarked: false }));
    const q = createPushQueue({ put, debounceMs: 0 });
    q.enqueue({ sourceUrl: 's', chapterOrder: 12, pageIndex: 1, manuallyMarked: false });
    q.enqueue({ sourceUrl: 's', chapterOrder: 12, pageIndex: 9, manuallyMarked: false });
    await q.flush();
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith({ sourceUrl: 's', chapterOrder: 12, pageIndex: 9, manuallyMarked: false });
  });

  it('keeps the item queued when put fails (retry on next flush)', async () => {
    const put = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ sourceUrl: 's', chapterOrder: 0, pageIndex: 0, manuallyMarked: false });
    const q = createPushQueue({ put, debounceMs: 0 });
    q.enqueue({ sourceUrl: 's', chapterOrder: 1, pageIndex: 1, manuallyMarked: false });
    await q.flush();
    await q.flush();
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('flushes multiple distinct series', async () => {
    const put = vi.fn(async () => ({ sourceUrl: '', chapterOrder: 0, pageIndex: 0, manuallyMarked: false }));
    const q = createPushQueue({ put, debounceMs: 0 });
    q.enqueue({ sourceUrl: 'a', chapterOrder: 1, pageIndex: 0, manuallyMarked: false });
    q.enqueue({ sourceUrl: 'b', chapterOrder: 1, pageIndex: 0, manuallyMarked: false });
    await q.flush();
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('coalesces overlapping flushes and keeps a value re-enqueued mid-flush', async () => {
    let resolveFirst!: () => void;
    const put = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveFirst = () => r(); }))
      .mockResolvedValue(undefined);
    const q = createPushQueue({ put, debounceMs: 1000 });
    q.enqueue({ sourceUrl: 's', chapterOrder: 1, pageIndex: 0, manuallyMarked: false });
    const flushDone = q.flush(); // in-flight, awaiting the first put
    // re-enqueue a newer value while the first put is still pending
    q.enqueue({ sourceUrl: 's', chapterOrder: 1, pageIndex: 9, manuallyMarked: false });
    // a second flush during the in-flight one must coalesce (no duplicate send)
    const flushDone2 = q.flush();
    resolveFirst();
    await Promise.all([flushDone, flushDone2]);
    expect(put).toHaveBeenCalledTimes(1); // only the first send so far; newer value retained
    await q.flush();
    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith(expect.objectContaining({ pageIndex: 9 }));
  });
});
