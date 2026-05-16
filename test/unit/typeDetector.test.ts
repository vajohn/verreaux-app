import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { detectImportType } from '../../src/features/import/typeDetector';

function makeFile(content = '\u0000'): string {
  return content;
}

describe('detectImportType', () => {
  it('detects Type 1 (multiple series with chapter subfolders)', () => {
    const zip = new JSZip();
    zip.file('Series A/Chapter 1/001.png', makeFile());
    zip.file('Series A/Chapter 2/001.png', makeFile());
    zip.file('Series B/Chapter 1/001.png', makeFile());
    expect(detectImportType(zip, 'home')).toBe('type1');
  });

  it('detects Type 2 (single series with chapter subfolders)', () => {
    const zip = new JSZip();
    zip.file('Solo Leveling/Chapter 1/001.png', makeFile());
    zip.file('Solo Leveling/Chapter 2/001.png', makeFile());
    expect(detectImportType(zip, 'home')).toBe('type2');
  });

  it('throws when no series folders are present', () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'hello');
    expect(() => detectImportType(zip, 'home')).toThrow();
  });

  it('detects Type 3 (single chapter folder) from series context', () => {
    const zip = new JSZip();
    zip.file('Chapter 5/001.png', makeFile());
    zip.file('Chapter 5/002.png', makeFile());
    expect(detectImportType(zip, 'series')).toBe('type3');
  });

  it('detects Type 2 from series context when subfolders are present', () => {
    const zip = new JSZip();
    zip.file('Solo Leveling/Chapter 1/001.png', makeFile());
    zip.file('Solo Leveling/Chapter 2/001.png', makeFile());
    expect(detectImportType(zip, 'series')).toBe('type2');
  });
});
