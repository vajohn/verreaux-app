// Build the fixture ZIP used by tests and the dev demo.
// Pure-Node: writes a tiny placeholder PNG (8x8) and zips it via JSZip.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { Buffer } from 'node:buffer';
import { deflateRawSync, crc32 } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Build a tiny RGBA PNG from a flat pixel buffer.
 * Uses Node's zlib for the IDAT chunk.
 */
function makePng(width, height, tone) {
  const channels = 4;
  const rowBytes = width * channels;
  // Construct raw image data: each scanline prefixed by filter byte 0.
  const raw = Buffer.alloc(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) {
    const off = y * (1 + rowBytes);
    raw[off] = 0; // filter
    for (let x = 0; x < width; x++) {
      const i = off + 1 + x * 4;
      raw[i] = (tone + x * 3) & 0xff;
      raw[i + 1] = (tone + y * 5) & 0xff;
      raw[i + 2] = (tone + (x + y)) & 0xff;
      raw[i + 3] = 255;
    }
  }
  const idatData = deflateRawSync(raw);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcInput = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcInput) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  const outDir = resolve(__dirname, '..', 'test', 'fixtures');
  mkdirSync(outDir, { recursive: true });

  const zip = new JSZip();

  // Two series. Each has 2 chapters. Each chapter has 3 pages.
  const series = [
    { name: 'Solo Leveling', tone: 80 },
    { name: 'Tower of God', tone: 160 },
  ];

  for (const s of series) {
    // cover at series root
    const cover = makePng(16, 24, s.tone);
    zip.file(`${s.name}/cover.png`, cover);
    for (let c = 1; c <= 2; c++) {
      for (let p = 1; p <= 3; p++) {
        const png = makePng(20, 28, (s.tone + c * 10 + p * 5) & 0xff);
        const cName = `Chapter ${String(c).padStart(3, '0')}`;
        const pName = `${String(p).padStart(3, '0')}.png`;
        zip.file(`${s.name}/${cName}/${pName}`, png);
      }
    }
  }

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const outPath = resolve(outDir, 'library.zip');
  writeFileSync(outPath, buf);
  console.log(`Wrote ${outPath} (${buf.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
