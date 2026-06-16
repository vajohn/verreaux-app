import { describe, it, expect, beforeEach } from 'vitest';
import { ZipWriter, BlobWriter, TextReader } from '@zip.js/zip.js';
import { openZip } from '../../src/lib/zip';
import { runNewSeriesPipeline } from '../../src/features/import/importRuntime';
import { db } from '../../src/db/db';

const PROFILE = 'p-src';

beforeEach(async () => { await db.delete(); await db.open(); });

async function makeType2Zip(): Promise<Uint8Array> {
  const zw = new ZipWriter(new BlobWriter('application/zip'));
  await zw.add('verreaux.json', new TextReader(JSON.stringify({ schema: 1, sourceUrl: 'https://qimanhwa.com/series/x', seriesTitle: 'Series X' })));
  await zw.add('Series X/Chapter 1/001.png', new TextReader('img-bytes'));
  const blob = await zw.close();
  return new Uint8Array(await blob.arrayBuffer());
}

describe('import stores sourceUrl from manifest', () => {
  it('sets sourceUrl on the created series', async () => {
    const zip = await openZip(await makeType2Zip());
    await runNewSeriesPipeline(zip, 'type2', PROFILE, () => {}, { cancelled: false }, undefined, 'https://qimanhwa.com/series/x');
    await zip.close();
    const series = await db.series.where('profileId').equals(PROFILE).first();
    expect(series?.sourceUrl).toBe('https://qimanhwa.com/series/x');
  });
});
