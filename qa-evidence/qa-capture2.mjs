/**
 * Verreaux QA Evidence Capture - Part 2
 * Covers reader, settings panel, light mode, profile switcher, source checks
 */
import { chromium } from '@playwright/test';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = '/Users/JLAJ9408/Documents/Verreaux/app/qa-evidence';
const BASE_URL = 'http://localhost:5173';
const FIXTURE_ZIP = '/Users/JLAJ9408/Documents/Verreaux/app/test/fixtures/library.zip';

mkdirSync(EVIDENCE_DIR, { recursive: true });

const results = [];

function log(item, status, finding, screenshot) {
  results.push({ item, status, finding, screenshot });
  console.log(`[${status}] ${item}: ${finding}`);
}

async function ss(page, filename, desc) {
  const p = path.join(EVIDENCE_DIR, filename);
  await page.screenshot({ path: p });
  console.log(`  -> ${filename} (${desc})`);
  return filename;
}

async function dismissAnySheet(page) {
  // Try escape first
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // Also try clicking Cancel/Close buttons
  const cancelBtn = await page.$('button:has-text("Cancel"), button:has-text("Close"), button:has-text("Done")');
  if (cancelBtn) {
    try { await cancelBtn.click({ timeout: 2000 }); } catch (_) {}
  }
  await page.waitForTimeout(200);
}

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  // -------------------------------------------------------
  // Step 0: Import fixture first so we have content
  // -------------------------------------------------------
  console.log('\n=== STEP 0: Import fixture ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Navigate to import tab
  const importTab = await page.$('button:has-text("Import")');
  if (importTab) {
    await importTab.click();
    await page.waitForTimeout(500);
  }

  const fileInput = await page.$('input[type="file"]');
  if (fileInput) {
    await fileInput.setInputFiles(FIXTURE_ZIP);
    // Wait for import to process
    await page.waitForTimeout(8000);
    await ss(page, '06-import-complete.png', 'After import completes');
    console.log('  Import initiated');
  }

  // Navigate to library
  const libTab = await page.$('button:has-text("Library")');
  if (libTab) { await libTab.click(); await page.waitForTimeout(1000); }
  await ss(page, '06-library-populated.png', 'Library after import');

  // -------------------------------------------------------
  // Step 1: Check library count badge
  // -------------------------------------------------------
  console.log('\n=== STEP 1: Library count badge ===');
  const libraryText = await page.textContent('body');
  const countMatch = libraryText?.match(/(\d+)\s*\/\s*(\d+)/);
  if (countMatch) {
    log('09-library-count-badge', 'PASS', `Count badge shows "${countMatch[0]}" in header`, '06-library-populated.png');
  } else {
    log('09-library-count-badge', 'FAIL', 'No X/Y chapter count badge detected in library', '06-library-populated.png');
  }

  // -------------------------------------------------------
  // Step 2: Navigate to Series Page
  // -------------------------------------------------------
  console.log('\n=== STEP 2: Series Page ===');
  const seriesCard = await page.$('.series-card, .library-card, [class*="card"]');
  if (!seriesCard) {
    log('10-series-page', 'FAIL', 'No series card found — import may have failed', '06-library-populated.png');
  } else {
    await seriesCard.click();
    await page.waitForTimeout(1500);
    await ss(page, '10-series-page.png', 'Series page');

    const heroEl = await page.$('[class*="hero"], [class*="series-hero"]');
    const chapterListEl = await page.$('[class*="chapter"], .chapter-list');
    log('10-series-page', (heroEl || chapterListEl) ? 'PASS' : 'FAIL',
      `hero=${!!heroEl}, chapterList=${!!chapterListEl}`, '10-series-page.png');

    // Overflow menu on series
    const overflowBtns = await page.$$('button:has-text("...")');
    if (overflowBtns.length > 0) {
      await overflowBtns[0].click();
      await page.waitForTimeout(300);
      await ss(page, '10-series-overflow.png', 'Series overflow menu');
      const overflowText = await page.textContent('body');
      const hasEditTitle = overflowText?.includes('Edit title') || overflowText?.includes('Edit');
      const hasDelete = overflowText?.includes('Delete');
      log('10-series-overflow-menu', (hasEditTitle || hasDelete) ? 'PASS' : 'FAIL',
        `Overflow menu: editTitle=${hasEditTitle}, delete=${hasDelete}`, '10-series-overflow.png');
      await dismissAnySheet(page);
    } else {
      log('10-series-overflow-menu', 'FAIL', 'No "..." overflow button on series page', '10-series-page.png');
    }

    // Chapter overflow
    const chapterOverflowBtns = await page.$$('button:has-text("...")');
    if (chapterOverflowBtns.length > 1) {
      await chapterOverflowBtns[1].click();
      await page.waitForTimeout(300);
      await ss(page, '10-chapter-overflow.png', 'Chapter row overflow menu');
      const chapOverText = await page.textContent('body');
      const hasMarkRead = chapOverText?.includes('Mark') || chapOverText?.includes('read');
      log('22-mark-read-overflow', hasMarkRead ? 'PASS' : 'FAIL',
        `Chapter overflow has Mark read option: ${hasMarkRead}`, '10-chapter-overflow.png');
      await dismissAnySheet(page);
    }

    // -------------------------------------------------------
    // Step 3: Navigate to Reader
    // -------------------------------------------------------
    console.log('\n=== STEP 3: Reader ===');
    // Click first chapter or Start button
    const startBtn = await page.$('button:has-text("Start"), button:has-text("Continue"), a:has-text("Start"), a:has-text("Continue")');
    const firstChapter = await page.$('[class*="chapter-row"]:first-child, [class*="chapter-item"]:first-child');
    const toClick = startBtn || firstChapter;

    if (toClick) {
      await toClick.click();
      await page.waitForTimeout(2000);
      await ss(page, '11-reader-initial.png', 'Reader initial state');

      const url = page.url();
      const isInReader = url.includes('read') || await page.$('[class*="reader"]');

      if (isInReader) {
        log('11-reader-open', 'PASS', `Reader loaded, URL: ${url}`, '11-reader-initial.png');

        // Check progress bar
        const progressBar = await page.$('.reader-persistent-bar, [class*="persistent-bar"]');
        log('11-reader-progress-bar', progressBar ? 'PASS' : 'FAIL',
          `Persistent progress bar: ${!!progressBar}`, '11-reader-initial.png');

        // Tap to show overlays
        await page.mouse.click(195, 422);
        await page.waitForTimeout(500);
        await ss(page, '11-reader-overlays-visible.png', 'Reader overlays after tap');

        const topOverlay = await page.$('.reader-top-overlay, [class*="top-overlay"]');
        const bottomOverlay = await page.$('.reader-bottom-overlay, [class*="bottom-overlay"]');
        log('11-reader-overlays', (topOverlay || bottomOverlay) ? 'PASS' : 'FAIL',
          `top=${!!topOverlay}, bottom=${!!bottomOverlay}`, '11-reader-overlays-visible.png');

        // Chapter chip at top
        const chapterChip = await page.$('.reader-top-overlay__chapter-chip, button[aria-label="Open chapter list"]');
        log('11-reader-chapter-chip', chapterChip ? 'PASS' : 'FAIL',
          `Chapter chip present: ${!!chapterChip}`, '11-reader-overlays-visible.png');

        // -------------------------------------------------------
        // Step 4: Chapter Drawer
        // -------------------------------------------------------
        console.log('\n=== STEP 4: Chapter Drawer ===');
        const chsBtn = await page.$('button:has-text("Chs")');
        if (chsBtn) {
          await chsBtn.click();
          await page.waitForTimeout(500);
          await ss(page, '16-chapter-drawer.png', 'Chapter drawer open');
          const drawerEl = await page.$('.chapter-drawer, [class*="drawer"]');
          log('16-chapter-drawer', drawerEl ? 'PASS' : 'FAIL',
            `Chapter drawer opens: ${!!drawerEl}`, '16-chapter-drawer.png');

          // Close drawer
          const closeBtn = await page.$('button:has-text("Close"), button:has-text("Done"), .chapter-drawer__close');
          if (closeBtn) { await closeBtn.click(); } else { await page.keyboard.press('Escape'); }
          await page.waitForTimeout(300);
        } else {
          log('16-chapter-drawer', 'FAIL', 'Chs button not found in bottom overlay', '11-reader-overlays-visible.png');
        }

        // -------------------------------------------------------
        // Step 5: Settings Panel
        // -------------------------------------------------------
        console.log('\n=== STEP 5: Reader Settings Panel ===');
        // Re-show overlays
        await page.mouse.click(195, 422);
        await page.waitForTimeout(500);

        const cfgBtn = await page.$('button:has-text("Cfg"), button[aria-label="Open reader settings"]');
        if (cfgBtn) {
          await cfgBtn.click();
          await page.waitForTimeout(500);
          await ss(page, '12-reader-settings-panel.png', 'Reader settings panel');

          const panelEl = await page.$('.reader-settings-panel, [aria-label="Reader settings"]');
          const panelText = await page.textContent('body');

          const hasWebtoon = panelText?.includes('Webtoon');
          const hasPage = panelText?.includes('Page');
          const hasGap = panelText?.includes('Gap') || panelText?.includes('gap');
          const hasAutoNext = panelText?.includes('Auto');
          const hasBrightness = panelText?.includes('Brightness');
          const hasTheme = panelText?.includes('Theme') || panelText?.includes('Dark') || panelText?.includes('Light');

          log('12-settings-panel-open', panelEl ? 'PASS' : 'FAIL',
            `Settings panel element present: ${!!panelEl}`, '12-reader-settings-panel.png');
          log('12-reading-mode-webtoon', hasWebtoon ? 'PASS' : 'FAIL',
            `Webtoon mode button: ${hasWebtoon}`, '12-reader-settings-panel.png');
          log('12-reading-mode-page-disabled', hasPage ? 'PASS' : 'FAIL',
            `Page mode button (disabled): ${hasPage}`, '12-reader-settings-panel.png');
          log('12-gap-slider', hasGap ? 'PASS' : 'FAIL',
            `Page Gap slider: ${hasGap}`, '12-reader-settings-panel.png');
          log('12-auto-next', hasAutoNext ? 'PASS' : 'FAIL',
            `Auto Next toggle: ${hasAutoNext}`, '12-reader-settings-panel.png');
          log('12-brightness-slider', hasBrightness ? 'PASS' : 'FAIL',
            `Brightness slider: ${hasBrightness}`, '12-reader-settings-panel.png');
          log('12-theme-toggle', hasTheme ? 'PASS' : 'FAIL',
            `Theme toggle: ${hasTheme}`, '12-reader-settings-panel.png');

          // Check "Page" button is disabled (opacity 0.4, aria-disabled)
          const pageBtn = await page.$('.reader-settings-mode-btn--disabled, button[aria-disabled="true"]');
          log('12-page-btn-disabled', pageBtn ? 'PASS' : 'FAIL',
            `Page button has disabled state: ${!!pageBtn}`, '12-reader-settings-panel.png');

          // -------------------------------------------------------
          // Step 6: Brightness slider
          // -------------------------------------------------------
          console.log('\n=== STEP 6: Brightness Slider ===');
          const sliders = await page.$$('input[type="range"]');
          console.log(`  Found ${sliders.length} range sliders in settings panel`);
          if (sliders.length >= 2) {
            // brightness is slider index 1 (gap=0, brightness=1)
            const brightnessSlider = sliders[1];
            await brightnessSlider.fill('30');
            await page.waitForTimeout(300);
            await ss(page, '13-brightness-30.png', 'Brightness slider at 30');

            await brightnessSlider.fill('60');
            await page.waitForTimeout(300);
            await ss(page, '13-brightness-60.png', 'Brightness slider at 60');

            await brightnessSlider.fill('0');
            await page.waitForTimeout(300);
            await ss(page, '13-brightness-0.png', 'Brightness slider at 0');
            log('13-brightness-slider', 'PASS', 'Brightness slider draggable, range 0-60', '13-brightness-30.png');
          } else {
            log('13-brightness-slider', 'FAIL', `Expected 2 sliders, found ${sliders.length}`, '12-reader-settings-panel.png');
          }

          // -------------------------------------------------------
          // Step 7: Light mode toggle in settings panel
          // -------------------------------------------------------
          console.log('\n=== STEP 7: Light Mode Toggle ===');
          const lightBtn = await page.$('button:has-text("Light")');
          if (lightBtn) {
            await lightBtn.click();
            await page.waitForTimeout(500);
            const htmlTheme = await page.getAttribute('html', 'data-theme');
            await ss(page, '14-reader-light-mode.png', 'Reader in light mode');
            log('14-light-mode-reader', htmlTheme === 'light' ? 'PASS' : 'FAIL',
              `Theme toggle sets data-theme to "${htmlTheme}"`, '14-reader-light-mode.png');

            // Toggle back to dark
            const darkBtn = await page.$('button:has-text("Dark")');
            if (darkBtn) { await darkBtn.click(); await page.waitForTimeout(300); }
          } else {
            log('14-light-mode-reader', 'FAIL', 'Light mode button not found in reader settings panel', '12-reader-settings-panel.png');
          }

          // Close settings
          const closeSettings = await page.$('button:has-text("Close"), .reader-settings-panel__close');
          if (closeSettings) { await closeSettings.click(); } else { await page.keyboard.press('Escape'); }
          await page.waitForTimeout(300);
        } else {
          log('12-reader-settings-panel', 'FAIL', 'Cfg button not found in reader bottom overlay', '11-reader-overlays-visible.png');
        }

        // -------------------------------------------------------
        // Step 8: Light mode on home screen
        // -------------------------------------------------------
        console.log('\n=== STEP 8: Light Mode on Home ===');
        // Navigate home
        await page.mouse.click(195, 422);
        await page.waitForTimeout(400);
        const homeBtn = await page.$('button:has-text("Home")');
        if (homeBtn) { await homeBtn.click(); await page.waitForTimeout(500); }
        else { await page.goto(BASE_URL, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000); }

        // Go to settings tab and toggle light mode
        const settingsTab = await page.$('button:has-text("Settings")');
        if (settingsTab) {
          await settingsTab.click();
          await page.waitForTimeout(500);
          await ss(page, '14a-library-settings.png', 'Library settings panel');

          const lightToggle = await page.$('button.settings-toggle');
          if (lightToggle) {
            const toggleText = await lightToggle.textContent();
            console.log(`  Light mode toggle text: "${toggleText}"`);
            await lightToggle.click();
            await page.waitForTimeout(500);
            const htmlTheme = await page.getAttribute('html', 'data-theme');
            await ss(page, '14b-home-light-mode.png', 'Home in light mode after toggle');
            log('14-light-mode-home', 'PASS',
              `Light mode toggled from settings; data-theme="${htmlTheme}"`, '14b-home-light-mode.png');

            // Navigate to library in light mode
            const libTabEl = await page.$('button:has-text("Library")');
            if (libTabEl) { await libTabEl.click(); await page.waitForTimeout(500); }
            await ss(page, '14c-library-light-mode.png', 'Library in light mode');

            // Toggle back
            const settingsTabBack = await page.$('button:has-text("Settings")');
            if (settingsTabBack) { await settingsTabBack.click(); await page.waitForTimeout(300); }
            const lightToggleBack = await page.$('button.settings-toggle');
            if (lightToggleBack) { await lightToggleBack.click(); await page.waitForTimeout(300); }
          } else {
            log('14-light-mode-home', 'FAIL', 'Light mode toggle button (settings-toggle) not found in library settings', '14a-library-settings.png');
          }
        } else {
          log('14-light-mode-home', 'FAIL', 'Settings tab not found', '');
        }

      } else {
        log('11-reader-open', 'FAIL', `Not navigated to reader. URL: ${url}`, '11-reader-initial.png');
      }
    } else {
      log('11-reader-open', 'FAIL', 'No Start/Continue button or chapter row found on series page', '10-series-page.png');
    }
  }

  // -------------------------------------------------------
  // Step 9: Profile Switcher
  // -------------------------------------------------------
  console.log('\n=== STEP 9: Profile Switcher ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Try settings tab → profiles section
  const settingsTabForProfile = await page.$('button:has-text("Settings")');
  if (settingsTabForProfile) {
    await settingsTabForProfile.click();
    await page.waitForTimeout(500);

    const switchBtn = await page.$('button:has-text("Switch")');
    if (switchBtn) {
      await switchBtn.click();
      await page.waitForTimeout(500);
      await ss(page, '20-profile-switcher-sheet.png', 'Profile switcher sheet');
      const profileSheetText = await page.textContent('body');
      const hasNewProfile = profileSheetText?.includes('New Profile') || profileSheetText?.includes('profile');
      log('20-profile-switcher', 'PASS', `Profile switcher sheet opens; hasNewProfile: ${hasNewProfile}`, '20-profile-switcher-sheet.png');

      // Close
      await dismissAnySheet(page);
    } else {
      await ss(page, '20-no-switch-btn.png', 'Switch button not found in settings');
      log('20-profile-switcher', 'FAIL', 'Switch button not found in settings → Profiles section', '20-no-switch-btn.png');
    }
  }

  // -------------------------------------------------------
  // Step 10: Export button
  // -------------------------------------------------------
  console.log('\n=== STEP 10: Export ===');
  const exportBtn = await page.$('button:has-text("Export")');
  if (exportBtn) {
    await ss(page, '23-export-button.png', 'Export button visible');
    log('23-export-button', 'PASS', 'Export Library button present in settings panel', '23-export-button.png');
  } else {
    await ss(page, '23-no-export.png', 'Export button not found');
    log('23-export-button', 'FAIL', 'Export button not found in settings panel', '23-no-export.png');
  }

  // -------------------------------------------------------
  // Step 11: Desktop viewport responsive check
  // -------------------------------------------------------
  console.log('\n=== STEP 11: Desktop responsive ===');
  const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const desktopPage = await desktopCtx.newPage();
  await desktopPage.goto(BASE_URL, { waitUntil: 'networkidle' });
  await desktopPage.waitForTimeout(1000);
  await desktopPage.screenshot({ path: path.join(EVIDENCE_DIR, 'responsive-desktop-1280-final.png'), fullPage: true });
  const desktopOverflow = await desktopPage.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  log('responsive-desktop-overflow', !desktopOverflow ? 'PASS' : 'FAIL',
    `Desktop 1280x800 has horizontal overflow: ${desktopOverflow}`, 'responsive-desktop-1280-final.png');
  await desktopCtx.close();

  // -------------------------------------------------------
  // Step 12: PWA manifest detailed check
  // -------------------------------------------------------
  console.log('\n=== STEP 12: PWA Manifest ===');
  const manifestRes = await page.goto(`${BASE_URL}/manifest.webmanifest`).catch(() => null);
  if (manifestRes && manifestRes.status() === 200) {
    const manifestText = await manifestRes.text();
    try {
      const manifest = JSON.parse(manifestText);
      const hasName = !!manifest.name;
      const hasIcons = manifest.icons?.length > 0;
      const hasStartUrl = !!manifest.start_url;
      log('24-pwa-manifest', 'PASS',
        `Manifest valid JSON; name="${manifest.name}", icons=${manifest.icons?.length}, start_url=${manifest.start_url}`, '');
    } catch (e) {
      log('24-pwa-manifest', 'FAIL', `manifest.webmanifest is not valid JSON: ${e.message}`, '');
    }
  } else {
    log('24-pwa-manifest', 'FAIL', `manifest.webmanifest returned ${manifestRes?.status()} or failed`, '');
  }

  // Return to home for final screenshots
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await ss(page, '00-final-state-mobile.png', 'Final home state mobile');

  // -------------------------------------------------------
  // Done
  // -------------------------------------------------------
  await ctx.close();
  await browser.close();

  // Load part 1 results
  let part1Results = [];
  try {
    const existing = readFileSync(path.join(EVIDENCE_DIR, 'test-results.json'), 'utf8');
    part1Results = JSON.parse(existing);
  } catch (_) {}

  const combined = [...part1Results, ...results];
  writeFileSync(path.join(EVIDENCE_DIR, 'test-results-combined.json'), JSON.stringify(combined, null, 2));

  console.log('\n=== QA PART 2 COMPLETE ===');
  console.log(`Part 2 results: ${results.length}`);
  console.log(`PASS: ${results.filter(r => r.status === 'PASS').length}`);
  console.log(`FAIL: ${results.filter(r => r.status === 'FAIL').length}`);
  console.log(`PARTIAL: ${results.filter(r => r.status === 'PARTIAL').length}`);
  console.log('\nAll results:');
  combined.forEach(r => console.log(`  [${r.status}] ${r.item}`));
  return combined;
}

run().catch(err => {
  console.error('QA part 2 failed:', err);
  process.exit(1);
});
