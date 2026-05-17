/**
 * imageSniff — detect image format from a Blob's magic bytes.
 *
 * Used to validate cover images regardless of the server's Content-Type header
 * (some CDNs serve images as application/octet-stream) and to reject formats
 * we cannot render reliably across browsers (HEIC) or that pose XSS risk (SVG).
 */

export type SupportedKind = 'jpeg' | 'png' | 'gif' | 'webp' | 'avif';

export type SniffResult =
  | { kind: SupportedKind }
  | { kind: 'unsupported'; reason: string };

const SVG_MIME = 'image/svg+xml';

export async function sniffImageType(blob: Blob): Promise<SniffResult> {
  if (blob.type === SVG_MIME || blob.type === 'image/svg') {
    return { kind: 'unsupported', reason: 'SVG is not allowed' };
  }
  if (blob.size === 0) {
    return { kind: 'unsupported', reason: 'Empty file' };
  }

  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (header.length < 4) {
    return { kind: 'unsupported', reason: 'File too small to identify' };
  }

  // JPEG: FF D8 FF
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return { kind: 'jpeg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  ) {
    return { kind: 'png' };
  }

  // GIF: 47 49 46 38 (37|39) 61  → "GIF87a" or "GIF89a"
  if (
    header.length >= 6 &&
    header[0] === 0x47 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x38 &&
    (header[4] === 0x37 || header[4] === 0x39) &&
    header[5] === 0x61
  ) {
    return { kind: 'gif' };
  }

  // WebP: RIFF....WEBP  → 52 49 46 46 ?? ?? ?? ?? 57 45 42 50
  if (
    header.length >= 12 &&
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header[8] === 0x57 &&
    header[9] === 0x45 &&
    header[10] === 0x42 &&
    header[11] === 0x50
  ) {
    return { kind: 'webp' };
  }

  // ISO BMFF "ftyp" box at offset 4: detects AVIF, HEIC, HEIF
  if (
    header.length >= 12 &&
    header[4] === 0x66 &&
    header[5] === 0x74 &&
    header[6] === 0x79 &&
    header[7] === 0x70
  ) {
    const brand = String.fromCharCode(header[8], header[9], header[10], header[11]);
    if (brand === 'avif' || brand === 'avis') {
      return { kind: 'avif' };
    }
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'msf1' || brand === 'heim' || brand === 'heis') {
      return {
        kind: 'unsupported',
        reason: 'HEIC/HEIF not supported — please convert to JPEG or PNG',
      };
    }
  }

  return { kind: 'unsupported', reason: 'Unrecognized image format' };
}
