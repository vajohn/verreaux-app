import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { db } from '../../src/db/db';
import { runNewSeriesPipeline } from '../../src/features/import/importRuntime';
import { detectImportType } from '../../src/features/import/typeDetector';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '..', 'fixtures', 'library.zip');
const PROFILE = 'pf-1';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({
    id: PROFILE,
    name: 'Tester',
    avatarColor: 'gold',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  });
});

describe('import → IDB', () => {
  it('persists all series, chapters, pages, and cover blobs from the fixture ZIP', async () => {
    const buf = readFileSync(FIXTURE);
    const zip = await JSZip.loadAsync(buf);
    const type = detectImportType(zip, 'home');
    expect(type).toBe('type1');
    const seriesCount = await runNewSeriesPipeline(zip, type, PROFILE, () => {});
    expect(seriesCount).toBe(2);
    const series = await db.series.where('profileId').equals(PROFILE).toArray();
    expect(series).toHaveLength(2);
    for (const s of series) {
      expect(s.coverImageId).toBeTruthy();
      const chapters = await db.chapters.where('seriesId').equals(s.id).toArray();
      expect(chapters.length).toBeGreaterThan(0);
      for (const c of chapters) {
        const pages = await db.pages.where('chapterId').equals(c.id).toArray();
        expect(pages.length).toBeGreaterThan(0);
      }
    }
  });

  it('skips chapters that already exist on a re-import (merge by normalized title and order)', async () => {
    const buf = readFileSync(FIXTURE);
    const zip = await JSZip.loadAsync(buf);
    const type = detectImportType(zip, 'home');
    await runNewSeriesPipeline(zip, type, PROFILE, () => {});
    const beforeChapters = await db.chapters.count();
    const zip2 = await JSZip.loadAsync(buf);
    await runNewSeriesPipeline(zip2, type, PROFILE, () => {});
    const afterChapters = await db.chapters.count();
    expect(afterChapters).toBe(beforeChapters);
  });
});
