import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';

// Provide a stable crypto.randomUUID in environments that lack it
if (!('randomUUID' in globalThis.crypto)) {
  let counter = 0;
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: () => `00000000-0000-4000-8000-${(counter++).toString().padStart(12, '0')}`,
  });
}

// Node.js 25 exposes a non-functional stub `localStorage` global
// (--localstorage-file without a path).  vitest's populateGlobal skips it
// because it is already on the global and not in its KEYS allowlist.
// Forcibly install jsdom's real Storage implementation so tests can call
// localStorage.setItem / .clear as normal.
// We obtain the real Storage from jsdom's internal window (accessible via the
// `jsdom` property that vitest sets on the global in its setup function).
const _jsdomWindow = (globalThis as Record<string, unknown> & { jsdom?: { window?: Window } }).jsdom?.window;
if (_jsdomWindow && typeof _jsdomWindow.localStorage?.setItem === 'function') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: _jsdomWindow.localStorage,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: _jsdomWindow.sessionStorage,
    writable: true,
    configurable: true,
  });
}
