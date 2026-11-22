'use strict';
/* Test images, drawn in code so they are the same everywhere: a photo-like scene, a detailed logo and line art. */
const { makePng } = require('./formats');

/** Cheap repeatable noise in 0..1. */
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Average `fn(x, y)` over an n×n grid inside the pixel, for antialiased edges. */
function supersample(fn, x, y, n) {
  const acc = [0, 0, 0, 0];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [r, g, b, a] = fn(x + (i + 0.5) / n, y + (j + 0.5) / n);
      // Average in premultiplied form, so the result has no fringes of its own.
      acc[0] += r * a; acc[1] += g * a; acc[2] += b * a; acc[3] += a;
    }
  }
  const a = acc[3] / (n * n);
  return a === 0 ? [0, 0, 0, 0] : [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3], a].map((v) => Math.round(v));
}

/** Photo-like: sky gradient, sun, hills and grass with fine texture. Opaque. */
function photo(size = 2048) {
  return makePng(size, size, (x, y) => {
    const u = x / size;
    const v = y / size;
    const hill = 0.62 + 0.06 * Math.sin(u * 9 + 1) + 0.03 * Math.sin(u * 31);
    if (v < hill) {
      const sun = Math.hypot(u - 0.72, v - 0.25) < 0.08;
      if (sun) return [255, 236, 160, 255];
      const n = hash(x >> 3, y >> 3) * 10;
      return [70 + v * 120 + n, 130 + v * 90 + n, 220 - v * 40, 255].map(Math.round);
    }
    // Grass: stripes and noise at one-pixel scale, the detail that turns jagged when shrunk badly.
    const stripe = (x + Math.floor(y / 3)) % 7 < 2 ? 40 : 0;
    const n = hash(x, y) * 60;
    return [30 + n * 0.5, 110 + stripe + n, 40 + n * 0.3, 255].map(Math.round);
  });
}

/** Detailed logo: thin colored rings and spokes on a transparent background. */
function logo(size = 1024) {
  const c = size / 2;
  const shape = (x, y) => {
    const d = Math.hypot(x - c, y - c);
    const angle = Math.atan2(y - c, x - c);
    if (d > size * 0.46) return [0, 0, 0, 0];
    const ring = Math.floor(d / (size * 0.023));
    if (ring % 2 === 0 && d > size * 0.12) return [230, 60, 40, 255];
    if (Math.abs(Math.sin(angle * 12)) < 0.12 && d > size * 0.12) return [30, 90, 200, 255];
    if (d <= size * 0.12) return [250, 190, 30, 255];
    return [0, 0, 0, 0];
  };
  return makePng(size, size, (x, y) => supersample(shape, x, y, 3));
}

/** Line art: black lines of 3 px on a transparent background. */
function lineArt(size = 2048) {
  const lines = (x, y) => {
    const onGrid = (x % 128 < 3) || (y % 128 < 3);
    const onDiagonal = Math.abs(x - y) < 2.2 || Math.abs(x + y - size) < 2.2;
    const r = Math.hypot(x - size / 2, y - size / 2);
    const onCircle = [300, 600, 900].some((rr) => Math.abs(r - rr) < 1.5);
    return onGrid || onDiagonal || onCircle ? [0, 0, 0, 255] : [0, 0, 0, 0];
  };
  return makePng(size, size, (x, y) => supersample(lines, x, y, 2));
}

module.exports = { photo, logo, lineArt };
