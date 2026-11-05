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
    assert.deepEqual(await article('README.md').locator('.bbrd-tab').allTextContents(), ['Diff', 'Rich diff', 'Preview']);
    assert.deepEqual(await article('package.json').locator('.bbrd-tab').allTextContents(), ['Diff', 'Rich diff', 'Tree']);
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
    assert.equal(await readme.locator('.stats').getAttribute('aria-label'), '3 added, 1 removed, 8 changed');
    assert.equal(await readme.locator('.counter').textContent(), '12 changes');
    await readme.locator('[data-action="next"]').click();
    assert.equal(await readme.locator('.counter').textContent(), '1 / 12');
    await readme.locator('[data-action="prev"]').click();
    assert.equal(await readme.locator('.counter').textContent(), '12 / 12');
  });

  it('hides deletions and folds unchanged sections, and persists the toggles', async () => {
    const readme = article('README.md');
    await readme.getByLabel('Show deletions').uncheck();
    assert.equal(await readme.locator('del.bbrd-del:visible, .bbrd-blk--del:visible').count(), 0);
    assert.equal(await readme.locator('.counter').textContent(), '11 changes');
    await readme.getByLabel('Only changes').check();
    const fold = readme.locator('.bbrd-fold-toggle:visible');
    assert.equal(await fold.textContent(), 'Show 7 unchanged sections');
    assert.equal(await article('package.json').getByLabel('Only changes').isChecked(), true, 'applies to other files');
    await shot('mock-readme-final-text-only-changes', readme);
    await fold.click();
    assert.equal(await readme.locator('.bbrd-fold-toggle:visible').count(), 0);

    await page.reload();
    await article('README.md').locator('.markdown-body').waitFor();
    assert.equal(await article('README.md').getByLabel('Show deletions').isChecked(), false, 'persisted');
    await article('README.md').getByLabel('Show deletions').check();
    await article('README.md').getByLabel('Only changes').uncheck();
  });

  it('switches to Preview and back to the standard Diff without collapsing the file', async () => {
    const readme = article('README.md');
    await readme.locator('.bbrd-tab[data-view="preview"]').click();
    assert.deepEqual(await readme.locator('.markdown-body h1').allTextContents(), ['Payments Service', 'Payments Service']);
    assert.equal(await readme.locator('.markdown-body del, .markdown-body ins').count(), 0);
    await readme.locator('.bbrd-tab[data-view="diff"]').click();
    assert.equal(await readme.locator('[data-qa="bk-file__content"]').isVisible(), true);
    assert.equal(await readme.locator('.bbrd-host').isVisible(), false);
    assert.equal(await readme.evaluate((a) => a.classList.contains('collapsed')), false);
    await readme.locator('.bbrd-tab[data-view="changes"]').click();
  });

  it('previews old and new side by side with aligned sections, or one at a time', async () => {
    const readme = article('README.md');
    await readme.locator('.bbrd-tab[data-view="preview"]').click();
    assert.equal(await readme.locator('.seg-btn[aria-checked="true"]').textContent(), 'Side by side');
    const oldHeading = readme.locator('.cmp-cell--old h2', { hasText: 'Configuration' });
    const newHeading = readme.locator('.cmp-cell--new h2', { hasText: 'Configuration' });
    const [a, b] = [await oldHeading.boundingBox(), await newHeading.boundingBox()];
    assert.ok(Math.abs(a.y - b.y) < 1, `sections aligned (${a.y} vs ${b.y})`);
    assert.ok(b.x > a.x + 200, 'new version is to the right');
    await shot('mock-readme-preview-side-by-side', readme);

    await readme.locator('.seg-btn[data-layout="old"]').click();
    assert.equal(await readme.locator('.cmp-cell--new p:visible').count(), 0);
    assert.equal(await readme.locator('.cmp-cell--old p', { hasText: 'three regions' }).isVisible(), true);
    await readme.locator('.seg-btn[data-layout="new"]').click();
    assert.equal(await readme.locator('.cmp-cell--old p:visible').count(), 0);
    assert.equal(await readme.locator('input[type="checkbox"].task-list-item-checkbox:visible').count(), 4);

    await page.reload();
    await article('README.md').locator('.bbrd-tab[data-view="preview"]').click();
    assert.equal(await article('README.md').locator('.seg-btn[aria-checked="true"]').textContent(), 'New', 'layout persisted');
    await article('README.md').locator('.seg-btn[data-layout="split"]').click();
    await article('README.md').locator('.bbrd-tab[data-view="changes"]').click();
  });

  it('mirrors JSON tree expansion across side-by-side panes', async () => {
    const pkg = article('package.json');
    await pkg.locator('.bbrd-tab[data-view="preview"]').click();
    const flags = (side) => pkg.locator(`.cmp-pane--${side} summary[data-path="featureFlags[0]"]`);
    await flags('old').click();
    assert.equal(await flags('new').evaluate((s) => s.parentElement.open), true);
    await pkg.locator('.bbrd-tab[data-view="changes"]').click();
  });

  it('supports keyboard navigation between tabs', async () => {
    const readme = article('README.md');
    await readme.locator('.bbrd-tab[data-view="changes"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await readme.getAttribute('data-bbrd-view'), 'preview');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await readme.getAttribute('data-bbrd-view'), 'changes');
  });

  it('renders a structural JSON diff with a jumpable summary', async () => {
    const pkg = article('package.json');
    await pkg.locator('.jd-summary').waitFor();
    const paths = await pkg.locator('.jd-sum-path').allTextContents();
    assert.deepEqual(paths, [
      'version',
      'scripts.test',
      'scripts.typecheck',
      'dependencies.express',
      'dependencies.request',
      'dependencies.undici',
      'regions[2]',
      'featureFlags[0].enabled',
      'featureFlags[0].rollout',
      'engines.node',
    ]);
    assert.equal(await pkg.locator('[data-path="engines.node"] ins').textContent(), '">=20"');
    await pkg.locator('.jd-sum-row', { hasText: 'featureFlags[0].rollout' }).click();
    assert.equal(await pkg.locator('[data-path="featureFlags[0].rollout"]').isVisible(), true);
    await shot('mock-package-json-rich-diff', pkg);
  });

  it('shows a JSON tree preview with expand/collapse all', async () => {
    const pkg = article('package.json');
    await pkg.locator('.bbrd-tab[data-view="preview"]').click();
    await pkg.locator('[data-action="collapse"]').click();
    assert.equal(await pkg.locator('details[open]').count(), 0);
    await pkg.locator('[data-action="expand"]').click();
    assert.ok((await pkg.locator('details[open]').count()) > 5);
    await pkg.locator('.bbrd-tab[data-view="changes"]').click();
  });

  it('handles added, deleted and invalid files', async () => {
    assert.equal(await article('docs/onboarding.md').locator('.note').textContent(), 'New file');
    assert.equal(await article('docs/onboarding.md').locator('.bbrd-blk--ins').count(), 3);
    assert.equal(await article('docs/legacy.md').locator('.bbrd-blk--del h1').textContent(), 'Legacy');
    await article('docs/legacy.md').locator('.bbrd-tab[data-view="preview"]').click();
    assert.equal(await article('docs/legacy.md').locator('.markdown-body h1').textContent(), 'Legacy');
    assert.equal(await article('docs/legacy.md').locator('.seg-btn[aria-checked="true"]').textContent(), 'Old');
    const broken = article('config/broken.json');
    assert.match(await broken.locator('.bbrd-error').textContent(), /new version is not valid JSON/);
    await broken.locator('[data-action="show-diff"]').click();
    assert.equal(await broken.getAttribute('data-bbrd-view'), 'diff');
  });

  it('hides markdown and chosen extensions from the file list and the diff', async () => {
    assert.equal(await page.locator('.bbrd-menu-host').count(), 1);
    assert.equal(await page.locator('.sidebar .bbrd-filters').count(), 0);
    const besideCog = await page.evaluate(() => {
      const cog = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').includes('Global diff settings') && !button.closest('.bbrd-menu-host'));
      return document.querySelector('.bbrd-menu-host')?.nextElementSibling === cog;
    });
    assert.equal(besideCog, true);
    const panel = await openHideMenu();
    await panel.getByLabel('Markdown files').check();
    assert.equal(await article('README.md').isVisible(), false);
    assert.equal(await article('docs/onboarding.md').isVisible(), false);
    assert.equal(await page.locator('a[href="#chg-README.md"]').isVisible(), false);
    assert.equal(await article('package.json').isVisible(), true);
    assert.match(await panel.locator('.bbrd-hidden-count').textContent(), /hidden/);

    const extensions = panel.locator('[data-filter="hiddenExtensions"]');
    await extensions.fill('.svg');
    await extensions.blur();
    assert.equal(await article('assets/logo.svg').isVisible(), false);
    assert.equal(await page.locator('a[href="#chg-src/checkout.js"]').isVisible(), true);
    await shot('mock-file-list-hidden', panel);

    await extensions.fill('');
    await extensions.blur();
    await panel.getByLabel('Markdown files').uncheck();
    assert.equal(await article('README.md').isVisible(), true);
    assert.equal(await article('assets/logo.svg').isVisible(), true);

    const viewed = page.locator('[data-qa="files-viewed-count"]');
    const changed = page.locator('[data-qa="files-changed-count"]');
    assert.equal(await viewed.textContent(), '0 of 14 files viewed');
    assert.equal(await changed.textContent(), '14 files changed');

    await panel.getByLabel('Test projects').check();
    assert.equal(await article('src/Payment.Tests/ChargeTests.cs').isVisible(), false);
    assert.equal(await article('src/Payment.UnitTests/FlowTests.cs').isVisible(), false);
    assert.equal(await page.locator('a[href="#chg-src/Payment.Tests/ChargeTests.cs"]').isVisible(), false);
    assert.equal(await article('src/Payment.cs').isVisible(), true);
    const folderNamed = (name) => page.locator('#file-list button').filter({ has: page.locator('.dirname', { hasText: new RegExp(`^${name}$`) }) });
    const testsFolder = folderNamed('Payment\\.Tests');
    assert.equal(await testsFolder.locator('.bbrd-hidden-pill').textContent(), 'Hidden');
    assert.equal(await folderNamed('Payment\\.UnitTests').locator('.bbrd-hidden-pill').count(), 1);
    assert.equal(await folderNamed('src').locator('.bbrd-hidden-pill').count(), 0);
    assert.equal(await page.locator('.bbrd-hidden-bar').count(), 0);
    assert.equal(await page.locator('#file-list .bbrd-hidden-toggle').count(), 0);
    assert.match(await panel.locator('.bbrd-hidden-count').textContent(), /tests/);
    assert.equal(await viewed.textContent(), '0 of 12 viewed · 14 files');
    assert.equal(await changed.textContent(), '12 of 14 files changed');
    await panel.getByRole('button', { name: 'Show hidden files' }).click();
    assert.equal(await article('src/Payment.Tests/ChargeTests.cs').isVisible(), true);
    assert.equal(await page.locator('a[href="#chg-src/Payment.Tests/ChargeTests.cs"]').locator('..').locator('.bbrd-cat').textContent(), 'Tests');
    assert.equal(await viewed.textContent(), '0 of 14 files viewed');
    assert.equal(await changed.textContent(), '14 files changed');
    await openHideMenu();
    await panel.getByRole('button', { name: 'Hide hidden files' }).click();
    assert.equal(await article('src/Payment.Tests/ChargeTests.cs').isVisible(), false);
    assert.equal(await viewed.textContent(), '0 of 12 viewed · 14 files');
    await openHideMenu();
    await panel.getByLabel('Test projects').uncheck();
    assert.equal(await article('src/Payment.Tests/ChargeTests.cs').isVisible(), true);
    assert.equal(await testsFolder.locator('.bbrd-hidden-pill').count(), 0);
    assert.equal(await viewed.textContent(), '0 of 14 files viewed');
    assert.equal(await changed.textContent(), '14 files changed');

    await panel.getByLabel('Solution and project files').check();
    assert.equal(await article('Payment.sln').isVisible(), false);
    assert.equal(await article('src/Payment.csproj').isVisible(), false);
    assert.match(await panel.locator('.bbrd-hidden-count').textContent(), /project/);
    assert.equal(await viewed.textContent(), '0 of 12 viewed · 14 files');
    assert.equal(await changed.textContent(), '12 of 14 files changed');
    await panel.getByLabel('Solution and project files').uncheck();
    assert.equal(await article('Payment.sln').isVisible(), true);
    assert.equal(await viewed.textContent(), '0 of 14 files viewed');

    await panel.getByLabel('Generated files').check();
    assert.equal(await article('pnpm-lock.yaml').isVisible(), false);
    await panel.getByLabel('Generated files').uncheck();
    assert.equal(await article('pnpm-lock.yaml').isVisible(), true);

    const pattern = panel.locator('[data-filter="hidePattern"]');
    await pattern.fill('\\.svg$');
    await pattern.blur();
    assert.equal(await article('assets/logo.svg').isVisible(), false);
    assert.equal(await article('src/Payment.cs').isVisible(), true);
    await pattern.fill('[');
    await pattern.blur();
    assert.equal(await pattern.getAttribute('aria-invalid'), 'true');
    assert.equal(await article('src/Payment.cs').isVisible(), true);
    await pattern.fill('');
    await pattern.blur();
    assert.equal(await article('assets/logo.svg').isVisible(), true);
  });

  it('keeps a single hide menu when the diff toolbar is re-rendered', async () => {
    await page.evaluate(() => window.__replaceDiffToolbar());
    await page.evaluate(() => window.__replaceDiffToolbar());
    await page.getByRole('button', { name: 'Hide files and comments' }).waitFor();
    assert.equal(await page.locator('.bbrd-menu-host').count(), 1);
    assert.equal(await page.locator('.bbrd-filters').count(), 1);
    const besideCog = await page.evaluate(() => {
      const cog = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').includes('Global diff settings') && !button.closest('.bbrd-menu-host'));
      return document.querySelector('.bbrd-menu-host')?.nextElementSibling === cog;
    });
    assert.equal(besideCog, true);
  });

  it('re-applies one Hidden pill and the viewed counter after the file tree re-renders', async () => {
    const panel = await openHideMenu();
    await panel.getByLabel('Test projects').check();
    const folderNamed = (name) => page.locator('#file-list button').filter({ has: page.locator('.dirname', { hasText: new RegExp(`^${name}$`) }) });
    assert.equal(await folderNamed('Payment\\.Tests').locator('.bbrd-hidden-pill').count(), 1);
    assert.equal(await page.locator('[data-qa="files-viewed-count"]').textContent(), '0 of 12 viewed · 14 files');
    assert.equal(await page.locator('[data-qa="files-changed-count"]').textContent(), '12 of 14 files changed');

    await page.evaluate(() => window.__replaceFileTree());
    await folderNamed('Payment\\.Tests').locator('.bbrd-hidden-pill').waitFor();
    assert.equal(await folderNamed('Payment\\.Tests').locator('.bbrd-hidden-pill').count(), 1);
    assert.equal(await folderNamed('Payment\\.UnitTests').locator('.bbrd-hidden-pill').count(), 1);
    assert.equal(await page.locator('.bbrd-menu-host').count(), 1);
    assert.equal(await page.locator('.bbrd-filters').count(), 1);
    assert.equal(await page.locator('.bbrd-hidden-bar').count(), 0);
    assert.equal(await page.locator('[data-qa="files-viewed-count"]').textContent(), '0 of 12 viewed · 14 files');
    assert.equal(await page.locator('[data-qa="files-changed-count"]').textContent(), '12 of 14 files changed');

    await openHideMenu();
    await panel.getByLabel('Test projects').uncheck();
    assert.equal(await page.locator('[data-qa="files-viewed-count"]').textContent(), '0 of 14 files viewed');
  });

  it('hides code comments and summary comments in JavaScript and C# diffs', async () => {
    const panel = await openHideMenu();
    const js = article('src/checkout.js');
    const cs = article('src/Payment.cs');
    const shown = (root, text) => root.locator('[data-key="code-line"]:visible', { hasText: text }).count();
    assert.equal(await shown(js, 'Reject empty amounts'), 1);
    assert.equal(await shown(js, '@param'), 2);

    await panel.getByLabel('Code comments').check();
    assert.equal(await shown(js, 'Reject empty amounts'), 0);
    const commentFold = js.locator('.bbrd-comment-fold').first();
    assert.match(await commentFold.textContent(), /comment line/);
    await commentFold.click();
    assert.equal(await shown(js, 'Reject empty amounts'), 1);
    await commentFold.click();
    assert.equal(await shown(js, 'Reject empty amounts'), 0);
    assert.equal(await js.locator('.bbrd-hide-comment:visible', { hasText: 'trailing note' }).count(), 0);
    assert.ok((await js.locator('.bbrd-hide-comment', { hasText: 'trailing note' }).count()) >= 1);
    assert.ok((await shown(js, 'gateway.capture')) >= 1);
    assert.equal(await shown(js, 'https?:'), 1, 'slashes inside a regex stay');
    assert.equal(await shown(js, '@param'), 2, 'summary comments stay until asked');
    assert.equal(await shown(cs, 'Reject empty amounts'), 0);
    assert.equal(await shown(cs, '<summary>'), 2);

    await openHideMenu();
    await panel.getByLabel('Summary comments').check();
    assert.equal(await shown(js, '@param'), 0);
    assert.equal(await shown(cs, '<summary>'), 0);
    assert.equal(await shown(cs, 'public string Charge'), 1);
    assert.equal(await shown(cs, 'http://gateway'), 1, 'comment markers inside strings stay');
    await shot('mock-comments-hidden', cs);

    await panel.getByLabel('Code comments').uncheck();
    await panel.getByLabel('Summary comments').uncheck();
    assert.equal(await shown(js, '@param'), 2);
    assert.equal(await shown(cs, '<summary>'), 2);
  });

  it('collapses a test file to one row per test', async () => {
    const tests = article('src/Payment.Tests/ChargeTests.cs');
    const folds = tests.locator('.bbrd-test-fold');
    assert.equal(await folds.count(), 2);
    assert.match(await folds.nth(0).locator('.bbrd-test-title').textContent(), /Charge rejects empty/);
    assert.equal(await tests.locator('[data-key="code-line"]:visible', { hasText: 'Assert.Null' }).count(), 0);
    await folds.nth(0).click();
    assert.equal(await tests.locator('[data-key="code-line"]:visible', { hasText: 'Assert.Null' }).count(), 1);
    await folds.nth(0).click();
  });

  it('re-attaches tabs when Bitbucket re-renders a file header', async () => {
    await page.evaluate(() => window.__rerenderHeader(0));
    await article('README.md').locator('.bbrd-tabs').waitFor();
    assert.equal(await article('README.md').locator('.bbrd-tabs').count(), 1);
  });
});

describe('real Bitbucket Cloud pull request', { skip: process.env.E2E_SKIP_REAL === '1' }, () => {
  it('injects tabs and renders rich views on bitbucket.org', async () => {
    await page.goto(REAL_PR_URL, { waitUntil: 'domcontentloaded' });
    const readme = article('README.md');
    await readme.locator('.bbrd-tabs').waitFor({ timeout: 45000 });
    await readme.locator('.markdown-body').waitFor({ timeout: 20000 });
    assert.equal(await readme.locator('.bbrd-blk--ins h2').first().textContent(), '⚠️ Warning');
    assert.equal(await readme.locator('[data-qa="bk-file__content"]').isVisible(), false);

    const pkg = article('package.json');
    await pkg.locator('.jd-summary').waitFor();
    assert.deepEqual(await pkg.locator('.jd-sum-path').allTextContents(), ['version', 'scripts.test']);
    await shot('real-package-json-rich-diff', pkg);

    await readme.locator('.bbrd-tab[data-view="diff"]').click();
    assert.equal(await readme.locator('[data-qa="bk-file__content"]').isVisible(), true);
  });
});
