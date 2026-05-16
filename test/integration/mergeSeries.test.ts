import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import { db } from '../../src/db/db';
import { runNewSeriesPipeline } from '../../src/features/import/importRuntime';
import { detectImportType } from '../../src/features/import/typeDetector';
import { computeMergePlan, mergeSeries } from '../../src/db/repos/series.repo';

const PROFILE = 'merge-series-test';

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

async function buildZip(name: string, chapters: number[]): Promise<JSZip> {
  const zip = new JSZip();
  const png = makeMinimalPng();
  zip.file(`${name}/cover.png`, png);
  for (const n of chapters) {
    zip.file(`${name}/Chapter ${String(n).padStart(3, '0')}/001.png`, png);
  }
  return zip;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({
    id: PROFILE,
    name: 'MergeIntegrationTester',
    avatarColor: 'gold',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  });
});

afterEach(async () => {
  await db.delete();
});

describe('computeMergePlan', () => {
  it('detects conflicts for chapters with the same order value', async () => {
    // Import series A with chapters 1, 2
    const zipA = await buildZip('Series A', [1, 2]);
    const typeA = detectImportType(zipA, 'home');
    await runNewSeriesPipeline(zipA, typeA, PROFILE, () => {});

    // Import series B with chapters 2, 3
    const zipB = await buildZip('Series B', [2, 3]);
    const typeB = detectImportType(zipB, 'home');
    await runNewSeriesPipeline(zipB, typeB, PROFILE, () => {});

    const seriesA = await db.series.where('normalizedTitle').equals('series a').first();
    const seriesB = await db.series.where('normalizedTitle').equals('series b').first();
    expect(seriesA).toBeDefined();
    expect(seriesB).toBeDefined();

    const plan = await computeMergePlan(seriesB!.id, seriesA!.id);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]!.order).toBe(2);
    expect(plan.sourceOnlyOrders).toContain(3);
  });
});

describe('mergeSeries', () => {
  it('merges two series with no conflicts — all source chapters adopted', async () => {
    // Series A: chapters 1, 2
    const zipA = await buildZip('Merge Target', [1, 2]);
    await runNewSeriesPipeline(zipA, detectImportType(zipA, 'home'), PROFILE, () => {});

    // Series B: chapters 3, 4
    const zipB = await buildZip('Merge Source', [3, 4]);
    await runNewSeriesPipeline(zipB, detectImportType(zipB, 'home'), PROFILE, () => {});

    const target = await db.series.where('normalizedTitle').equals('merge target').first();
    const source = await db.series.where('normalizedTitle').equals('merge source').first();
    expect(target).toBeDefined();
    expect(source).toBeDefined();

    await mergeSeries(target!.id, source!.id, new Map());

    // Source series should be gone
    const afterSource = await db.series.get(source!.id);
    expect(afterSource).toBeUndefined();

    // Target series should have 4 chapters
    const chapters = await db.chapters.where('seriesId').equals(target!.id).toArray();
    expect(chapters).toHaveLength(4);
    expect(chapters.map((c) => c.order).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it('resolves conflicts by keeping target chapter when resolution = "target"', async () => {
    const zipA = await buildZip('Conflict Target', [1, 2]);
    await runNewSeriesPipeline(zipA, detectImportType(zipA, 'home'), PROFILE, () => {});

    const zipB = await buildZip('Conflict Source', [2, 3]);
    await runNewSeriesPipeline(zipB, detectImportType(zipB, 'home'), PROFILE, () => {});

    const target = await db.series.where('normalizedTitle').equals('conflict target').first();
    const source = await db.series.where('normalizedTitle').equals('conflict source').first();
    expect(target).toBeDefined();
    expect(source).toBeDefined();

    // Get target's chapter at order=2 before merge to verify it's kept
    const targetCh2Before = await db.chapters
      .where('[seriesId+order]')
      .equals([target!.id, 2])
      .first();
    expect(targetCh2Before).toBeDefined();

    // Resolve conflict: keep target for order=2
    const resolutions = new Map<number, 'target' | 'source'>([[2, 'target']]);
    await mergeSeries(target!.id, source!.id, resolutions);

    // Target chapter at order=2 should survive
    const targetCh2After = await db.chapters.get(targetCh2Before!.id);
    expect(targetCh2After).toBeDefined();

    // Merged result: chapters 1, 2, 3
    const chapters = await db.chapters.where('seriesId').equals(target!.id).toArray();
    const orders = chapters.map((c) => c.order).sort((a, b) => a - b);
    expect(orders).toEqual([1, 2, 3]);
  });

  it('deletes source series after merge', async () => {
    const zipA = await buildZip('Del Target', [1]);
    await runNewSeriesPipeline(zipA, detectImportType(zipA, 'home'), PROFILE, () => {});

    const zipB = await buildZip('Del Source', [2]);
    await runNewSeriesPipeline(zipB, detectImportType(zipB, 'home'), PROFILE, () => {});

    const target = await db.series.where('normalizedTitle').equals('del target').first();
    const source = await db.series.where('normalizedTitle').equals('del source').first();
    expect(source).toBeDefined();

    await mergeSeries(target!.id, source!.id, new Map());

    expect(await db.series.get(source!.id)).toBeUndefined();
  });

  it('remaps readingProgress from source to target series', async () => {
    const zipA = await buildZip('Remap Target', [1]);
    await runNewSeriesPipeline(zipA, detectImportType(zipA, 'home'), PROFILE, () => {});

    const zipB = await buildZip('Remap Source', [2]);
    await runNewSeriesPipeline(zipB, detectImportType(zipB, 'home'), PROFILE, () => {});

    const target = await db.series.where('normalizedTitle').equals('remap target').first();
    const source = await db.series.where('normalizedTitle').equals('remap source').first();
    const sourceCh = await db.chapters.where('seriesId').equals(source!.id).first();

    // Add progress on source series
    await db.readingProgress.add({
      id: 'rp-remap-1',
      profileId: PROFILE,
      seriesId: source!.id,
      currentChapterId: sourceCh!.id,
      pageIndex: 0,
      scrollPosition: 0,
      manuallyMarked: false,
      updatedAt: Date.now(),
    });

    await mergeSeries(target!.id, source!.id, new Map());

    const rp = await db.readingProgress.get('rp-remap-1');
    expect(rp?.seriesId).toBe(target!.id);
  });
});
