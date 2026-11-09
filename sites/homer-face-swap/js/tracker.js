// Finds Homer's head in a reference frame and follows it through the others.
// Everything keys off colour: the hedge is the only strongly green thing in
// these frames and Homer's skin the only saturated yellow, so a pixel's
// "greenness" doubles as "the hedge is here".

export const TRACKER_VERSION = 4;

// Greenness above this is hedge (leaves and their dark outlines).
export const GREEN_CUT = 14;

// Erosion of the silhouette before it is trusted to say "Homer is here".
// Its outermost pixels blend with the hedge and read as green, and a few
// pixels of tracking error must not read as leaves.
const CORE_ERODE = 6;

// Pixels darker than this (max channel) are outline ink; the silhouette only
// takes ink within OUTLINE_REACH px of Homer's lighter areas.
const DARK = 70;
const OUTLINE_REACH = 5;

// Head erasing: hair strokes are looked for this far above the skull, and the
// erased area is grown by ERASE_GROW px to catch the outline's soft edge.
const HAIR_REACH = 40;
const ERASE_GROW = 5;

// Radius (reference px) over which rim occlusion is averaged: tight for face
// pixels hugging the outline, wide further out, so one uncovered rim point
// can't project a thin ray of face across the leaves.
const RIM_SMOOTH = 20;
const RIM_SMOOTH_FAR = 50;

// Colour error (sum over RGB) beyond which a pixel counts as no match at all.
const TAU = 150;

// Template pixels whose colour changes by more than this across 2px are edges.
const EDGE_MIN = 60;
const FLAT_WEIGHT = 0.2;

// Exponent on scale in the score; see score().
const AREA_POWER = 1;

// Below this fraction of the head visible the estimate is noise.
const LOST_BELOW = 0.02;

export const greenness = (r, g, b) => g - (r > b ? r : b);

export const isSkin = (r, g, b) => r > 170 && g > 120 && b < 110 && r > g && r - b > 110;

// The brown fence touches Homer's skull in the opening frames; without this the
// flood fill that builds his silhouette leaks into the planks.
// Homer's own outlines are the same hue but darker, hence the brightness floor.
export function isFence(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 90 || max - min < 0.35 * max || !(r >= g && g >= b)) {
    return false;
  }
  return (60 * (g - b)) / (r - b) < 37;
}

function isMuzzle(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 110 || max > 215 || max - min < 0.4 * max || !(r >= g && g >= b)) {
    return false;
  }
  const hue = (60 * (g - b)) / (r - b);
  return hue > 36 && hue < 56;
}

// 4-connected components of a 0/1 mask.
function label(mask, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = [];
  for (let p = 0; p < w * h; p++) {
    if (!mask[p] || labels[p] >= 0) {
      continue;
    }
    const c = { id: comps.length, n: 0, x0: w, y0: h, x1: 0, y1: 0 };
    labels[p] = c.id;
    stack.push(p);
    while (stack.length) {
      const q = stack.pop();
      const x = q % w;
      const y = (q / w) | 0;
      c.n++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      if (x > 0 && mask[q - 1] && labels[q - 1] < 0) {
        labels[q - 1] = c.id;
        stack.push(q - 1);
      }
      if (x < w - 1 && mask[q + 1] && labels[q + 1] < 0) {
        labels[q + 1] = c.id;
        stack.push(q + 1);
      }
      if (y > 0 && mask[q - w] && labels[q - w] < 0) {
        labels[q - w] = c.id;
        stack.push(q - w);
      }
      if (y < h - 1 && mask[q + w] && labels[q + w] < 0) {
        labels[q + w] = c.id;
        stack.push(q + w);
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

// Fills enclosed 0 regions of at most maxArea pixels (compression specks).
// Larger enclosed regions are background seen through a gap, such as fence
// inside the loops of Homer's hair, and must stay out; so must any hole with
// hedge in it, since Homer himself has no green.
function fillSmallHoles(mask, w, h, maxArea, isGreen) {
  const inv = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    inv[p] = mask[p] ? 0 : 1;
  }
  const { labels, comps } = label(inv, w, h);
  const fill = new Set(
    comps.filter((c) => c.n <= maxArea && c.x0 > 0 && c.y0 > 0 && c.x1 < w - 1 && c.y1 < h - 1).map((c) => c.id),
  );
  for (let p = 0; p < w * h; p++) {
    if (fill.has(labels[p]) && isGreen(p)) {
      fill.delete(labels[p]);
    }
  }
  for (let p = 0; p < w * h; p++) {
    if (fill.has(labels[p])) {
      mask[p] = 1;
    }
  }
}

// The flood fill escapes along thin seams (the dark line where hedge meets
// fence, hair strokes). A morphological opening cuts them, then only the
// part still joined to the head is kept.
function openToHead(sil, w, h, labels, headId, box, W) {
  const R = 2;
  const dist = insideDistance(sil, w, h);
  const thick = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    thick[p] = dist[p] > R ? 1 : 0;
  }
  const { labels: parts, comps } = label(thick, w, h);
  const votes = new Map();
  for (let p = 0; p < w * h; p++) {
    const x = (p % w) + box.x0;
    const y = ((p / w) | 0) + box.y0;
    if (parts[p] >= 0 && labels[y * W + x] === headId) {
      votes.set(parts[p], (votes.get(parts[p]) ?? 0) + 1);
    }
  }
  const keep = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? comps[0]?.id;
  // Grow the kept part back by R, but only over pixels the flood fill accepted.
  const grown = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (parts[p] !== keep) {
      continue;
    }
    const x = p % w;
    const y = (p / w) | 0;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && sil[ny * w + nx]) {
          grown[ny * w + nx] = 1;
        }
      }
    }
  }
  sil.set(grown);
}

// From a core mask: its rim points, and for every pixel the nearest rim point
// and how far away it is.
function coreGeometry(core, r2, isOuter) {
  const nearest = new Int32Array(r2.w * r2.h).fill(-1);
  const rimDist = new Uint16Array(r2.w * r2.h);
  const queue = new Int32Array(r2.w * r2.h);
  const rimX = [];
  const rimY = [];
  const rimOuter = [];
  let qh = 0;
  let qt = 0;
  for (let p = r2.w; p < r2.w * (r2.h - 1); p++) {
    if (core[p] && (!core[p - 1] || !core[p + 1] || !core[p - r2.w] || !core[p + r2.w])) {
      const x = (p % r2.w) + r2.x0;
      const y = ((p / r2.w) | 0) + r2.y0;
      nearest[p] = rimX.length;
      rimX.push(x);
      rimY.push(y);
      rimOuter.push(isOuter(x, y) ? 1 : 0);
      queue[qt++] = p;
    }
  }
  while (qh < qt) {
    const q = queue[qh++];
    const x = q % r2.w;
    const y = (q / r2.w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= r2.w || ny >= r2.h) {
          continue;
        }
        const n = ny * r2.w + nx;
        if (nearest[n] < 0) {
          nearest[n] = nearest[q];
          rimDist[n] = rimDist[q] + 1;
          queue[qt++] = n;
        }
      }
    }
  }
  const rim = rimNeighbourhoods(rimX, rimY, RIM_SMOOTH);
  rim.far = rimNeighbourhoods(rimX, rimY, RIM_SMOOTH_FAR);
  rim.outer = Uint8Array.from(rimOuter);
  return { nearest, rimDist, rim };
}

// Shrinks the core to what is Homer in every frame where he is still out in
// the open. The reference frame is one expression; when he talks or rolls his
// eyes, edge bits of it (the corner where eye meets skull) land on hedge that
// is only behind him, and would otherwise read as leaves in front.
// frames: iterable of { img: ImageData, head: [s, 0, 0, s, ox, oy] }, read
// one at a time so a generator can produce them without holding them all.
export function stabilizeCore(ref, frames) {
  const { r2, core } = ref;
  const misses = new Uint16Array(r2.w * r2.h);
  const cells = [];
  for (let p = 0; p < core.length; p++) {
    if (core[p]) {
      cells.push(p);
    }
  }
  let count = 0;
  for (const { img, head } of frames) {
    count++;
    const { data, width: W, height: H } = img;
    for (const p of cells) {
      const x = Math.round(head[0] * ((p % r2.w) + r2.x0) + head[4]);
      const y = Math.round(head[0] * (((p / r2.w) | 0) + r2.y0) + head[5]);
      if (x < 0 || y < 0 || x >= W || y >= H) {
        continue;
      }
      const o = (y * W + x) * 4;
      if (greenness(data[o], data[o + 1], data[o + 2]) > GREEN_CUT) {
        misses[p]++;
      }
    }
  }
  if (!count) {
    return ref;
  }
  const allowed = Math.floor(count * 0.03);
  const stable = new Uint8Array(core.length);
  for (const p of cells) {
    if (misses[p] <= allowed) {
      stable[p] = 1;
    }
  }
  // Whatever fell out at the edge takes a little margin with it.
  const shrink = insideDistance(stable, r2.w, r2.h);
  for (const p of cells) {
    if (shrink[p] <= 2) {
      stable[p] = 0;
    }
  }
  return { ...ref, core: stable, ...coreGeometry(stable, r2, ref.isOuter) };
}

// For each rim point, the rim points within radius (CSR layout), so per-frame
// rim occlusion can be averaged along the outline instead of read point by point.
function rimNeighbourhoods(xs, ys, radius) {
  const n = xs.length;
  const cells = new Map();
  const key = (cx, cy) => cx * 100003 + cy;
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(xs[i] / radius), Math.floor(ys[i] / radius));
    if (!cells.has(k)) {
      cells.set(k, []);
    }
    cells.get(k).push(i);
  }
  const offsets = new Int32Array(n + 1);
  const neighbours = [];
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(xs[i] / radius);
    const cy = Math.floor(ys[i] / radius);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of cells.get(key(cx + dx, cy + dy)) ?? []) {
          if ((xs[j] - xs[i]) ** 2 + (ys[j] - ys[i]) ** 2 <= radius * radius) {
            neighbours.push(j);
          }
        }
      }
    }
    offsets[i + 1] = neighbours.length;
  }
  return { x: Float32Array.from(xs), y: Float32Array.from(ys), n, offsets, neighbours: Int32Array.from(neighbours) };
}

// Chessboard distance from the mask, for pixels within `limit` of it (others: limit + 1).
function distanceFrom(mask, w, h, limit) {
  const dist = new Uint16Array(w * h).fill(limit + 1);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  for (let p = 0; p < w * h; p++) {
    if (mask[p]) {
      dist[p] = 0;
      queue[tail++] = p;
    }
  }
  while (head < tail) {
    const q = queue[head++];
    const d = dist[q] + 1;
    if (d > limit) {
      continue;
    }
    const x = q % w;
    const y = (q / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && dist[ny * w + nx] > d) {
          dist[ny * w + nx] = d;
          queue[tail++] = ny * w + nx;
        }
      }
    }
  }
  return dist;
}

// Chessboard distance from each mask pixel to the nearest non-mask pixel or border.
function insideDistance(mask, w, h) {
  const dist = new Uint16Array(w * h).fill(65535);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!mask[p]) {
        dist[p] = 0;
      } else if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        dist[p] = 1;
        queue[tail++] = p;
      }
    }
  }
  for (let p = 0; p < w * h; p++) {
    if (dist[p] === 0) {
      queue[tail++] = p;
    }
  }
  while (head < tail) {
    const q = queue[head++];
    const x = q % w;
    const y = (q / w) | 0;
    const d = dist[q] + 1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          continue;
        }
        const n = ny * w + nx;
        if (dist[n] > d) {
          dist[n] = d;
          queue[tail++] = n;
        }
      }
    }
  }
  return dist;
}

// Studies the reference frame: where the head is, its silhouette, the
// colour template the tracker matches, and where a replacement face sits.
export function analyzeReference(img) {
  const { width: W, height: H, data } = img;
  const skin = new Uint8Array(W * H);
  for (let p = 0, o = 0; p < W * H; p++, o += 4) {
    skin[p] = isSkin(data[o], data[o + 1], data[o + 2]) ? 1 : 0;
  }
  const { labels, comps } = label(skin, W, H);
  // Head = the highest sizeable patch of skin; arms and hands sit lower.
  const head = comps.filter((c) => c.n >= W * H * 0.003).sort((a, b) => a.y0 - b.y0)[0];
  if (!head) {
    return null;
  }

  const hw = head.x1 - head.x0 + 1;
  const hh = head.y1 - head.y0 + 1;
  const box = {
    x0: Math.max(0, Math.floor(head.x0 - 0.3 * hw)),
    y0: Math.max(0, Math.floor(head.y0 - 0.15 * hh)),
    x1: Math.min(W - 1, Math.ceil(head.x1 + 0.3 * hw)),
    y1: head.y1,
  };
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;

  // Silhouette: everything reachable from his skin that is neither hedge nor
  // fence. Dark pixels are only crossed near his light areas: that takes in
  // his outlines and the eyes behind them, but stops at the thick dark seam
  // where the hedge's top edge meets his skull.
  const kind = new Uint8Array(bw * bh); // 0 background, 1 light, 2 dark
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const o = ((y + box.y0) * W + x + box.x0) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      if (greenness(r, g, b) <= GREEN_CUT && !isFence(r, g, b)) {
        kind[y * bw + x] = Math.max(r, g, b) < DARK ? 2 : 1;
      }
    }
  }
  const sil = new Uint8Array(bw * bh);
  const stack = [];
  for (let y = head.y0; y <= head.y1; y++) {
    for (let x = head.x0; x <= head.x1; x++) {
      if (labels[y * W + x] === head.id) {
        const q = (y - box.y0) * bw + (x - box.x0);
        sil[q] = 1;
        stack.push(q);
      }
    }
  }
  const floodLight = () => {
    while (stack.length) {
      const q = stack.pop();
      const x = q % bw;
      const y = (q / bw) | 0;
      for (const n of [x > 0 ? q - 1 : -1, x < bw - 1 ? q + 1 : -1, y > 0 ? q - bw : -1, y < bh - 1 ? q + bw : -1]) {
        if (n >= 0 && !sil[n] && kind[n] === 1) {
          sil[n] = 1;
          stack.push(n);
        }
      }
    }
  };
  // Each pass crosses one band of ink: skin -> eye outline -> eye white ->
  // pupil, and so on.
  for (let pass = 0; pass < 3; pass++) {
    floodLight();
    const near = distanceFrom(sil, bw, bh, OUTLINE_REACH);
    for (let p = 0; p < bw * bh; p++) {
      if (!sil[p] && kind[p] === 2 && near[p] <= OUTLINE_REACH) {
        sil[p] = 1;
        stack.push(p);
      }
    }
  }
  floodLight();
  openToHead(sil, bw, bh, labels, head.id, box, W);
  fillSmallHoles(sil, bw, bh, 150, (q) => {
    const o = (((q / bw) | 0) + box.y0) * W * 4 + ((q % bw) + box.x0) * 4;
    return greenness(data[o], data[o + 1], data[o + 2]) > GREEN_CUT;
  });
  const dist = insideDistance(sil, bw, bh);

  // Where the replacement face goes: skull top to the bottom of the muzzle.
  const muzzleMask = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const o = ((y + box.y0) * W + x + box.x0) * 4;
      muzzleMask[y * bw + x] = sil[y * bw + x] && isMuzzle(data[o], data[o + 1], data[o + 2]) ? 1 : 0;
    }
  }
  // Anti-aliased outlines everywhere share the muzzle's colour; erosion drops them.
  const muzzleDist = insideDistance(muzzleMask, bw, bh);
  for (let p = 0; p < bw * bh; p++) {
    muzzleMask[p] = muzzleDist[p] > 3 ? 1 : 0;
  }
  const muzzle = label(muzzleMask, bw, bh).comps.sort((a, b) => b.n - a.n)[0];
  const faceTop = head.y0;
  const faceBottom = muzzle && muzzle.n > hw * 4 ? muzzle.y1 + 3 + box.y0 : head.y0 + Math.round(0.8 * hh);
  let minX = W;
  let maxX = 0;
  for (let y = faceTop; y <= faceBottom; y++) {
    for (let x = 0; x < bw; x++) {
      if (sil[(y - box.y0) * bw + x]) {
        minX = Math.min(minX, x + box.x0);
        maxX = Math.max(maxX, x + box.x0);
      }
    }
  }
  const anchor = { cx: (minX + maxX) / 2, cy: (faceTop + faceBottom) / 2, h: faceBottom - faceTop, w: maxX - minX };

  // What to paint out so nothing of the original head peeks around the new
  // face: the silhouette down to the muzzle, plus the ink above the skull (his
  // hair strokes) that the silhouette leaves out, grown a few pixels to take
  // the anti-aliased edge with it. The neck below stays to hold the face up.
  const eraseBottom = Math.min(bh - 1, faceBottom - box.y0 + ERASE_GROW);
  const hairBottom = head.y0 - box.y0 + Math.round(0.35 * hh);
  const near = distanceFrom(sil, bw, bh, HAIR_REACH);
  const erase = new Uint8Array(bw * bh);
  for (let y = 0; y <= eraseBottom; y++) {
    for (let x = 0; x < bw; x++) {
      const p = y * bw + x;
      const o = ((y + box.y0) * W + x + box.x0) * 4;
      // Hair ink (~80 bright, softer at the tips) is darker than the fence planks (~118).
      const inked = Math.max(data[o], data[o + 1], data[o + 2]) < 112 && greenness(data[o], data[o + 1], data[o + 2]) <= GREEN_CUT;
      if (sil[p] || (y <= hairBottom && near[p] <= HAIR_REACH && inked)) {
        erase[p] = 1;
      }
    }
  }
  const grown = distanceFrom(erase, bw, bh, ERASE_GROW);
  for (let y = 0; y <= eraseBottom; y++) {
    for (let x = 0; x < bw; x++) {
      if (grown[y * bw + x] <= ERASE_GROW) {
        erase[y * bw + x] = 1;
      }
    }
  }

  // Core: the light parts of Homer (skin, eye whites, muzzle) well inside his
  // outline, where "not green" reliably means "Homer is in front". Ink is left
  // out: where his outline meets the hedge's own dark edge, a pixel can't be
  // told from leaves. Everything outside the core, ink included, is judged by
  // the nearest point of the core's rim, so leaves that swallow his edge
  // swallow the face too.
  const margin = Math.round(0.9 * Math.max(bw, bh));
  const r2 = { x0: box.x0 - margin, y0: box.y0 - margin, w: bw + 2 * margin, h: bh + 2 * margin };
  const core = new Uint8Array(r2.w * r2.h);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const o = ((y + box.y0) * W + x + box.x0) * 4;
      if (dist[y * bw + x] > CORE_ERODE && Math.max(data[o], data[o + 1], data[o + 2]) >= DARK) {
        core[(y + margin) * r2.w + x + margin] = 1;
      }
    }
  }
  // A rim point is on his outer outline (rather than around ink inside the
  // face) when it lies within a couple of pixels of the core's erosion depth.
  const isOuter = (x, y) => {
    const bx = x - box.x0;
    const by = y - box.y0;
    return bx >= 0 && by >= 0 && bx < bw && by < bh && dist[by * bw + bx] <= CORE_ERODE + 5;
  };
  const geometry = coreGeometry(core, r2, isOuter);

  // Colour template, minus the outermost ring which blends with the hedge.
  // Flat yellow matches flat yellow at any position or size, so the template
  // leans on edges (outlines, eyes, pupils, muzzle) and keeps a light
  // sprinkling of flat pixels.
  const edgeAt = (x, y) => {
    const o = (y * W + x) * 4;
    let m = 0;
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) {
        continue;
      }
      const q = (ny * W + nx) * 4;
      const d = Math.abs(data[o] - data[q]) + Math.abs(data[o + 1] - data[q + 1]) + Math.abs(data[o + 2] - data[q + 2]);
      if (d > m) {
        m = d;
      }
    }
    return m;
  };
  const edges = [];
  const flats = [];
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (dist[y * bw + x] > 1) {
        (edgeAt(x + box.x0, y + box.y0) > EDGE_MIN ? edges : flats).push(x + box.x0, y + box.y0);
      }
    }
  }
  const template = (edgeStride, flatStride) => {
    const xs = [];
    const ys = [];
    const rgb = [];
    const w = [];
    const take = (list, stride, weight) => {
      for (let i = 0; i < list.length; i += 2 * stride) {
        const o = (list[i + 1] * W + list[i]) * 4;
        xs.push(list[i]);
        ys.push(list[i + 1]);
        rgb.push(data[o], data[o + 1], data[o + 2]);
        w.push(weight);
      }
    };
    take(edges, edgeStride, 1);
    take(flats, flatStride, FLAT_WEIGHT);
    return {
      xs: Float32Array.from(xs),
      ys: Float32Array.from(ys),
      rgb: Uint8Array.from(rgb),
      w: Float32Array.from(w),
      wsum: w.reduce((a, b) => a + b, 0),
      n: xs.length,
    };
  };

  return {
    W,
    H,
    head,
    box,
    sil,
    erase,
    anchor,
    center: { x: anchor.cx, y: anchor.cy },
    r2,
    core,
    isOuter,
    ...geometry,
    coarse: template(6, 40),
    fine: template(2, 12),
  };
}

// Matching cost of the template under q = s * p + (ox, oy), plus the fraction
// of template pixels that landed on something other than hedge.
//
// Only visible pixels that match earn anything; landing on hedge earns
// nothing, since Homer may simply be behind it. Each sample is weighted by
// the frame area it covers (s squared), otherwise shrinking the template to
// cram more samples into a small visible patch would always win.
function score(img, tpl, s, ox, oy, bilinear) {
  const { data, width: W, height: H } = img;
  const { xs, ys, rgb, w, wsum, n } = tpl;
  let reward = 0;
  let vis = 0;
  for (let i = 0; i < n; i++) {
    const qx = s * xs[i] + ox;
    const qy = s * ys[i] + oy;
    let r;
    let g;
    let b;
    if (bilinear) {
      const x0 = Math.floor(qx);
      const y0 = Math.floor(qy);
      if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) {
        continue;
      }
      const fx = qx - x0;
      const fy = qy - y0;
      const o = (y0 * W + x0) * 4;
      const o2 = o + W * 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      r = data[o] * w00 + data[o + 4] * w10 + data[o2] * w01 + data[o2 + 4] * w11;
      g = data[o + 1] * w00 + data[o + 5] * w10 + data[o2 + 1] * w01 + data[o2 + 5] * w11;
      b = data[o + 2] * w00 + data[o + 6] * w10 + data[o2 + 2] * w01 + data[o2 + 6] * w11;
    } else {
      const x = Math.round(qx);
      const y = Math.round(qy);
      if (x < 0 || y < 0 || x >= W || y >= H) {
        continue;
      }
      const o = (y * W + x) * 4;
      r = data[o];
      g = data[o + 1];
      b = data[o + 2];
    }
    if (g - (r > b ? r : b) > GREEN_CUT) {
      continue;
    }
    vis++;
    const e = Math.abs(r - rgb[i * 3]) + Math.abs(g - rgb[i * 3 + 1]) + Math.abs(b - rgb[i * 3 + 2]);
    if (e < TAU) {
      reward += w[i] * (TAU - e);
    }
  }
  return [(-(s ** AREA_POWER) * reward) / wsum, vis / n];
}

// Best head transform for one frame, searched around a prediction.
// Transform: q = s * (p - c) + c + (dx, dy), c = reference head centre.
function estimate(img, ref, pred) {
  const { x: cx, y: cy } = ref.center;
  const evalAt = (tpl, s, dx, dy, bilinear) => {
    const [cost, vis] = score(img, tpl, s, cx * (1 - s) + dx, cy * (1 - s) + dy, bilinear);
    // A pull towards the prediction, stronger as less of Homer is visible.
    const prior = pred.pull * (0.004 * ((dx - pred.dx) ** 2 + (dy - pred.dy) ** 2) + 40 * (s / pred.s - 1) ** 2);
    return { s, dx, dy, cost: cost + prior, vis };
  };

  // Coarse grid around the prediction, then two tighter passes around the best.
  const passes = [
    { tpl: ref.coarse, radius: 6, step: 3, sStep: 0.02, bilinear: false },
    { tpl: ref.coarse, radius: 2, step: 1, sStep: 0.008, bilinear: false },
    { tpl: ref.fine, radius: 2, step: 0.25, sStep: 0.003, bilinear: true },
  ];
  let best = pred;
  for (const pass of passes) {
    // Costs from different templates don't compare, so re-score the incumbent.
    const base = evalAt(pass.tpl, best.s, best.dx, best.dy, pass.bilinear);
    best = base;
    for (let k = -1; k <= 1; k++) {
      const s = base.s * (1 + pass.sStep * k);
      for (let j = -pass.radius; j <= pass.radius; j++) {
        for (let i = -pass.radius; i <= pass.radius; i++) {
          const c = evalAt(pass.tpl, s, base.dx + i * pass.step, base.dy + j * pass.step, pass.bilinear);
          if (c.cost < best.cost) {
            best = c;
          }
        }
      }
    }
  }
  return best;
}

// Constant-velocity prediction. With little of Homer visible the match mostly
// latches onto the hole's edge, so momentum is damped and the prior tightened
// rather than letting the head coast off as the hedge closes in.
function predict(track, t, dir) {
  const prev = track[t - dir];
  const prev2 = track[t - 2 * dir];
  const pull = Math.min(8, Math.max(1, 0.3 / Math.max(prev.conf, 0.01)));
  if (!prev2 || prev.lost || prev2.lost) {
    return { s: prev.s, dx: prev.dx, dy: prev.dy, pull };
  }
  const damp = prev.conf > 0.3 ? 0.8 : 0.2;
  return {
    s: prev.s * (1 + damp * 0.6 * (prev.s / prev2.s - 1)),
    dx: prev.dx + damp * (prev.dx - prev2.dx),
    dy: prev.dy + damp * (prev.dy - prev2.dy),
    pull,
  };
}

// Tracks every frame outward from the reference. getFrame(i) resolves to ImageData.
export async function trackAll(ref, refIndex, count, getFrame, onProgress) {
  const track = new Array(count);
  track[refIndex] = { s: 1, dx: 0, dy: 0, conf: 1, lost: false };
  let done = 1;
  for (const dir of [1, -1]) {
    for (let t = refIndex + dir; t >= 0 && t < count; t += dir) {
      const pred = predict(track, t, dir);
      const best = estimate(await getFrame(t), ref, pred);
      track[t] = best.vis < LOST_BELOW
        ? { s: pred.s, dx: pred.dx, dy: pred.dy, conf: best.vis, lost: true }
        : { s: best.s, dx: best.dx, dy: best.dy, conf: best.vis, lost: false };
      onProgress?.(++done / count);
    }
  }
  return track;
}

// Steadies the track with a robust local-linear fit (LOWESS). Homer's
// expressions nudge the match by a few pixels from frame to frame while his
// head barely moves; a straight line through each neighbourhood removes that
// jitter yet follows the camera pan without lag, and the robustness passes
// stop a single bad frame from dragging its neighbours. Scale changes slowly,
// so it gets twice the window.
export function smoothTrack(track, level) {
  if (!level) {
    return track;
  }
  const n = track.length;
  const base = track.map((t) => (t.lost ? 0.05 : 0.2 + t.conf));
  const robust = new Float64Array(n).fill(1);
  const fit = (key, radius) => {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sw = 0;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let sxy = 0;
      for (let j = Math.max(0, i - radius); j <= Math.min(n - 1, i + radius); j++) {
        const u = Math.abs(j - i) / (radius + 1);
        const w = (1 - u * u * u) ** 3 * base[j] * robust[j];
        const x = j - i;
        sw += w;
        sx += w * x;
        sy += w * track[j][key];
        sxx += w * x * x;
        sxy += w * x * track[j][key];
      }
      const det = sw * sxx - sx * sx;
      // Intercept of the weighted line at x = 0, or the weighted mean if degenerate.
      out[i] = sw <= 1e-9 ? track[i][key] : Math.abs(det) < 1e-9 ? sy / sw : (sy * sxx - sx * sxy) / det;
    }
    return out;
  };
  const posRadius = 2 * level;
  let dx;
  let dy;
  for (let pass = 0; pass < 3; pass++) {
    dx = fit('dx', posRadius);
    dy = fit('dy', posRadius);
    const res = track.map((t, i) => Math.hypot(t.dx - dx[i], t.dy - dy[i]));
    const scale = 6 * Math.max(0.5, [...res].sort((a, b) => a - b)[Math.floor(n / 2)]);
    res.forEach((r, i) => {
      const u = r / scale;
      robust[i] = u >= 1 ? 0.01 : (1 - u * u) ** 2;
    });
  }
  const s = fit('s', 4 * level);
  return track.map((t, i) => ({ ...t, s: s[i], dx: dx[i], dy: dy[i] }));
}
