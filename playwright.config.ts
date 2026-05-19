import { defineConfig, devices } from '@playwright/test';

// Allow overriding the dev port when port 5173 is held by an unrelated dev
// server. Set PORT=5174 (or whatever's free) when running locally.
const port = process.env['PORT'] ?? '5173';
// Vite serves over HTTPS (self-signed certs under app/certs/) at base path
// `/verreaux-app/` — see vite.config.ts. baseURL stays at origin so tests can
// goto absolute paths like '/verreaux-app/' directly.
const baseURL = `https://localhost:${port}`;

export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `${baseURL}/verreaux-app/`,
    reuseExistingServer: !process.env['CI'],
    timeout: 90_000,
    ignoreHTTPSErrors: true,
  },
});
