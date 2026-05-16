import { describe, it, expect } from 'vitest';
import { computeRenderWindow, WINDOW_SIZE } from '../../src/features/reader/useVirtualization';

describe('computeRenderWindow', () => {
  it('clamps to [0, total - 1]', () => {
    expect(computeRenderWindow(0, 50)).toEqual({ start: 0, end: WINDOW_SIZE });
    expect(computeRenderWindow(49, 50)).toEqual({ start: 49 - WINDOW_SIZE, end: 49 });
  });
  it('produces a window of size 2 * WINDOW_SIZE + 1 in the middle', () => {
    const w = computeRenderWindow(50, 100);
    expect(w.start).toBe(40);
    expect(w.end).toBe(60);
    expect(w.end - w.start + 1).toBe(WINDOW_SIZE * 2 + 1);
  });
});
