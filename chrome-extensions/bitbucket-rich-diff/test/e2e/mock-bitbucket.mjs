/**
 * Serves a fake Bitbucket Cloud pull request at https://bitbucket.org/acme/payments/pull-requests/42
 * via Playwright request interception, so the real content script runs against it. The page
 * mirrors the DOM structure of Bitbucket's "Files changed" view (data-qa hooks, sticky file
 * header that collapses the file on click, scroll container) and the /!api/2.0 responses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { structuredPatch } from 'diff';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, '../fixtures');
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
  { status: 'added', path: 'src/Payment.Tests/ChargeTests.cs', old: null, new: '[Fact]\npublic void Charge_rejects_empty()\n{\n    Assert.Null(payment.Charge(0));\n}\n\n[Fact]\npublic void Charge_returns_receipt()\n{\n    Assert.Equal("ok", payment.Charge(10));\n}\n' },
  { status: 'added', path: 'src/Payment.UnitTests/FlowTests.cs', old: null, new: 'public class FlowTests {}\n' },
  { status: 'added', path: 'Payment.sln', old: null, new: 'Microsoft Visual Studio Solution File\n' },
  { status: 'added', path: 'src/Payment.csproj', old: null, new: '<Project Sdk="Microsoft.NET.Sdk"></Project>\n' },
  { status: 'modified', path: 'pnpm-lock.yaml', old: 'lock: 1\n', new: 'lock: 2\n' },
  { status: 'modified', path: 'assets/logo.svg', old: '<svg></svg>\n', new: '<svg id="logo"></svg>\n' },
  { status: 'modified', path: 'config/broken.json', old: '{"a": 1}\n', new: '{"a": 1,,}\n' },
];

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function lineStats(file) {
  const patch = structuredPatch(file.path, file.path, file.old ?? '', file.new ?? '', '', '', { context: 3 });
  let added = 0;
  let removed = 0;
  for (const hunk of patch.hunks) {
    for (const raw of hunk.lines) {
      if (raw[0] === '+') added += 1;
      else if (raw[0] === '-') removed += 1;
    }
  }
  const parts = [];
  if (added) parts.push(`${added} ${added === 1 ? 'line' : 'lines'} added`);
  if (removed) parts.push(`${removed} ${removed === 1 ? 'line' : 'lines'} removed`);
  return parts.join(', ');
}

function fileListHtml(files) {
  const root = { dirs: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push(file);
  }
  const render = (node) => {
    let html = '';
    for (const child of node.dirs.values()) {
      html += `<li><button type="button" aria-expanded="true"><span role="img" aria-label="Directory"></span><span class="dirname">${escape(child.name)}</span></button><ul role="list">${render(child)}</ul></li>`;
    }
    for (const file of node.files) {
      const stat = lineStats(file);
      html += `<li><a href="#chg-${escape(file.path)}"><span>${escape(file.path.split('/').pop())}</span>${stat ? `<span class="stat"> ${escape(stat)}</span>` : ''}</a></li>`;
    }
    return html;
  };
  return render(root);
}

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
    body { margin: 0; height: 100vh; display: flex; flex-direction: column; overflow: hidden; font: 14px -apple-system, Segoe UI, Roboto, sans-serif; color: #172b4d; }
    .top { height: 60px; flex: none; border-bottom: 1px solid #ddd; display: flex; align-items: center; padding: 0 24px; font-weight: 600; }
    .diff-shell { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .page { display: flex; flex: 1; min-height: 0; }
    .sidebar { width: 300px; flex: none; overflow: auto; border-right: 1px solid #dfe1e6; padding: 12px; box-sizing: border-box; }
    .sidebar ul { margin: 0; padding: 0; }
    .sidebar li { list-style: none; margin: 2px 0; }
    .sidebar a { color: inherit; text-decoration: none; font-size: 13px; }
    .scroller { position: sticky; top: 0; flex: 1; height: 100%; overflow: auto; padding: 16px 24px; box-sizing: border-box; }
    .diff-bar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin: 0 0 12px; padding: 8px 0; background: #fff; }
    .icon-btn { width: 32px; height: 32px; border: 0; border-radius: 4px; background: transparent; }
    .vh { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
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
    <nav class="repo-nav" aria-label="Repository"><a href="/acme/payments/src">Source</a><a href="/acme/payments/commits">Commits</a><a href="/acme/payments/branches">Branches</a></nav>
    <nav aria-label="Pull request"><div class="pr-tabs" role="tablist"><a role="tab" href="/acme/payments/pull-requests/42/overview">Overview</a><a role="tab" href="/acme/payments/pull-requests/42/diff" aria-current="page">Files changed</a><a role="tab" href="/acme/payments/pull-requests/42/commits">Commits</a></div><button type="button">Comments (3 unresolved)</button><div>Unresolved Comments (3)</div><div>Resolved Comments (1)</div></nav>
    <div class="diff-shell">
    <div class="page">
      <aside id="file-tree" class="sidebar"><div class="sidebar-head"><span data-qa="files-changed-count">${MOCK_FILES.length} files changed</span><button type="button">Filter files</button></div><div class="lines-updated"><span><h5>Lines updated</h5></span><div><span>+1404</span><span>-82</span></div></div><ul role="list" id="file-list"></ul></aside>
      <div class="scroller">
        <div class="diff-bar"><span data-qa="files-viewed-count">0 of ${MOCK_FILES.length} files viewed</span><button type="button" class="icon-btn"><span class="vh">Global diff settings</span></button></div>
        <div id="files"></div>
      </div>
    </div>
    </div>
    <script>
      const files = ${JSON.stringify(MOCK_FILES.map((f) => ({ path: f.path, html: articleHtml(f) })))};
      const fileListMarkup = ${JSON.stringify(fileListHtml(MOCK_FILES))};
      const fileCount = ${MOCK_FILES.length};
      // Bitbucket renders fil