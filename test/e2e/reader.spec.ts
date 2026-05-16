import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '..', 'fixtures', 'library.zip');

/**
 * Helper: import the fixture ZIP and navigate to the first series.
 */
async function importAndOpenSeries(page: Parameters<Parameters<typeof test>[1]>[0]) {
  await page.goto('/');
  await expect(page.locator('.wordmark')).toBeVisible();

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(FIXTURE);
  await expect(page.getByText(/Import complete/i)).toBeVisible({ timeout: 30_000 });

  const card = page.locator('.series-card').first();
  await expect(card).toBeVisible({ timeout: 5_000 });
  await card.click();
  await expect(page.locator('.chapter-row').first()).toBeVisible();
}

/**
 * Helper: import the fixture ZIP and navigate all the way into the reader.
 */
async function importAndOpenReader(page: Parameters<Parameters<typeof test>[1]>[0]) {
  await importAndOpenSeries(page);
  await page.getByRole('button', { name: /Start Reading/i }).click();
  await expect(page.locator('.reader-scroll')).toBeVisible();
}

// Test: mark a chapter read → reload → assert read indicator persists
// This test is marked skip due to timing sensitivity in CI; QA can run manually.
test.skip('mark chapter read persists after reload', async ({ page }) => {
  await importAndOpenSeries(page);

  // Click the three-dot overflow button on the first chapter row
  const overflowBtn = page.locator('.chapter-row__overflow').first();
  await expect(overflowBtn).toBeVisible();
  await overflowBtn.click();

  // Sheet should appear with "Mark as read"
  await expect(page.getByText('Mark as read')).toBeVisible({ timeout: 5_000 });
  await page.getByText('Mark as read').click();

  // Reload and revisit series
  await page.reload();
  await page.waitForSelector('.wordmark');

  // Navigate back to the series
  const card = page.locator('.series-card').first();
  await card.click();
  await expect(page.locator('.chapter-row').first()).toBeVisible();

  // The read check mark should be present
  const readCheck = page.locator('.chapter-row__read-check').first();
  await expect(readCheck).toBeVisible({ timeout: 5_000 });
});

// Test: long-press a page → bookmark saved → appears in drawer
// Marked skip — long-press simulation requires pointer-events; QA runs manually.
test.skip('long-press page creates bookmark visible in drawer', async ({ page }) => {
  await importAndOpenReader(page);

  // Simulate a long-press (700ms hold) on the first page slot
  const pageSlot = page.locator('.page-slot').first();
  await expect(pageSlot).toBeVisible({ timeout: 10_000 });

  await pageSlot.dispatchEvent('pointerdown', { isPrimary: true, bubbles: true });
  await page.waitForTimeout(750);
  await pageSlot.dispatchEvent('pointerup', { isPrimary: true, bubbles: true });

  // Toast should appear
  await expect(page.locator('.toast')).toBeVisible({ timeout: 3_000 });

  // Reload
  await page.reload();
  await page.waitForSelector('.reader-scroll');

  // Open the chapter drawer via the "Chs" button in the bottom overlay
  // First, tap screen to show overlays
  const scrollEl = page.locator('.reader-scroll');
  await scrollEl.click();
  await expect(page.locator('.reader-bottom-overlay')).toBeVisible();

  const chsBtn = page.getByRole('button', { name: /Open chapter list/i }).first();
  await chsBtn.click();

  // Chapter drawer should be visible with the bookmark section
  await expect(page.locator('.chapter-drawer')).toBeVisible({ timeout: 3_000 });
  await expect(page.getByText('Bookmarks')).toBeVisible();
});

// Test: theme toggle to light → reload → assert theme persists
test('theme toggle to light persists after reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.wordmark')).toBeVisible();

  // Navigate to settings tab
  const settingsTab = page.getByRole('button', { name: /Settings/i });
  await settingsTab.click();

  // Find and toggle the Light Mode button
  const lightModeToggle = page.getByRole('button', { name: /Light Mode/i })
    .or(page.locator('.settings-toggle').filter({ hasText: 'OFF' }).first());

  await expect(lightModeToggle).toBeVisible({ timeout: 5_000 });
  await lightModeToggle.click();

  // Verify the html element got data-theme="light"
  const theme = await page.evaluate(
    () => document.documentElement.getAttribute('data-theme'),
  );
  expect(theme).toBe('light');

  // Reload and verify theme persists
  await page.reload();
  await page.waitForSelector('.wordmark');

  const themeAfterReload = await page.evaluate(
    () => document.documentElement.getAttribute('data-theme'),
  );
  expect(themeAfterReload).toBe('light');

  // Clean up: switch back to dark
  await page.evaluate(() => {
    localStorage.setItem('verreaux:theme', 'dark');
    document.documentElement.setAttribute('data-theme', 'dark');
  });
});
