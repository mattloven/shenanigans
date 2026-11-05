import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });

const copies = [
  ['src/manifest.json', 'manifest.json'],
  ['src/styles/page.css', 'page.css'],
  ['src/options/options.html', 'options.html'],
  ['src/options/options.css', 'options.css'],
  ['assets/icons', 'icons'],
];

function copyStatic() {
  for (const [from, to] of copies) fs.cpSync(path.join(root, from), path.join(outdir, to), { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const manifestPath = path.join(outdir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.version = pkg.version;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const options = {
  absWorkingDir: root,
  entryPoints: { content: 'src/content/index.js', options: 'src/options/options.js' },
  outdir,
  bundle: true,
  format: 'iife',
  target: 'chrome114',
  loader: { '.css': 'text' },
  legalComments: 'none',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
  plugins: [{ name: 'static', setup: (build) => build.onEnd(copyStatic) }],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log(`Watching ${outdir}`);
} else {
  await esbuild.build(options);
  console.log(`\nLoad this folder in chrome://extensions:\n${outdir}\n`);
  console.log('dist is listed in .gitignore, so the editor file tree hides it. The folder is on disk at the path above.');
}
