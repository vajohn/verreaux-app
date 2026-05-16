/**
 * Extracts a numeric sort key from a folder or file name.
 * Examples:
 *   "Chapter 001"          -> 1
 *   "Chapter 1.5"          -> 1.5
 *   "[Extra] Chapter 5"    -> 5
 *   "Chapter 001 (Fixed)"  -> 1
 *   "Prologue"             -> 0
 *   "ep23.webp"            -> 23
 */
export function extractSortKey(input: string): number {
  if (!input) return 0;
  // Match the first occurrence of a decimal-or-integer number with optional
  // leading zeros. Allow decimal point only between digits.
  const match = input.match(/(\d+)(?:\.(\d+))?/);
  if (!match) return 0;
  const intPart = match[1] ?? '0';
  const fracPart = match[2];
  if (fracPart !== undefined) {
    return parseFloat(`${intPart}.${fracPart}`);
  }
  return parseInt(intPart, 10);
}

export function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}
