import { describe, it, expect } from 'vitest';
import { makeTestZip } from '../helpers/makeTestZip';
import { detectImportType } from '../../src/features/import/typeDetector';

const STUB = '\u0000';

describe('detectImportType', () => {
  it('detects Type 1 (multiple series with chapter subfolders)', async () => {
    const zip = await makeTestZip({
      'Series A/Chapter 1/001.png': STUB,
      'Series A/Chapter 2/001.png': STUB,
      'Series B/Chapter 1/001.png': STUB,
    });
    expect(detectImportType(zip, 'home')).toBe('type1');
  });

  it('detects Type 2 (single series with chapter subfolders)', async () => {
    const zip = await makeTestZip({
      'Solo Leveling/Chapter 1/001.png': STUB,
      'Solo Leveling/Chapter 2/001.png': STUB,
    });
    expect(detectImportType(zip, 'home')).toBe('type2');
  });

  it('throws when no series folders are present', async () => {
    const zip = await makeTestZip({ 'readme.txt': 'hello' });
    expect(() => detectImportType(zip, 'home')).toThrow();
  });

  it('detects Type 3 (single chapter folder) from series context', async () => {
    const zip = await makeTestZip({
      'Chapter 5/001.png': STUB,
      'Chapter 5/002.png': STUB,
    });
    expect(detectImportType(zip, 'series')).toBe('type3');
  });

  it('detects Type 2 from series context when subfolders are present', async () => {
    const zip = await makeTestZip({
      'Solo Leveling/Chapter 1/001.png': STUB,
      'Solo Leveling/Chapter 2/001.png': STUB,
    });
    expect(detectImportType(zip, 'series')).toBe('type2');
  });
});
