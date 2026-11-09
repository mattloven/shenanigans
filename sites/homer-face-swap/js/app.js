import { analyzeReference, trackAll, smoothTrack, stabilizeCore, TRACKER_VERSION } from './tracker.js';
import { renderFrame, frameData, alphaBox, headTransform, apply, faceCorners, hedgeCover } from './compositor.js';
import { loadServerFrames, loadFileFrames } from './frames.js';
import { zipBlobs } from './zip.js';

const $ = (id) => document.getElementById(id);
const STORE = 'hedge-face-swap';
const SETTINGS_KEY = 'settings:v2';

const DEFAULTS = {
  fit: { scale: 1.1, offsetX: 0, offsetY: 0, rotation: 0, flip: false },
  look: { brightness: 100, contrast: 100, saturation: 100 },
  occlusion: { enabled: true, sensitivity: 22, softness: 10 },
  erase: true,
  smoothing: 3,
  srcFps: 24,
  output: { fps: 'original', scale: 1, quality: 'high', loop: 'infinite', pngs: true, dest: 'folder' },
  crop: { enabled: false, aspect: 'free', x: 0, y: 0, w: 0, h: 0 },
};

const QUALITY_HINTS = {
  standard: '128 colours a frame, small changes skipped. Smallest file.',
  high: '256 colours a frame, tuned towards the face.',
  maximum: '256 colours, finer tuning, dithered skin tones. Largest file.',
};

const ASPECTS = { free: null, '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9 };

// Working width for tracking and the preview (see useFrames).
const WORK_WIDTH = 960;

// Browser storage is a convenience only; every read and write may throw.
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`${STORE}:${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`${STORE}:${key}`, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
};

function mergeDefaults(saved) {
  const out = structuredClone(DEFAULTS);
  for (const [k, v] of Object.entries(saved ?? {})) {
    if (!(k in out)) {
      continue;
    }
    out[k] = typeof out[k] === 'object' && out[k] !== null ? { ...out[k], ...v } : v;
  }
  return out;
}

const state = {
  frames: [],
  W: 0,
  H: 0,
  srcScale: 1,
  skipped: [],
  source: '',
  signature: '',
  refIndex: 0,
  ref: null,
  rawTrack: null,
  track: null,
  outline: null,
  face: null,
  settings: mergeDefaults(store.get(SETTINGS_KEY, null)),
  nudges: {},
  trim: { start: 0, end: 0, dropped: new Set() },
  faceSelected: false,
  current: 0,
  playing: false,
  playTimer: 0,
  serverFrames: false,
  result: null,
  cancel: false,
  generating: false,
};

const preview = $('preview');
const pctx = preview.getContext('2d');

// ---------- small helpers ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setStatus(text) {
  $('status').textContent = text;
}

function busy(text, fraction) {
  const el = $('busy');
  if (text == null) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  $('busyText').textContent = text;
  $('busyBar').style.width = `${Math.round((fraction ?? 0) * 100)}%`;
}

function saveSettings() {
  store.set(SETTINGS_KEY, state.settings);
  markStale();
}

// Everything that changes what Generate would produce, to tell whether the
// last export still matches the current settings.
function outputKey() {
  const s = state.settings;
  return JSON.stringify({
    plan: buildPlan(),
    size: outputSize(),
    crop: cropRect(),
    fit: s.fit,
    look: s.look,
    occlusion: s.occlusion,
    erase: s.erase,
    smoothing: s.smoothing,
    quality: s.output.quality,
    loop: s.output.loop,
    face: state.face?.name,
    nudges: state.nudges,
  });
}

function markStale() {
  if (state.result && state.frames.length) {
    $('resultStale').hidden = outputKey() === state.result.key;
  }
}

let renderQueued = false;
function requestRender() {
  if (!renderQueued) {
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }
}

const fmtBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

// ---------- frames, reference and tracking ----------

async function useFrames({ frames, source, fps, stamp, skipped = [] }) {
  stopPlayback();
  state.frames = frames;
  // Tracking, hedge tests and the preview run at a fixed working width; the
  // tuned pixel distances assume it. Export draws the source at full size.
  const srcW = frames[0].width;
  const srcH = frames[0].height;
  state.skipped = skipped;
  const fitWork = Math.min(1, WORK_WIDTH / srcW);
  state.W = Math.round(srcW * fitWork);
  state.H = Math.round(srcH * fitWork);
  state.srcScale = srcW / state.W;
  state.source = source;
  state.signature = `${frames.length}:${srcW}x${srcH}:${frames[0].name}:${frames.at(-1).name}`;
  // The stamp changes when the frames on disk are rewritten (enhanced or
  // restored), so a cached track never outlives the pixels it came from.
  state.stamp = stamp ?? '';
  if (fps) {
    state.settings.srcFps = fps;
  }
  preview.width = state.W;
  preview.height = state.H;
  const scrub = $('scrub');
  scrub.max = String(frames.length - 1);
  state.current = Math.min(state.current, frames.length - 1);
  state.nudges = store.get(`nudges:${state.signature}`, {});
  loadTrim();
  buildTrimStrip();
  state.refIndex = store.get(`ref:${state.signature}`, 0);
  if (state.refIndex >= frames.length) {
    state.refIndex = 0;
  }
  const c = state.settings.crop;
  if (c.w <= 0 || c.h <= 0 || c.x + c.w > state.W || c.y + c.h > state.H) {
    Object.assign(c, { x: 0, y: 0, w: state.W, h: state.H });
  }
  state.result = null;
  $('results').hidden = true;
  syncControls();
  await analyzeAndTrack(false);
}

async function analyzeAndTrack(force) {
  const { frames, W, H } = state;
  state.ref = null;
  state.track = null;
  updateGenerate();
  busy('Finding the head…', 0);
  await sleep(20);
  const ref = analyzeReference(frameData(frames[state.refIndex].bitmap, W, H));
  if (!ref) {
    busy(null);
    setStatus(`Couldn't find a yellow head in frame ${state.refIndex + 1}. Pick a frame where Homer is fully visible and use it as the reference.`);
    requestRender();
    return;
  }
  state.ref = ref;
  state.outline = buildOutline(ref);

  const cacheKey = `track:v${TRACKER_VERSION}:${state.signature}:${state.stamp}:${state.refIndex}`;
  const cached = force ? null : store.get(cacheKey, null);
  if (cached?.length === frames.length) {
    state.rawTrack = cached.map(([s, dx, dy, conf, lost]) => ({ s, dx, dy, conf, lost: !!lost }));
  } else {
    const started = performance.now();
    state.rawTrack = await trackAll(
      ref,
      state.refIndex,
      frames.length,
      async (i) => {
        await sleep(0);
        return frameData(frames[i].bitmap, W, H);
      },
      (p) => busy(`Tracking the head… ${Math.round(p * 100)}%`, p),
    );
    console.info(`Tracked ${frames.length} frames in ${Math.round(performance.now() - started)} ms`);
    store.set(cacheKey, state.rawTrack.map((t) => [t.s, t.dx, t.dy, t.conf, t.lost ? 1 : 0]));
  }
  busy('Learning the head shape…', 1);
  await sleep(20);
  state.ref = stabilizeCore(ref, openFrames(ref, state.rawTrack));
  applySmoothing();
  busy(null);
  describeTrack();
  updateGenerate();
  requestRender();
}

// Frames where Homer is still out in the open (hedge over under a tenth of
// his outline), produced one at a time.
function* openFrames(ref, raw) {
  const { frames, W, H } = state;
  for (let i = 0; i < frames.length; i++) {
    if (raw[i].lost) {
      continue;
    }
    const img = frameData(frames[i].bitmap, W, H);
    const head = headTransform(ref, raw[i], null);
    if (hedgeCover(ref, head, img, DEFAULTS.occlusion) < 0.1) {
      yield { img, head };
    }
  }
}

function applySmoothing() {
  state.track = state.rawTrack ? smoothTrack(state.rawTrack, state.settings.smoothing) : null;
  drawStrip();
}

function describeTrack() {
  const t = state.rawTrack;
  if (!t) {
    return;
  }
  const lost = t.findIndex((f, i) => i > state.refIndex && f.lost);
  const partial = t.filter((f) => !f.lost && f.conf < 0.6).length;
  $('trackInfo').textContent =
    `Reference: frame ${state.refIndex + 1}. ` +
    (lost >= 0 ? `Head followed to frame ${lost}; after that it's gone into the hedge. ` : 'Head followed in every frame. ') +
    (partial ? `${partial} frames partly hidden.` : '');
  const { width: sw, height: sh } = state.frames[0];
  const skipped = state.skipped.length
    ? ` · skipped ${state.skipped.length} unreadable: ${state.skipped.slice(0, 4).join(', ')}${state.skipped.length > 4 ? '…' : ''}`
    : '';
  setStatus(`${state.frames.length} frames · ${sw}×${sh} · ${state.source}${skipped}`);
}

// Silhouette outline in reference coordinates, for the tracking overlay.
function buildOutline(ref) {
  const { box, sil } = ref;
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const c = new OffscreenCanvas(bw, bh);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(bw, bh);
  for (let y = 1; y < bh - 1; y++) {
    for (let x = 1; x < bw - 1; x++) {
      const p = y * bw + x;
      if (sil[p] && (!sil[p - 1] || !sil[p + 1] || !sil[p - bw] || !sil[p + bw])) {
        img.data.set([255, 64, 220, 255], p * 4);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Keyframed corrections: linear between keys, held beyond the ends.
function nudgeAt(i) {
  const keys = Object.keys(state.nudges).map(Number).sort((a, b) => a - b);
  if (!keys.length) {
    return null;
  }
  if (i <= keys[0]) {
    return state.nudges[keys[0]];
  }
  if (i >= keys.at(-1)) {
    return state.nudges[keys.at(-1)];
  }
  const hi = keys.findIndex((k) => k >= i);
  const a = keys[hi - 1];
  const b = keys[hi];
  const t = (i - a) / (b - a);
  const na = state.nudges[a];
  const nb = state.nudges[b];
  return { dx: na.dx + (nb.dx - na.dx) * t, dy: na.dy + (nb.dy - na.dy) * t, ds: na.ds + (nb.ds - na.ds) * t };
}

// ---------- face ----------

async function useFace(blob, name, persist = true) {
  const bitmap = await createImageBitmap(blob);
  const { box, transparent } = alphaBox(bitmap);
  state.face = { bitmap, box, transparent, name };
  const url = URL.createObjectURL(blob);
  $('faceThumb').innerHTML = '';
  const img = new Image();
  img.src = url;
  img.alt = 'Face';
  $('faceThumb').append(img);
  $('faceName').textContent = `${name} · ${bitmap.width}×${bitmap.height}`;
  $('faceWarn').hidden = transparent;
  if (persist) {
    const reader = new FileReader();
    reader.onload = () => {
      if (!store.set('face', { name, data: reader.result })) {
        store.set('face', null);
      }
    };
    reader.readAsDataURL(blob);
  }
  updateGenerate();
  markStale();
  requestRender();
}

async function restoreFace() {
  const saved = store.get('face', null);
  if (saved?.data) {
    try {
      await useFace(await (await fetch(saved.data)).blob(), saved.name, false);
      return;
    } catch {
      // fall through to the sample
    }
  }
  try {
    const res = await fetch('samples/sample-face.png');
    if (res.ok) {
      await useFace(await res.blob(), 'sample-face.png', false);
    }
  } catch {
    // no sample shipped; wait for the user to pick one
  }
}

// ---------- preview ----------

function render() {
  const { frames, W, H, current } = state;
  if (!frames.length) {
    return;
  }
  const s = state.settings;
  const info = renderFrame(pctx, {
    bitmap: frames[current].bitmap,
    W,
    H,
    k: 1,
    ref: state.ref,
    track: state.track?.[current],
    nudge: nudgeAt(current),
    face: state.face,
    fit: s.fit,
    look: s.look,
    occlusion: s.occlusion,
    erase: s.erase,
    showFace: !$('showOriginal').checked,
  });
  if ($('showOverlay').checked && state.ref && state.track) {
    drawOverlay(info);
  }
  if (s.crop.enabled) {
    drawCrop();
  }
  if (state.faceSelected) {
    drawFaceBox();
  }
  const kept = keptFrames();
  const note = kept.includes(current) ? '' : state.trim.dropped.has(current) ? ' · dropped' : ' · trimmed';
  $('frameLabel').textContent = `${current + 1} / ${frames.length}${note}`;
  $('scrub').value = String(current);
  syncNudgeInputs();
  markTrimCurrent();
}

// ---------- face box (free transform) ----------

// The face's corners on the preview plus its centre and the rotate knob.
function faceGeometry() {
  const { ref, track, face, current } = state;
  if (!ref || !track || !face || $('showOriginal').checked) {
    return null;
  }
  const corners = faceCorners(ref, track[current], nudgeAt(current), face, state.settings.fit);
  const cx = corners.reduce((a, c) => a + c[0], 0) / 4;
  const cy = corners.reduce((a, c) => a + c[1], 0) / 4;
  // Knob sits beyond the middle of the top edge, along the face's "up".
  const tx = (corners[0][0] + corners[1][0]) / 2;
  const ty = (corners[0][1] + corners[1][1]) / 2;
  const len = Math.hypot(tx - cx, ty - cy) || 1;
  const reach = 28 * (state.W / preview.getBoundingClientRect().width);
  return { corners, cx, cy, knob: [tx + ((tx - cx) / len) * reach, ty + ((ty - cy) / len) * reach], top: [tx, ty] };
}

function drawFaceBox() {
  const g = faceGeometry();
  if (!g) {
    return;
  }
  const hs = handleSize();
  pctx.save();
  pctx.strokeStyle = '#ffd60a';
  pctx.lineWidth = Math.max(1.5, hs / 6);
  pctx.beginPath();
  g.corners.forEach(([x, y], i) => (i ? pctx.lineTo(x, y) : pctx.moveTo(x, y)));
  pctx.closePath();
  pctx.stroke();
  pctx.beginPath();
  pctx.moveTo(...g.top);
  pctx.lineTo(...g.knob);
  pctx.stroke();
  pctx.fillStyle = '#ffd60a';
  for (const [x, y] of g.corners) {
    pctx.fillRect(x - hs / 2, y - hs / 2, hs, hs);
  }
  pctx.beginPath();
  pctx.arc(g.knob[0], g.knob[1], hs * 0.6, 0, Math.PI * 2);
  pctx.fill();
  pctx.restore();
}

function insideQuad(p, q) {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const [xi, yi] = q[i];
    const [xj, yj] = q[j];
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// What a pointer at p would grab on the face: 'rotate', 'scale', 'move' or null.
function faceHit(p) {
  const g = faceGeometry();
  if (!g) {
    return null;
  }
  const tol = handleSize();
  if (state.faceSelected) {
    if (Math.hypot(p.x - g.knob[0], p.y - g.knob[1]) <= tol) {
      return 'rotate';
    }
    if (g.corners.some(([x, y]) => Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol)) {
      return 'scale';
    }
  }
  return insideQuad(p, g.corners) ? 'move' : null;
}

function dragFace(p, e) {
  const fit = state.settings.fit;
  const { mode, start, orig, g, s } = drag;
  const h = state.ref.anchor.h;
  if (mode === 'move') {
    // Frame pixels -> reference pixels -> fractions of Homer's face height.
    fit.offsetX = orig.offsetX + (p.x - start.x) / (s * h);
    fit.offsetY = orig.offsetY + (p.y - start.y) / (s * h);
  } else if (mode === 'scale') {
    const from = Math.hypot(start.x - g.cx, start.y - g.cy) || 1;
    fit.scale = Math.min(4, Math.max(0.2, (orig.scale * Math.hypot(p.x - g.cx, p.y - g.cy)) / from));
  } else if (mode === 'rotate') {
    const turn = Math.atan2(p.y - g.cy, p.x - g.cx) - Math.atan2(start.y - g.cy, start.x - g.cx);
    let deg = orig.rotation + (turn * 180) / Math.PI;
    deg = ((((deg + 180) % 360) + 360) % 360) - 180;
    fit.rotation = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg * 2) / 2;
  }
  syncers.forEach((f) => f());
  requestRender();
}

function drawOverlay() {
  const { ref, current } = state;
  const t = state.track[current];
  const m = headTransform(ref, t, nudgeAt(current));
  pctx.save();
  pctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  pctx.globalAlpha = 0.9;
  pctx.drawImage(state.outline, ref.box.x0, ref.box.y0);
  pctx.restore();
  const a = ref.anchor;
  const [x0, y0] = apply(m, a.cx - a.w / 2, a.cy - a.h / 2);
  const [x1, y1] = apply(m, a.cx + a.w / 2, a.cy + a.h / 2);
  pctx.save();
  pctx.strokeStyle = 'rgba(80, 220, 255, 0.9)';
  pctx.setLineDash([6, 4]);
  pctx.lineWidth = 1.5;
  pctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  pctx.setLineDash([]);
  pctx.font = '600 14px system-ui, sans-serif';
  const label = t.lost
    ? 'head hidden: holding last position'
    : `visible ${Math.round(t.conf * 100)}% · scale ${t.s.toFixed(3)} · shift ${t.dx.toFixed(1)}, ${t.dy.toFixed(1)}`;
  const tw = pctx.measureText(label).width;
  pctx.fillStyle = 'rgba(0,0,0,0.65)';
  pctx.fillRect(x0, Math.max(0, y0 - 24), tw + 12, 22);
  pctx.fillStyle = t.lost ? '#ffb547' : '#9ff';
  pctx.fillText(label, x0 + 6, Math.max(16, y0 - 8));
  pctx.restore();
}

function drawCrop() {
  const c = cropRect();
  const { W, H } = state;
  pctx.save();
  pctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  pctx.beginPath();
  pctx.rect(0, 0, W, H);
  pctx.rect(c.x, c.y, c.w, c.h);
  pctx.fill('evenodd');
  pctx.strokeStyle = '#ffd60a';
  pctx.lineWidth = 2;
  pctx.strokeRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2);
  const hs = handleSize();
  pctx.fillStyle = '#ffd60a';
  for (const [hx, hy] of [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]]) {
    pctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
  }
  pctx.restore();
}

function drawStrip() {
  const strip = $('strip');
  const w = Math.max(1, Math.round(strip.clientWidth * devicePixelRatio));
  strip.width = w;
  strip.height = 8 * devicePixelRatio;
  const ctx = strip.getContext('2d');
  ctx.clearRect(0, 0, w, strip.height);
  const t = state.rawTrack;
  if (!t) {
    return;
  }
  const n = t.length;
  for (let i = 0; i < n; i++) {
    const x0 = Math.floor((i / n) * w);
    const x1 = Math.ceil(((i + 1) / n) * w);
    ctx.fillStyle = t[i].lost ? '#3a3d44' : t[i].conf < 0.6 ? '#3fa34d' : '#ffd60a';
    ctx.globalAlpha = t[i].lost ? 1 : 0.35 + 0.65 * Math.min(1, t[i].conf / 0.6);
    ctx.fillRect(x0, 3 * devicePixelRatio, x1 - x0, 5 * devicePixelRatio);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff';
  for (const k of Object.keys(state.nudges).map(Number)) {
    const x = ((k + 0.5) / n) * w;
    ctx.fillRect(x - devicePixelRatio, 0, 2 * devicePixelRatio, 8 * devicePixelRatio);
  }
}

// ---------- playback ----------

// Source frames that make it into the output: inside the trim, not dropped.
function keptFrames() {
  const { start, end, dropped } = state.trim;
  const kept = [];
  for (let i = start; i <= end && i < state.frames.length; i++) {
    if (!dropped.has(i)) {
      kept.push(i);
    }
  }
  return kept;
}

function buildPlan() {
  const kept = keptFrames();
  const n = kept.length;
  if (!n) {
    return [];
  }
  const src = Math.max(1, Number(state.settings.srcFps) || 24);
  const o = state.settings.output;
  const fps = o.fps === 'original' ? src : Number(o.fps);
  const count = Math.max(1, Math.round((n * fps) / src));
  const plan = [];
  for (let i = 0; i < count; i++) {
    plan.push({
      index: kept[Math.min(n - 1, Math.floor((i * src) / fps + 1e-6))],
      // Centiseconds, with rounding error carried so the total stays true.
      delay: Math.round(((i + 1) * 100) / fps) - Math.round((i * 100) / fps),
    });
  }
  return plan;
}

function startPlayback() {
  if (!state.frames.length) {
    return;
  }
  const plan = buildPlan();
  if (!plan.length) {
    return;
  }
  let pos = plan.findIndex((p) => p.index >= state.current);
  if (pos < 0 || pos >= plan.length - 1) {
    pos = 0;
  }
  state.playing = true;
  $('play').classList.add('playing');
  const step = () => {
    if (!state.playing) {
      return;
    }
    state.current = plan[pos].index;
    render();
    const delay = plan[pos].delay * 10;
    pos = (pos + 1) % plan.length;
    state.playTimer = setTimeout(step, delay);
  };
  step();
}

function stopPlayback() {
  state.playing = false;
  clearTimeout(state.playTimer);
  $('play').classList.remove('playing');
}

function goTo(i) {
  stopPlayback();
  state.current = Math.max(0, Math.min(state.frames.length - 1, i));
  requestRender();
}

// ---------- crop ----------

function cropRect() {
  const { W, H } = state;
  const c = state.settings.crop;
  if (!c.enabled) {
    return { x: 0, y: 0, w: W, h: H };
  }
  const x = Math.max(0, Math.min(W - 16, Math.round(c.x)));
  const y = Math.max(0, Math.min(H - 16, Math.round(c.y)));
  return { x, y, w: Math.max(16, Math.min(W - x, Math.round(c.w))), h: Math.max(16, Math.min(H - y, Math.round(c.h))) };
}

function setCrop(r) {
  const { W, H } = state;
  const c = state.settings.crop;
  c.w = Math.max(16, Math.min(W, r.w));
  c.h = Math.max(16, Math.min(H, r.h));
  c.x = Math.max(0, Math.min(W - c.w, r.x));
  c.y = Math.max(0, Math.min(H - c.h, r.y));
  syncCropInputs();
  updateSummary();
  saveSettings();
  requestRender();
}

// Fits rect r to the chosen aspect around its centre, inside the frame.
function constrainAspect(r) {
  const ratio = ASPECTS[state.settings.crop.aspect];
  if (!ratio) {
    return r;
  }
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  let w = r.w;
  let h = w / ratio;
  if (h > state.H) {
    h = state.H;
    w = h * ratio;
  }
  if (w > state.W) {
    w = state.W;
    h = w / ratio;
  }
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function handleSize() {
  return Math.max(8, (12 * state.W) / preview.getBoundingClientRect().width);
}

function toSource(e) {
  const r = preview.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * state.W, y: ((e.clientY - r.top) / r.height) * state.H };
}

let drag = null;

function cropHit(p) {
  const c = cropRect();
  const tol = handleSize();
  const corners = { nw: [c.x, c.y], ne: [c.x + c.w, c.y], sw: [c.x, c.y + c.h], se: [c.x + c.w, c.y + c.h] };
  for (const [name, [hx, hy]] of Object.entries(corners)) {
    if (Math.abs(p.x - hx) <= tol && Math.abs(p.y - hy) <= tol) {
      return name;
    }
  }
  if (p.x > c.x && p.x < c.x + c.w && p.y > c.y && p.y < c.y + c.h) {
    return 'move';
  }
  return 'new';
}

// The face wins over the crop: clicking the face selects it for moving,
// resizing (corners) and rotating (round knob); clicking elsewhere lets go.
function onPointerDown(e) {
  if (!state.frames.length) {
    return;
  }
  const p = toSource(e);
  const faceMode = faceHit(p);
  if (faceMode) {
    stopPlayback();
    state.faceSelected = true;
    drag = { mode: faceMode, face: true, start: p, orig: { ...state.settings.fit }, g: faceGeometry(), s: headTransform(state.ref, state.track[state.current], nudgeAt(state.current))[0] };
    preview.setPointerCapture(e.pointerId);
    e.preventDefault();
    requestRender();
    return;
  }
  if (state.faceSelected) {
    state.faceSelected = false;
    requestRender();
  }
  if (!state.settings.crop.enabled) {
    return;
  }
  const c = cropRect();
  const mode = cropHit(p);
  const opposite = { nw: [c.x + c.w, c.y + c.h], ne: [c.x, c.y + c.h], sw: [c.x + c.w, c.y], se: [c.x, c.y] };
  drag = { mode, start: p, orig: c, anchor: mode === 'new' ? [p.x, p.y] : opposite[mode] };
  preview.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onPointerMove(e) {
  if (!state.frames.length) {
    return;
  }
  const p = toSource(e);
  if (drag?.face) {
    dragFace(p, e);
    return;
  }
  if (!drag) {
    const faceMode = faceHit(p);
    if (faceMode) {
      preview.style.cursor = { rotate: 'grab', scale: 'nwse-resize', move: 'move' }[faceMode];
      return;
    }
    if (!state.settings.crop.enabled) {
      preview.style.cursor = '';
      return;
    }
    const hit = cropHit(p);
    preview.style.cursor = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', move: 'move' }[hit] ?? 'crosshair';
    return;
  }
  if (drag.mode === 'move') {
    setCrop({ ...drag.orig, x: drag.orig.x + p.x - drag.start.x, y: drag.orig.y + p.y - drag.start.y });
    return;
  }
  const [ax, ay] = drag.anchor;
  const px = Math.max(0, Math.min(state.W, p.x));
  const py = Math.max(0, Math.min(state.H, p.y));
  let w = Math.abs(px - ax);
  let h = Math.abs(py - ay);
  const ratio = ASPECTS[state.settings.crop.aspect];
  if (ratio) {
    if (w / h > ratio) {
      h = w / ratio;
    } else {
      w = h * ratio;
    }
  }
  setCrop({ x: px < ax ? ax - w : ax, y: py < ay ? ay - h : ay, w, h });
}

function onPointerUp() {
  if (drag?.face) {
    saveSettings();
  }
  drag = null;
}

// ---------- trim ----------

function loadTrim() {
  const n = state.frames.length;
  const saved = store.get(`trim:${state.signature}`, null);
  const start = Math.max(0, Math.min(n - 1, saved?.start ?? 0));
  state.trim = {
    start,
    end: Math.max(start, Math.min(n - 1, saved?.end ?? n - 1)),
    dropped: new Set((saved?.dropped ?? []).filter((i) => i >= 0 && i < n)),
  };
}

function saveTrim() {
  const { start, end, dropped } = state.trim;
  store.set(`trim:${state.signature}`, { start, end, dropped: [...dropped] });
  paintTrim();
  updateSummary();
  requestRender();
}

function setTrim(which, i) {
  const t = state.trim;
  if (which === 'start') {
    t.start = Math.max(0, Math.min(i, t.end));
  } else {
    t.end = Math.min(state.frames.length - 1, Math.max(i, t.start));
  }
  saveTrim();
}

function toggleDrop(i) {
  const { dropped } = state.trim;
  if (dropped.has(i)) {
    dropped.delete(i);
  } else {
    dropped.add(i);
  }
  saveTrim();
}

function buildTrimStrip() {
  const strip = $('trimFrames');
  strip.innerHTML = '';
  const { frames, W, H } = state;
  const th = 54;
  const tw = Math.round((th * W) / H);
  frames.forEach((f, i) => {
    const cell = document.createElement('div');
    cell.className = 'tf';
    cell.dataset.i = String(i);
    const c = document.createElement('canvas');
    c.width = tw;
    c.height = th;
    c.getContext('2d').drawImage(f.bitmap, 0, 0, tw, th);
    const num = document.createElement('span');
    num.className = 'tf-num';
    num.textContent = String(i + 1);
    const drop = document.createElement('button');
    drop.className = 'tf-drop';
    drop.type = 'button';
    drop.title = 'Drop or keep this frame (X)';
    drop.setAttribute('aria-label', `Drop or keep frame ${i + 1}`);
    drop.textContent = '×';
    cell.append(c, num, drop);
    strip.append(cell);
  });
  paintTrim();
}

function paintTrim() {
  const { start, end, dropped } = state.trim;
  const cells = $('trimFrames').children;
  for (let i = 0; i < cells.length; i++) {
    cells[i].classList.toggle('out', i < start || i > end);
    cells[i].classList.toggle('dropped', dropped.has(i));
  }
  const kept = keptFrames().length;
  $('trimInfo').textContent =
    `Frames ${start + 1}–${end + 1} · ${kept} kept` + (dropped.size ? ` · ${[...dropped].filter((i) => i >= start && i <= end).length} dropped` : '');
  placeTrimHandles();
}

function placeTrimHandles() {
  const cells = $('trimFrames').children;
  if (!cells.length) {
    return;
  }
  const first = cells[state.trim.start];
  const last = cells[state.trim.end];
  $('trimStart').style.left = `${first.offsetLeft - 2}px`;
  $('trimEnd').style.left = `${last.offsetLeft + last.offsetWidth - 8}px`;
}

let lastMarked = -1;
function markTrimCurrent() {
  const cells = $('trimFrames').children;
  if (lastMarked >= 0 && cells[lastMarked]) {
    cells[lastMarked].classList.remove('current');
  }
  const cell = cells[state.current];
  if (!cell) {
    return;
  }
  cell.classList.add('current');
  lastMarked = state.current;
  // Keep the current frame in view while playing or stepping.
  const box = $('trimScroll');
  if (cell.offsetLeft < box.scrollLeft || cell.offsetLeft + cell.offsetWidth > box.scrollLeft + box.clientWidth) {
    box.scrollLeft = cell.offsetLeft - box.clientWidth / 2;
  }
}

// Frame index under a pointer, from its position along the strip.
function trimIndexAt(clientX) {
  const cells = $('trimFrames').children;
  const box = $('trimScroll').getBoundingClientRect();
  const x = clientX - box.left + $('trimScroll').scrollLeft;
  for (let i = 0; i < cells.length; i++) {
    if (x < cells[i].offsetLeft + cells[i].offsetWidth) {
      return i;
    }
  }
  return cells.length - 1;
}

function bindTrim() {
  $('trimFrames').addEventListener('click', (e) => {
    const cell = e.target.closest('.tf');
    if (!cell) {
      return;
    }
    const i = Number(cell.dataset.i);
    if (e.target.closest('.tf-drop')) {
      toggleDrop(i);
    } else {
      goTo(i);
    }
  });
  for (const which of ['start', 'end']) {
    const handle = $(which === 'start' ? 'trimStart' : 'trimEnd');
    handle.addEventListener('pointerdown', (e) => {
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
      const move = (ev) => {
        const i = trimIndexAt(ev.clientX);
        setTrim(which, i);
        goTo(i);
        // Nudge the strip along when dragging past its edges.
        const box = $('trimScroll');
        const r = box.getBoundingClientRect();
        if (ev.clientX > r.right - 30) {
          box.scrollLeft += 20;
        } else if (ev.clientX < r.left + 30) {
          box.scrollLeft -= 20;
        }
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }
  // A vertical wheel scrolls the strip sideways.
  $('trimScroll').addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        $('trimScroll').scrollLeft += e.deltaY;
        e.preventDefault();
      }
    },
    { passive: false },
  );
  $('trimSetStart').addEventListener('click', () => setTrim('start', state.current));
  $('trimSetEnd').addEventListener('click', () => setTrim('end', state.current));
  $('trimDrop').addEventListener('click', () => toggleDrop(state.current));
  $('trimReset').addEventListener('click', () => {
    state.trim = { start: 0, end: state.frames.length - 1, dropped: new Set() };
    saveTrim();
  });
}

function cropToHead() {
  const { ref, track } = state;
  if (!ref || !track) {
    return;
  }
  const a = ref.anchor;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  track.forEach((t, i) => {
    if (t.lost) {
      return;
    }
    const m = headTransform(ref, t, nudgeAt(i));
    const [ax, ay] = apply(m, a.cx - a.w * 0.75, a.cy - a.h * 0.7);
    const [bx, by] = apply(m, a.cx + a.w * 0.75, a.cy + a.h * 0.75);
    x0 = Math.min(x0, ax);
    y0 = Math.min(y0, ay);
    x1 = Math.max(x1, bx);
    y1 = Math.max(y1, by);
  });
  state.settings.crop.enabled = true;
  setCrop(constrainAspect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }));
  syncControls();
}

// ---------- generate ----------

function outputSize() {
  const c = cropRect();
  const k = state.settings.output.scale * state.srcScale;
  return { w: Math.round(c.w * k), h: Math.round(c.h * k) };
}

function updateSummary() {
  if (!state.frames.length) {
    $('outSummary').textContent = '';
    return;
  }
  const plan = buildPlan();
  const { w, h } = outputSize();
  const seconds = plan.reduce((a, p) => a + p.delay, 0) / 100;
  $('outSummary').textContent = `${w} × ${h} px · ${plan.length} frames · ${seconds.toFixed(2)} s`;
  // Past roughly 4K a frame, GIFs get slow to make, enormous, and many
  // viewers won't open them.
  const huge = w * h > 12e6;
  $('outWarn').hidden = !huge;
  $('outWarn').textContent = huge
    ? `Very large: each frame is ${w} × ${h} (${Math.round((w * h) / 1e6)} megapixels). Expect a long run and a GIF of hundreds of MB that many apps won't open. Original resolution, a crop, or a smaller Real-ESRGAN upscale keeps it manageable.`
    : '';
  markStale();
}

function describeDest() {
  const dest = state.settings.output.dest;
  $('destFolderRow').hidden = dest !== 'folder';
  $('destHint').textContent = {
    folder: 'The GIF and the frames ZIP go straight into this folder. The browser asks for permission the first time.',
    downloads: 'Saved like any download; the browser may ask where, depending on its settings.',
    app: 'Into homer-face-swap\\output\\run-<date-time>\\ next to the app.',
  }[dest];
}

function updateGenerate() {
  $('generate').disabled = !(state.frames.length && state.ref && state.track && state.face && keptFrames().length) || state.generating;
}

function progress(text, fraction) {
  $('progressText').textContent = text;
  $('progressBar').style.width = `${Math.round(fraction * 100)}%`;
}

function runName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `run-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function saveToServer(run, sub, name, blob) {
  const path = ['api', 'save', run, ...(sub ? [sub] : []), name].join('/');
  const res = await fetch(`/${path}`, { method: 'POST', body: blob });
  if (!res.ok) {
    throw new Error(`Saving ${name} failed (${res.status})`);
  }
  return (await res.json()).path;
}

// A couple of PNG encoders working side by side with the GIF encoder.
function pngPool(size) {
  const workers = Array.from({ length: size }, () => new Worker(new URL('./png-worker.js', import.meta.url), { type: 'module' }));
  const pending = new Map();
  let nextId = 0;
  for (const w of workers) {
    w.onmessage = (e) => {
      const { id, blob, error } = e.data;
      const p = pending.get(id);
      pending.delete(id);
      if (error) {
        p.reject(new Error(error));
      } else {
        p.resolve(blob);
      }
    };
  }
  return {
    get busy() {
      return pending.size;
    },
    encode(rgba, width, height) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        workers[id % size].postMessage({ id, rgba: rgba.buffer, width, height }, [rgba.buffer]);
      });
    },
    close() {
      workers.forEach((w) => w.terminate());
    },
  };
}

// Face-layer pixels in output coordinates, so the encoder spends colours there.
function faceMask(info, crop, k, w, h) {
  const mask = new Uint8Array(w * h);
  const ox = info.x - Math.round(crop.x * k);
  const oy = info.y - Math.round(crop.y * k);
  for (let j = 0; j < info.h; j++) {
    const y = j + oy;
    if (y < 0 || y >= h) {
      continue;
    }
    for (let i = 0; i < info.w; i++) {
      const x = i + ox;
      if (x >= 0 && x < w && info.alpha[(j * info.w + i) * 4 + 3] > 64) {
        mask[y * w + x] = 1;
      }
    }
  }
  return mask;
}

async function generate() {
  if ($('generate').disabled) {
    return;
  }
  stopPlayback();
  const s = state.settings;
  const o = s.output;
  const plan = buildPlan();
  const k = o.scale * state.srcScale;
  const crop = cropRect();
  const { w: outW, h: outH } = outputSize();
  const { W, H, frames } = state;
  const run = runName();
  const key = outputKey();
  // Ask for the folder now, while the click still counts as the user's say-so.
  let dir = null;
  if (o.dest === 'folder') {
    dir = await outputFolder(false);
    if (!dir) {
      setStatus('Pick a folder to save into, or choose Downloads or the app folder under Output.');
      return;
    }
  }

  state.generating = true;
  state.cancel = false;
  updateGenerate();
  $('progress').hidden = false;
  progress('Starting…', 0);

  const worker = new Worker(new URL('./gif-worker.js', import.meta.url));
  let encoded = 0;
  const finished = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') {
        encoded++;
      } else if (m.type === 'done') {
        resolve(m);
      } else if (m.type === 'error') {
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => reject(new Error(e.message || 'GIF encoder failed'));
  });
  finished.catch(() => {});
  worker.postMessage({ type: 'start', width: outW, height: outH, loop: o.loop === 'infinite', quality: o.quality });

  const work = new OffscreenCanvas(W * k, H * k);
  const wctx = work.getContext('2d');
  const out = new OffscreenCanvas(outW, outH);
  const octx = out.getContext('2d', { willReadFrequently: true });
  const pool = o.pngs ? pngPool(2) : null;
  const pngs = [];
  const saves = [];
  let open = null;

  try {
    for (let i = 0; i < plan.length; i++) {
      if (state.cancel) {
        throw new Error('cancelled');
      }
      // Don't let rendering run far ahead of the encoders; frames are big.
      while (i - encoded > 3 || (pool && pool.busy > 4)) {
        await sleep(8);
      }
      const { index, delay } = plan[i];
      // Full-size frames are decoded one at a time; a lower frame rate or a
      // held frame reuses the one already open.
      if (open?.index !== index) {
        open?.bitmap.close();
        open = { index, bitmap: await frames[index].full() };
      }
      const info = renderFrame(wctx, {
        bitmap: open.bitmap,
        W,
        H,
        k,
        ref: state.ref,
        track: state.track[index],
        nudge: nudgeAt(index),
        face: state.face,
        fit: s.fit,
        look: s.look,
        occlusion: s.occlusion,
        erase: s.erase,
      });
      octx.clearRect(0, 0, outW, outH);
      octx.drawImage(work, Math.round(crop.x * k), Math.round(crop.y * k), outW, outH, 0, 0, outW, outH);
      const img = octx.getImageData(0, 0, outW, outH);
      const mask = info ? faceMask(info, crop, k, outW, outH) : null;
      if (pool) {
        const name = `frame_${String(i + 1).padStart(4, '0')}.png`;
        const encodedPng = pool.encode(img.data.slice(), outW, outH).then((blob) => {
          pngs.push({ name, blob });
        });
        encodedPng.catch(() => {});
        saves.push(encodedPng);
      }
      const transfer = mask ? [img.data.buffer, mask.buffer] : [img.data.buffer];
      worker.postMessage({ type: 'frame', index: i, rgba: img.data.buffer, delay, mask: mask?.buffer }, transfer);
      progress(`Rendering frame ${i + 1} of ${plan.length}`, ((i + 1) / plan.length) * 0.9);
      await sleep(0);
    }
    progress('Finishing the GIF…', 0.92);
    while (encoded < plan.length) {
      if (state.cancel) {
        throw new Error('cancelled');
      }
      progress(`Encoding frame ${encoded + 1} of ${plan.length}`, 0.9 + (encoded / plan.length) * 0.08);
      await sleep(30);
    }
    worker.postMessage({ type: 'finish' });
    const { blob: gif } = await finished;
    progress('Finishing the PNG frames…', 0.98);
    await Promise.all(saves);
    pngs.sort((a, b) => a.name.localeCompare(b.name));
    const base = `face-swap-${run.slice(4)}`;
    const files = [{ name: `${base}.gif`, blob: gif }];
    let zip = null;
    if (pngs.length) {
      zip = await zipBlobs(pngs, (p) => progress(`Zipping the frames… ${Math.round(p * 100)}%`, 0.98));
      files.push({ name: `${base}-frames.zip`, blob: zip });
    }
    const saved = await saveFiles(files, o.dest, dir, run);
    showResults({ gif, zip, pngs, run, key, saved, plan, outW, outH });
  } catch (err) {
    if (err.message !== 'cancelled') {
      console.error(err);
      setStatus(`Generate failed: ${err.message}`);
    }
  } finally {
    open?.bitmap.close();
    worker.terminate();
    pool?.close();
    state.generating = false;
    $('progress').hidden = true;
    updateGenerate();
  }
}

// ---------- saving ----------

// A folder picked once is remembered (IndexedDB holds the handle) and only
// needs the browser's permission again after a restart.
const idb = (mode, fn) =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open(STORE, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
const folderPicking = 'showDirectoryPicker' in window;

async function outputFolder(choose) {
  if (!folderPicking) {
    return null;
  }
  let dir = choose ? null : await idb('readonly', (kv) => kv.get('outputFolder')).catch(() => null);
  if (dir) {
    const opts = { mode: 'readwrite' };
    if ((await dir.queryPermission(opts)) !== 'granted' && (await dir.requestPermission(opts).catch(() => 'denied')) !== 'granted') {
      dir = null;
    }
  }
  if (!dir) {
    try {
      dir = await window.showDirectoryPicker({ id: 'face-swap-output', mode: 'readwrite', startIn: 'downloads' });
    } catch {
      return null; // closed without choosing
    }
    await idb('readwrite', (kv) => kv.put(dir, 'outputFolder')).catch(() => {});
  }
  $('destFolderName').textContent = dir.name;
  return dir;
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 120000);
}

// Writes each file to the chosen place; returns a line saying where they went.
async function saveFiles(files, dest, dir, run) {
  const total = files.reduce((a, f) => a + f.blob.size, 0);
  progress(`Saving ${fmtBytes(total)}…`, 0.99);
  if (dest === 'folder') {
    for (const f of files) {
      try {
        const handle = await dir.getFileHandle(f.name, { create: true });
        const w = await handle.createWritable();
        await w.write(f.blob);
        await w.close();
      } catch (err) {
        throw new Error(`Couldn't write ${f.name} (${fmtBytes(f.blob.size)}) to ${dir.name}: ${err.message}`);
      }
    }
    return `Saved ${files.map((f) => f.name).join(' and ')} in the "${dir.name}" folder.`;
  }
  if (dest === 'app') {
    let path = '';
    for (const f of files) {
      const res = await fetch(`/api/save/${run}/${f.name}`, { method: 'POST', body: f.blob }).catch((err) => {
        throw new Error(`Couldn't send ${f.name} (${fmtBytes(f.blob.size)}) to the app folder: ${err.message}`);
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      path = (await res.json()).path;
    }
    return `Saved to ${path.replace(/[\\/][^\\/]+$/, '')}`;
  }
  files.forEach((f) => download(f.name, f.blob));
  return `Downloaded ${files.map((f) => f.name).join(' and ')}.`;
}

function showResults({ gif, zip, pngs, run, key, saved, plan, outW, outH }) {
  if (state.result) {
    URL.revokeObjectURL(state.result.gifUrl);
    state.result.thumbs.forEach((u) => URL.revokeObjectURL(u));
  }
  const gifUrl = URL.createObjectURL(gif);
  const seconds = plan.reduce((a, p) => a + p.delay, 0) / 100;
  $('resultGif').src = gifUrl;
  $('downloadGif').href = gifUrl;
  $('downloadGif').download = `face-swap-${run.slice(4)}.gif`;
  const made = `${run.slice(13, 15)}:${run.slice(15, 17)}`;
  $('resultMeta').textContent = `Made at ${made} · ${outW} × ${outH} · ${plan.length} frames · ${seconds.toFixed(2)} s · ${fmtBytes(gif.size)}`;
  $('resultStale').hidden = true;
  $('downloadZip').hidden = !pngs.length;
  $('savedTo').textContent = saved;
  const strip = $('filmstrip');
  strip.innerHTML = '';
  const thumbs = [];
  for (const p of pngs) {
    const url = URL.createObjectURL(p.blob);
    thumbs.push(url);
    const fig = document.createElement('figure');
    const img = new Image();
    img.loading = 'lazy';
    img.src = url;
    img.alt = p.name;
    const cap = document.createElement('figcaption');
    cap.textContent = p.name.replace(/\D/g, '').replace(/^0+/, '');
    fig.append(img, cap);
    strip.append(fig);
  }
  state.result = { gif, zip, gifUrl, pngs, run, thumbs, key };
  $('results').hidden = false;
  $('results').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setStatus(`Generated ${plan.length} frames. ${saved}`);
}

async function downloadZip() {
  const r = state.result;
  if (!r?.pngs.length) {
    return;
  }
  const btn = $('downloadZip');
  btn.disabled = true;
  btn.textContent = 'Zipping…';
  try {
    r.zip ??= await zipBlobs(r.pngs, (p) => (btn.textContent = `Zipping… ${Math.round(p * 100)}%`));
    download(`face-swap-${r.run.slice(4)}-frames.zip`, r.zip);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download PNG frames (.zip)';
  }
}

// ---------- controls ----------

function segmented(id, options, get, set) {
  const el = $(id);
  el.innerHTML = '';
  for (const [value, label] of options) {
    const lab = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = id;
    input.value = String(value);
    input.checked = String(get()) === String(value);
    input.addEventListener('change', () => set(value));
    const span = document.createElement('span');
    span.textContent = label;
    lab.append(input, span);
    el.append(lab);
  }
}

function range(id, get, set, fmt) {
  const input = $(id);
  const out = $(`${id}Out`);
  const show = () => {
    input.value = String(get());
    if (out) {
      out.textContent = fmt(get());
    }
  };
  input.addEventListener('input', () => {
    set(Number(input.value));
    if (out) {
      out.textContent = fmt(get());
    }
    saveSettings();
    requestRender();
  });
  return show;
}

const syncers = [];

function syncControls() {
  syncers.forEach((f) => f());
  const s = state.settings;
  segmented('segFps', [['original', `Original${state.frames.length ? ` (${s.srcFps})` : ''}`], [25, '25'], [20, '20'], [15, '15'], [10, '10']], () => s.output.fps, (v) => {
    s.output.fps = v;
    afterOutputChange();
  });
  segmented('segScale', [[1, 'Original'], [2, '2×'], [3, '3×']], () => s.output.scale, (v) => {
    s.output.scale = v;
    afterOutputChange();
  });
  segmented('segQuality', [['standard', 'Standard'], ['high', 'High'], ['maximum', 'Maximum']], () => s.output.quality, (v) => {
    s.output.quality = v;
    afterOutputChange();
  });
  segmented('segLoop', [['infinite', 'Infinite'], ['once', 'Once']], () => s.output.loop, (v) => {
    s.output.loop = v;
    afterOutputChange();
  });
  segmented('segAspect', Object.keys(ASPECTS).map((a) => [a, a === 'free' ? 'Free' : a]), () => s.crop.aspect, (v) => {
    s.crop.aspect = v;
    setCrop(constrainAspect(cropRect()));
  });
  $('qualityHint').textContent = QUALITY_HINTS[s.output.quality];
  $('fitFlip').checked = s.fit.flip;
  $('occOn').checked = s.occlusion.enabled;
  $('eraseOn').checked = s.erase;
  $('outPngs').checked = s.output.pngs;
  if (!folderPicking && s.output.dest === 'folder') {
    s.output.dest = 'downloads';
  }
  segmented('segDest', [...(folderPicking ? [['folder', 'A folder']] : []), ['downloads', 'Downloads'], ...(state.serverFrames ? [['app', 'App folder']] : [])], () => s.output.dest, (v) => {
    s.output.dest = v;
    saveSettings();
    describeDest();
  });
  describeDest();
  $('cropOn').checked = s.crop.enabled;
  $('cropBody').hidden = !s.crop.enabled;
  syncCropInputs();
  updateSummary();
}

function afterOutputChange() {
  $('qualityHint').textContent = QUALITY_HINTS[state.settings.output.quality];
  saveSettings();
  updateSummary();
  if (state.playing) {
    stopPlayback();
    startPlayback();
  }
}

function syncCropInputs() {
  const c = cropRect();
  $('cropX').value = String(c.x);
  $('cropY').value = String(c.y);
  $('cropW').value = String(c.w);
  $('cropH').value = String(c.h);
}

function syncNudgeInputs() {
  const n = state.nudges[state.current];
  const active = document.activeElement;
  for (const [id, key, mul] of [['nudgeX', 'dx', 1], ['nudgeY', 'dy', 1], ['nudgeS', 'ds', 100]]) {
    if ($(id) !== active) {
      $(id).value = n ? String(Math.round(n[key] * mul * 10) / 10) : '';
      $(id).placeholder = n ? '' : String(Math.round((nudgeAt(state.current)?.[key] ?? 0) * mul * 10) / 10);
    }
  }
}

function setNudge() {
  const val = (id) => Number($(id).value || $(id).placeholder || 0);
  state.nudges[state.current] = { dx: val('nudgeX'), dy: val('nudgeY'), ds: val('nudgeS') / 100 };
  store.set(`nudges:${state.signature}`, state.nudges);
  markStale();
  drawStrip();
  requestRender();
}

function bindUI() {
  const s = state.settings;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const signed = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
  syncers.push(
    range('fitScale', () => s.fit.scale, (v) => (s.fit.scale = v), pct),
    range('fitX', () => s.fit.offsetX, (v) => (s.fit.offsetX = v), signed),
    range('fitY', () => s.fit.offsetY, (v) => (s.fit.offsetY = v), signed),
    range('fitRot', () => s.fit.rotation, (v) => (s.fit.rotation = v), (v) => `${v}°`),
    range('lookBright', () => s.look.brightness, (v) => (s.look.brightness = v), (v) => `${v}%`),
    range('lookContrast', () => s.look.contrast, (v) => (s.look.contrast = v), (v) => `${v}%`),
    range('lookSat', () => s.look.saturation, (v) => (s.look.saturation = v), (v) => `${v}%`),
    range('occSens', () => s.occlusion.sensitivity, (v) => (s.occlusion.sensitivity = v), String),
    range('occSoft', () => s.occlusion.softness, (v) => (s.occlusion.softness = v), String),
    range('smooth', () => s.smoothing, (v) => {
      s.smoothing = v;
      applySmoothing();
    }, (v) => (v ? `${v} of 5` : 'Off')),
    range('srcFps', () => s.srcFps, (v) => {
      s.srcFps = v;
      syncControls();
    }, (v) => `${v} fps`),
  );

  $('fitFlip').addEventListener('change', (e) => {
    s.fit.flip = e.target.checked;
    saveSettings();
    requestRender();
  });
  $('resetFit').addEventListener('click', () => {
    s.fit = structuredClone(DEFAULTS.fit);
    s.look = structuredClone(DEFAULTS.look);
    saveSettings();
    syncControls();
    requestRender();
  });
  $('occOn').addEventListener('change', (e) => {
    s.occlusion.enabled = e.target.checked;
    saveSettings();
    requestRender();
  });
  $('eraseOn').addEventListener('change', (e) => {
    s.erase = e.target.checked;
    saveSettings();
    requestRender();
  });
  bindTrim();
  $('outPngs').addEventListener('change', (e) => {
    s.output.pngs = e.target.checked;
    saveSettings();
  });
  $('pickFolder').addEventListener('click', async () => {
    if (await outputFolder(true)) {
      s.output.dest = 'folder';
      saveSettings();
      syncControls();
    }
  });
  $('cropOn').addEventListener('change', (e) => {
    s.crop.enabled = e.target.checked;
    $('cropBody').hidden = !s.crop.enabled;
    saveSettings();
    syncCropInputs();
    updateSummary();
    requestRender();
  });
  for (const id of ['cropX', 'cropY', 'cropW', 'cropH']) {
    $(id).addEventListener('change', () => {
      const r = { x: Number($('cropX').value), y: Number($('cropY').value), w: Number($('cropW').value), h: Number($('cropH').value) };
      setCrop(id === 'cropW' || id === 'cropH' ? constrainAspect(r) : r);
    });
  }
  $('cropHomer').addEventListener('click', cropToHead);
  $('cropReset').addEventListener('click', () => setCrop({ x: 0, y: 0, w: state.W, h: state.H }));

  for (const id of ['nudgeX', 'nudgeY', 'nudgeS']) {
    $(id).addEventListener('change', setNudge);
  }
  $('nudgeClear').addEventListener('click', () => {
    delete state.nudges[state.current];
    store.set(`nudges:${state.signature}`, state.nudges);
    drawStrip();
    requestRender();
  });
  $('nudgeClearAll').addEventListener('click', () => {
    state.nudges = {};
    store.set(`nudges:${state.signature}`, state.nudges);
    drawStrip();
    requestRender();
  });
  $('useRef').addEventListener('click', async () => {
    state.refIndex = state.current;
    store.set(`ref:${state.signature}`, state.refIndex);
    await analyzeAndTrack(false);
  });
  $('retrack').addEventListener('click', () => analyzeAndTrack(true));

  $('play').addEventListener('click', () => (state.playing ? stopPlayback() : startPlayback()));
  $('prev').addEventListener('click', () => goTo(state.current - 1));
  $('next').addEventListener('click', () => goTo(state.current + 1));
  $('scrub').addEventListener('input', (e) => goTo(Number(e.target.value)));
  $('showOriginal').addEventListener('change', requestRender);
  $('showOverlay').addEventListener('change', requestRender);

  $('chooseFace').addEventListener('click', () => $('faceFile').click());
  $('faceFile').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) {
      useFace(f, f.name);
    }
    e.target.value = '';
  });
  $('loadFramesBtn').addEventListener('click', () => $('loadFrames').click());
  $('loadFrames').addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files?.length) {
      return;
    }
    try {
      busy('Loading frames…', 0);
      const loaded = await loadFileFrames(files, (p) => busy('Loading frames…', p), WORK_WIDTH);
      state.serverFrames = false;
      await useFrames(loaded);
    } catch (err) {
      busy(null);
      setStatus(err.message);
    }
    e.target.value = '';
  });

  $('generate').addEventListener('click', generate);
  $('cancel').addEventListener('click', () => (state.cancel = true));
  $('downloadZip').addEventListener('click', downloadZip);

  preview.addEventListener('pointerdown', onPointerDown);
  preview.addEventListener('pointermove', onPointerMove);
  preview.addEventListener('pointerup', onPointerUp);
  preview.addEventListener('pointercancel', onPointerUp);

  // Drop a face PNG anywhere.
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) {
      dragDepth++;
      $('dropHint').hidden = false;
    }
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) {
      $('dropHint').hidden = true;
    }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('dropHint').hidden = true;
    const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (f) {
      useFace(f, f.name);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input[type="number"], input[type="text"]')) {
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      state.playing ? stopPlayback() : startPlayback();
    } else if (e.key === 'ArrowLeft' && e.target.type !== 'range') {
      goTo(state.current - 1);
    } else if (e.key === 'ArrowRight' && e.target.type !== 'range') {
      goTo(state.current + 1);
    } else if (e.key === 'o' && !e.repeat) {
      $('showOriginal').checked = true;
      requestRender();
    } else if (e.key === '[') {
      setTrim('start', state.current);
    } else if (e.key === ']') {
      setTrim('end', state.current);
    } else if ((e.key === 'x' || e.key === 'Delete') && !e.repeat) {
      toggleDrop(state.current);
    } else if (e.key === 'Escape' && state.faceSelected) {
      state.faceSelected = false;
      requestRender();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'o') {
      $('showOriginal').checked = false;
      requestRender();
    }
  });
  window.addEventListener('resize', drawStrip);

  syncControls();
}

async function init() {
  bindUI();
  restoreFace();
  idb('readonly', (kv) => kv.get('outputFolder'))
    .then((dir) => dir && ($('destFolderName').textContent = dir.name))
    .catch(() => {});
  try {
    busy('Loading frames…', 0);
    const loaded = await loadServerFrames((p) => busy('Loading frames…', p), WORK_WIDTH);
    state.serverFrames = true;
    await useFrames(loaded);
  } catch (err) {
    busy(null);
    setStatus(`${err.message}. Use "Load frames…" to pick frame images or a GIF.`);
  }
}

init();
