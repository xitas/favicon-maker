// A small animated GIF encoder (and the PNG decoding it needs), so the README demo can be
// made from browser screenshots without installing anything. Dev only.
//
//   const gif = encodeGif(width, height, frames)   // frames: [{ png: Buffer, delay: ms }]
//
// All frames share one 256-colour palette (the most used colours, which suits a mostly
// gray interface), and each frame only stores the rectangle that changed since the last one.

'use strict';
const { inflateSync } = require('node:zlib');

// Decodes an 8-bit RGB or RGBA PNG (what Chrome's screenshots are) to { width, height, rgb }.
function decodePng(buf) {
  if (buf.toString('latin1', 1, 4) !== 'PNG') throw new Error('not a PNG');
  let pos = 8, width = 0, height = 0, type = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), name = buf.toString('latin1', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || (type !== 2 && type !== 6) || data[12] !== 0) throw new Error('unsupported PNG (8-bit RGB or RGBA only)');
    } else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), bpp = type === 6 ? 4 : 3, stride = width * bpp;
  const px = Buffer.alloc(stride * height), rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[row - stride + x] : 0, c = x >= bpp && y ? px[row - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
    for (let x = 0; x < width; x++) rgb.set(px.subarray(row + x * bpp, row + x * bpp + 3), (y * width + x) * 3);
  }
  return { width, height, rgb };
}

// The most used colours (counted in 5-bit-per-channel buckets, each the average of its
// pixels), up to 256, and a function mapping any colour to its nearest palette entry.
function makePalette(images) {
  const buckets = new Map();
  for (const rgb of images) {
    for (let i = 0; i < rgb.length; i += 3) {
      const key = (rgb[i] >> 3) << 10 | (rgb[i + 1] >> 3) << 5 | rgb[i + 2] >> 3;
      let b = buckets.get(key);
      if (!b) buckets.set(key, b = [0, 0, 0, 0]);
      b[0]++; b[1] += rgb[i]; b[2] += rgb[i + 1]; b[3] += rgb[i + 2];
    }
  }
  const top = [...buckets.values()].sort((a, b) => b[0] - a[0]).slice(0, 256);
  const colors = top.map(b => [Math.round(b[1] / b[0]), Math.round(b[2] / b[0]), Math.round(b[3] / b[0])]);
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = r << 16 | g << 8 | b;
    let best = cache.get(key);
    if (best !== undefined) return best;
    let d = Infinity;
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i], dr = c[0] - r, dg = c[1] - g, db = c[2] - b;
      // Weighted for the eye (green counts most), so text edges keep their weight.
      const e = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (e < d) { d = e; best = i; }
    }
    cache.set(key, best);
    return best;
  };
  const table = Buffer.alloc(768);
  colors.forEach((c, i) => table.set(c, i * 3));
  return { table, nearest };
}

// GIF's LZW compression (after omggif by Dean McNamee, MIT).
function lzw(indices, minCode) {
  const out = [];
  let cur = 0, bits = 0;
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, next = eoi + 1, table = new Map();
  const emit = code => { cur |= code << bits; bits += size; while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; } };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix << 8 | k, found = table.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next === 4096) { emit(clear); next = eoi + 1; size = minCode + 1; table = new Map(); }
    else { if (next >= 1 << size) size++; table.set(key, next++); }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(cur & 255);
  return Buffer.from(out);
}

const u16 = n => Buffer.from([n & 255, n >> 8]);

function encodeGif(width, height, frames) {
  const images = frames.map(f => {
    const img = decodePng(f.png);
    if (img.width !== width || img.height !== height) throw new Error(`frame is ${img.width}x${img.height}, not ${width}x${height}`);
    return img.rgb;
  });
  const { table, nearest } = makePalette(images);
  const parts = [Buffer.from('GIF89a'), u16(width), u16(height), Buffer.from([0xf7, 0, 0]), table,
    Buffer.from([0x21, 0xff, 0x0b]), Buffer.from('NETSCAPE2.0'), Buffer.from([3, 1, 0, 0, 0])];   // loop forever
  let prev = null;
  frames.forEach((f, n) => {
    const rgb = images[n];
    // The rectangle that changed since the last frame (the whole image for the first).
    let x0 = 0, y0 = 0, x1 = width - 1, y1 = height - 1;
    if (prev) {
      x0 = width; y0 = height; x1 = -1; y1 = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 3;
          if (rgb[i] !== prev[i] || rgb[i + 1] !== prev[i + 1] || rgb[i + 2] !== prev[i + 2]) {
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 0; }   // nothing changed: a 1-pixel frame just for the delay
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, indices = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = ((y0 + y) * width + x0 + x) * 3;
        indices[y * w + x] = nearest(rgb[i], rgb[i + 1], rgb[i + 2]);
      }
    }
    const data = lzw(indices, 8), blocks = [];
    for (let i = 0; i < data.length; i += 255) { const chunk = data.subarray(i, i + 255); blocks.push(Buffer.from([chunk.length]), chunk); }
    parts.push(Buffer.from([0x21, 0xf9, 4, 0x04]), u16(Math.round(f.delay / 10)), Buffer.from([0, 0]),   // keep the last frame under this one
      Buffer.from([0x2c]), u16(x0), u16(y0), u16(w), u16(h), Buffer.from([0, 8]), ...blocks, Buffer.from([0]));
    prev = rgb;
  });
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

module.exports = { decodePng, encodeGif };
