// RGBA pixels -> opaque RGB PNG. The browser's own canvas PNG encoder takes
// about a second per 960x720 frame; native deflate plus a per-row filter
// choice is many times faster.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc(bytes, c = 0xffffffff) {
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  }
  return c;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  dv.setUint32(8 + data.length, (crc(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

// Filtered scanlines: each row tries None, Sub, Up and Paeth and keeps the
// one with the smallest sum of absolute values (the usual libpng heuristic).
function scanlines(rgba, w, h) {
  const stride = w * 3;
  const out = new Uint8Array((stride + 1) * h);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  const trial = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];
  for (let y = 0; y < h; y++) {
    for (let x = 0, o = y * w * 4, j = 0; x < w; x++, o += 4, j += 3) {
      cur[j] = rgba[o];
      cur[j + 1] = rgba[o + 1];
      cur[j + 2] = rgba[o + 2];
    }
    const [t0, t1, t2, t3] = trial;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    for (let i = 0; i < stride; i++) {
      const x = cur[i];
      const a = i >= 3 ? cur[i - 3] : 0;
      const b = prev[i];
      const c = i >= 3 ? prev[i - 3] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const v1 = (x - a) & 255;
      const v2 = (x - b) & 255;
      const v3 = (x - paeth) & 255;
      t0[i] = x;
      t1[i] = v1;
      t2[i] = v2;
      t3[i] = v3;
      s0 += x < 128 ? x : 256 - x;
      s1 += v1 < 128 ? v1 : 256 - v1;
      s2 += v2 < 128 ? v2 : 256 - v2;
      s3 += v3 < 128 ? v3 : 256 - v3;
    }
    const scores = [s0, s1, s2, s3];
    const best = scores.indexOf(Math.min(s0, s1, s2, s3));
    const row = y * (stride + 1);
    out[row] = [0, 1, 2, 4][best];
    out.set(trial[best], row + 1);
    [prev, cur] = [cur, prev];
  }
  return out;
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Encodes width x height RGBA pixels (alpha ignored) as a PNG Blob.
export async function encodePng(rgba, width, height) {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const idat = await deflate(scanlines(rgba, width, height));
  return new Blob(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))],
    { type: 'image/png' },
  );
}
