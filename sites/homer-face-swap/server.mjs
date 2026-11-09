// Local static server for the face-swap app. Serves the app, the source frames
// from FRAMES_DIR, and accepts generated files into ./output so a run leaves
// real files on disk as well as browser downloads.
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile, stat, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const framesDir = resolve(process.env.FRAMES_DIR ?? join(appDir, 'frames'));
const outputDir = resolve(appDir, 'output');
const originalsDir = join(framesDir, 'original');
const port = Number(process.env.PORT ?? 5178);
const esrganExe = resolve(process.env.REALESRGAN ?? join(appDir, 'tools', 'realesrgan', 'realesrgan-ncnn-vulkan.exe'));

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const frameExt = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const safeName = /^[A-Za-z0-9_.-]+$/;

// Resolves a request path under root, refusing anything that escapes it.
function within(root, rel) {
  const full = resolve(root, '.' + sep + decodeURIComponent(rel));
  return full === root || full.startsWith(root + sep) ? full : null;
}

async function sendFile(res, file) {
  try {
    const info = await stat(file);
    if (!info.isFile()) {
      throw new Error('not a file');
    }
    res.writeHead(200, { 'Content-Type': types[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('Not found');
  }
}

async function frameNames(dir) {
  return (await readdir(dir))
    .filter((n) => frameExt.has(extname(n).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

let esrganJob = null;

// Backs up any frame not yet in original/, runs Real-ESRGAN's anime-video
// model over the originals into a scratch folder, then copies the results
// over the frames. Progress is the count of files written so far.
async function runEsrgan(job) {
  let scratch = null;
  let timer = null;
  try {
    await mkdir(originalsDir, { recursive: true });
    for (const n of await frameNames(framesDir)) {
      const backup = join(originalsDir, n);
      if (!(await isFile(backup))) {
        await copyFile(join(framesDir, n), backup);
      }
    }
    const sources = await frameNames(originalsDir);
    job.total = sources.length;
    scratch = await mkdtemp(join(tmpdir(), 'realesrgan-'));
    timer = setInterval(async () => {
      job.done = (await readdir(scratch).catch(() => [])).length;
    }, 500);
    const args = ['-i', originalsDir, '-o', scratch, '-n', 'realesr-animevideov3', '-s', String(job.scale), '-f', 'png'];
    await new Promise((done, fail) => {
      const proc = spawn(esrganExe, args, { cwd: dirname(esrganExe), windowsHide: true });
      let tail = '';
      const keep = (d) => (tail = (tail + d).slice(-2000));
      proc.stdout.on('data', keep);
      proc.stderr.on('data', keep);
      proc.on('error', fail);
      proc.on('close', (code) => {
        if (code === 0) {
          done();
        } else {
          const last = tail.trim().split(/\r?\n/).filter((l) => !/^\d+(\.\d+)?%$/.test(l.trim())).pop();
          fail(new Error(`Real-ESRGAN stopped (exit ${code})${last ? `: ${last}` : ''}`));
        }
      });
    });
    const made = await frameNames(scratch);
    if (made.length !== sources.length) {
      throw new Error(`Real-ESRGAN wrote ${made.length} of ${sources.length} frames; nothing was replaced`);
    }
    for (const n of made) {
      await copyFile(join(scratch, n), join(framesDir, n));
    }
    job.done = made.length;
  } catch (err) {
    job.error = err.message;
  } finally {
    clearInterval(timer);
    job.running = false;
    job.finished = Date.now();
    if (scratch) {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (path === '/api/frames') {
    try {
      const names = await frameNames(framesDir);
      const originals = await frameNames(originalsDir).catch(() => []);
      // Newest write among the frames: changes whenever they are replaced.
      let stamp = 0;
      for (const n of names) {
        stamp = Math.max(stamp, (await stat(join(framesDir, n))).mtimeMs);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        dir: framesDir,
        frames: names.map((n) => '/frames/' + encodeURIComponent(n)),
        originals: originals.length ? originalsDir : null,
        stamp: Math.round(stamp),
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Cannot read ${framesDir}: ${err.message}` }));
    }
    return;
  }

  // POST /api/frames/write/<name>: replaces an existing source frame. The
  // first write of each frame copies the untouched file into original/ so
  // enhancing can be redone from, or undone to, the capture as it came.
  if (path.startsWith('/api/frames/write/') && req.method === 'POST') {
    const name = decodeURIComponent(path.slice('/api/frames/write/'.length));
    const target = join(framesDir, name);
    if (!safeName.test(name) || !frameExt.has(extname(name).toLowerCase()) || !(await isFile(target))) {
      res.writeHead(400).end('Not an existing frame');
      return;
    }
    await mkdir(originalsDir, { recursive: true });
    const backup = join(originalsDir, name);
    if (!(await isFile(backup))) {
      await copyFile(target, backup);
    }
    await writeFile(target, await readBody(req));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: target, backup }));
    return;
  }

  // GET /api/realesrgan: whether the upscaler is installed, and the last run.
  if (path === '/api/realesrgan' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ available: await isFile(esrganExe), exe: esrganExe, job: esrganJob }));
    return;
  }

  // POST /api/realesrgan/run?scale=2: upscales every original into the frames folder.
  if (path === '/api/realesrgan/run' && req.method === 'POST') {
    const scale = Number(url.searchParams.get('scale') ?? 2);
    if (![2, 3, 4].includes(scale)) {
      res.writeHead(400).end('Scale must be 2, 3 or 4');
      return;
    }
    if (esrganJob?.running) {
      res.writeHead(409).end('A run is already going');
      return;
    }
    if (!(await isFile(esrganExe))) {
      res.writeHead(404).end(`Real-ESRGAN not found at ${esrganExe}`);
      return;
    }
    esrganJob = { running: true, done: 0, total: 0, scale, error: null, started: Date.now(), finished: null };
    runEsrgan(esrganJob);
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(esrganJob));
    return;
  }

  // POST /api/frames/restore: puts every backed-up original back.
  if (path === '/api/frames/restore' && req.method === 'POST') {
    const names = await frameNames(originalsDir).catch(() => []);
    for (const n of names) {
      await copyFile(join(originalsDir, n), join(framesDir, n));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ restored: names.length }));
    return;
  }

  // POST /api/save/<run>/<name> or /api/save/<run>/frames/<name>
  if (path.startsWith('/api/save/') && req.method === 'POST') {
    const parts = path.slice('/api/save/'.length).split('/');
    const valid = parts.length >= 2 && parts.length <= 3 && parts.every((p) => safeName.test(p) && p !== '.' && p !== '..');
    if (!valid) {
      res.writeHead(400).end('Bad path');
      return;
    }
    const target = join(outputDir, ...parts);
    await mkdir(join(target, '..'), { recursive: true });
    // Streamed straight to disk: a big GIF or frames ZIP can run to gigabytes.
    try {
      await pipeline(req, createWriteStream(target));
    } catch (err) {
      await rm(target, { force: true });
      res.writeHead(500).end(`Saving ${parts.at(-1)} failed: ${err.message}`);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: target }));
    return;
  }

  if (path.startsWith('/frames/')) {
    const file = within(framesDir, path.slice('/frames/'.length));
    return file ? sendFile(res, file) : res.writeHead(403).end();
  }

  const file = within(appDir, path === '/' ? 'index.html' : path.slice(1));
  return file ? sendFile(res, file) : res.writeHead(403).end();
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Homer face swap on http://localhost:${port}  (frames: ${framesDir})`);
});
