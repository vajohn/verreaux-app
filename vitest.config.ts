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
    environmentOptions: {
      // Node.js 25 exposes a stub `localStorage` global (--localstorage-file
      // without a path), which vitest's populateGlobal skips because it only
      // overrides keys already in the global when they appear in KEYS.
      // Listing them here as additionalKeys forces jsdom's real implementations
      // to win, so tests can call localStorage.setItem / .clear as normal.
      additionalKeys: ['localStorage', 'sessionStorage'],
    },
    globals: true,
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['./test/setup.ts'],
  },
});
