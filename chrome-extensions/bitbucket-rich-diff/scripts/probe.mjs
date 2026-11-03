// Evaluates an expression on a live PR page (with the extension loaded) and prints the result.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '..');
const [url, expression] = [process.argv[2], process.argv[3]];
const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'bbrd-')), {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${path.join(root, 'dist')}`, `--load-extension=${path.join(root, 'dist')}`],
  viewport: { width: 1500, height: 1200 },
});
const page = context.pages()[0] || (await context.newPage());
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.locator('article[data-qa="branch-diff-file"]').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(3000);
console.log(JSON.stringify(await page.evaluate(expression), null, 2));
await context.close();
