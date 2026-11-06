import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const items = [
  ['.land-payload/page.css.zlib.b64', 'src/styles/page.css'],
  ['.land-payload/review-groups.js.zlib.b64', 'src/content/review-groups.js'],
  ['.land-payload/SPEC.md.zlib.b64', 'SPEC.md'],
];
for (const [from, to] of items) {
  const src = path.join(root, from);
  if (!fs.existsSync(src)) continue;
  const raw = zlib.inflateSync(Buffer.from(fs.readFileSync(src, 'utf8').trim(), 'base64'));
  fs.writeFileSync(path.join(root, to), raw);
  console.log('inflated', to, raw.length);
}
