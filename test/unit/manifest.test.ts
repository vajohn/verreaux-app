import { describe, it, expect } from 'vitest';
import { ZipWriter, BlobWriter, TextReader } from '@zip.js/zip.js';
import { openZip } from '../../src/lib/zip';
import { readManifest } from '../../src/features/import/manifest';

async function zipWith(files: Record<string, string>): Promise<Uint8Array> {
  const zw = new ZipWriter(new BlobWriter('application/zip'));
  for (const [name, text] of Object.entries(files)) await zw.add(name, new TextReader(text));
  const blob = await zw.close();
  return new Uint8Array(await blob.arrayBuffer());
}

describe('readManifest', () => {
  it('returns the sourceUrl from a verreaux.json at the zip root', async () => {
    const bytes = await zipWith({
      'verreaux.json': JSON.stringify({ schema: 1, sourceUrl: 'https://qimanhwa.com/series/x', seriesTitle: 'X' }),
      'X/Chapter 1/001.png': 'x',
    });
    const zip = await openZip(bytes);
    expect((await readManifest(zip))?.sourceUrl).toBe('https://qimanhwa.com/series/x');
    await zip.close();
  });

  it('returns null when there is no manifest', async () => {
    const bytes = await zipWith({ 'X/Chapter 1/001.png': 'x' });
    const zip = await openZip(bytes);
    expect(await readManifest(zip)).toBeNull();
    await zip.close();
  });

  it('returns null for a malformed manifest rather than throwing', async () => {
    const bytes = await zipWith({ 'verreaux.json': '{not json' });
    const zip = await openZip(bytes);
    expect(await readManifest(zip)).toBeNull();
    await zip.close();
  });
});
