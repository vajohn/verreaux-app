import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEscape } from '../../src/lib/useEscape';

describe('useEscape', () => {
  afterEach(() => {
    // Clean up any lingering listeners between tests by resetting the DOM
    vi.restoreAllMocks();
  });

  it('calls callback when Escape key is pressed', () => {
    const callback = vi.fn();
    renderHook(() => useEscape(callback));

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(event);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not call callback for other keys', () => {
    const callback = vi.fn();
    renderHook(() => useEscape(callback));

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    document.dispatchEvent(event);

    expect(callback).not.toHaveBeenCalled();
  });

  it('removes the listener on unmount', () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => useEscape(callback));

    unmount();

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(event);

    expect(callback).not.toHaveBeenCalled();
  });

  it('calls updated callback when callback reference changes', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: () => void }) => useEscape(cb), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(event);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('calls callback multiple times on repeated Escape presses', () => {
    const callback = vi.fn();
    renderHook(() => useEscape(callback));

    for (let i = 0; i < 3; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }

    expect(callback).toHaveBeenCalledTimes(3);
  });
});
