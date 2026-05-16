const DEBUG =
  typeof localStorage !== 'undefined' && localStorage.getItem('verreaux:debug') === 'true';

export function dbg(...args: unknown[]): void {
  if (DEBUG && typeof console !== 'undefined') {
    // eslint-disable-next-line no-console
    console.debug('[Verreaux]', ...args);
  }
}
