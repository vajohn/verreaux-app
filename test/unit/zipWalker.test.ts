import { describe, it, expect } from 'vitest';
import { makeTestZip } from '../helpers/makeTestZip';
import { walkLibrary, walkChapterUpdate } from '../../src/features/import/zipWalker';

const STUB = '\u0000';

describe('walkLibrary', () => {
  it('walks a Type 1 ZIP and discovers series + chapters + pages', async () => {
    const zip = await makeTestZip({
      'Series A/cover.png': STUB,
      'Series A/Chapter 001/001.png': STUB,
      'Series A/Chapter 001/002.png': STUB,
      'Series A/Chapter 002/001.png': STUB,
      'Series B/Chapter 001/001.png': STUB,
    });

    const series = await walkLibrary(zip);
    expect(series).toHaveLength(2);
    const a = series.find((s) => s.title === 'Series A')!;
    expect(a.coverPath).toBe('Series A/cover.png');
    expect(a.chapters).toHaveLength(2);
    expect(a.chapters[0]!.pages).toHaveLength(2);
    expect(a.chapters[0]!.order).toBe(1);
    expect(a.chapters[1]!.order).toBe(2);
  });

  it('sorts chapters by extracted order key, not by name', async () => {
    const zip = await makeTestZip({
      'Foo/Chapter 002/001.png': STUB,
      'Foo/Chapter 001/001.png': STUB,
      'Foo/Chapter 010/001.png': STUB,
    });
    const series = await walkLibrary(zip);
    const orders = series[0]!.chapters.map((c) => c.order);
    expect(orders).toEqual([1, 2, 10]);
  });

  it('skips chapters with no image pages', async () => {
    const zip = await makeTestZip({
      'Foo/Chapter 1/001.png': STUB,
      'Foo/Chapter 2/notes.txt': 'no image',
    });
    const series = await walkLibrary(zip);
    expect(series[0]!.chapters).toHaveLength(1);
  });
});

describe('walkChapterUpdate', () => {
  it('discovers chapter folders for a Type 3 ZIP', async () => {
    const zip = await makeTestZip({
      'Chapter 5/001.png': STUB,
      'Chapter 5/002.png': STUB,
    });
    const chapters = await walkChapterUpdate(zip);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.order).toBe(5);
    expect(chapters[0]!.pages).toHaveLength(2);
  });
});
