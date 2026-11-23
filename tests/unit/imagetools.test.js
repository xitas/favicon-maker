'use strict';
/* js/imagetools.js: what pastes and drops hold. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('../helpers/load');

const { ImageTools } = loadScripts();
const kind = (parts) => ImageTools.classify(parts).kind;
const file = (type, name) => ({ type, name: name || 'x' });

test('an image file wins over any text', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']) {
    const r = ImageTools.classify({ files: [file(type)], text: 'https://example.com/a.png' });
    assert.equal(r.kind, 'file', type);
    assert.equal(r.file.type, type);
  }
  assert.equal(kind({ files: [file('', 'logo.svg')] }), 'file', 'an SVG named .svg without a type');
  assert.equal(kind({ files: [file('application/pdf', 'a.pdf')] }), 'none');
  assert.equal(kind({ files: [file('text/plain', 'a.txt'), file('image/png')] }), 'file', 'the first image among other files');
});

test('SVG code pasted as text', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
  for (const text of [svg, '  \n' + svg + '\n', '<?xml version="1.0"?>\n' + svg, '<!-- made by hand -->' + svg,
    '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">' + svg, '﻿' + svg]) {
    const r = ImageTools.classify({ text });
    assert.equal(r.kind, 'svg', JSON.stringify(text.slice(0, 30)));
    assert.equal(r.text, text.trim());
  }
  for (const text of ['<svg', 'hello <svg></svg>', '<div><svg></svg></div>', '<svgfoo></svgfoo>', '']) {
    assert.notEqual(kind({ text }), 'svg', text);
  }
});

test('only a link: explained, never downloaded', () => {
  const cases = [
    { text: 'https://example.com/logo.png' },
    { text: 'http://example.com/a.svg\n' },
    { uriList: 'https://example.com/logo.png' },
    { text: '//cdn.example.com/a.png' },
    { text: 'data:image/png;base64,AAAA' },
    { html: '<meta charset="utf-8"><img src="https://example.com/logo.png" alt="">' },
    { text: 'https://a.example/1.png\nhttps://a.example/2.png' }
  ];
  for (const parts of cases) {
    const r = ImageTools.classify(parts);
    assert.equal(r.kind, 'address', JSON.stringify(parts));
    assert.equal(r.message, 'Save the image first, then drop or paste it here.');
  }
});

test('ordinary text is left alone', () => {
  for (const text of ['hello', 'my logo https://example.com', 'Café ☕', '   ']) {
    assert.equal(kind({ text }), 'none', text);
  }
  assert.equal(kind({}), 'none');
  assert.equal(kind({ html: '<p>text only</p>' }), 'none');
});

/* ---------- Crop ---------- */

const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

test('cropRect: contain and cover fit, zoom and pan', () => {
  // A 200 × 100 image in a 100 box.
  let r = ImageTools.cropRect(100, 200, 100, 'contain', 1, 0, 0);
  assert.deepEqual([r.x, r.y, r.w, r.h], [0, 25, 100, 50]);
  r = ImageTools.cropRect(100, 200, 100, 'cover', 1, 0, 0);
  assert.deepEqual([r.x, r.y, r.w, r.h], [-50, 0, 200, 100]);
  r = ImageTools.cropRect(100, 200, 100, 'contain', 2, 0.1, -0.2);
  assert.deepEqual([r.w, r.h], [200, 100]);
  assert.ok(near(r.x + r.w / 2, 60) && near(r.y + r.h / 2, 30), 'center moved by 10% right and 20% up');
});

test('cropRect: zoom stays between 1 and 8', () => {
  assert.equal(ImageTools.cropRect(100, 100, 100, 'contain', 0.2, 0, 0).w, 100);
  assert.equal(ImageTools.cropRect(100, 100, 100, 'contain', 20, 0, 0).w, 800);
  assert.equal(ImageTools.cropRect(100, 100, 100, 'contain', NaN, 0, 0).w, 100);
  assert.equal(ImageTools.clampZoom(3.5), 3.5);
});

test('cropRect: with cover, the image always covers the frame', () => {
  for (const [iw, ih] of [[200, 100], [100, 300], [100, 100]]) {
    for (const zoom of [1, 1.5, 3]) {
      for (const pan of [-1, -0.4, 0, 0.3, 1]) {
        const r = ImageTools.cropRect(100, iw, ih, 'cover', zoom, pan, -pan);
        assert.ok(r.x <= 1e-9 && r.y <= 1e-9 && r.x + r.w >= 100 - 1e-9 && r.y + r.h >= 100 - 1e-9, `${iw}x${ih} zoom ${zoom} pan ${pan}`);
      }
    }
  }
  // A square image at zoom 1 can't move at all.
  const r = ImageTools.cropRect(100, 100, 100, 'cover', 1, 0.5, 0.5);
  assert.deepEqual([r.x, r.y, r.panX, r.panY], [0, 0, 0, 0]);
  // Contain allows moving one frame either way, or more when zoomed in, so any point can reach the middle.
  assert.equal(ImageTools.cropRect(100, 100, 100, 'contain', 1, 5, -5).panX, 1);
  assert.equal(ImageTools.cropRect(100, 100, 100, 'contain', 4, 5, -5).panX, 2);
});

/* ---------- Trim ---------- */

/** An RGBA image filled with `bg`, with a `fg` rectangle at (x, y, w, h). */
function picture(W, H, bg, fg, rect) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inside = x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3];
      data.set(inside ? fg : bg, (y * W + x) * 4);
    }
  }
  return data;
}

test('trim finds the content inside transparent, white and colored margins', () => {
  const cases = [
    ['transparent', [0, 0, 0, 0], [200, 30, 30, 255], 'transparent'],
    ['white', [255, 255, 255, 255], [20, 20, 120, 255], '#ffffff'],
    ['colored', [40, 160, 90, 255], [250, 240, 50, 255], '#28a05a']
  ];
  for (const [label, bg, fg, expected] of cases) {
    const b = ImageTools.trimBounds(picture(80, 60, bg, fg, [12, 7, 30, 20]), 80, 60);
    assert.deepEqual({ ...b }, { x: 12, y: 7, w: 30, h: 20, background: expected }, label);
  }
});

test('trim allows for noise and soft edges in the margin color', () => {
  const data = picture(40, 40, [250, 250, 250, 255], [0, 0, 0, 255], [10, 10, 5, 5]);
  for (let i = 0; i < data.length; i += 4 * 7) if (data[i] > 200) { data[i] = 240; data[i + 1] = 255; }
  const b = ImageTools.trimBounds(data, 40, 40);
  assert.deepEqual([b.x, b.y, b.w, b.h], [10, 10, 5, 5]);
  assert.match(b.background, /^#f[0-9a-f]f[0-9a-f]f[0-9a-f]$/, `a near-white margin (${b.background})`);
});

test('trim finds nothing to trim on a busy edge, or in an empty image', () => {
  const busy = new Uint8ClampedArray(30 * 30 * 4);
  for (let i = 0; i < busy.length; i += 4) busy.set([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, 255], i);
  assert.equal(ImageTools.trimBounds(busy, 30, 30), null);
  assert.equal(ImageTools.trimBounds(picture(20, 20, [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]), 20, 20), null);
});

test('trimCrop makes the content fill the frame, centered', () => {
  // A 100 × 100 image whose content is a 20 × 20 square at (60, 10).
  const c = ImageTools.trimCrop({ x: 60, y: 10, w: 20, h: 20 }, 100, 100, 'contain');
  assert.equal(c.zoom, 500, '5 times larger');
  assert.equal(c.x, -100, 'moved left as far as allowed');
  // Check with the crop math: the content's center lands near the frame's center when it can.
  const d = ImageTools.trimCrop({ x: 40, y: 20, w: 20, h: 40 }, 100, 100, 'contain');
  assert.equal(d.zoom, 250);
  const r = ImageTools.cropRect(1, 100, 100, 'contain', d.zoom / 100, d.x / 100, d.y / 100);
  const k = r.w / 100;
  assert.ok(near(r.x + 50 * k, 0.5, 0.01) && near(r.y + 40 * k, 0.5, 0.01), 'content center at the frame center');
  // Content larger than 1/8 of the image: zoom stays within 8.
  assert.equal(ImageTools.trimCrop({ x: 0, y: 0, w: 1, h: 1 }, 100, 100, 'contain').zoom, 800);
  assert.equal(ImageTools.trimCrop({ x: 0, y: 0, w: 100, h: 100 }, 100, 100, 'contain').zoom, 100);
});

/* ---------- Suggested colors ---------- */

test('palette: the main colors, clearly different, and the edge color', () => {
  // White background with a big blue square and a smaller red one.
  const W = 60;
  const data = picture(W, W, [255, 255, 255, 255], [20, 60, 200, 255], [5, 5, 30, 30]);
  for (let y = 40; y < 55; y++) for (let x = 40; x < 55; x++) data.set([220, 30, 40, 255], (y * W + x) * 4);
  const p = ImageTools.palette(data, W, W);
  assert.deepEqual(Array.from(p.main), ['#ffffff', '#143cc8', '#dc1e28']);
  assert.equal(p.edge, '#ffffff');
  // Transparent edges: no edge color; see-through pixels are not counted.
  const clear = picture(W, W, [0, 0, 0, 0], [10, 150, 90, 255], [10, 10, 40, 40]);
  const q = ImageTools.palette(clear, W, W);
  assert.deepEqual(Array.from(q.main), ['#0a965a']);
  assert.equal(q.edge, null);
  // Near-identical shades count as one.
  const shades = picture(W, W, [100, 100, 100, 255], [104, 102, 100, 255], [0, 0, 30, 60]);
  assert.equal(ImageTools.palette(shades, W, W).main.length, 1);
});
