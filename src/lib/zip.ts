/**
 * Thin wrapper around @zip.js/zip.js exposing only the operations the app
 * needs: enumerate paths, check existence, read one entry to a Blob, close.
 *
 * Why an internal abstraction:
 * - Decouples call sites from a specific ZIP library so future swaps stay
 *   local to this file.
 * - Lets tests construct a reader from an in-memory Uint8Array via the same
 *   API the runtime uses on a Blob.
 *
 * Memory model: BlobReader gives zip.js random access to the underlying file
 * without ever loading it whole into an ArrayBuffer. Each `readBlob(path)`
 * streams one entry's bytes into a fresh Blob; previous blobs are released
 * by the GC once callers drop their references. This is what makes ingesting
 * a multi-GB archive on iOS Safari viable — JSZip's `loadAsync` cannot do it.
 */
import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  ZipReader as ZipJsReader,
  ZipWriter,
  configure,
  type Entry,
} from '@zip.js/zip.js';

// We are already inside a Web Worker for imports; let zip.js decompress on
// the same thread instead of spawning nested workers (avoids worker-in-worker
// instability on iOS WebKit). Decompression cost is negligible here because
// the scraper writes pages with STORED (no compression).
configure({ useWebWorkers: false });

export interface ZipEntryMeta {
  /** Full path inside the archive (e.g. "Series/Chapter 001/001.webp"). */
  path: string;
  /** Uncompressed byte length, if reported by the central directory. */
  size: number;
  isDirectory: boolean;
}

export interface ZipReader {
  entries(): readonly ZipEntryMeta[];
  has(path: string): boolean;
  readBlob(path: string): Promise<Blob>;
  readText(path: string): Promise<string>;
  close(): Promise<void>;
}

class ZipReaderImpl implements ZipReader {
  private readonly inner: ZipJsReader<unknown>;
  private readonly entriesByPath: Map<string, Entry>;
  private readonly entriesList: ZipEntryMeta[];
  private closed = false;

  constructor(inner: ZipJsReader<unknown>, entries: Entry[]) {
    this.inner = inner;
    this.entriesByPath = new Map();
    this.entriesList = [];
    for (const entry of entries) {
      this.entriesByPath.set(entry.filename, entry);
      this.entriesList.push({
        path: entry.filename,
        size: entry.uncompressedSize ?? 0,
        isDirectory: entry.directory,
      });
    }
  }

  entries(): readonly ZipEntryMeta[] {
    return this.entriesList;
  }

  has(path: string): boolean {
    return this.entriesByPath.has(path);
  }

  async readBlob(path: string): Promise<Blob> {
    if (this.closed) throw new Error('ZipReader closed');
    const entry = this.entriesByPath.get(path);
    if (!entry) throw new Error(`Entry not found: ${path}`);
    if (entry.directory) throw new Error(`Entry is a directory: ${path}`);
    // Entry is the union DirectoryEntry | FileEntry; getData only exists on
    // FileEntry. Cast after the directory guard above.
    const fileEntry = entry as Entry & {
      getData: (writer: BlobWriter) => Promise<Blob>;
    };
    // Pass the MIME type through to the resulting Blob. Raster formats (PNG,
    // JPEG, WebP) work in <img src="blob:..."> even with empty type because
    // browsers content-sniff them, but SVG explicitly does NOT sniff (anti-
    // XSS) — without `type: image/svg+xml` the blob URL renders blank.
    const mime = mimeForPath(path);
    return fileEntry.getData(new BlobWriter(mime));
  }

  async readText(path: string): Promise<string> {
    if (this.closed) throw new Error('ZipReader closed');
    const entry = this.entriesByPath.get(path);
    if (!entry) throw new Error(`Entry not found: ${path}`);
    if (entry.directory) throw new Error(`Entry is a directory: ${path}`);
    const fileEntry = entry as Entry & {
      getData: (writer: TextWriter) => Promise<string>;
    };
    return fileEntry.getData(new TextWriter());
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.inner.close();
  }
}

function mimeForPath(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return '';
  switch (path.slice(dot).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return '';
  }
}

/** Open a ZIP from a Blob (browser File) or Uint8Array (Node tests). */
export async function openZip(source: Blob | Uint8Array): Promise<ZipReader> {
  const reader =
    source instanceof Uint8Array
      ? new Uint8ArrayReader(source)
      : new BlobReader(source);
  const zip = new ZipJsReader(reader);
  const entries = await zip.getEntries();
  return new ZipReaderImpl(zip, entries);
}

/** Re-export the writer side for use in exportLibrary.ts and tests. */
export { BlobReader, BlobWriter, TextReader, TextWriter, ZipWriter };
