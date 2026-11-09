// Web worker: quantises frames and writes an animated GIF89a.
//
// Each frame gets its own palette, spent only on the pixels that changed;
// unchanged pixels are left transparent so the previous frame shows through,
// and the frame is cropped to the box that changed. The face is weighted up
// in the palette so skin tones don't band against the cartoon's flat colours.

const PRESETS = {
  // tolerance: colour error (sum over RGB) under which a pixel counts as unchanged.
  standard: { colors: 128, bits: 5, kmeans: 0, dither: false, tolerance: 18, faceWeight: 2 },
  high: { colors: 256, bits: 6, kmeans: 2, dither: false, tolerance: 8, faceWeight: 4 },
  maximum: { colors: 256, bits: 6, kmeans: 4, dither: true, tolerance: 3, faceWeight: 6 },
};

let writer = null;

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'start') {
      writer = new GifWriter(m.width, m.height, m.loop, PRESETS[m.quality] ?? PRESETS.high);
    } else if (m.type === 'frame') {
      writer.add(new Uint8Array(m.rgba), m.delay, m.mask ? new Uint8Array(m.mask) : null);
      self.postMessage({ type: 'progress', index: m.index });
    } else if (m.type === 'finish') {
      const blob = writer.finish();
      self.postMessage({ type: 'done', blob, frames: writer.frames });
      writer = null;
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message ?? String(err) });
  }
};

class Bytes {
  constructor(size = 1 << 16) {
    this.buf = new Uint8Array(size);
    this.len = 0;
  }
  ensure(n) {
    if (this.len + n > this.buf.length) {
      const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
      next.set(this.buf.subarray(0, this.len));
      this.buf = next;
    }
  }
  byte(b) {
    this.ensure(1);
    this.buf[this.len++] = b;
  }
  u16(v) {
    this.byte(v & 255);
    this.byte((v >> 8) & 255);
  }
  bytes(arr) {
    this.ensure(arr.length);
    this.buf.set(arr, this.len);
    this.len += arr.length;
  }
  str(s) {
    for (let i = 0; i < s.length; i++) {
      this.byte(s.charCodeAt(i));
    }
  }
  done() {
    return this.buf.slice(0, this.len);
  }
}

class GifWriter {
  constructor(w, h, loop, preset) {
    this.w = w;
    this.h = h;
    this.p = preset;
    this.parts = [];
    this.shown = new Uint8Array(w * h * 3);
    this.frames = 0;
    this.lastGce = null;
    const head = new Bytes(64);
    head.str('GIF89a');
    head.u16(w);
    head.u16(h);
    head.byte(0x70); // no global colour table; every frame carries its own
    head.byte(0);
    head.byte(0);
    if (loop) {
      head.bytes([0x21, 0xff, 0x0b]);
      head.str('NETSCAPE2.0');
      head.bytes([3, 1, 0, 0, 0]); // loop count 0 = forever
    }
    // "Once" omits the NETSCAPE block: a loop count of 1 means play twice in most viewers.
    this.parts.push(head.done());
  }

  add(rgba, delay, mask) {
    const { w, h, p, shown } = this;
    const first = this.frames === 0;
    const dirty = new Uint8Array(w * h);
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!first) {
          const o = i * 4;
          const s = i * 3;
          const d = Math.abs(rgba[o] - shown[s]) + Math.abs(rgba[o + 1] - shown[s + 1]) + Math.abs(rgba[o + 2] - shown[s + 2]);
          if (d <= p.tolerance) {
            continue;
          }
        }
        dirty[i] = 1;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) {
      this.stretchLast(delay);
      return;
    }

    const reserve = first ? 0 : 1;
    const palette = quantize(rgba, dirty, mask, w, x0, y0, x1, y1, p.colors - reserve, p);
    const count = palette.length / 3;
    const trans = count;
    let tableBits = 1;
    while (1 << tableBits < count + reserve) {
      tableBits++;
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const indices = mapPixels(rgba, dirty, mask, w, x0, y0, bw, bh, palette, p, trans);

    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const c = indices[y * bw + x];
        if (c === trans && reserve) {
          continue;
        }
        const s = ((y + y0) * w + x + x0) * 3;
        shown[s] = palette[c * 3];
        shown[s + 1] = palette[c * 3 + 1];
        shown[s + 2] = palette[c * 3 + 2];
      }
    }

    const out = new Bytes(bw * bh + 1024);
    const gce = [0x21, 0xf9, 0x04, (1 << 2) | reserve, 0, 0, reserve ? trans : 0, 0];
    out.bytes(gce);
    const gceAt = 4;
    out.byte(0x2c);
    out.u16(x0);
    out.u16(y0);
    out.u16(bw);
    out.u16(bh);
    out.byte(0x80 | (tableBits - 1));
    const table = new Uint8Array(3 << tableBits);
    table.set(palette);
    out.bytes(table);
    lzw(indices, Math.max(2, tableBits), out);
    const bytes = out.done();
    this.parts.push(bytes);
    this.lastGce = { bytes, at: gceAt, delay: 0 };
    this.frames++;
    this.stretchLast(delay);
  }

  // Adds time to the last written frame (also used when a frame changed nothing).
  stretchLast(delay) {
    const g = this.lastGce;
    g.delay = Math.min(65535, g.delay + Math.max(2, delay));
    g.bytes[g.at] = g.delay & 255;
    g.bytes[g.at + 1] = g.delay >> 8;
  }

  finish() {
    this.parts.push(new Uint8Array([0x3b]));
    return new Blob(this.parts, { type: 'image/gif' });
  }
}

// Shared histogram buffers, sized for 6 bits per channel.
const HIST = 1 << 18;
const hCount = new Float64Array(HIST);
const hR = new Float64Array(HIST);
const hG = new Float64Array(HIST);
const hB = new Float64Array(HIST);
const lut = new Int16Array(HIST);

// Median cut over a weighted colour histogram of the changed pixels, then a
// few k-means passes to settle the colours.
function quantize(rgba, dirty, mask, w, x0, y0, x1, y1, maxColors, p) {
  const shift = 8 - p.bits;
  const touched = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (!dirty[i]) {
        continue;
      }
      const o = i * 4;
      const r = rgba[o];
      const g = rgba[o + 1];
      const b = rgba[o + 2];
      const key = ((r >> shift) << (2 * p.bits)) | ((g >> shift) << p.bits) | (b >> shift);
      const wt = mask && mask[i] ? p.faceWeight : 1;
      if (hCount[key] === 0) {
        touched.push(key);
      }
      hCount[key] += wt;
      hR[key] += r * wt;
      hG[key] += g * wt;
      hB[key] += b * wt;
    }
  }
  const n = touched.length;
  const cr = new Float64Array(n);
  const cg = new Float64Array(n);
  const cb = new Float64Array(n);
  const cw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = touched[i];
    cw[i] = hCount[k];
    cr[i] = hR[k] / hCount[k];
    cg[i] = hG[k] / hCount[k];
    cb[i] = hB[k] / hCount[k];
    hCount[k] = 0;
    hR[k] = 0;
    hG[k] = 0;
    hB[k] = 0;
  }

  if (n <= maxColors) {
    const pal = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      pal[i * 3] = Math.round(cr[i]);
      pal[i * 3 + 1] = Math.round(cg[i]);
      pal[i * 3 + 2] = Math.round(cb[i]);
    }
    return pal;
  }

  const chans = [cr, cg, cb];
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    order[i] = i;
  }
  const stats = (start, end) => {
    let W = 0;
    const s = [0, 0, 0];
    const q = [0, 0, 0];
    for (let i = start; i < end; i++) {
      const c = order[i];
      const wt = cw[c];
      W += wt;
      for (let ch = 0; ch < 3; ch++) {
        const v = chans[ch][c];
        s[ch] += v * wt;
        q[ch] += v * v * wt;
      }
    }
    const vars = s.map((sv, ch) => q[ch] - (sv * sv) / W);
    const axis = vars.indexOf(Math.max(...vars));
    return { start, end, W, sse: vars[0] + vars[1] + vars[2], axis };
  };
  const boxes = [stats(0, n)];
  while (boxes.length < maxColors) {
    let bi = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].end - boxes[i].start > 1 && (bi < 0 || boxes[i].sse > boxes[bi].sse)) {
        bi = i;
      }
    }
    if (bi < 0 || boxes[bi].sse <= 0) {
      break;
    }
    const box = boxes[bi];
    const ch = chans[box.axis];
    const slice = Array.from(order.subarray(box.start, box.end)).sort((a, b) => ch[a] - ch[b]);
    order.set(slice, box.start);
    let acc = 0;
    let cut = box.start + 1;
    for (let i = box.start; i < box.end - 1; i++) {
      acc += cw[order[i]];
      if (acc >= box.W / 2) {
        cut = i + 1;
        break;
      }
    }
    boxes.splice(bi, 1, stats(box.start, cut), stats(cut, box.end));
  }

  const k = boxes.length;
  const pr = new Float64Array(k);
  const pg = new Float64Array(k);
  const pb = new Float64Array(k);
  boxes.forEach((box, j) => {
    let W = 0;
    for (let i = box.start; i < box.end; i++) {
      const c = order[i];
      W += cw[c];
      pr[j] += cr[c] * cw[c];
      pg[j] += cg[c] * cw[c];
      pb[j] += cb[c] * cw[c];
    }
    pr[j] /= W;
    pg[j] /= W;
    pb[j] /= W;
  });

  for (let it = 0; it < p.kmeans; it++) {
    const sr = new Float64Array(k);
    const sg = new Float64Array(k);
    const sb = new Float64Array(k);
    const sw = new Float64Array(k);
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bd = Infinity;
      for (let j = 0; j < k; j++) {
        const dr = cr[i] - pr[j];
        const dg = cg[i] - pg[j];
        const db = cb[i] - pb[j];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      sr[best] += cr[i] * cw[i];
      sg[best] += cg[i] * cw[i];
      sb[best] += cb[i] * cw[i];
      sw[best] += cw[i];
    }
    for (let j = 0; j < k; j++) {
      if (sw[j] > 0) {
        pr[j] = sr[j] / sw[j];
        pg[j] = sg[j] / sw[j];
        pb[j] = sb[j] / sw[j];
      }
    }
  }

  const pal = new Uint8Array(k * 3);
  for (let j = 0; j < k; j++) {
    pal[j * 3] = Math.round(pr[j]);
    pal[j * 3 + 1] = Math.round(pg[j]);
    pal[j * 3 + 2] = Math.round(pb[j]);
  }
  return pal;
}

function nearest(pal, r, g, b) {
  let best = 0;
  let bd = Infinity;
  for (let j = 0; j < pal.length; j += 3) {
    const dr = r - pal[j];
    const dg = g - pal[j + 1];
    const db = b - pal[j + 2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) {
      bd = d;
      best = j / 3;
    }
  }
  return best;
}

// Palette index per pixel of the changed box; unchanged pixels get `trans`.
// Maximum quality error-diffuses the face only: the cartoon's flat colours
// map cleanly, and dithering them would just add noise and bytes.
function mapPixels(rgba, dirty, mask, w, x0, y0, bw, bh, pal, p, trans) {
  const shift = 8 - p.bits;
  const half = 1 << Math.max(0, shift - 1);
  lut.fill(-1, 0, 1 << (3 * p.bits));
  const lookup = (r, g, b) => {
    const key = ((r >> shift) << (2 * p.bits)) | ((g >> shift) << p.bits) | (b >> shift);
    let c = lut[key];
    if (c < 0) {
      c = nearest(pal, ((r >> shift) << shift) + half, ((g >> shift) << shift) + half, ((b >> shift) << shift) + half);
      lut[key] = c;
    }
    return c;
  };
  const out = new Uint8Array(bw * bh);
  const dither = p.dither && mask;
  let errCur = dither ? new Float32Array((bw + 2) * 3) : null;
  let errNext = dither ? new Float32Array((bw + 2) * 3) : null;
  for (let y = 0; y < bh; y++) {
    const ltr = (y & 1) === 0;
    for (let n = 0; n < bw; n++) {
      const x = ltr ? n : bw - 1 - n;
      const i = (y + y0) * w + x + x0;
      if (!dirty[i]) {
        out[y * bw + x] = trans;
        continue;
      }
      const o = i * 4;
      if (!dither || !mask[i]) {
        out[y * bw + x] = lookup(rgba[o], rgba[o + 1], rgba[o + 2]);
        continue;
      }
      const e = (x + 1) * 3;
      const r = clamp(rgba[o] + errCur[e]);
      const g = clamp(rgba[o + 1] + errCur[e + 1]);
      const b = clamp(rgba[o + 2] + errCur[e + 2]);
      const c = lookup(r, g, b);
      out[y * bw + x] = c;
      const er = r - pal[c * 3];
      const eg = g - pal[c * 3 + 1];
      const eb = b - pal[c * 3 + 2];
      const dir = ltr ? 1 : -1;
      const spread = (buf, dx, f) => {
        const xx = x + dx;
        if (xx < 0 || xx >= bw) {
          return;
        }
        const j = (y0 + y + (buf === errNext ? 1 : 0)) * w + xx + x0;
        if (!mask[j]) {
          return;
        }
        const t = (xx + 1) * 3;
        buf[t] += er * f;
        buf[t + 1] += eg * f;
        buf[t + 2] += eb * f;
      };
      spread(errCur, dir, 7 / 16);
      if (y + 1 < bh) {
        spread(errNext, -dir, 3 / 16);
        spread(errNext, 0, 5 / 16);
        spread(errNext, dir, 1 / 16);
      }
    }
    if (dither) {
      [errCur, errNext] = [errNext, errCur];
      errNext.fill(0);
    }
  }
  return out;
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

// GIF-flavoured LZW with variable code width and clear codes when the table fills.
const LZW_CODE = new Int32Array(1 << 20);
const LZW_STAMP = new Int32Array(1 << 20);
let lzwGen = 0;

function lzw(indices, minCode, out) {
  out.byte(minCode);
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let size;
  let next;
  let acc = 0;
  let nbits = 0;
  const block = new Uint8Array(255);
  let blen = 0;
  const put = (b) => {
    block[blen++] = b;
    if (blen === 255) {
      out.byte(255);
      out.bytes(block);
      blen = 0;
    }
  };
  const emit = (code) => {
    acc |= code << nbits;
    nbits += size;
    while (nbits >= 8) {
      put(acc & 255);
      acc >>>= 8;
      nbits -= 8;
    }
  };
  // The decoder widens codes once its table reaches 2^size; it builds the
  // table one code behind us, so we check before adding our entry.
  const widen = () => {
    if (next === 1 << size && size < 12) {
      size++;
    }
  };
  const reset = () => {
    lzwGen++;
    size = minCode + 1;
    next = eoi + 1;
  };
  reset();
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    if (LZW_STAMP[key] === lzwGen) {
      prefix = LZW_CODE[key];
      continue;
    }
    emit(prefix);
    widen();
    if (next < 4096) {
      LZW_CODE[key] = next++;
      LZW_STAMP[key] = lzwGen;
    } else {
      emit(clear);
      reset();
    }
    prefix = k;
  }
  emit(prefix);
  widen();
  emit(eoi);
  if (nbits > 0) {
    put(acc & 255);
  }
  if (blen) {
    out.byte(blen);
    out.bytes(block.subarray(0, blen));
  }
  out.byte(0);
}
