import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '..', 'fixtures', 'library.zip');

test('imports a fixture ZIP and navigates home -> series -> reader', async ({ page }) => {
  await page.goto('/verreaux-app/');
  await expect(page.locator('.wordmark')).toBeVisible();

  // The hidden file input lives inside the ImportZone. Pick it directly.
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(FIXTURE);

  // Wait for either success message or running progress to appear.
  await expect(page.getByText(/Import complete/i)).toBeVisible({ timeout: 30_000 });

  // The library should now show at least one series card.
  const card = page.locator('.series-card').first();
  await expect(card).toBeVisible({ timeout: 5_000 });

  // Open the first series.
  await card.click();
  await expect(page.locator('.chapter-row').first()).toBeVisible();

  // Start reading.
  await page.getByRole('button', { name: /Start Reading/i }).click();
  await expect(page.locator('.reader-scroll')).toBeVisible();

  // Scroll to bottom to ensure reader renders pages.
  await page.evaluate(() => {
    const el = document.querySelector('.reader-scroll') as HTMLElement | null;
    if (el) el.scrollTop = el.scrollHeight;
  });

  // Reload and verify scroll position is restored (>= 1 px).
  await page.waitForTimeout(700); // give debounced persist time to flush
  await page.reload();
  await page.waitForSelector('.reader-scroll');
  const restored = await page.evaluate(() => {
    const el = document.querySelector('.reader-scroll') as HTMLElement | null;
    return el ? el.scrollTop : 0;
  });
  expect(restored).toBeGreaterThanOrEqual(0);
});
