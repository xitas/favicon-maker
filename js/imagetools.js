/* Image helpers with no page state: what a paste or drop holds, crop math, trimming empty edges, and
   colors taken from an image. Pure functions on plain values and RGBA pixel buffers. */
const ImageTools = (() => {
  'use strict';

  /* ---------- Paste and drop ---------- */

  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
  const SAVE_FIRST = 'Save the image first, then drop or paste it here.';

  /** True for text that is an SVG document (as copied from an editor or a page's source). */
  function isSvgText(text) {
    const t = String(text || '').replace(/^﻿/, '').trim();
    return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(t) && /<\/svg>\s*$/i.test(t);
  }

  /** True for text that is only a web address (one link, maybe in a list of addresses). */
  function isAddress(text) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l[0] !== '#');
    return lines.length > 0 && lines.every((l) => /^(https?:|data:|blob:|file:|\/\/)\S+$/i.test(l));
  }

  /**
   * What a paste or drop gives us, from its parts: files (with a type), plain text, HTML and a list of
   * addresses. Returns { kind: 'file', file } for an image file, { kind: 'svg', text } for SVG code,
   * { kind: 'address', message } when there is only a link to an image (which we never download),
   * or { kind: 'none' }.
   */
  function classify(parts) {
    const files = (parts.files || []).filter((f) => f && (IMAGE_TYPES.indexOf(f.type) !== -1 || /^image\//.test(f.type || '') || /\.svg$/i.test(f.name || '')));
    if (files.length) return { kind: 'file', file: files[0] };
    const text = parts.text || '';
    if (isSvgText(text)) return { kind: 'svg', text: text.trim() };
    const html = parts.html || '';
    const htmlImage = /<img\b[^>]*\bsrc\s*=/i.test(html);
    if (parts.uriList || isAddress(text) || htmlImage) return { kind: 'address', message: SAVE_FIRST };
    return { kind: 'none' };
  }

  /* ---------- Crop ---------- */

  const ZOOM_MIN = 1;
  const ZOOM_MAX = 8;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** Zoom kept between 1 (the image fits as chosen) and 8. */
  function clampZoom(z) {
    return clamp(Number.isFinite(z) ? z : 1, ZOOM_MIN, ZOOM_MAX);
  }

  /**
   * Where the image goes in a square box of \`box\`: fitted (contain or cover), zoomed, and its center moved
   * by (panX, panY) in fractions of the box. With cover, the image always covers the box: the pan is
   * limited so no edge shows. With contain, any point of the image can be moved to the middle.
   * Returns { x, y, w, h } relative to the box, and the pan actually used.
   */
  function cropRect(box, iw, ih, fit, zoom, panX, panY) {
    const z = clampZoom(zoom);
    const k = (fit === 'cover' ? Math.max(box / iw, box / ih) : Math.min(box / iw, box / ih)) * z;
    const w = iw * k;
    const h = ih * k;
    const lx = Math.max(1, w / box / 2);
    const ly = Math.max(1, h / box / 2);
    let px = clamp(Number.isFinite(panX) ? panX : 0, -lx, lx);
    let py = clamp(Number.isFinite(panY) ? panY : 0, -ly, ly);
    if (fit === 'cover') {
      const mx = Math.max(0, (w - box) / 2) / box;
      const my = Math.max(0, (h - box) / 2) / box;
      px = clamp(px, -mx, mx);
      py = clamp(py, -my, my);
    }
    const cx = box / 2 + px * box;
    const cy = box / 2 + py * box;
    return { x: cx - w / 2, y: cy - h / 2, w, h, panX: px, panY: py };
  }

  /* ---------- Colors in pixels ---------- */

  const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  /** The pixels around the edge of an image, as indexes into its RGBA data. */
  function edgeIndexes(w, h) {
    const out = [];
    for (let x = 0; x < w; x++) {
      out.push(x * 4, ((h - 1) * w + x) * 4);
    }
    for (let y = 1; y < h - 1; y++) {
      out.push(y * w * 4, (y * w + w - 1) * 4);
    }
    return out;
  }

  /**
   * The edge's background: 'transparent' when most of the edge is see-through, the edge's main color when
   * most of it is one plain color, or null when the edge is busy (a photo, say).
   */
  function edgeBackground(data, w, h, tol) {
    const idx = edgeIndexes(w, h);
    const clear = idx.filter((i) => data[i + 3] < 16).length;
    if (clear >= idx.length * 0.6) return { transparent: true };
    // The most common color among the solid edge pixels (in coarse steps), averaged.
    const buckets = new Map();
    for (const i of idx) {
      if (data[i + 3] < 200) continue;
      const key = (data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | (data[i + 2] >> 4);
      const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
      buckets.set(key, b);
    }
    let top = null;
    for (const b of buckets.values()) if (!top || b.n > top.n) top = b;
    if (!top) return null;
    const color = [top.r / top.n, top.g / top.n, top.b / top.n];
    const near = idx.filter((i) => data[i + 3] >= 200 && dist([data[i], data[i + 1], data[i + 2]], color) <= tol).length;
    return near >= idx.length * 0.6 ? { transparent: false, color } : null;
  }

  /**
   * The content of an image inside empty margins, which are transparent or one plain color.
   * Returns { x, y, w, h, background } in pixels, or null when there is no plain margin to trim
   * (or nothing but margin).
   */
  function trimBounds(data, w, h, tol) {
    const t = tol === undefined ? 24 : tol;
    const bg = edgeBackground(data, w, h, t);
    if (!bg) return null;
    const isBackground = bg.transparent
      ? (i) => data[i + 3] < 16
      : (i) => data[i + 3] < 16 || dist([data[i], data[i + 1], data[i + 2]], bg.color) <= t;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isBackground((y * w + x) * 4)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return {
      x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1,
      background: bg.transparent ? 'transparent' : hex(...bg.color)
    };
  }

  /**
   * The zoom and pan that make the content (from trimBounds) fill the frame: as big as fits, centered.
   * Zoom is in percent (100 to 800) and pan in percent of the frame, as the settings store them.
   */
  function trimCrop(bounds, iw, ih, fit) {
    const k0 = fit === 'cover' ? Math.max(1 / iw, 1 / ih) : Math.min(1 / iw, 1 / ih);
    const kc = Math.min(1 / bounds.w, 1 / bounds.h);
    const zoom = clampZoom(kc / k0);
    const k = k0 * zoom;
    const cx = bounds.x + bounds.w / 2 - iw / 2;
    const cy = bounds.y + bounds.h / 2 - ih / 2;
    const r = cropRect(1, iw, ih, fit, zoom, -cx * k, -cy * k);
    const round1 = (v) => Math.round(v * 1000) / 10 + 0;
    return { zoom: Math.round(zoom * 100), x: round1(r.panX), y: round1(r.panY) };
  }

  /**
   * Colors to suggest from an image: its main colors (up to \`count\`, clearly different from each other)
   * and its edge color when the edge is one plain color. Returns { main: [hex], edge: hex|null }.
   */
  function palette(data, w, h, count) {
    const n = count || 4;
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      const key = (data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | (data[i + 2] >> 4);
      const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
      buckets.set(key, b);
    }
    const sorted = Array.from(buckets.values()).sort((a, b) => b.n - a.n).map((b) => [b.r / b.n, b.g / b.n, b.b / b.n]);
    const main = [];
    for (const c of sorted) {
      if (main.every((m) => dist(m, c) > 48)) main.push(c);
      if (main.length >= n) break;
    }
    const bg = edgeBackground(data, w, h, 24);
    return { main: main.map((c) => hex(...c)), edge: bg && !bg.transparent ? hex(...bg.color) : null };
  }

  return {
    IMAGE_TYPES, SAVE_FIRST, isSvgText, isAddress, classify,
    ZOOM_MIN, ZOOM_MAX, clampZoom, cropRect, trimBounds, trimCrop, palette
  };
})();
