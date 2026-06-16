import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'virtual:pwa-register/react': path.resolve(
        __dirname,
        'test/stubs/pwa-register-react.ts',
      ),
    },
  },
  test: {
    environment: 'jsdom',
    // Note: the Node 25 `localStorage` stub is overridden in test/setup.ts
    // (vitest's jsdom env ignores environmentOptions.additionalKeys, so the
    // shim there is what actually restores jsdom's Storage).
    globals: true,
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['./test/setup.ts'],
  },
});
