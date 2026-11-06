import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readPayload(rel) {
  const src = path.join(root, rel);
  const p1 = src + '.p1';
  const p2 = src + '.p2';
  if (fs.existsSync(p1) && fs.existsSync(p2)) {
    return fs.readFileSync(p1, 'utf8') + fs.readFileSync(p2, 'utf8');
  }
  if (fs.existsSync(src)) return fs.readFileSync(src, 'utf8');
  return null;
}

const items = [
  ['.land-payload/page.css.zlib.b64', 'src/styles/page.css'],
  ['.land-payload/review-groups.js.zlib.b64', 'src/content/review-groups.js'],
  ['.land-payload/SPEC.md.zlib.b64', 'SPEC.md'],
];
for (const [from, to] of items) {
  const text = readPayload(from);
  if (text == null) continue;
  const raw = zlib.inflateSync(Buffer.from(text.trim(), 'base64'));
  fs.writeFileSync(path.join(root, to), raw);
  console.log('inflated', to, raw.length);
}
