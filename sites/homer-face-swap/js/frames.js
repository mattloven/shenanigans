// Loads source frames: from the local server's frames folder, from picked
// image files, or from a single GIF (decoded with WebCodecs where available).
//
// Each frame is held only as a working-size copy (workWidth wide) for
// tracking and the preview; `full()` decodes the original-size image when an
// export needs it, and the caller closes it. Holding 147 upscaled frames at
// full size runs to gigabytes and takes the browser down with it.
//
// Frames that won't decode are skipped and reported, rather than failing
// the whole load.

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });

// Decodes a source into a frame record; `reopen` yields the source again.
async function toFrame(name, reopen, workWidth) {
  const full = await createImageBitmap(await reopen());
  const { width, height } = full;
  let bitmap = full;
  if (width > workWidth) {
    bitmap = await createImageBitmap(full, {
      resizeWidth: workWidth,
      resizeHeight: Math.round((height * workWidth) / width),
      resizeQuality: 'high',
    });
    full.close();
  }
  return { name, bitmap, width, height, full: async () => createImageBitmap(await reopen()) };
}

// Loads every source with a few in flight; unreadable ones are left out.
async function loadAll(sources, workWidth, onProgress) {
  const frames = new Array(sources.length);
  const skipped = [];
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < sources.length) {
      const i = next++;
      const { name, reopen } = sources[i];
      try {
        frames[i] = await toFrame(name, reopen, workWidth);
      } catch {
        skipped.push(name);
      }
      onProgress?.(++done / sources.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const loaded = frames.filter(Boolean);
  if (!loaded.length) {
    throw new Error(`None of the ${sources.length} frames could be read`);
  }
  return { frames: loaded, skipped: skipped.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) };
}

export async function loadServerFrames(onProgress, workWidth) {
  const res = await fetch('/api/frames', { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `Frame list unavailable (${res.status})`);
  }
  if (!body.frames.length) {
    throw new Error(`No images in ${body.dir}`);
  }
  const sources = body.frames.map((url) => ({
    name: decodeURIComponent(url.split('/').pop()),
    reopen: async () => {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) {
        throw new Error(`${url} answered ${r.status}`);
      }
      return r.blob();
    },
  }));
  const { frames, skipped } = await loadAll(sources, workWidth, onProgress);
  return { frames, skipped, source: body.dir, fps: null, stamp: body.stamp };
}

export async function loadFileFrames(files, onProgress, workWidth) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (list.length === 1 && list[0].type === 'image/gif') {
    return decodeGif(list[0], onProgress, workWidth);
  }
  if (!list.length) {
    throw new Error('No image files selected');
  }
  list.sort(byName);
  const sources = list.map((file) => ({ name: file.name, reopen: async () => file }));
  const { frames, skipped } = await loadAll(sources, workWidth, onProgress);
  return { frames, skipped, source: `${list.length} files`, fps: null };
}

async function decodeGif(file, onProgress, workWidth) {
  if (!('ImageDecoder' in window)) {
    throw new Error('This browser cannot split a GIF into frames; pick the frame images instead');
  }
  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
  await decoder.tracks.ready;
  const count = decoder.tracks.selectedTrack.frameCount;
  const frames = [];
  let micros = 0;
  for (let i = 0; i < count; i++) {
    const { image } = await decoder.decode({ frameIndex: i });
    micros += image.duration ?? 0;
    // A GIF's frames are already in memory; full() just hands out a copy.
    const kept = await createImageBitmap(image);
    image.close();
    frames.push(await toFrame(`frame_${String(i + 1).padStart(4, '0')}`, async () => kept, workWidth));
    onProgress?.((i + 1) / count);
  }
  decoder.close();
  return { frames, skipped: [], source: file.name, fps: micros > 0 ? Math.round((count / (micros / 1e6)) * 100) / 100 : null };
}
