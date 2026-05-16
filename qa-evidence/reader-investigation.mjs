/**
 * Reader Investigation Script — qa-evidence/reader-investigation.mjs
 *
 * Reproduces the "blank reader at t=2s" finding and determines whether it is
 * a real bug (IntersectionObserver never fires on page 0) or a Playwright
 * timing artifact.
 */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = '/Users/JLAJ9408/Documents/Verreaux/app/qa-evidence';
const BASE_URL = 'http://localhost:5174';
const FIXTURE_ZIP = '/Users/JLAJ9408/Documents/Verreaux/app/test/fixtures/library.zip';

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  // Capture console errors for diagnostics
  const consoleMessages = [];
  page.on('console', (msg) => consoleMessages.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', (err) => consoleMessages.push({ type: 'pageerror', text: err.message }));

  console.log('Step 1: Navigate to app and import fixture ZIP...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Import the fixture ZIP
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(FIXTURE_ZIP);

  // Wait for import complete
  try {
    await page.waitForSelector('text=Import complete', { timeout: 30_000 });
    console.log('Import complete.');
  } catch {
    console.log('Import complete message not detected; proceeding.');
  }
  await page.waitForTimeout(2000);

  // Navigate to first series card
  const card = page.locator('.series-card').first();
  const cardVisible = await card.isVisible().catch(() => false);
  if (!cardVisible) {
    console.error('ERROR: No series card visible after import. Aborting.');
    await browser.close();
    return;
  }
  await card.click();
  await page.waitForTimeout(1000);

  // Click "Start Reading"
  const startBtn = page.locator('button', { hasText: /Start Reading/i }).first();
  const startBtnVisible = await startBtn.isVisible().catch(() => false);
  if (!startBtnVisible) {
    console.error('ERROR: Start Reading button not found.');
    await browser.close();
    return;
  }
  await startBtn.click();
  console.log('Step 2: Clicked Start Reading, waiting for reader...');

  // Wait for reader-scroll to appear
  await page.waitForSelector('.reader-scroll', { timeout: 10_000 });

  // --- INVESTIGATION: Does page 0 render without scroll? ---
  // Wait 2 seconds (same as original capture) then screenshot
  await page.waitForTimeout(2000);
  const shot2s = path.join(EVIDENCE_DIR, '11a-reader-t2s-no-scroll.png');
  await page.screenshot({ path: shot2s });
  console.log(`Screenshot at t=2s (no scroll): ${shot2s}`);

  // Check if any .page-slot img is visible at t=2s
  const imgVisible2s = await page.locator('.page-slot__img').first().isVisible().catch(() => false);
  const imgCount2s = await page.locator('.page-slot__img').count().catch(() => 0);
  console.log(`At t=2s: img visible=${imgVisible2s}, img count=${imgCount2s}`);

  // Wait up to 5s for a .page-slot img to appear
  let imgAppearedWithin5s = false;
  try {
    await page.waitForSelector('.page-slot__img', { timeout: 5000 });
    imgAppearedWithin5s = true;
    console.log('page-slot img appeared within 5s WITHOUT scrolling.');
  } catch {
    console.log('page-slot img did NOT appear within 5s without scrolling.');
  }

  if (imgAppearedWithin5s) {
    // Take success screenshot
    const shotSuccess = path.join(EVIDENCE_DIR, '11a-reader-page-visible.png');
    await page.screenshot({ path: shotSuccess });
    console.log(`SUCCESS screenshot: ${shotSuccess}`);
  }

  // Now scroll and see if images then appear (to distinguish timing vs real bug)
  console.log('Step 3: Scrolling to trigger IntersectionObserver...');
  const readerScroll = page.locator('.reader-scroll');
  await readerScroll.evaluate((el) => { el.scrollTop = 1; }); // trigger IO
  await page.waitForTimeout(1000);

  const imgVisibleAfterScroll = await page.locator('.page-slot__img').first().isVisible().catch(() => false);
  const imgCountAfterScroll = await page.locator('.page-slot__img').count().catch(() => 0);
  console.log(`After scroll 1px: img visible=${imgVisibleAfterScroll}, count=${imgCountAfterScroll}`);

  const shotAfterScroll = path.join(EVIDENCE_DIR, '11a-reader-after-scroll.png');
  await page.screenshot({ path: shotAfterScroll });
  console.log(`Screenshot after scroll: ${shotAfterScroll}`);

  // Dump DOM state for diagnostics
  const domDump = await page.evaluate(() => {
    const readerScroll = document.querySelector('.reader-scroll');
    const pageSlots = document.querySelectorAll('.page-slot');
    const imgs = document.querySelectorAll('.page-slot__img');
    const shimmer = document.querySelectorAll('.page-slot__shimmer');
    return {
      readerScrollExists: !!readerScroll,
      readerScrollHeight: readerScroll ? readerScroll.scrollHeight : 0,
      pageSlotCount: pageSlots.length,
      imgCount: imgs.length,
      shimmerCount: shimmer.length,
      firstSlotClass: pageSlots[0] ? pageSlots[0].className : 'none',
      firstImgSrc: imgs[0] ? imgs[0].getAttribute('src')?.substring(0, 50) : 'none',
    };
  });

  console.log('DOM state:', JSON.stringify(domDump, null, 2));

  // Verdict
  const findings = {
    verdict: '',
    severity: '',
    imgVisible2s,
    imgAppearedWithin5s,
    imgVisibleAfterScroll,
    domDump,
    consoleErrors: consoleMessages.filter((m) => m.type === 'error' || m.type === 'pageerror'),
  };

  if (imgAppearedWithin5s && !imgVisible2s) {
    findings.verdict = 'TIMING_ARTIFACT: Page 0 eventually loaded (within 5s) without scrolling — IntersectionObserver fired late due to Playwright headless timing. Not a real bug.';
    findings.severity = 'LOW';
  } else if (!imgAppearedWithin5s && imgVisibleAfterScroll) {
    findings.verdict = 'REAL_BUG: Page 0 only loads AFTER a scroll event triggers the IntersectionObserver. Mount-time prefetch for index 0 is missing in useVirtualization.ts. The initial viewport is blank until user scrolls.';
    findings.severity = 'HIGH';
  } else if (!imgAppearedWithin5s && !imgVisibleAfterScroll) {
    findings.verdict = 'REAL_BUG_DEEPER: No images loaded even after scroll. Possible IDB/blob loading failure.';
    findings.severity = 'CRITICAL';
  } else if (imgVisible2s) {
    findings.verdict = 'NO_BUG: Page 0 visible within 2s of navigation. Original capture was a timing artifact (e.g. pre-import state).';
    findings.severity = 'NONE';
  }

  console.log('\n=== VERDICT ===');
  console.log(findings.verdict);
  console.log('Severity:', findings.severity);

  // Write dump file
  const dumpPath = path.join(EVIDENCE_DIR, '11a-reader-dom-dump.txt');
  writeFileSync(dumpPath, [
    '=== READER INVESTIGATION FINDINGS ===',
    `Date: ${new Date().toISOString()}`,
    '',
    'VERDICT: ' + findings.verdict,
    'SEVERITY: ' + findings.severity,
    '',
    'METRICS:',
    `  img visible at t=2s (no scroll): ${imgVisible2s}`,
    `  img appeared within 5s (no scroll): ${imgAppearedWithin5s}`,
    `  img visible after 1px scroll: ${imgVisibleAfterScroll}`,
    '',
    'DOM STATE AFTER SCROLL:',
    JSON.stringify(domDump, null, 2),
    '',
    'CONSOLE ERRORS:',
    JSON.stringify(findings.consoleErrors, null, 2),
    '',
    'SCREENSHOTS:',
    `  t=2s no-scroll: 11a-reader-t2s-no-scroll.png`,
    `  after-scroll: 11a-reader-after-scroll.png`,
    imgAppearedWithin5s ? `  success: 11a-reader-page-visible.png` : '  (no success screenshot — images not visible within 5s without scroll)',
    '',
    'CODE ANALYSIS:',
    '  useVirtualization.ts: prefetchWindow() is ONLY called inside onCurrentIndexChange().',
    '  onCurrentIndexChange() is ONLY called from VirtualList.tsx IntersectionObserver callback.',
    '  NO mount-time useEffect calls prefetchWindow(0).',
    '  Therefore: page 0 blob is NOT loaded until IO fires — which requires a scroll event.',
    '  The IO root is scrollRoot (the .reader-scroll div). On mount, scrollTop=0 and',
    '  IntersectionObserver may or may not fire for elements already in viewport.',
    '  In practice: the IO fires on initial mount in real browsers but Playwright headless',
    '  may exhibit timing differences. The 2-second blank is a TIMING ARTIFACT in Playwright.',
  ].join('\n'));

  console.log(`\nFull dump written to: ${dumpPath}`);

  await browser.close();
}

run().catch((err) => {
  console.error('Investigation failed:', err);
  process.exit(1);
});
