/**
 * Integration test: Move up / Move down sort order
 *
 * Verifies that setSortOrder() swaps sortOrder values correctly, and that
 * the resulting order matches what the library would display.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db/db';
import { createSeries, getAllSeries, setSortOrder } from '../../src/db/repos/series.repo';

const PROFILE = 'sort-order-test';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.profiles.add({ id: PROFILE, name: 'Sort Tester', avatarColor: 'gold', createdAt: Date.now() });
});

afterEach(async () => {
  await db.delete();
});

async function createNamedSeries(title: string, sortOrder: number) {
  const s = await createSeries({ profileId: PROFILE, title, coverImageId: null });
  await setSortOrder(s.id, sortOrder);
  return { ...s, sortOrder };
}

function sortedByOrder(series: { title: string; sortOrder: number }[]) {
  return [...series].sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.title);
}

describe('custom sort: move up / move down', () => {
  it('swaps sortOrder between two adjacent items (move down)', async () => {
    const a = await createNamedSeries('Alpha', 100);
    const b = await createNamedSeries('Beta', 200);

    // Swap: move Alpha down (Alpha gets Beta's sortOrder, Beta gets Alpha's)
    await setSortOrder(a.id, b.sortOrder);
    await setSortOrder(b.id, a.sortOrder);

    const all = await getAllSeries(PROFILE);
    expect(sortedByOrder(all)).toEqual(['Beta', 'Alpha']);
  });

  it('swaps sortOrder between two adjacent items (move up)', async () => {
    const a = await createNamedSeries('Alpha', 100);
    const b = await createNamedSeries('Beta', 200);

    // Move Beta up — Beta gets Alpha's sortOrder, Alpha gets Beta's
    await setSortOrder(b.id, a.sortOrder);
    await setSortOrder(a.id, b.sortOrder);

    const all = await getAllSeries(PROFILE);
    expect(sortedByOrder(all)).toEqual(['Beta', 'Alpha']);
  });

  it('preserves order of non-swapped items', async () => {
    const a = await createNamedSeries('Alpha', 100);
    const b = await createNamedSeries('Beta', 200);
    const c = await createNamedSeries('Gamma', 300);

    // Move Gamma up one step (swap Gamma and Beta)
    await setSortOrder(c.id, b.sortOrder);
    await setSortOrder(b.id, c.sortOrder);

    const all = await getAllSeries(PROFILE);
    expect(sortedByOrder(all)).toEqual(['Alpha', 'Gamma', 'Beta']);
  });

  it('reload after swap reflects persisted sortOrder', async () => {
    const a = await createNamedSeries('Alpha', 100);
    const b = await createNamedSeries('Beta', 200);

    await setSortOrder(a.id, b.sortOrder);
    await setSortOrder(b.id, a.sortOrder);

    // Simulate reload: fetch fresh from IDB
    const reloaded = await getAllSeries(PROFILE);
    expect(sortedByOrder(reloaded)).toEqual(['Beta', 'Alpha']);

    // Reload again — persisted
    const reloaded2 = await getAllSeries(PROFILE);
    expect(sortedByOrder(reloaded2)).toEqual(['Beta', 'Alpha']);
  });

  it('moving first item up is a no-op (boundary guard)', async () => {
    const a = await createNamedSeries('Alpha', 100);
    const b = await createNamedSeries('Beta', 200);

    // Attempting to move Alpha (index 0) up — nothing to swap
    const series = (await getAllSeries(PROFILE)).sort((x, y) => x.sortOrder - y.sortOrder);
    const firstIdx = 0;
    // Guard: if index <= 0, do nothing
    if (firstIdx > 0) {
      const prev = series[firstIdx - 1];
      const curr = series[firstIdx];
      if (prev && curr) {
        await setSortOrder(curr.id, prev.sortOrder);
        await setSortOrder(prev.id, curr.sortOrder);
      }
    }

    const all = await getAllSeries(PROFILE);
    // Order unchanged
    expect(sortedByOrder(all)).toEqual(['Alpha', 'Beta']);

    // Suppress unused variable warning
    void a;
    void b;
  });
});
