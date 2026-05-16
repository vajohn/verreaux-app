import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLongPress } from '../../src/lib/useLongPress';

describe('useLongPress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls callback after 700ms when pointer stays down', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));

    // Simulate pointerdown
    act(() => {
      result.current.onPointerDown({ isPrimary: true } as React.PointerEvent);
    });

    // Not called yet at 699ms
    act(() => { vi.advanceTimersByTime(699); });
    expect(cb).not.toHaveBeenCalled();

    // Called at 700ms
    act(() => { vi.advanceTimersByTime(1); });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('cancels on pointerup before threshold', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));

    act(() => {
      result.current.onPointerDown({ isPrimary: true } as React.PointerEvent);
    });

    act(() => { vi.advanceTimersByTime(400); });

    act(() => {
      result.current.onPointerUp({} as React.PointerEvent);
    });

    act(() => { vi.advanceTimersByTime(400); });
    expect(cb).not.toHaveBeenCalled();
  });

  it('cancels on pointerleave', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));

    act(() => {
      result.current.onPointerDown({ isPrimary: true } as React.PointerEvent);
    });

    act(() => { vi.advanceTimersByTime(300); });

    act(() => {
      result.current.onPointerLeave({} as React.PointerEvent);
    });

    act(() => { vi.advanceTimersByTime(500); });
    expect(cb).not.toHaveBeenCalled();
  });

  it('cancels on pointercancel', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));

    act(() => {
      result.current.onPointerDown({ isPrimary: true } as React.PointerEvent);
    });

    act(() => {
      result.current.onPointerCancel({} as React.PointerEvent);
    });

    act(() => { vi.advanceTimersByTime(1000); });
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores non-primary pointer (e.g. right-click)', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));

    act(() => {
      result.current.onPointerDown({ isPrimary: false } as React.PointerEvent);
    });

    act(() => { vi.advanceTimersByTime(1000); });
    expect(cb).not.toHaveBeenCalled();
  });

  it('supports a custom threshold', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, 300));

    act(() => {
      result.current.onPointerDown({ isPrimary: true } as React.PointerEvent);
    });

    act(() => { vi.advanceTimersByTime(299); });
    expect(cb).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1); });
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
