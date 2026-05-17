import { describe, it, expect } from 'vitest';
import { sniffImageType } from '../../src/features/series/imageSniff';

function blobOf(bytes: number[], type = ''): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

// Pad bytes up to 16 so slice(0,12) always returns a full header.
function padded(prefix: number[]): number[] {
  const out = prefix.slice();
  while (out.length < 16) out.push(0x00);
  return out;
}

describe('sniffImageType', () => {
  it('detects JPEG by FF D8 FF prefix', async () => {
    const result = await sniffImageType(blobOf(padded([0xff, 0xd8, 0xff, 0xe0])));
    expect(result.kind).toBe('jpeg');
  });

  it('detects PNG by 8-byte signature', async () => {
    const result = await sniffImageType(
      blobOf(padded([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    );
    expect(result.kind).toBe('png');
  });

  it('detects GIF87a', async () => {
    const result = await sniffImageType(
      blobOf(padded([0x47, 0x49, 0x46, 0x38, 0x37, 0x61])),
    );
    expect(result.kind).toBe('gif');
  });

  it('detects GIF89a', async () => {
    const result = await sniffImageType(
      blobOf(padded([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])),
    );
    expect(result.kind).toBe('gif');
  });

  it('detects WebP via RIFF/WEBP container', async () => {
    const result = await sniffImageType(
      blobOf([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x00, 0x00, 0x00, 0x00, // size (any)
        0x57, 0x45, 0x42, 0x50, // WEBP
        0x56, 0x50, 0x38, 0x20, // VP8 (filler)
      ]),
    );
    expect(result.kind).toBe('webp');
  });

  it('detects AVIF via ftyp box with avif brand', async () => {
    const result = await sniffImageType(
      blobOf([
        0x00, 0x00, 0x00, 0x20, // box size
        0x66, 0x74, 0x79, 0x70, // "ftyp"
        0x61, 0x76, 0x69, 0x66, // "avif"
        0x00, 0x00, 0x00, 0x00,
      ]),
    );
    expect(result.kind).toBe('avif');
  });

  it('rejects HEIC via ftyp box with heic brand', async () => {
    const result = await sniffImageType(
      blobOf([
        0x00, 0x00, 0x00, 0x20,
        0x66, 0x74, 0x79, 0x70,
        0x68, 0x65, 0x69, 0x63, // "heic"
        0x00, 0x00, 0x00, 0x00,
      ]),
    );
    expect(result.kind).toBe('unsupported');
    if (result.kind === 'unsupported') {
      expect(result.reason).toMatch(/HEIC/i);
    }
  });

  it('rejects HEIF "mif1" brand', async () => {
    const result = await sniffImageType(
      blobOf([
        0x00, 0x00, 0x00, 0x20,
        0x66, 0x74, 0x79, 0x70,
        0x6d, 0x69, 0x66, 0x31, // "mif1"
        0x00, 0x00, 0x00, 0x00,
      ]),
    );
    expect(result.kind).toBe('unsupported');
  });

  it('rejects SVG by MIME type before reading bytes', async () => {
    const result = await sniffImageType(blobOf(padded([0x3c, 0x3f, 0x78, 0x6d, 0x6c]), 'image/svg+xml'));
    expect(result.kind).toBe('unsupported');
    if (result.kind === 'unsupported') {
      expect(result.reason).toMatch(/SVG/i);
    }
  });

  it('rejects empty blob', async () => {
    const result = await sniffImageType(new Blob([]));
    expect(result.kind).toBe('unsupported');
  });

  it('rejects unrecognized bytes (e.g. HTML masquerading as image)', async () => {
    const html = '<!doctype html><html>';
    const result = await sniffImageType(new Blob([html], { type: 'application/octet-stream' }));
    expect(result.kind).toBe('unsupported');
    if (result.kind === 'unsupported') {
      expect(result.reason).toMatch(/unrecognized/i);
    }
  });

  it('rejects files shorter than 4 bytes', async () => {
    const result = await sniffImageType(blobOf([0xff, 0xd8]));
    expect(result.kind).toBe('unsupported');
  });
});
