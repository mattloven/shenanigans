// Web worker (module): enhances one frame at a time. Replies with the PNG to
// save, or with the pixels when the page only wants a preview.
import { enhanceFrame } from './enhance.js';
import { encodePng } from './png.js';

self.onmessage = async (e) => {
  const { id, bitmap, look, shared, png } = e.data;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const out = enhanceFrame(ctx.getImageData(0, 0, canvas.width, canvas.height), look, shared);
    if (png) {
      self.postMessage({ id, blob: await encodePng(new Uint8Array(out.data.buffer), out.width, out.height) });
    } else {
      self.postMessage({ id, image: out }, [out.data.buffer]);
    }
  } catch (err) {
    self.postMessage({ id, error: err?.message ?? String(err) });
  }
};
