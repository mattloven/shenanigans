// Paints Homer's head out of a frame so nothing of it peeks around the new
// face. The fence and hedge behind him run in roughly horizontal bands, so
// each erased run of a row is filled from the background just left and right
// of it: flat paint from each side meeting at a hard edge, the way the
// cartoon itself is painted, rather than a blend that reads as blur.

import { GREEN_CUT, greenness, isSkin, isFence } from './tracker.js';

// Distances below are in working-resolution pixels (960 wide) and scale
// with the resolution the patch is painted at.
const SAMPLE = 3; // background pixels looked at on each side of a run

// Ink this dark is outline; it joins the head only next to his lighter parts.
const DARK = 70;
const INK_REACH = 3;
const GROW = 4;

// Hair strokes: darker than the fence planks behind them (~118), followed
// this far above the top of the skull.
const HAIR_DARK = 112;
const HAIR_REACH = 40;

// Homer as he is drawn in this frame, within the w x h window at (x0, y0)
// and above row `cut` (his neck). The reference outline alone misses what
// moves with his expression: the nose tip swinging down, a dropped jaw.
// Seeds are his skin; the fill spreads over anything that is neither hedge
// nor fence, crossing outline ink only close to what it already holds.
function homerHere(data, W, x0, y0, w, h, cut, px, hairCut) {
  const kind = new Uint8Array(w * h); // 0 background, 1 light, 2 ink
  const mask = new Uint8Array(w * h);
  const stack = [];
  const rows = Math.min(h, Math.max(0, cut - y0));
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < w; i++) {
      const o = ((y0 + j) * W + x0 + i) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      if (greenness(r, g, b) > GREEN_CUT || isFence(r, g, b)) {
        continue;
      }
      kind[j * w + i] = Math.max(r, g, b) < DARK ? 2 : 1;
      if (isSkin(r, g, b)) {
        mask[j * w + i] = 1;
        stack.push(j * w + i);
      }
    }
  }
  const flood = () => {
    while (stack.length) {
      const q = stack.pop();
      const i = q % w;
      const j = (q / w) | 0;
      for (const n of [i > 0 ? q - 1 : -1, i < w - 1 ? q + 1 : -1, j > 0 ? q - w : -1, j < rows - 1 ? q + w : -1]) {
        if (n >= 0 && !mask[n] && kind[n] === 1) {
          mask[n] = 1;
          stack.push(n);
        }
      }
    }
  };
  for (let pass = 0; pass < 2; pass++) {
    flood();
    const near = grow(mask, w, h, Math.round(INK_REACH * px));
    for (let p = 0; p < w * h; p++) {
      if (!mask[p] && kind[p] === 2 && near[p]) {
        mask[p] = 1;
        stack.push(p);
      }
    }
  }
  flood();
  addHair(data, W, x0, y0, w, h, mask, hairCut, Math.round(HAIR_REACH * px));
  return grow(mask, w, h, Math.round(GROW * px));
}

// Hair strokes rising off the skull, as drawn in this frame: they join the
// head only through other dark pixels, so they are followed through dark
// pixels alone, a limited distance, and only above the top of the skull
// (lower down the same rule would run along the hedge's dark top edge).
function addHair(data, W, x0, y0, w, h, mask, hairCut, reach) {
  const rows = Math.min(h, Math.max(0, hairCut - y0));
  const dist = new Int32Array(w * h).fill(-1);
  const queue = [];
  for (let p = 0; p < w * h; p++) {
    if (mask[p]) {
      dist[p] = 0;
      queue.push(p);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const q = queue[qi];
    const d = dist[q];
    if (d >= reach) {
      continue;
    }
    const i = q % w;
    const j = (q / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ni = i + dx;
        const nj = j + dy;
        if (ni < 0 || nj < 0 || ni >= w || nj >= rows) {
          continue;
        }
        const n = nj * w + ni;
        if (dist[n] >= 0) {
          continue;
        }
        const o = ((y0 + nj) * W + x0 + ni) * 4;
        const r = data[o];
        const g = data[o + 1];
        const b = data[o + 2];
        if (Math.max(r, g, b) < HAIR_DARK && greenness(r, g, b) <= GREEN_CUT) {
          dist[n] = d + 1;
          mask[n] = 1;
          queue.push(n);
        }
      }
    }
  }
}

// Mask dilated by r pixels (square).
function grow(mask, w, h, r) {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    let last = -Infinity;
    for (let i = 0; i < w; i++) {
      if (mask[j * w + i]) {
        last = i;
      }
      if (i - last <= r) {
        tmp[j * w + i] = 1;
      }
    }
    last = Infinity;
    for (let i = w - 1; i >= 0; i--) {
      if (mask[j * w + i]) {
        last = i;
      }
      if (last - i <= r) {
        tmp[j * w + i] = 1;
      }
    }
  }
  for (let i = 0; i < w; i++) {
    let last = -Infinity;
    for (let j = 0; j < h; j++) {
      if (tmp[j * w + i]) {
        last = j;
      }
      if (j - last <= r) {
        out[j * w + i] = 1;
      }
    }
    last = Infinity;
    for (let j = h - 1; j >= 0; j--) {
      if (tmp[j * w + i]) {
        last = j;
      }
      if (last - j <= r) {
        out[j * w + i] = 1;
      }
    }
  }
  return out;
}

// src: the untouched frame (ImageData), px times the working resolution.
// head: reference -> src transform. leavesStay: once the hedge is closing
// in, leaf-green pixels inside the area are leaves in front of him and are
// kept rather than painted over.
// Returns { x, y, image } covering the erased area (other pixels
// transparent), or null.
export function erasePatch(src, ref, head, leavesStay, greenLimit, px = 1) {
  const { data, width: W, height: H } = src;
  const { box, erase } = ref;
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const s = head[0];
  const ox = head[4];
  const oy = head[5];
  // A little beyond the reference box, for a nose tip that swings out of it.
  const sample = Math.max(1, Math.round(SAMPLE * px));
  const pad = sample + 2 + Math.round(0.1 * s * bw);
  const x0 = Math.max(0, Math.floor(s * box.x0 + ox) - pad);
  const y0 = Math.max(0, Math.floor(s * box.y0 + oy) - pad);
  const x1 = Math.min(W - 1, Math.ceil(s * box.x1 + ox) + pad);
  const y1 = Math.min(H - 1, Math.ceil(s * box.y1 + oy) + pad);
  if (x1 <= x0 || y1 <= y0) {
    return null;
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;

  const cut = Math.round(s * (ref.anchor.cy + ref.anchor.h / 2 + GROW) + oy);
  const hairCut = Math.round(s * (ref.head.y0 + 10) + oy);
  const here = homerHere(data, W, x0, y0, w, h, cut, px, hairCut);
  const mask = new Uint8Array(w * h);
  let any = false;
  for (let j = 0; j < h; j++) {
    const ry = Math.round((y0 + j - oy) / s) - box.y0;
    for (let i = 0; i < w; i++) {
      const rx = Math.round((x0 + i - ox) / s) - box.x0;
      const inRef = ry >= 0 && ry < bh && rx >= 0 && rx < bw && erase[ry * bw + rx];
      if (!inRef && !here[j * w + i]) {
        continue;
      }
      if (leavesStay) {
        const o = ((y0 + j) * W + x0 + i) * 4;
        if (data[o + 1] - Math.max(data[o], data[o + 2]) > greenLimit) {
          continue;
        }
      }
      mask[j * w + i] = 1;
      any = true;
    }
  }
  if (!any) {
    return null;
  }

  const image = new ImageData(w, h);
  const out = image.data;
  for (let j = 0; j < h; j++) {
    const row = (y0 + j) * W * 4;
    out.set(data.subarray(row + x0 * 4, row + (x1 + 1) * 4), j * w * 4);
  }

  // The tracked head box in patch columns: the clone offset hangs off this,
  // not off the erased shape, so it moves only as smoothly as the head does.
  const frame = {
    data,
    W,
    H,
    x0,
    y0,
    bx0: Math.floor(s * box.x0 + ox) - x0,
    bx1: Math.ceil(s * box.x1 + ox) - x0,
  };
  if (!fillScene(out, mask, w, h, px, frame)) {
    fillRows(out, mask, w, h, sample);
  }
  // Only painted pixels are drawn, so the patch never covers frame pixels
  // it didn't change.
  for (let p = 0; p < w * h; p++) {
    if (!mask[p]) {
      out[p * 4 + 3] = 0;
    }
  }
  return { x: x0, y: y0, image };
}

const median = (v) => v.sort((a, b) => a - b)[v.length >> 1];
const greenAt = (out, o) => out[o + 1] - Math.max(out[o], out[o + 2]) > GREEN_CUT;

// Fills the area the way the scene is built, so it holds still from frame to
// frame: fence planks carried straight down from above, the hedge's dark top
// edge continued across, flat hedge green below. Rebuilding each row from
// its neighbours instead put the fence post's edge in a different place every
// frame. Returns false when there is no hedge around to go by.
function fillScene(out, mask, w, h, px, frame) {
  let minX = w;
  let maxX = -1;
  for (let p = 0; p < w * h; p++) {
    if (mask[p]) {
      const x = p % w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }

  // Hedge colour: the median of plain hedge (not its dark scribbles) close by.
  const near = grow(mask, w, h, Math.round(10 * px));
  const hr = [];
  const hg = [];
  const hb = [];
  for (let p = 0; p < w * h; p++) {
    const o = p * 4;
    if (near[p] && !mask[p] && greenAt(out, o) && out[o + 1] > 70) {
      hr.push(out[o]);
      hg.push(out[o + 1]);
      hb.push(out[o + 2]);
    }
  }
  if (hr.length < 20) {
    return false;
  }
  const hedge = [median(hr), median(hg), median(hb)];

  // Where the hedge's top edge meets each side of the area: the first hedge
  // pixel below fence, averaged over a band of columns so the edge's
  // scallops don't make the line jump about between frames.
  const topOfHedge = (x) => {
    let sawFence = false;
    for (let y = 0; y < h; y++) {
      const p = y * w + x;
      if (mask[p]) {
        return null;
      }
      if (greenAt(out, p * 4)) {
        return sawFence ? y : null;
      }
      sawFence = true;
    }
    return null;
  };
  const band = (from, to) => {
    const ys = [];
    const step = Math.max(1, Math.round(2 * px));
    for (let x = Math.max(0, from); x <= Math.min(w - 1, to); x += step) {
      const y = topOfHedge(x);
      if (y !== null) {
        ys.push(y);
      }
    }
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
  };
  const reach = Math.round(24 * px);
  const gap = Math.round(2 * px);
  let yL = band(minX - reach, minX - gap);
  let yR = band(maxX + gap, maxX + reach);
  yL ??= yR;
  yR ??= yL;

  // The edge's outline: the darkest paint just under the edge on either side.
  const th = Math.max(1, Math.round(2.5 * px));
  let ink = null;
  if (yL !== null) {
    const ir = [];
    const ig = [];
    const ib = [];
    for (const [x0, x1, y] of [[minX - reach, minX - gap, yL], [maxX + gap, maxX + reach, yR]]) {
      for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
        for (let y2 = Math.max(0, Math.round(y)); y2 < Math.min(h, Math.round(y) + 2 * th); y2++) {
          const o = (y2 * w + x) * 4;
          if (!mask[y2 * w + x] && Math.max(out[o], out[o + 1], out[o + 2]) < 80) {
            ir.push(out[o]);
            ig.push(out[o + 1]);
            ib.push(out[o + 2]);
          }
        }
      }
    }
    ink = ir.length >= 4 ? [median(ir), median(ig), median(ib)] : null;
  }

  const xL = minX - (reach + gap) / 2;
  const xR = maxX + (reach + gap) / 2;
  const edgeAt = (x) => (yL === null ? null : yL + (yR - yL) * (xR > xL ? (x - xL) / (xR - xL) : 0));

  // Right beside the area, the real hedge edge wanders either side of the
  // rebuilt straight one; a leaf tip cut off by the area would float above
  // it, a dip would leave a notch of fence below it. Those few pixels join
  // the fill so the two edges meet cleanly.
  if (yL !== null) {
    const beside = grow(mask, w, h, Math.round(8 * px));
    const below = Math.round(10 * px);
    for (let p = 0; p < w * h; p++) {
      if (mask[p] || !beside[p]) {
        continue;
      }
      const x = p % w;
      const y = (p / w) | 0;
      const edge = edgeAt(x);
      const o = p * 4;
      const leafy = greenAt(out, o) || Math.max(out[o], out[o + 1], out[o + 2]) < 80;
      if ((y < edge && leafy) || (y >= edge + th && y < edge + th + below && !leafy)) {
        mask[p] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }

  // Hedge below the edge is blended from the plain hedge around the area
  // (inverse-distance weights), so it picks up the hedge's gentle shading and
  // its border can't be seen; dark scribbles are left out so nothing smears.
  const border = [];
  for (let p = 0; p < w * h; p++) {
    if (mask[p] || !near[p]) {
      continue;
    }
    const x = p % w;
    const y = (p / w) | 0;
    const e = edgeAt(x);
    const touches = (x > 0 && mask[p - 1]) || (x < w - 1 && mask[p + 1]) || (y > 0 && mask[p - w]) || (y < h - 1 && mask[p + w]);
    if (touches && (e === null || y > e + th) && greenAt(out, p * 4) && out[p * 4 + 1] > 70) {
      border.push(x, y, out[p * 4], out[p * 4 + 1], out[p * 4 + 2]);
    }
  }
  const stride = Math.max(1, Math.ceil(border.length / 5 / BORDER_SAMPLES)) * 5;
  const pts = [];
  for (let i = 0; i < border.length; i += stride) {
    pts.push(border[i], border[i + 1], border[i + 2], border[i + 3], border[i + 4]);
  }
  const blend = (x, y) => {
    if (!pts.length) {
      return hedge;
    }
    let sw = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < pts.length; i += 5) {
      const dx = pts[i] - x;
      const dy = pts[i + 1] - y;
      const wt = 1 / (dx * dx + dy * dy + 1);
      sw += wt;
      r += pts[i + 2] * wt;
      g += pts[i + 3] * wt;
      b += pts[i + 4] * wt;
    }
    return [r / sw, g / sw, b / sw];
  };

  // Hedge below the edge is cloned from the hedge one head-width to the side,
  // on the same rows, as a clone stamp would: leaves and scribbles included.
  // Nothing is ever seen behind his head, so anything smooth reads as a
  // smudge next to the textured hedge. Only hedge is taken (fence changes
  // plank by plank sideways, so it is carried down from above instead).
  const clones = cloneSides(frame, mask, w, h, edgeAt, th);
  const cloneAt = (x, y, o) => {
    const edge = edgeAt(x);
    if (edge !== null && y < edge + th) {
      return false;
    }
    // Same row first; failing that, as far down as the source side's hedge
    // edge sits below ours, so the copy comes from under its edge too.
    for (const dir of clones) {
      const fx = frame.x0 + x + dir * frame.reach;
      for (const drop of [0, frame.drop]) {
        const fy = frame.y0 + y + drop;
        if (fx < 0 || fx >= frame.W || fy >= frame.H) {
          continue;
        }
        const q = (fy * frame.W + fx) * 4;
        if (greenAt(frame.data, q)) {
          out[o] = frame.data[q];
          out[o + 1] = frame.data[q + 1];
          out[o + 2] = frame.data[q + 2];
          return true;
        }
      }
    }
    return false;
  };

  // Where cloning can't reach: fence continues straight down (the median of a
  // few pixels above, skipping the one or two touching the area, so a stray
  // dark pixel can't run down the column as a streak), the edge's ink, then
  // hedge blended from around.
  const skip = Math.max(1, Math.round(1.5 * px));
  const run = Math.max(3, Math.round(6 * px));
  for (let x = minX; x <= maxX; x++) {
    const edge = edgeAt(x);
    let fence = null;
    let lastClear = -1;
    for (let y = 0; y < h; y++) {
      const p = y * w + x;
      if (!mask[p]) {
        lastClear = y;
        fence = null;
        continue;
      }
      const o = p * 4;
      if (cloneAt(x, y, o)) {
        continue;
      }
      let c;
      if (edge !== null && y < edge) {
        if (!fence) {
          const vals = [[], [], []];
          for (let yy = lastClear - skip; yy >= 0 && yy > lastClear - skip - run; yy--) {
            const q = (yy * w + x) * 4;
            if (mask[yy * w + x]) {
              break;
            }
            vals[0].push(out[q]);
            vals[1].push(out[q + 1]);
            vals[2].push(out[q + 2]);
          }
          fence = vals[0].length ? vals.map(median) : hedge;
        }
        c = fence;
      } else if (edge !== null && ink && y < edge + th) {
        c = ink;
      } else {
        c = blend(x, y);
      }
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
    }
  }
  return true;
}

// Border points the hedge blend draws on; more is smoother but slower.
const BORDER_SAMPLES = 160;

// The one side to clone hedge from (as a one-element list, or empty). Mixing
// sides, or running off the frame edge partway, leaves a straight seam where
// the source changes, so a side whose whole source lies inside the frame
// wins, then the one with the most hedge one head-width across. Sets
// frame.reach, the sideways distance: a little more than the head box, so
// the source clears the head entirely.
function cloneSides(frame, mask, w, h, edgeAt, th) {
  const { data, W, x0, y0, bx0, bx1 } = frame;
  frame.reach = Math.round((bx1 - bx0) * 1.1);
  let minX = w;
  let maxX = -1;
  for (let p = 0; p < w * h; p++) {
    if (mask[p]) {
      minX = Math.min(minX, p % w);
      maxX = Math.max(maxX, p % w);
    }
  }
  const scores = [1, -1].map((dir) => {
    const lo = x0 + minX + dir * frame.reach;
    const hi = x0 + maxX + dir * frame.reach;
    const inFrame = lo >= 0 && hi < W;
    let hedge = 0;
    for (let p = 0; p < w * h; p += 7) {
      if (!mask[p]) {
        continue;
      }
      const x = p % w;
      const y = (p / w) | 0;
      const edge = edgeAt(x);
      const fx = x0 + x + dir * frame.reach;
      if ((edge !== null && y < edge + th) || fx < 0 || fx >= W) {
        continue;
      }
      if (greenAt(data, ((y0 + y) * W + fx) * 4)) {
        hedge++;
      }
    }
    return { dir, inFrame, hedge };
  });
  const best = scores
    .filter((sc) => sc.hedge > 0)
    .sort((a, b) => Number(b.inFrame) - Number(a.inFrame) || b.hedge - a.hedge)[0];
  // How much lower the hedge edge sits on the chosen side than ours.
  frame.drop = 0;
  if (best) {
    const edges = [];
    const ours = [];
    for (let x = minX; x <= maxX; x += 4) {
      const fx = x0 + x + best.dir * frame.reach;
      const e = edgeAt(x);
      if (e === null || fx < 0 || fx >= W) {
        continue;
      }
      for (let y = 0; y < h; y++) {
        if (greenAt(data, ((y0 + y) * W + fx) * 4)) {
          edges.push(y);
          ours.push(e);
          break;
        }
      }
    }
    if (edges.length) {
      const mean = (a) => a.reduce((m, v) => m + v, 0) / a.length;
      frame.drop = Math.max(0, Math.round(mean(edges) - mean(ours) + th));
    }
  }
  return best ? [best.dir] : [];
}
