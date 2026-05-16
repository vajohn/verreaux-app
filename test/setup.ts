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
