import { describe, it, expect, vi } from 'vitest';
import { compressImageBlob } from '../../src/features/import/imageCompressor';

// In jsdom/vitest, createImageBitmap and OffscreenCanvas are not available.
// We test the no-op path (when image fits within MAX_DIMENSION) and the
// fallback when OffscreenCanvas is unavailable.

describe('compressImageBlob', () => {
  it('returns the original blob when within max dimension', async () => {
    // Stub createImageBitmap to return a small image (100x100)
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() }),
    );

    const original = new Blob([new Uint8Array(64)], { type: 'image/png' });
    const result = await compressImageBlob(original);
    expect(result).toBe(original); // same reference — no resize needed
  });

  it('falls back to original blob when OffscreenCanvas is unavailable', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 2000, height: 3000, close: vi.fn() }),
    );

    // OffscreenCanvas is not available in jsdom — compressImageBlob should fall back
    const original = new Blob([new Uint8Array(64)], { type: 'image/png' });
    const result = await compressImageBlob(original);

    // In jsdom (no OffscreenCanvas), should return the original blob unchanged
    expect(result).toBe(original);
  });

  it('handles createImageBitmap rejection gracefully', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockRejectedValue(new Error('Unsupported format')),
    );

    const original = new Blob([new Uint8Array(64)], { type: 'image/png' });
    // Should reject since createImageBitmap threw — caller handles this
    await expect(compressImageBlob(original)).rejects.toThrow();
  });
});
