// Renders assets/icons/icon-*.png from the inline SVG below. Run once after changing the design.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets/icons');
fs.mkdirSync(outDir, { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect x="4" y="4" width="120" height="120" rx="26" fill="#0c66e4"/>
  <rect x="26" y="28" width="76" height="72" rx="10" fill="#fff"/>
  <rect x="38" y="42" width="40" height="8" rx="4" fill="#0c66e4"/>
  <rect x="38" y="58" width="52" height="8" rx="4" fill="#22a06b"/>
  <rect x="38" y="74" width="34" height="8" rx="4" fill="#e2483d"/>
  <rect x="30" y="58" width="3" height="8" rx="1.5" fill="#22a06b"/>
  <rect x="30" y="74" width="3" height="8" rx="1.5" fill="#e2483d"/>
</svg>`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome' });
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}`);
  await page.screenshot({ path: path.join(outDir, `icon-${size}.png`), omitBackground: true });
}
await browser.close();
