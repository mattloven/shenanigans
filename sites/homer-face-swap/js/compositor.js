// Draws one output frame: the source frame, scaled, with the replacement face
// placed on Homer's tracked head and hidden wherever the hedge covers him.

import { erasePatch } from './eraser.js';

// 2D affine as [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f.
export const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// Reference coordinates -> frame coordinates for one frame, including any
// manual correction. Pure scale + shift, so it stays [s, 0, 0, s, ox, oy].
export function headTransform(ref, t, nudge) {
  const s = t.s * (1 + (nudge?.ds ?? 0));
  const { x: cx, y: cy } = ref.center;
  return [s, 0, 0, s, cx * (1 - s) + t.dx + (nudge?.dx ?? 0), cy * (1 - s) + t.dy + (nudge?.dy ?? 0)];
}

// Face image pixels -> reference coordinates. The face's opaque box is scaled
// to fit.scale x the height of Homer's face (skull top to muzzle bottom).
export function faceTransform(ref, face, fit) {
  const a = ref.anchor;
  const k = (fit.scale * a.h) / face.box.h;
  const th = (fit.rotation * Math.PI) / 180;
  const fx = fit.flip ? -1 : 1;
  const m = [Math.cos(th) * k * fx, Math.sin(th) * k * fx, -Math.sin(th) * k, Math.cos(th) * k, 0, 0];
  const cx = a.cx + fit.offsetX * a.h;
  const cy = a.cy + fit.offsetY * a.h;
  const [bx, by] = apply(m, face.box.x + face.box.w / 2, face.box.y + face.box.h / 2);
  m[4] = cx - bx;
  m[5] = cy - by;
  return m;
}

const smoothstep = (t) => t * t * (3 - 2 * t);
const ramp = (v, from, to) => (v <= from ? 0 : v >= to ? 1 : smoothstep((v - from) / (to - from)));

// Share of the outline under hedge over which hiding fades in.
const ONSET_FROM = 0.12;
const ONSET_TO = 0.22;

// Greenness at a fractional source position (bilinear), 0 off-frame.
function greenAt(data, W, H, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) {
    return 0;
  }
  const fx = x - x0;
  const fy = y - y0;
  const o = (y0 * W + x0) * 4;
  const o2 = o + W * 4;
  const g = (p) => data[p + 1] - (data[p] > data[p + 2] ? data[p] : data[p + 2]);
  return (g(o) * (1 - fx) + g(o + 4) * fx) * (1 - fy) + (g(o2) * (1 - fx) + g(o2 + 4) * fx) * fy;
}

// How covered by hedge each point of Homer's rim is in this frame, averaged
// along the outline so neighbouring face pixels get similar answers.
function rimCover(ref, head, src, lo, hi) {
  const { rim } = ref;
  const { data, width: W, height: H } = src;
  const s = head[0];
  const d = 3 * s;
  const span = Math.max(1, hi - lo);
  const raw = new Float32Array(rim.n);
  for (let i = 0; i < rim.n; i++) {
    const x = s * rim.x[i] + head[4];
    const y = s * rim.y[i] + head[5];
    // Least green of a small cross, so a pixel or two of tracking error at
    // the outline doesn't read as leaves.
    const g = Math.min(
      greenAt(data, W, H, x, y),
      greenAt(data, W, H, x - d, y),
      greenAt(data, W, H, x + d, y),
      greenAt(data, W, H, x, y - d),
      greenAt(data, W, H, x, y + d),
    );
    raw[i] = g <= lo ? 0 : g >= hi ? 1 : smoothstep((g - lo) / span);
  }
  // Once the hedge has closed over most of his outline, a gap in it is a hole
  // he peers through, not open air: everything beyond the outline is leaves.
  let covered = 0;
  let outer = 0;
  for (let i = 0; i < rim.n; i++) {
    if (rim.outer[i]) {
      covered += raw[i];
      outer++;
    }
  }
  const closed = covered / Math.max(1, outer);
  const closure = ramp(closed, 0.6, 0.72);
  // Before he backs in, a little of his outline still reads as covered: his
  // expression changes from the reference frame and lands a few rim points on
  // hedge that is only behind him. Nothing is hidden until the hedge has
  // really started closing in.
  const onset = ramp(closed, ONSET_FROM, ONSET_TO);
  const average = (hood) => {
    const out = new Float32Array(rim.n);
    for (let i = 0; i < rim.n; i++) {
      let sum = 0;
      for (let j = hood.offsets[i]; j < hood.offsets[i + 1]; j++) {
        sum += raw[hood.neighbours[j]];
      }
      out[i] = Math.max(closure, (onset * sum) / (hood.offsets[i + 1] - hood.offsets[i]));
    }
    return out;
  };
  return { near: average(rim), far: average(rim.far), closed, onset };
}

// Share of Homer's outer outline under hedge in this frame (0..1).
export function hedgeCover(ref, head, src, occlusion) {
  return rimCover(ref, head, src, occlusion.sensitivity - occlusion.softness, occlusion.sensitivity + occlusion.softness).closed;
}

// Greenness with single-pixel specks ignored: the least green of a 1px cross.
// Most face pixels aren't green at all, so the centre alone settles those.
function solidGreenAt(data, W, H, x, y, lo) {
  const c = greenAt(data, W, H, x, y);
  if (c <= lo) {
    return c;
  }
  return Math.min(
    c,
    greenAt(data, W, H, x - 1, y),
    greenAt(data, W, H, x + 1, y),
    greenAt(data, W, H, x, y - 1),
    greenAt(data, W, H, x, y + 1),
  );
}

// Multiplies the face layer's alpha by "Homer is visible here".
// Inside his core silhouette that is simply "this pixel isn't hedge". Outside
// it (the face is wider than his outline) the hedge there is either behind him
// or in front, and colour can't tell which; the nearest stretch of his rim
// decides. Leaves that swallow his edge swallow the face too, while hedge
// that is only behind him never cuts into the face.
// src is the frame at e times the working resolution; positions below are in
// working units and scaled by e when sampling it.
function occlude(layer, x0, y0, k, head, ref, src, e, lo, hi, cover) {
  const { data: px, width: lw, height: lh } = layer;
  const { r2, core, nearest, rimDist } = ref;
  const { data, width: W, height: H } = src;
  const s = head[0];
  const ox = head[4];
  const oy = head[5];
  const span = Math.max(1, hi - lo);
  if (cover.onset === 0) {
    return;
  }
  for (let j = 0; j < lh; j++) {
    const qy = (y0 + j + 0.5) / k;
    const py = Math.round((qy - oy) / s) - r2.y0;
    const iy = py < 0 ? 0 : py >= r2.h ? r2.h - 1 : py;
    for (let i = 0; i < lw; i++) {
      const a = (j * lw + i) * 4 + 3;
      if (px[a] === 0) {
        continue;
      }
      const qx = (x0 + i + 0.5) / k;
      const pxr = Math.round((qx - ox) / s) - r2.x0;
      const ix = pxr < 0 ? 0 : pxr >= r2.w ? r2.w - 1 : pxr;
      const idx = iy * r2.w + ix;
      const g = solidGreenAt(data, W, H, qx * e - 0.5, qy * e - 0.5, lo);
      if (g <= lo) {
        continue;
      }
      let occ = (g >= hi ? 1 : smoothstep((g - lo) / span)) * cover.onset;
      if (!core[idx]) {
        const n = nearest[idx];
        let front = 0;
        if (n >= 0) {
          const t = Math.min(1, Math.max(0, (rimDist[idx] - 4) / 20));
          front = cover.near[n] * (1 - t) + cover.far[n] * t;
        }
        occ *= ramp(front, 0.15, 0.4);
      }
      if (occ > 0) {
        px[a] = px[a] * (1 - occ);
      }
    }
  }
}

let layerCanvas = null;
let srcCanvas = null;
let patchCanvas = null;

function scratch(canvas, w, h) {
  if (!canvas || canvas.width < w || canvas.height < h) {
    return new OffscreenCanvas(Math.max(w, canvas?.width ?? 0), Math.max(h, canvas?.height ?? 0));
  }
  return canvas;
}

// Reads a frame's pixels at source resolution.
export function frameData(bitmap, W, H) {
  srcCanvas = scratch(srcCanvas, W, H);
  const ctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(bitmap, 0, 0, W, H);
  return ctx.getImageData(0, 0, W, H);
}

// Corners of the face's opaque box in output pixels, clockwise from top-left.
export function faceCorners(ref, track, nudge, face, fit, k = 1) {
  const m = mul([k, 0, 0, k, 0, 0], mul(headTransform(ref, track, nudge), faceTransform(ref, face, fit)));
  const { x, y, w, h } = face.box;
  return [apply(m, x, y), apply(m, x + w, y), apply(m, x + w, y + h), apply(m, x, y + h)];
}

// Renders frame + face into ctx (sized W*k x H*k). Returns the face layer's
// placement and alpha so the GIF encoder can favour the face, or null.
export function renderFrame(ctx, opts) {
  const { bitmap, W, H, k, ref, track, nudge, face, fit, look, occlusion, erase, showFace = true } = opts;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, W * k, H * k);
  if (!showFace || !face || !ref || !track) {
    return null;
  }

  const head = headTransform(ref, track, nudge);
  const lo = occlusion.sensitivity - occlusion.softness;
  const hi = occlusion.sensitivity + occlusion.softness;
  const src = occlusion.enabled || erase ? (opts.src ?? frameData(bitmap, W, H)) : null;
  const cover = src ? rimCover(ref, head, src, lo, hi) : null;
  // Pixel-level work (painting the head out, cutting leaves over the face)
  // reads the source at the resolution it is drawn at, up to the source's
  // own, so its edges are as sharp as the frame around them. The working
  // copy only drives the outline-wide decisions above.
  const e = Math.min(k, bitmap.width / W);
  const sharp = src && e > 1 ? frameData(bitmap, Math.round(W * e), Math.round(H * e)) : src;

  // Paint the original head out first; the hedge test below still reads the
  // untouched pixels, where Homer is still there to be seen.
  if (erase) {
    const paintHead = [head[0] * e, 0, 0, head[0] * e, head[4] * e, head[5] * e];
    const patch = erasePatch(sharp, ref, paintHead, occlusion.enabled && cover.onset > 0, lo, e);
    if (patch) {
      const { width: pw, height: ph } = patch.image;
      const f = k / e;
      patchCanvas = scratch(patchCanvas, pw, ph);
      const pctx = patchCanvas.getContext('2d');
      pctx.clearRect(0, 0, patchCanvas.width, patchCanvas.height);
      pctx.putImageData(patch.image, 0, 0);
      ctx.drawImage(patchCanvas, 0, 0, pw, ph, patch.x * f, patch.y * f, pw * f, ph * f);
    }
  }

  const m = mul([k, 0, 0, k, 0, 0], mul(head, faceTransform(ref, face, fit)));
  const corners = [
    apply(m, face.box.x, face.box.y),
    apply(m, face.box.x + face.box.w, face.box.y),
    apply(m, face.box.x, face.box.y + face.box.h),
    apply(m, face.box.x + face.box.w, face.box.y + face.box.h),
  ];
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))) - 1);
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))) - 1);
  const x1 = Math.min(W * k, Math.ceil(Math.max(...corners.map((c) => c[0]))) + 1);
  const y1 = Math.min(H * k, Math.ceil(Math.max(...corners.map((c) => c[1]))) + 1);
  if (x1 <= x0 || y1 <= y0) {
    return null;
  }
  const lw = x1 - x0;
  const lh = y1 - y0;

  layerCanvas = scratch(layerCanvas, lw, lh);
  const lctx = layerCanvas.getContext('2d', { willReadFrequently: true });
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.clearRect(0, 0, lw, lh);
  lctx.setTransform(m[0], m[1], m[2], m[3], m[4] - x0, m[5] - y0);
  lctx.imageSmoothingEnabled = true;
  lctx.imageSmoothingQuality = 'high';
  lctx.filter = `brightness(${look.brightness}%) contrast(${look.contrast}%) saturate(${look.saturation}%)`;
  lctx.drawImage(face.bitmap, 0, 0);
  lctx.filter = 'none';
  lctx.setTransform(1, 0, 0, 1, 0, 0);

  const layer = lctx.getImageData(0, 0, lw, lh);
  if (occlusion.enabled) {
    occlude(layer, x0, y0, k, head, ref, sharp, e, lo, hi, cover);
  }
  lctx.putImageData(layer, 0, 0);
  ctx.drawImage(layerCanvas, 0, 0, lw, lh, x0, y0, lw, lh);
  return { x: x0, y: y0, w: lw, h: lh, alpha: layer.data };
}

// Opaque bounding box of an image's alpha channel.
export function alphaBox(bitmap) {
  const c = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const { data, width: w, height: h } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  let transparent = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a < 255) {
        transparent = true;
      }
      if (a > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) {
    return { box: { x: 0, y: 0, w, h }, transparent };
  }
  return { box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, transparent };
}
