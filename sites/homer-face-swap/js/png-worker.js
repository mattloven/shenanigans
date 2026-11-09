// Web worker (module): encodes frames to PNG off the main thread.
import { encodePng } from './png.js';

self.onmessage = async (e) => {
  const { id, rgba, width, height } = e.data;
  try {
    self.postMessage({ id, blob: await encodePng(new Uint8Array(rgba), width, height) });
  } catch (err) {
    self.postMessage({ id, error: err?.message ?? String(err) });
  }
};
