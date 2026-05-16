import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import { db } from '../../src/db/db';
import { runNewSeriesPipeline } from '../../src/features/import/importRuntime';
import { detectImportType } from '../../src/features/import/typeDetector';
import { createProfile } from '../../src/db/repos/profiles.repo';
import { getAllSeries } from '../../src/db/repos/series.repo';

function makeMinimalPng(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

async function buildLibraryZip(seriesName: string): Promise<JSZip> {
  const zip = new JSZip();
  const png = makeMinimalPng();
  zip.file(`${seriesName}/cover.png`, png);
  zip.file(`${seriesName}/Chapter 001/001.png`, png);
  return zip;
}

let profileA: string;
let profileB: string;

beforeEach(async () => {
  await db.delete();
  await db.open();

  const pA = await createProfile('Profile A', 'gold');
  const pB = await createProfile('Profile B', 'steel');
  profileA = pA.id;
  profileB = pB.id;
});

afterEach(async () => {
  await db.delete();
});

describe('profile data isolation', () => {
  it('series imported to profile A are not visible to profile B', async () => {
    const zip = await buildLibraryZip('Exclusive Series');
    const importType = detectImportType(zip, 'home');
    await runNewSeriesPipeline(zip, importType, profileA, () => {});

    const seriesInA = await getAllSeries(profileA);
    const seriesInB = await getAllSeries(profileB);

    expect(seriesInA).toHaveLength(1);
    expect(seriesInA[0]!.title).toBe('Exclusive Series');
    expect(seriesInB).toHaveLength(0);
  });

  it('series imported to profile B do not appear in profile A', async () => {
    const zipA = await buildLibraryZip('Series For A');
    const zipB = await buildLibraryZip('Series For B');

    await runNewSeriesPipeline(zipA, detectImportType(zipA, 'home'), profileA, () => {});
    await runNewSeriesPipeline(zipB, detectImportType(zipB, 'home'), profileB, () => {});

    const seriesA = await getAllSeries(profileA);
    const seriesB = await getAllSeries(profileB);

    expect(seriesA).toHaveLength(1);
    expect(seriesA[0]!.title).toBe('Series For A');
    expect(seriesB).toHaveLength(1);
    expect(seriesB[0]!.title).toBe('Series For B');
  });

  it('reading progress is isolated between profiles', async () => {
    const zip = await buildLibraryZip('Shared Title');
    await runNewSeriesPipeline(zip, detectImportType(zip, 'home'), profileA, () => {});

    const seriesA = await getAllSeries(profileA);
    const seriesId = seriesA[0]!.id;

    // Add reading progress for profile A
    await db.readingProgress.add({
      id: 'rp-isolation-test',
      profileId: profileA,
      seriesId,
      currentChapterId: 'ch-test',
      pageIndex: 5,
      scrollPosition: 200,
      manuallyMarked: false,
      updatedAt: Date.now(),
    });

    // Profile B should have no reading progress
    const progressB = await db.readingProgress.where('profileId').equals(profileB).toArray();
    expect(progressB).toHaveLength(0);

    // Profile A still has its progress
    const progressA = await db.readingProgress.where('profileId').equals(profileA).toArray();
    expect(progressA).toHaveLength(1);
    expect(progressA[0]!.pageIndex).toBe(5);
  });
});
