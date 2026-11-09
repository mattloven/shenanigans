// Cleans up TV-captured cartoon frames. The paint in a cartoon is flat, so
// anything that varies inside a flat area is capture noise or compression
// blotching: an edge-preserving filter smooths it, flat areas snap to one
// palette shared by every frame (so colours stop shimmering from frame to
// frame), levels and saturation undo the washed-out capture, and a 2x
// upscale is sharpened without halos so ink lines come out crisp.

// Colour samples (rgb triplets) from an ImageData, every `step` pixels.
export function samplePixels(img, step) {
  const { data } = img;
  const out = [];
  for (let p = 0; p < data.length; p += 4 * step) {
    out.push(data[p], data[p + 1], data[p + 2]);
  }
  return out;
}

// Levels from the shared samples: the darkest and brightest 0.5% per
// channel become black and white (captures lift the blacks and dull the
// whites), blended back by `strength` so hues don't swing.
export function buildLevels(samples, strength = 0.8) {
  const lo = [];
  const hi = [];
  for (let c = 0; c < 3; c++) {
    const vals = [];
    for (let i = c; i < samples.length; i += 3) {
      vals.push(samples[i]);
    }
    vals.sort((a, b) => a - b);
    const a = vals[Math.floor(vals.length * 0.005)];
    const b = vals[Math.floor(vals.length * 0.995)];
    lo.push(a * strength);
    hi.push(255 - (255 - b) * strength);
  }
  return { lo, hi };
}

// Levels, then saturation lifted around each pixel's own luminance.
export function grader(levels, pop) {
  const lut = [0, 1, 2].map((c) => {
    const t = new Float32Array(256);
    const span = Math.max(1, levels.hi[c] - levels.lo[c]);
    for (let v = 0; v < 256; v++) {
      t[v] = Math.min(255, Math.max(0, ((v - levels.lo[c]) * 255) / span));
    }
    return t;
  });
  return (r, g, b, out, o) => {
    const R = lut[0][r];
    const G = lut[1][g];
    const B = lut[2][b];
    const l = 0.299 * R + 0.587 * G + 0.114 * B;
    out[o] = clamp(l + (R - l) * (1 + pop));
    out[o + 1] = clamp(l + (G - l) * (1 + pop));
    out[o + 2] = clamp(l + (B - l) * (1 + pop));
  };
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// k-means palette over colour samples, seeded by spreading picks apart.
export function buildPalette(samples, k, iterations = 12) {
  const n = samples.length / 3;
  const pal = new Float32Array(k * 3);
  // k-means++ style seeding on a subsample keeps rare paint (the orange
  // sign, eye whites) from being swallowed by the big greens.
  const pick = (i, j) => {
    pal[j * 3] = samples[i * 3];
    pal[j * 3 + 1] = samples[i * 3 + 1];
    pal[j * 3 + 2] = samples[i * 3 + 2];
  };
  pick(Math.floor(n / 2), 0);
  const dist = new Float32Array(n).fill(Infinity);
  for (let j = 1; j < k; j++) {
    let far = 0;
    let farD = -1;
    for (let i = 0; i < n; i++) {
      const dr = samples[i * 3] - pal[(j - 1) * 3];
      const dg = samples[i * 3 + 1] - pal[(j - 1) * 3 + 1];
      const db = samples[i * 3 + 2] - pal[(j - 1) * 3 + 2];
      const d = dr * dr + dg * dg + db * db;
      if (d < dist[i]) {
        dist[i] = d;
      }
      if (dist[i] > farD) {
        farD = dist[i];
        far = i;
      }
    }
    pick(far, j);
  }
  for (let it = 0; it < iterations; it++) {
    const sum = new Float64Array(k * 4);
    for (let i = 0; i < n; i++) {
      const j = nearest(pal, k, samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2])[0];
      sum[j * 4] += samples[i * 3];
      sum[j * 4 + 1] += samples[i * 3 + 1];
      sum[j * 4 + 2] += samples[i * 3 + 2];
      sum[j * 4 + 3]++;
    }
    for (let j = 0; j < k; j++) {
      if (sum[j * 4 + 3]) {
        pal[j * 3] = sum[j * 4] / sum[j * 4 + 3];
        pal[j * 3 + 1] = sum[j * 4 + 1] / sum[j * 4 + 3];
        pal[j * 3 + 2] = sum[j * 4 + 2] / sum[j * 4 + 3];
      }
    }
  }
  return pal;
}

function nearest(pal, k, r, g, b) {
  let best = 0;
  let bd = Infinity;
  for (let j = 0; j < k; j++) {
    const dr = r - pal[j * 3];
    const dg = g - pal[j * 3 + 1];
    const db = b - pal[j * 3 + 2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) {
      bd = d;
      best = j;
    }
  }
  return [best, bd];
}

// Edge-preserving smoothing: neighbours count only when their colour is
// close, so blotches inside a flat area average out and ink edges don't.
function bilateral(src, w, h, radius, sigmaRange) {
  const out = new Uint8ClampedArray(src.length);
  const rangeW = new Float32Array(766);
  for (let d = 0; d < 766; d++) {
    rangeW[d] = Math.exp(-(d * d) / (2 * sigmaRange * sigmaRange));
  }
  const spatial = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      spatial.push(dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * 1.5 * 1.5)));
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const r0 = src[o];
      const g0 = src[o + 1];
      const b0 = src[o + 2];
      let sw = 0;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let s = 0; s < spatial.length; s += 3) {
        const nx = x + spatial[s];
        const ny = y + spatial[s + 1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          continue;
        }
        const q = (ny * w + nx) * 4;
        const d = Math.abs(src[q] - r0) + Math.abs(src[q + 1] - g0) + Math.abs(src[q + 2] - b0);
        const wt = spatial[s + 2] * rangeW[d];
        sw += wt;
        sr += src[q] * wt;
        sg += src[q + 1] * wt;
        sb += src[q + 2] * wt;
      }
      out[o] = sr / sw;
      out[o + 1] = sg / sw;
      out[o + 2] = sb / sw;
      out[o + 3] = 255;
    }
  }
  return out;
}

// Unsharp mask held inside each pixel's 3x3 range: edges steepen, but
// nothing overshoots, so no bright or dark halos ring the ink lines.
function crispen(src, w, h, amount) {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let lo = 255;
        let hi = 0;
        let blur = 0;
        let wsum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx;
            const v = src[(ny * w + nx) * 4 + c];
            const wt = (dx ? 1 : 2) * (dy ? 1 : 2);
            blur += v * wt;
            wsum += wt;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        const v = src[o + c] + amount * (src[o + c] - blur / wsum);
        out[o + c] = v < lo ? lo : v > hi ? hi : v;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

// Shock filter: a pixel partway through an edge is pulled towards whichever
// side's colour it is nearer, using the darkest and lightest pixels around
// it as the two sides. Repeated, a blurred 6px transition closes to about
// two, which reads as a crisp ink line, and only existing colours are used.
function steepen(src, w, h, amount) {
  const out = new Uint8ClampedArray(src);
  const lum = new Float32Array(w * h);
  for (let p = 0, o = 0; p < w * h; p++, o += 4) {
    lum[p] = 0.299 * src[o] + 0.587 * src[o + 1] + 0.114 * src[o + 2];
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      let lo = p;
      let hi = p;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const q = p + dy * w + dx;
          if (lum[q] < lum[lo]) lo = q;
          if (lum[q] > lum[hi]) hi = q;
        }
      }
      if (lum[hi] - lum[lo] < EDGE_SPAN) {
        continue;
      }
      const o = p * 4;
      const a = lo * 4;
      const b = hi * 4;
      const da = Math.abs(src[o] - src[a]) + Math.abs(src[o + 1] - src[a + 1]) + Math.abs(src[o + 2] - src[a + 2]);
      const db = Math.abs(src[o] - src[b]) + Math.abs(src[o + 1] - src[b + 1]) + Math.abs(src[o + 2] - src[b + 2]);
      const t = da / Math.max(1, da + db);
      const target = t < 0.5 ? a : b;
      // The middle of an edge stays put; its shoulders move the most.
      const wgt = amount * Math.abs(2 * t - 1);
      for (let c = 0; c < 3; c++) {
        out[o + c] = src[o + c] + (src[target + c] - src[o + c]) * wgt;
      }
    }
  }
  return out;
}

// Luminance step across a 3x3 window that counts as an edge.
const EDGE_SPAN = 28;

// One frame: ImageData in, enhanced ImageData (scaled) out.
// look: { scale, clean (0-3), pop (0-1), crisp (0-2), snap (colour distance) }
// shared: { levels, palette } built once from samples of every frame.
export function enhanceFrame(img, look, shared) {
  const { width: w, height: h } = img;
  let px = img.data;
  for (let i = 0; i < look.clean; i++) {
    px = bilateral(px, w, h, 2, 14 + 6 * look.clean);
  }

  // Grade, then snap near-flat pixels to the graded palette. Edges and
  // anti-aliasing sit between palette colours and keep their blend.
  const grade = grader(shared.levels, look.pop);
  const k = shared.palette.length / 3;
  const pal = new Float32Array(k * 3);
  const tmp = [0, 0, 0];
  for (let j = 0; j < k; j++) {
    grade(Math.round(shared.palette[j * 3]), Math.round(shared.palette[j * 3 + 1]), Math.round(shared.palette[j * 3 + 2]), tmp, 0);
    pal.set(tmp, j * 3);
  }
  const graded = new Uint8ClampedArray(px.length);
  const snap2 = look.snap * look.snap;
  const cache = new Map();
  for (let o = 0; o < px.length; o += 4) {
    grade(px[o], px[o + 1], px[o + 2], graded, o);
    graded[o + 3] = 255;
    if (!snap2) {
      continue;
    }
    const key = (graded[o] << 16) | (graded[o + 1] << 8) | graded[o + 2];
    let hit = cache.get(key);
    if (hit === undefined) {
      const [j, d] = nearest(pal, k, graded[o], graded[o + 1], graded[o + 2]);
      hit = d <= snap2 ? j : -1;
      cache.set(key, hit);
    }
    if (hit >= 0) {
      graded[o] = pal[hit * 3];
      graded[o + 1] = pal[hit * 3 + 1];
      graded[o + 2] = pal[hit * 3 + 2];
    }
  }

  const W = Math.round(w * look.scale);
  const H = Math.round(h * look.scale);
  const small = new OffscreenCanvas(w, h);
  small.getContext('2d').putImageData(new ImageData(graded, w, h), 0, 0);
  const big = new OffscreenCanvas(W, H);
  const bctx = big.getContext('2d', { willReadFrequently: true });
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, W, H);
  let up = bctx.getImageData(0, 0, W, H).data;
  // Crisp 0-2: up to four steepening passes, then a halo-free unsharp.
  const passes = Math.round(look.crisp * 2);
  for (let i = 0; i < passes; i++) {
    up = steepen(up, W, H, 0.6);
  }
  if (look.crisp > 0) {
    up = crispen(up, W, H, 0.5 * look.crisp);
  }
  return new ImageData(up, W, H);
}
