import { describe, it, expect } from 'vitest';
import { extractSortKey, stemOf, extOf } from '../../src/lib/naturalSort';

describe('extractSortKey', () => {
  it('handles zero-padded integers', () => {
    expect(extractSortKey('Chapter 001')).toBe(1);
  });
  it('handles decimal chapters', () => {
    expect(extractSortKey('Chapter 1.5')).toBe(1.5);
  });
  it('handles prefix noise', () => {
    expect(extractSortKey('[Extra] Chapter 5')).toBe(5);
  });
  it('handles suffix noise', () => {
    expect(extractSortKey('Chapter 001 (Fixed)')).toBe(1);
  });
  it('falls back to 0 for non-numeric', () => {
    expect(extractSortKey('Prologue')).toBe(0);
  });
  it('handles big numbers', () => {
    expect(extractSortKey('Ep12345')).toBe(12345);
  });
});

describe('stemOf', () => {
  it('removes extensions', () => {
    expect(stemOf('001.png')).toBe('001');
    expect(stemOf('cover.webp')).toBe('cover');
  });
  it('keeps names without extensions', () => {
    expect(stemOf('readme')).toBe('readme');
  });
});

describe('extOf', () => {
  it('returns lowercase extension with dot', () => {
    expect(extOf('001.PNG')).toBe('.png');
    expect(extOf('cover.WEBP')).toBe('.webp');
  });
  it('returns empty when no extension', () => {
    expect(extOf('foo')).toBe('');
  });
});
