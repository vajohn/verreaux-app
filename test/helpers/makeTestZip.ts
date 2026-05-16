/**
 * Test helper: build a real ZIP archive (Uint8Array) from a flat file map,
 * then open it via the production `openZip` so tests exercise the same
 * ZipReader interface the runtime uses.
 *
 * Accepts string contents (encoded as UTF-8) or raw Uint8Array bytes.
 * Stored uncompressed — these are tiny test fixtures.
 */
import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from '@zip.js/zip.js';
import { openZip, type ZipReader } from '../../src/lib/zip';

export type ZipFileContent = string | Uint8Array;
export type ZipFiles = Record<string, ZipFileContent>;

export async function buildZipBytes(files: ZipFiles): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  for (const [path, content] of Object.entries(files)) {
    if (typeof content === 'string') {
      await writer.add(path, new TextReader(content));
    } else {
      await writer.add(path, new Uint8ArrayReader(content));
    }
  }
  return writer.close();
}

export async function makeTestZip(files: ZipFiles): Promise<ZipReader> {
  const bytes = await buildZipBytes(files);
  return openZip(bytes);
}
