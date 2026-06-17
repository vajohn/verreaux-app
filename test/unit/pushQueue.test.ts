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
});
