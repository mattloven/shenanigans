/**
 * Serves a fake Bitbucket Cloud pull request at https://bitbucket.org/acme/payments/pull-requests/42
 * via Playwright request interception, so the real content script runs against it. The page
 * mirrors the DOM structure of Bitbucket's "Files changed" view (data-qa hooks, sticky file
 * header that collapses the file on click, scroll container) and the /!api/2.0 responses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { structuredPatch } from 'diff';

const fixtures = path.resolve(import.meta.dirname, '../fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

export const MOCK_PR_URL = 'https://bitbucket.org/acme/payments/pull-requests/42/diff';
export const OLD_COMMIT = 'aaaaaaaaaaaa1111111111111111111111111111';
export const NEW_COMMIT = 'bbbbbbbbbbbb2222222222222222222222222222';
const API = 'https://bitbucket.org/!api/2.0/repositories/acme/payments';

export const MOCK_FILES = [
  { status: 'modified', path: 'README.md', old: read('sample-old.md'), new: read('sample-new.md') },
  { status: 'modified', path: 'package.json', old: read('config-old.json'), new: read('config-new.json') },
  { status: 'added', path: 'docs/onboarding.md', old: null, new: '# Onboarding\n\nWelcome to the **payments** team.\n\n- Read the README\n- Pair with a buddy\n' },
  { status: 'removed', path: 'docs/legacy.md', old: '# Legacy\n\nThe old settlement batch.\n', new: null },
  { status: 'modified', path: 'src/app.js', old: 'const a = 1;\n', new: 'const a = 2;\n' },
  { status: 'modified', path: 'src/checkout.js', old: read('checkout-old.js'), new: read('checkout-new.js') },
  { status: 'modified', path: 'src/Payment.cs', old: read('payment-old.cs'), new: read('payment-new.cs') },
  { status: 'modified', path: 'assets/logo.svg', old: '<svg></svg>\n', new: '<svg id="logo"></svg>\n' },
  { status: 'modified', path: 'config/broken.json', old: '{"a": 1}\n', new: '{"a": 1,,}\n' },
];

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function diffLine(raw) {
  const prefix = raw[0];
  if (prefix !== '+' && prefix !== '-' && prefix !== ' ') return `<div class="hunk">${escape(raw)}</div>`;
  const text = raw.slice(1);
  const tone = prefix === '+' ? 'add' : prefix === '-' ? 'del' : '';
  return `<div data-key="code-line" role="row" class="line ${tone}"><div data-qa="code-line"><pre><div><span class="mark">${escape(prefix)}</span><span role="gridcell" data-line-type="${prefix}">${escape(text)}</span></div></pre></div></div>`;
}

function diffRows(file) {
  const patch = structuredPatch(file.path, file.path, file.old ?? '', file.new ?? '', '', '', { context: 3 });
  return patch.hunks
    .map((hunk) => `<div class="hunk">@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@</div>${hunk.lines.map(diffLine).join('')}`)
    .join('');
}

function articleHtml(file) {
  return `
  <article data-qa="branch-diff-file" aria-label="Diff of file ${file.path}">
    <div>
      <div data-qa="bk-file__header" data-testid="file-header" tabindex="0" class="file-header">
        <div class="chev">⌄</div>
        <div><span class="status">${file.status}</span></div>
        <div><h2 data-qa="bk-filepath"><div>${file.path
          .split('/')
          .map((s) => `<span data-qa="bk-filepath__padded-segment">${s}</span>`)
          .join('<span data-qa="bk-filepath__padded-segment">/</span>')}</div></h2></div>
        <div class="right"><label><input type="checkbox"> Viewed</label><div data-qa="bk-file__actions"><button>⋯</button></div></div>
      </div>
      <div class="collapsible"><div><div data-qa="bk-file__content" data-testid="file-content">${diffRows(file)}</div></div></div>
    </div>
  </article>`;
}

function pageHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Mock PR</title><style>
    body { margin: 0; font: 14px -apple-system, Segoe UI, Roboto, sans-serif; color: #172b4d; }
    .top { height: 60px; border-bottom: 1px solid #ddd; display: flex; align-items: center; padding: 0 24px; font-weight: 600; }
    .page { display: flex; height: calc(100vh - 61px); }
    .sidebar { width: 300px; flex: none; overflow: auto; border-right: 1px solid #dfe1e6; padding: 12px; box-sizing: border-box; }
    .sidebar ul { margin: 0; padding: 0; }
    .sidebar li { list-style: none; margin: 2px 0; }
    .sidebar a { color: inherit; text-decoration: none; font-size: 13px; }
    .scroller { position: sticky; top: 0; flex: 1; height: 100%; overflow: auto; padding: 16px 24px; box-sizing: border-box; }
    article { border: 1px solid #dfe1e6; border-radius: 4px; margin-bottom: 16px; }
    .file-header { position: sticky; top: 0; z-index: 180; display: flex; align-items: center; gap: 8px; height: 42px; padding: 0 12px; background: #f7f8f9; border-bottom: 1px solid #dfe1e6; cursor: pointer; }
    .file-header h2 { font-size: 14px; margin: 0; }
    .status { font-size: 11px; color: #626f86; }
    .right { display: flex; gap: 12px; align-items: center; }
    article.collapsed .collapsible { display: none; }
    [data-qa="bk-file__content"] { font: 12px ui-monospace, Menlo, monospace; }
    .line { white-space: pre; padding: 0 8px; } .line.add { background: #dcfff1; } .line.del { background: #ffeceb; }
    .hunk { background: #f1f2f4; color: #626f86; padding: 2px 8px; }
  </style></head><body>
    <div class="top">acme / payments — Pull request #42: Payments docs refresh</div>
    <div class="page">
      <aside class="sidebar"><div><button type="button">Filter files</button></div><ul role="list" id="file-list"></ul></aside>
      <div class="scroller"><div id="files"></div></div>
    </div>
    <script>
      const files = ${JSON.stringify(MOCK_FILES.map((f) => ({ path: f.path, html: articleHtml(f) })))};
      // Bitbucket renders file diffs asynchronously after the SPA boots.
      setTimeout(() => {
        document.getElementById('files').innerHTML = files.map((f) => f.html).join('');
        document.getElementById('file-list').innerHTML = files.map((f) => '<li><a href="#chg-' + f.path + '"><span>' + f.path + '</span></a></li>').join('');
        for (const header of document.querySelectorAll('.file-header')) {
          header.addEventListener('click', () => header.closest('article').classList.toggle('collapsed'));
        }
      }, 300);
      window.__rerenderHeader = (index) => {
        const header = document.querySelectorAll('[data-qa="bk-file__header"]')[index];
        const clone = header.cloneNode(true);
        clone.querySelectorAll('.bbrd-tabs').forEach((n) => n.remove());
        clone.addEventListener('click', () => clone.closest('article').classList.toggle('collapsed'));
        header.replaceWith(clone);
      };
    </script>
  </body></html>`;
}

function side(file, which) {
  const content = which === 'old' ? file.old : file.new;
  if (content === null) return null;
  const commit = which === 'old' ? OLD_COMMIT : NEW_COMMIT;
  return { path: file.path, type: 'commit_file', links: { self: { href: `${API}/src/${commit}/${file.path}` } } };
}

/** @param {import('playwright-core').BrowserContext} context */
export async function installMockBitbucket(context, { onApiRequest } = {}) {
  const png = fs.readFileSync(path.resolve(import.meta.dirname, '../../assets/icons/icon-128.png'));
  await context.route(/^https:\/\/bitbucket\.org\/acme\/payments\/pull-requests\/42/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml() }),
  );
  await context.route(`${API}/**`, (route) => {
    const url = new URL(route.request().url());
    onApiRequest?.(url);
    if (url.pathname.endsWith('/pullrequests/42/diffstat')) {
      const values = MOCK_FILES.map((f) => ({ type: 'diffstat', status: f.status, old: side(f, 'old'), new: side(f, 'new') }));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ values, pagelen: 500, size: values.length, page: 1 }) });
    }
    const m = url.pathname.match(/\/src\/([^/]+)\/(.+)$/);
    if (m) {
      const file = MOCK_FILES.find((f) => f.path === decodeURIComponent(m[2]));
      const content = file && (m[1] === OLD_COMMIT ? file.old : file.new);
      if (content == null) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ status: 200, contentType: 'text/plain', body: content });
    }
    return route.fulfill({ status: 404, body: 'not mocked' });
  });
  await context.route(/^https:\/\/bitbucket\.org\/acme\/payments\/raw\//, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
}
