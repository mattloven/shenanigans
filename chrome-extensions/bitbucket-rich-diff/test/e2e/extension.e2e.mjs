// End-to-end tests: the built extension (dist/) loaded into Chromium against
//  1. a mocked Bitbucket PR (deterministic, covers every view and edge case), and
//  2. a real public Bitbucket Cloud PR (smoke test; skipped with E2E_SKIP_REAL=1).
// Run with `npm run test:e2e`. Screenshots land in test-results/.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { installMockBitbucket, MOCK_PR_URL, NEW_COMMIT } from './mock-bitbucket.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(root, 'dist');
const results = path.join(root, 'test-results');
fs.mkdirSync(results, { recursive: true });

const REAL_PR_URL = 'https://bitbucket.org/atlassian/atlassian-connect-express/pull-requests/572/diff';

let context;
let page;

const article = (filePath) => page.locator(`article[aria-label="Diff of file ${filePath}"]`);
const shot = (name, locator = page) => locator.screenshot({ path: path.join(results, `${name}.png`) });

async function openHideMenu() {
  const panel = page.locator('.bbrd-filters');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Hide files and comments' }).click();
    await panel.waitFor();
  }
  return panel;
}

before(async () => {
  assert.ok(fs.existsSync(path.join(dist, 'manifest.json')), 'run `npm run build` first');
  context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'bbrd-e2e-')), {
    channel: 'chromium',
    executablePath: process.env.CHROME_PATH || undefined,
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    viewport: { width: 1400, height: 1000 },
  });
  await installMockBitbucket(context);
  page = context.pages()[0] || (await context.newPage());
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
});

after(async () => {
  await context?.close();
});

describe('mock pull request', () => {
  before(async () => {
    await page.goto(MOCK_PR_URL);
    await article('README.md').locator('.bbrd-tabs').waitFor();
  });

  it('adds tabs to markdown and JSON files only', async () => {
    for (const p of ['README.md', 'package.json', 'docs/onboarding.md', 'docs/legacy.md', 'config/broken.json']) {
      assert.equal(await article(p).locator('.bbrd-tab').count(), 3, p);
    }
    assert.equal(await article('src/app.js').locator('.bbrd-tabs').count(), 0);
    assert.deepEqual(await article('README.md').locator('.bbrd-tab').allTextContents(), ['Diff', 'Rich Diff', 'Preview']);
    assert.deepEqual(await article('package.json').locator('.bbrd-tab').allTextContents(), ['Diff', 'Rich Diff', 'Tree']);
  });

  it('opens in Rich diff by default and hides the standard diff', async () => {
    const readme = article('README.md');
    assert.equal(await readme.getAttribute('data-bbrd-view'), 'changes');
    assert.equal(await readme.locator('[data-qa="bk-file__content"]').isVisible(), false);
    await readme.locator('.markdown-body').waitFor();
    await shot('mock-readme-rich-diff', readme);
  });

  it('renders tracked changes in the markdown', async () => {
    const body = article('README.md').locator('.markdown-body');
    assert.deepEqual(await body.locator('p del.bbrd-del').first().textContent(), 'three');
    assert.ok((await body.locator('ins.bbrd-ins').allTextContents()).map((t) => t.trim()).includes('Platform'));
    assert.equal(await body.locator('tr.bbrd-el--mod del').first().textContent(), '10');
    assert.equal(await body.locator('.bbrd-code-line--ins').first().textContent(), '  timeout: 10s');
    assert.equal(await body.locator('li.bbrd-el--ins').first().textContent(), 'Copy .env.example to .env.');
    assert.equal(await body.locator('h2 del.bbrd-del').textContent(), 'Legacy');
    assert.equal(await body.locator('.bbrd-blk--del p').textContent(), 'The nightly settlement batch is scheduled with cron on the old VM fleet. It will be removed once\nthe streaming pipeline is live in every region.');
  });

  it('resolves relative images and links to the PR source commit', async () => {
    const body = article('README.md').locator('.markdown-body');
    assert.equal(await body.locator('img').first().getAttribute('src'), `https://bitbucket.org/acme/payments/raw/${NEW_COMMIT}/docs/architecture.png`);
    assert.equal(await body.locator('a', { hasText: 'runbook' }).getAttribute('href'), `https://bitbucket.org/acme/payments/src/${NEW_COMMIT}/docs/runbook.md#settlement`);
    assert.ok(await body.locator('img').first().evaluate((img) => img.complete && img.naturalWidth > 0), 'image loads');
  });

  it('shows stats and navigates between changes', async () => {
    const readme = article('README.md');
    assert.equal(await readme.locator('.stats').getAttribute
