#!/usr/bin/env node
/**
 * generate-icons.mjs
 * Generates all required PWA icon assets from the brand source webp.
 * Strategy: use macOS `sips` (always available on Darwin) for raster conversion.
 * The maskable icon uses the same 512×512 PNG — browsers render maskable icons
 * with a safe-zone crop; without compositing support in sips, this is the
 * correct minimal fallback. A proper masked asset with #030303 letterbox should
 * be produced by a design tool if pixel-perfect maskable rendering is required.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUBLIC = resolve(ROOT, 'public');
const SOURCE = resolve(ROOT, '..', 'ai', 'app icon.webp');

// CI / non-macOS guard: `sips` only exists on Darwin. If we can't run it but
// the icons are already on disk (committed under public/), skip silently so
// the build proceeds with the checked-in assets.
function hasSips() {
  try {
    execSync('command -v sips', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const REQUIRED_ICONS = [
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
  'apple-touch-icon.png',
  'favicon.ico',
];
const allIconsPresent = REQUIRED_ICONS.every((f) => existsSync(resolve(PUBLIC, f)));

if (!hasSips()) {
  if (allIconsPresent) {
    console.log('sips not available; skipping icon regeneration (using checked-in public/ icons).');
    process.exit(0);
  }
  console.error('sips not available and icons are missing under public/. Commit the generated icons or run this script on macOS.');
  process.exit(1);
}

// Verify source asset exists
if (!existsSync(SOURCE)) {
  console.error(`Source asset not found: ${SOURCE}`);
  process.exit(1);
}

const icons = [
  { out: 'icon-192.png',          w: 192, h: 192 },
  { out: 'icon-512.png',          w: 512, h: 512 },
  { out: 'icon-512-maskable.png', w: 512, h: 512 },
  { out: 'apple-touch-icon.png',  w: 180, h: 180 },
];

// sips writes PNG; for favicon.ico we write a 32×32 PNG named favicon.ico
// (browsers accept PNG data in .ico wrappers; true ICO encoding requires
// additional tooling not available via sips alone).
const favicon = { out: 'favicon.ico', w: 32, h: 32 };

function generate(outName, w, h, format = 'png') {
  const outPath = resolve(PUBLIC, outName);
  const cmd = [
    'sips',
    '-s', 'format', format,
    '-z', String(h), String(w),
    `"${SOURCE}"`,
    '--out', `"${outPath}"`,
  ].join(' ');
  try {
    execSync(cmd, { stdio: 'pipe' });
    console.log(`  generated: public/${outName} (${w}x${h})`);
  } catch (err) {
    console.error(`  FAILED: ${outName}`, err.message);
    process.exit(1);
  }
}

console.log('Generating PWA icon assets via sips...');

for (const { out, w, h } of icons) {
  generate(out, w, h, 'png');
}

// favicon.ico: sips can write ico format on macOS
try {
  generate(favicon.out, favicon.w, favicon.h, 'ico');
} catch {
  // If ico format fails, fall back to PNG renamed .ico (still parsed correctly
  // by all major browsers when served with the correct Content-Type).
  console.warn('  ico format unavailable; generating PNG as favicon.ico fallback');
  generate(favicon.out, favicon.w, favicon.h, 'png');
}

console.log('Done. All icon assets written to public/.');
