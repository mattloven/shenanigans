import { samplePixels, buildLevels, buildPalette } from './enhance.js';

const $ = (id) => document.getElementById(id);
const KEY = 'hedge-face-swap:enhance';
const DEFAULT_LOOK = { scale: 2, clean: 1, snap: 18, pop: 0.25, crisp: 1.5 };

const loadLook = () => {
  try {
    return { ...DEFAULT_LOOK, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_LOOK };
  }
};
const saveLook = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    // preferences only
  }
};

let look = loadLook();
let names = [];
let framesDir = '';
let originalsDir = null;
let shared = null;
let current = 0;
let split = 0.5;
let previewSeq = 0;
const orig = document.createElement('canvas');
const enh = document.createElement('canvas');
const view = $('view');

// Always enhance from the capture as it came: once a run has replaced the
// frames, their untouched copies live in original/.
const sourceUrl = (name) => `/frames/${originalsDir ? 'original/' : ''}${encodeURIComponent(name)}`;
const loadBitmap = async (name) => createImageBitmap(await (await fetch(sourceUrl(name), { cache: 'no-store' })).blob());

const setStatus = (t) => ($('status').textContent = t);

// ---------- workers ----------

const workers = Array.from({ length: 3 }, () => new Worker(new URL('./enhance-worker.js', import.meta.url), { type: 'module' }));
const pending = new Map();
let nextId = 0;
workers.forEach((w) =>
  w.addEventListener('message', (e) => {
    const p = pending.get(e.data.id);
    pending.delete(e.data.id);
    if (e.data.error) {
      p.reject(new Error(e.data.error));
    } else {
      p.resolve(e.data);
    }
  }),
);
function enhanceOn(bitmap, png) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    workers[id % workers.length].postMessage({ id, bitmap, look, shared, png }, [bitmap]);
  });
}

// ---------- shared palette and levels ----------

async function prepare() {
  const samples = [];
  const picks = names.filter((_, i) => i % 6 === 0);
  for (const [i, name] of picks.entries()) {
    const bm = await loadBitmap(name);
    const c = new OffscreenCanvas(bm.width, bm.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bm, 0, 0);
    for (const v of samplePixels(ctx.getImageData(0, 0, bm.width, bm.height), 23)) {
      samples.push(v);
    }
    bm.close();
    setStatus(`Studying the colours… ${Math.round(((i + 1) / picks.length) * 100)}%`);
  }
  shared = { levels: buildLevels(samples), palette: buildPalette(samples, 32) };
}

// ---------- preview ----------

async function preview() {
  const seq = ++previewSeq;
  const name = names[current];
  $('frameLabel').textContent = `${current + 1} / ${names.length}`;
  const [a, b] = await Promise.all([loadBitmap(name), loadBitmap(name)]);
  const { image } = await enhanceOn(b, false);
  if (seq !== previewSeq) {
    a.close();
    return;
  }
  for (const c of [orig, enh, view]) {
    c.width = image.width;
    c.height = image.height;
  }
  const octx = orig.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(a, 0, 0, image.width, image.height);
  a.close();
  enh.getContext('2d').putImageData(image, 0, 0);
  draw();
}

function draw() {
  if (!enh.width) {
    return;
  }
  const ctx = view.getContext('2d');
  const x = Math.round(split * view.width);
  ctx.drawImage(orig, 0, 0, x, view.height, 0, 0, x, view.height);
  ctx.drawImage(enh, x, 0, view.width - x, view.height, x, 0, view.width - x, view.height);
  const box = $('compare').getBoundingClientRect();
  const r = view.getBoundingClientRect();
  $('divider').style.left = `${r.left - box.left + $('compare').scrollLeft + split * r.width}px`;
}

let timer = 0;
const refresh = () => {
  clearTimeout(timer);
  timer = setTimeout(() => preview().catch((e) => setStatus(e.message)), 150);
};

// ---------- controls ----------

function bindControls() {
  const seg = $('segScale');
  for (const [v, label] of [[1, 'Same size'], [2, '2×']]) {
    const lab = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'scale';
    input.value = String(v);
    input.checked = look.scale === v;
    input.addEventListener('change', () => {
      look.scale = v;
      saveLook();
      refresh();
      describe();
    });
    const span = document.createElement('span');
    span.textContent = label;
    lab.append(input, span);
    seg.append(lab);
  }
  const fmt = {
    clean: (v) => ['Off', 'Light', 'Medium', 'Strong'][v],
    snap: (v) => (v ? String(v) : 'Off'),
    pop: (v) => `+${Math.round(v * 100)}%`,
    crisp: (v) => (v ? v.toFixed(1) : 'Off'),
  };
  for (const key of Object.keys(fmt)) {
    const input = $(key);
    const show = () => {
      input.value = String(look[key]);
      $(`${key}Out`).textContent = fmt[key](look[key]);
    };
    show();
    input.addEventListener('input', () => {
      look[key] = Number(input.value);
      $(`${key}Out`).textContent = fmt[key](look[key]);
      saveLook();
      refresh();
    });
    input.addEventListener('sync', show);
  }
  $('resetLook').addEventListener('click', () => {
    look = { ...DEFAULT_LOOK };
    saveLook();
    for (const key of ['clean', 'snap', 'pop', 'crisp']) {
      $(key).dispatchEvent(new Event('sync'));
    }
    seg.querySelectorAll('input').forEach((i) => (i.checked = Number(i.value) === look.scale));
    refresh();
    describe();
  });

  $('frame').addEventListener('input', (e) => {
    current = Number(e.target.value);
    refresh();
  });

  const compare = $('compare');
  let pan = null;
  compare.addEventListener('pointerdown', (e) => {
    compare.setPointerCapture(e.pointerId);
    pan = $('zoom').checked ? { x: e.clientX, y: e.clientY, sl: compare.scrollLeft, st: compare.scrollTop } : null;
    moveSplit(e);
  });
  compare.addEventListener('pointermove', (e) => {
    if (pan) {
      compare.scrollLeft = pan.sl - (e.clientX - pan.x);
      compare.scrollTop = pan.st - (e.clientY - pan.y);
      draw();
    } else if (e.buttons) {
      moveSplit(e);
    }
  });
  compare.addEventListener('pointerup', () => (pan = null));
  $('zoom').addEventListener('change', (e) => {
    compare.classList.toggle('zoomed', e.target.checked);
    view.style.width = e.target.checked ? `${view.width / devicePixelRatio}px` : '';
    compare.style.maxHeight = e.target.checked ? '70vh' : '';
    compare.style.overflow = e.target.checked ? 'hidden' : '';
    draw();
  });
  window.addEventListener('resize', draw);

  $('run').addEventListener('click', run);
  $('restore').addEventListener('click', restore);
}

function moveSplit(e) {
  if ($('zoom').checked) {
    return;
  }
  const r = view.getBoundingClientRect();
  split = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  draw();
}

function describe() {
  const scale = look.scale === 2 ? 'twice the size' : 'the same size';
  $('saveInfo').textContent =
    `Writes ${names.length} frames at ${scale} back into ${framesDir}. ` +
    (originalsDir
      ? `The untouched captures are already kept in ${originalsDir}, and each run starts from them.`
      : `Each untouched capture is first copied into ${framesDir}\\original, so you can restore them.`);
  $('restore').hidden = !originalsDir;
}

// ---------- run ----------

async function run() {
  const btn = $('run');
  btn.disabled = true;
  $('runMeter').hidden = false;
  let done = 0;
  let next = 0;
  const started = performance.now();
  const step = async () => {
    while (next < names.length) {
      const name = names[next++];
      const { blob } = await enhanceOn(await loadBitmap(name), true);
      const res = await fetch(`/api/frames/write/${encodeURIComponent(name)}`, { method: 'POST', body: blob });
      if (!res.ok) {
        throw new Error(`Saving ${name} failed (${res.status})`);
      }
      done++;
      $('runBar').style.width = `${(done / names.length) * 100}%`;
      $('runText').textContent = `Enhanced ${done} of ${names.length}`;
    }
  };
  try {
    // The first write backs up every original, so read sources before it.
    await Promise.all(workers.map(step));
    const info = await (await fetch('/api/frames', { cache: 'no-store' })).json();
    originalsDir = info.originals;
    $('runText').textContent = `Done: ${names.length} frames in ${Math.round((performance.now() - started) / 1000)} s. Reload the face swap page to use them.`;
    describe();
  } catch (err) {
    $('runText').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

// ---------- Real-ESRGAN (runs in the local server) ----------

let esrScale = 2;

function bindEsrgan(status) {
  const seg = $('segEsr');
  for (const v of [2, 3, 4]) {
    const lab = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'esr';
    input.value = String(v);
    input.checked = v === esrScale;
    input.addEventListener('change', () => (esrScale = v));
    const span = document.createElement('span');
    span.textContent = `${v}×`;
    lab.append(input, span);
    seg.append(lab);
  }
  $('esrRun').addEventListener('click', runEsrgan);
  if (!status.available) {
    $('esrRun').disabled = true;
    $('esrText').textContent = `Real-ESRGAN isn't installed: expected ${status.exe}.`;
  } else if (status.job?.running) {
    watchEsrgan();
  }
}

async function runEsrgan() {
  $('esrRun').disabled = true;
  $('run').disabled = true;
  const res = await fetch(`/api/realesrgan/run?scale=${esrScale}`, { method: 'POST' });
  if (!res.ok) {
    $('esrText').textContent = await res.text();
    $('esrRun').disabled = false;
    $('run').disabled = false;
    return;
  }
  watchEsrgan();
}

async function watchEsrgan() {
  $('esrRun').disabled = true;
  $('run').disabled = true;
  $('esrMeter').hidden = false;
  for (;;) {
    const { job } = await (await fetch('/api/realesrgan', { cache: 'no-store' })).json();
    const frac = job.total ? job.done / job.total : 0;
    $('esrBar').style.width = `${frac * 100}%`;
    if (job.running) {
      $('esrText').textContent = job.total ? `Upscaling… ${job.done} of ${job.total}` : 'Backing up the originals…';
      await new Promise((r) => setTimeout(r, 700));
      continue;
    }
    const secs = Math.round((job.finished - job.started) / 1000);
    $('esrText').textContent = job.error
      ? job.error
      : `Done: ${job.total} frames at ${job.scale}× in ${secs} s, saved to the frames folder. Reload the face swap page to use them.`;
    break;
  }
  const info = await (await fetch('/api/frames', { cache: 'no-store' })).json();
  originalsDir = info.originals;
  describe();
  $('esrRun').disabled = false;
  $('run').disabled = false;
}

async function restore() {
  const res = await (await fetch('/api/frames/restore', { method: 'POST' })).json();
  $('runText').textContent = `Put back ${res.restored} original frames. The originals stay in the original folder too.`;
}

async function init() {
  const info = await (await fetch('/api/frames', { cache: 'no-store' })).json();
  if (info.error) {
    setStatus(info.error);
    return;
  }
  names = info.frames.map((u) => decodeURIComponent(u.split('/').pop()));
  framesDir = info.dir;
  originalsDir = info.originals;
  $('frame').max = String(names.length - 1);
  bindControls();
  bindEsrgan(await (await fetch('/api/realesrgan', { cache: 'no-store' })).json());
  describe();
  await prepare();
  setStatus(`${names.length} frames · ${framesDir}`);
  await preview();
}

init().catch((e) => setStatus(e.message));
