// Minimal ZIP writer (stored, no compression: PNGs are already compressed).

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

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// entries: [{ name, blob }]
export async function zipBlobs(entries, onProgress) {
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());
  const enc = new TextEncoder();
  for (let i = 0; i < entries.length; i++) {
    const { name, blob } = entries[i];
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const nameBytes = enc.encode(name);
    const size = blob.size;
    // Plain ZIP offsets are 32-bit; past 4 GB the archive would be corrupt.
    if (offset + 30 + nameBytes.length + size > 0xffffffff) {
      throw new Error('The frames add up to more than 4 GB, too much for one ZIP. Pick a smaller resolution or fewer frames.');
    }

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(local.buffer, nameBytes, blob);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, nameBytes);

    offset += 30 + nameBytes.length + size;
    onProgress?.((i + 1) / entries.length);
  }
  const cdSize = central.reduce((a, p) => a + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
