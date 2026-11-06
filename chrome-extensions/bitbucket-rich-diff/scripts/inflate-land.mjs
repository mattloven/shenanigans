import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAND =
  'https://raw.githubusercontent.com/mattloven/shenanigans/cursor/land-remaining-fixes-3ec3/chrome-extensions/bitbucket-rich-diff';

function fetchText(url) {
  return execFileSync('curl', ['-fsSL', url], { encoding: 'utf8', maxBuffer: 20_000_000 });
}

function readLocalPayload(rel) {
  const src = path.join(root, rel);
  const p1 = `${src}.p1`;
  const p2 = `${src}.p2`;
  if (fs.existsSync(p1) && fs.existsSync(p2)) {
    return fs.readFileSync(p1, 'utf8') + fs.readFileSync(p2, 'utf8');
  }
  if (fs.existsSync(src)) return fs.readFileSync(src, 'utf8');
  return null;
}

function loadPayload(rel) {
  const local = readLocalPayload(rel);
  if (local) {
    try {
      zlib.inflateSync(Buffer.from(local.trim(), 'base64'));
      return local;
    } catch {
      // fall through to land branch
    }
  }
  // Whole-file zlib on land for page + review-groups; SPEC uses p1/p2.
  if (rel.endsWith('SPEC.md.zlib.b64')) {
    const a = fetchText(`${LAND}/${rel}.p1`);
    const b = fetchText(`${LAND}/${rel}.p2`);
    return a + b;
  }
  return fetchText(`${LAND}/${rel}`);
}

const zlibItems = [
  ['.land-payload/page.css.zlib.b64', 'src/styles/page.css'],
  ['.land-payload/review-groups.js.zlib.b64', 'src/content/review-groups.js'],
  ['.land-payload/SPEC.md.zlib.b64', 'SPEC.md'],
];

for (const [from, to] of zlibItems) {
  const text = loadPayload(from);
  const raw = zlib.inflateSync(Buffer.from(text.trim(), 'base64'));
  fs.writeFileSync(path.join(root, to), raw);
  console.log('inflated', to, raw.length);
}

/** Product files that are complete on the land tip (not the truncated CSS/JS stubs). */
const syncFiles = [
  'src/core/comments.js',
  'src/content/comment-mask.js',
  'src/content/file-view.js',
  'src/content/pr-context.js',
  'src/content/test-outline.js',
  'src/content/stats-tab.js',
  'src/styles/page-folds.css',
  'src/styles/page-groups.css',
  'src/manifest.json',
  'scripts/build.mjs',
  'package.json',
  'test/unit/comment-mask.test.js',
  'test/unit/comments.test.js',
  'test/unit/content-app.test.js',
  'test/unit/review-groups.test.js',
  'test/unit/test-outline-view.test.js',
];

for (const rel of syncFiles) {
  const text = fetchText(`${LAND}/${rel}`);
  const dest = path.join(root, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
  console.log('synced', rel, text.length);
}
