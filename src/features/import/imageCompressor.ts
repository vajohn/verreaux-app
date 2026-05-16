/**
 * Resize an image blob to a maximum dimension of 1600px using a canvas,
 * outputting JPEG at 0.85 quality.
 *
 * Note: This is a synchronous canvas operation that runs on the main thread
 * (or in a worker that supports OffscreenCanvas). It can significantly slow
 * down imports for large images. Only enabled when compressOnImport is true.
 */

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

export async function compressImageBlob(blob: Blob): Promise<Blob> {
  // Decode the image via createImageBitmap (available in workers and main thread)
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;

  // Check if resizing is needed
  if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
    bitmap.close();
    return blob; // No resize needed
  }

  const scale = MAX_DIMENSION / Math.max(width, height);
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);

  // OffscreenCanvas may not be available in all environments (e.g., jsdom test env)
  if (typeof OffscreenCanvas === 'undefined') {
    bitmap.close();
    return blob; // Fallback: return original
  }

  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return blob; // Fallback: return original
  }

  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  const compressed = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  return compressed;
}
