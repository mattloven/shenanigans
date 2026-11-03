// Long-running driver for a visible Chromium started with --remote-debugging-port=9222.
// Keeps mock Bitbucket routes installed and exposes a tiny command API on localhost:5055:
//   /goto?url=…   /mock   /reload   /eval   (POST body = JS expression)   /shot?name=…
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { installMockBitbucket, MOCK_PR_URL } from '../test/e2e/mock-bitbucket.mjs';

const root = path.resolve(import.meta.dirname, '..');
const shotsDir = path.join(root, 'tmp/live');
fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
await installMockBitbucket(context);

const page = () => context.pages().find((p) => !p.url().startsWith('chrome://')) || context.pages()[0];

async function reloadExtension() {
  const ext = await context.newPage();
  await ext.goto('chrome://extensions');
  await ext.evaluate(async () => {
    await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
    const items = await chrome.developerPrivate.getExtensionsInfo();
    for (const item of items) {
      if (item.location !== 'UNPACKED') continue;
      if (item.state !== 'ENABLED') await chrome.management.setEnabled(item.id, true);
      await chrome.developerPrivate.reload(item.id, { failQuietly: true });
    }
  });
  await new Promise((r) => setTimeout(r, 500));
  await ext.close();
  await page().bringToFront();
  await page().reload({ waitUntil: 'domcontentloaded' });
}

const handlers = {
  '/goto': async (url) => {
    await page().goto(url.searchParams.get('url'), { waitUntil: 'domcontentloaded' });
    return 'ok';
  },
  '/back': async () => {
    await page().goBack();
    return 'ok';
  },
  '/mock': async () => {
    await page().goto(MOCK_PR_URL, { waitUntil: 'domcontentloaded' });
    return 'ok';
  },
  '/reload': async () => {
    await reloadExtension();
    return 'ok';
  },
  '/eval': async (url, body) => JSON.stringify(await page().evaluate(body), null, 2),
  // POST body is the body of an async function receiving the Playwright `page`.
  '/do': async (url, body) => {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    return JSON.stringify(await new AsyncFunction('page', body)(page()), null, 2);
  },
  '/shot': async (url) => {
    const file = path.join(shotsDir, `${url.searchParams.get('name') || 'shot'}.png`);
    await page().screenshot({ path: file });
    return file;
  },
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const handler = handlers[url.pathname];
      if (!handler) throw new Error(`unknown command ${url.pathname}`);
      res.end(`${await handler(url, body)}\n`);
    } catch (error) {
      res.statusCode = 500;
      res.end(`${error.stack}\n`);
    }
  })
  .listen(5055, () => console.log('live driver on :5055'));
