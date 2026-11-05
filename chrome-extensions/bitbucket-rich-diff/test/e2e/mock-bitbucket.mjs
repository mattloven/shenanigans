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
  const patch = structuredPatch(file.path, file.path, file.old ?? '', file.new ?? '', '', '', { contex