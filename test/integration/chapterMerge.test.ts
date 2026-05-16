import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import JSZip from 'jszip';
import { db } from '../../src/db/db';
import { runNewSeriesPipeline, runChapterMergePipeline } from '../../src/features/import/importRuntime';
import { detectImportType } from '../../src/features/import/typeDetector';

const PROFILE = 'pf-merge-1';

// Minimal 1x1 PNG (67 bytes) used as a page image fixture.
function makeMinimalPng(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR length + type
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // bit depth 8, RGB
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT length + type
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, // IDAT data
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, // CRC
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND length + type
    0x44, 0xae, 0x42, 0x60, 0x82,                   // IEND CRC
  ]);
}

/**
 * Build a library ZIP with the given series name and chapter numbers.
 * Each chapter gets one PNG page.
 */
async function buildLibraryZip(seriesName: string, chapterNumbers: number[]): Promise<JSZip> {
  const zip = new JSZip();
  const png = makeMinimalPng();
  zip.file(`${seriesName}/cover.png`, png);
  for (const n of chapterNumbers) {
    const chName = `Chapter ${String(n).padStart(3, '0')}`;
    zip.file(`${seriesName}/${chName}/001.png`, png);
  }
  return zip;
}

/**
 * Build a chapter-update ZIP containing only the specified chapter numbers.
 * Suitable for type3 / runChapterMergePipeline.
 */
async function buildChapterUpdateZip(chapterNumbers: number[]): Promise<JSZip> {
  const zip = new JSZip();
  const png = makeMinimalPng();
  for (const n of chapterNumbers) {
    const chName = `Chapter ${String(n).padStart(3, '0')}`;
    zip.file(`${chName}/001.png`, png);
  }
  return zip;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({
    id: PROFILE,
    name: 'MergeTester',
    avatarColor: 'gold',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  });
});

afterEach(async () => {
  await db.delete();
});

describe('runChapterMergePipeline (type-3 chapter update)', () => {
  it('adds new chapters to an existing series while preserving cover and progress', async () => {
    // Step 1: Import a 2-chapter library ZIP.
    const libraryZip = await buildLibraryZip('Rising Force', [1, 2]);
    const libraryType = detectImportType(libraryZip, 'home');
    expect(libraryType).toBe('type2');
    const seriesCount = await runNewSeriesPipeline(libraryZip, libraryType, PROFILE, () => {});
    expect(seriesCount).toBe(1);

    const seriesBefore = await db.series.where('profileId').equals(PROFILE).first();
    expect(seriesBefore).toBeDefined();
    const seriesId = seriesBefore!.id;
    const originalCoverId = seriesBefore!.coverImageId;
    expect(originalCoverId).toBeTruthy();

    const chaptersBefore = await db.chapters.where('seriesId').equals(seriesId).toArray();
    expect(chaptersBefore).toHaveLength(2);

    // Step 2: Simulate reading progress (chapter 1, page 0).
    await db.readingProgress.add({
      id: 'rp-1',
      profileId: PROFILE,
      seriesId,
      currentChapterId: chaptersBefore[0]!.id,
      pageIndex: 0,
      scrollPosition: 0,
      manuallyMarked: false,
      updatedAt: Date.now(),
    });

    // Step 3: Import a chapter-update ZIP with chapter 3.
    const updateZip = await buildChapterUpdateZip([3]);
    const updateType = detectImportType(updateZip, 'series');
    expect(updateType).toBe('type3');

    await runChapterMergePipeline(updateZip, seriesId, PROFILE, () => {});

    // Step 4: Assert series has 3 chapters in order.
    const chaptersAfter = await db.chapters
      .where('seriesId')
      .equals(seriesId)
      .sortBy('order');
    expect(chaptersAfter).toHaveLength(3);
    expect(chaptersAfter.map((c) => c.order)).toEqual([1, 2, 3]);

    // Step 5: Assert new chapter has page blobs (blobId is stored and resolves).
    const ch3 = chaptersAfter.find((c) => c.order === 3)!;
    const pages = await db.pages.where('chapterId').equals(ch3.id).toArray();
    expect(pages).toHaveLength(1);
    expect(pages[0]!.blobId).toBeTruthy();
    const blobRecord = await db.blobs.get(pages[0]!.blobId);
    expect(blobRecord).toBeDefined();

    // Step 6: Original cover is unchanged.
    const seriesAfter = await db.series.get(seriesId);
    expect(seriesAfter!.coverImageId).toBe(originalCoverId);

    // Step 7: Reading progress is unaffected.
    const progress = await db.readingProgress
      .where('[profileId+seriesId]')
      .equals([PROFILE, seriesId])
      .first();
    expect(progress).toBeDefined();
    expect(progress!.currentChapterId).toBe(chaptersBefore[0]!.id);
    expect(progress!.pageIndex).toBe(0);
  });

  it('skips chapters that already exist (idempotent merge)', async () => {
    const libraryZip = await buildLibraryZip('Rising Force', [1, 2]);
    const libraryType = detectImportType(libraryZip, 'home');
    await runNewSeriesPipeline(libraryZip, libraryType, PROFILE, () => {});

    const series = await db.series.where('profileId').equals(PROFILE).first();
    const seriesId = series!.id;

    // Import chapter 2 again — should be a no-op.
    const updateZip = await buildChapterUpdateZip([2]);
    await runChapterMergePipeline(updateZip, seriesId, PROFILE, () => {});

    const chapters = await db.chapters.where('seriesId').equals(seriesId).toArray();
    expect(chapters).toHaveLength(2);
  });
});

describe('quota check — main-thread path', () => {
  it('transitions to quota-warning state when usage + file size exceeds 80% of quota', async () => {
    // jsdom does not expose navigator.storage; install a minimal stub so the
    // importController quota check can call estimate().
    const mockEstimate = vi.fn().mockResolvedValue({ quota: 1000, usage: 900 });
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: mockEstimate },
    });

    const { useImportStore } = await import('../../src/features/import/import.store');
    const { startImport } = await import('../../src/features/import/importController');

    useImportStore.getState().reset();

    // A 50-byte file: 900 + 50 = 950 > 800 (80% of 1000) → should warn.
    const file = new File([new Uint8Array(50)], 'test.zip', { type: 'application/zip' });
    startImport({ file, context: 'home', activeProfileId: PROFILE });

    // Allow the async IIFE in startImport to complete.
    await vi.waitFor(() => {
      const s = useImportStore.getState().state;
      return s.status === 'quota-warning';
    });

    const state = useImportStore.getState().state;
    expect(state.status).toBe('quota-warning');
    if (state.status === 'quota-warning') {
      expect(state.estimatedBytes).toBe(50);
      expect(state.availableBytes).toBe(100); // quota(1000) - usage(900)
    }

    // pendingArgs must be stored so continueImport() can proceed.
    expect(useImportStore.getState().pendingArgs).toBeTruthy();
  });
});
