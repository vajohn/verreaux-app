import { describe, it, expect } from 'vitest';
import { titleFromSourceUrl } from '../../src/features/sync/sourceUrlTitle';

describe('titleFromSourceUrl', () => {
  it('derives a title-cased name from the last meaningful path segment', () => {
    expect(titleFromSourceUrl('https://qimanhwa.com/manga/solo-leveling')).toBe('Solo Leveling');
    expect(titleFromSourceUrl('https://x.test/series/the_beginning-after-the-end/')).toBe('The Beginning After The End');
    expect(titleFromSourceUrl('https://x.test/comic/9999')).toBe('Comic 9999'); // numeric-only slug falls back to prior segment + id
  });
  it('falls back to the host when no usable path', () => {
    expect(titleFromSourceUrl('https://qimanhwa.com/')).toBe('qimanhwa.com');
    expect(titleFromSourceUrl('not a url')).toBe('New series');
  });
});
