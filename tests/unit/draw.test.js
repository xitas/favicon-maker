'use strict';
/* Pure parts of js/draw.js. Drawing itself needs a real canvas and is checked in the browser tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('../helpers/load');

const { Draw } = loadScripts();

test('snapSize rounds font sizes the way Firefox draws them on canvas', () => {
  // Measured in Firefox: the size each request is actually drawn at.
  const firefox = [[8, 8], [11.2, 11.25], [11.25, 11.25], [11.3, 11.25], [16, 16], [22.4, 22.5], [33.6, 33.5],
    [50, 50], [50.5, 50.5], [100, 100], [100.4, 100], [126, 126], [179.2, 180], [200, 200], [256, 256],
    [300, 300], [358, 360], [358.4, 360], [359, 360], [360, 360], [400, 400], [512, 512]];
  for (const [requested, drawn] of firefox) assert.equal(Draw.snapSize(requested), drawn, `${requested} px`);
});

test('snapSize keeps whole sizes the icons use and is stable', () => {
  for (const px of [1, 2, 4, 12, 16, 24, 32, 48, 64, 128]) assert.equal(Draw.snapSize(px), px);
  for (const px of [3.3, 11.2, 22.4, 33.6, 126.7, 358.4, 1000.1]) {
    const once = Draw.snapSize(px);
    assert.equal(Draw.snapSize(once), once, `${px} px`);
    assert.ok(Math.abs(once - px) / px < 0.008, `${px} px changes by under 0.8%`);
  }
});

test('snapSize leaves zero and bad input alone', () => {
  assert.equal(Draw.snapSize(0), 0);
  assert.ok(Number.isNaN(Draw.snapSize(NaN)));
});

test('maskable safe zone: a circle 80% across', () => {
  assert.equal(Draw.SAFE_ZONE_RADIUS, 0.4);
  assert.equal(Draw.inSafeZone(100, 50, 50), true, 'center');
  assert.equal(Draw.inSafeZone(100, 90, 50), true, 'right edge of the circle');
  assert.equal(Draw.inSafeZone(100, 91, 50), false, 'just outside');
  assert.equal(Draw.inSafeZone(100, 10, 10), false, 'corner');
  assert.equal(Draw.inSafeZone(512, 256 + 204, 256), true);
  assert.equal(Draw.inSafeZone(512, 256 + 206, 256), false);
});

test('maskable design area: default padding makes it as wide as the safe zone', () => {
  assert.equal(Draw.MASK_PAD_DEFAULT, 10);
  assert.deepEqual({ ...Draw.maskArea(512, 10) }, { x: 51.2, y: 51.2, size: 409.6 });
  const a = Draw.maskArea(512, Draw.MASK_PAD_DEFAULT);
  assert.ok(Math.abs(a.size - 512 * 2 * Draw.SAFE_ZONE_RADIUS) < 1e-9, 'area width = safe zone diameter');
  assert.deepEqual({ ...Draw.maskArea(192, 0) }, { x: 0, y: 0, size: 192 });
  assert.deepEqual({ ...Draw.maskArea(100, undefined) }, { ...Draw.maskArea(100, Draw.MASK_PAD_DEFAULT) });
  assert.deepEqual({ ...Draw.maskArea(100, 90) }, { ...Draw.maskArea(100, 40) }, 'padding is capped');
  assert.deepEqual({ ...Draw.maskArea(100, -5) }, { ...Draw.maskArea(100, 0) });
});

test('maskable design area: at 21.7% padding a full square fits inside the circle', () => {
  // Corners of the design area are on the circle when its half-diagonal equals the safe zone radius.
  const pad = 50 - 100 * Draw.SAFE_ZONE_RADIUS / Math.SQRT2;
  const a = Draw.maskArea(1000, pad);
  assert.ok(Draw.inSafeZone(1000, a.x + 0.01, a.y + 0.01));
  assert.ok(!Draw.inSafeZone(1000, a.x - 1, a.y - 1));
  assert.ok(Math.abs(pad - 21.72) < 0.01);
});

test('imageLayout: contain and cover, centered in the padded box', () => {
  const contain = Draw.imageLayout(100, { pad: 10, fit: 'contain' }, 200, 100);
  assert.deepEqual(JSON.parse(JSON.stringify(contain)), { clip: { x: 10, y: 10, size: 80 }, x: 10, y: 30, w: 80, h: 40 });
  const cover = Draw.imageLayout(100, { pad: 0, fit: 'cover' }, 200, 100);
  assert.deepEqual(JSON.parse(JSON.stringify(cover)), { clip: { x: 0, y: 0, size: 100 }, x: -50, y: 0, w: 200, h: 100 });
});

test('imageLayout: the crop zooms and moves the image inside the box', () => {
  const l = Draw.imageLayout(100, { pad: 10, fit: 'contain', cropZoom: 200, cropX: 10, cropY: -5 }, 100, 100);
  assert.deepEqual(JSON.parse(JSON.stringify(l.clip)), { x: 10, y: 10, size: 80 });
  assert.deepEqual([l.w, l.h], [160, 160]);
  assert.deepEqual([l.x + l.w / 2, l.y + l.h / 2], [58, 46], 'center moved 10% of the box right and 5% up');
});

test('borderPx: grows with the icon, at least 1 px, never more than a twelfth', () => {
  assert.equal(Draw.borderPx(512, 4), 20.48);
  assert.equal(Draw.borderPx(16, 4), 1, '0.64 px becomes 1 px');
  assert.equal(Draw.borderPx(32, 4), 1.28);
  assert.equal(Draw.borderPx(512, 15), 512 / 12, '15% of 512 is capped');
  assert.equal(Draw.borderPx(16, 15), 16 / 12, 'a thick border stays thin on a 16 px icon');
  assert.equal(Draw.borderPx(48, 1), 1);
  for (const size of [16, 32, 48, 180, 192, 512]) {
    for (const pct of [1, 4, 8, 15]) {
      const w = Draw.borderPx(size, pct);
      assert.ok(w >= 1 && w <= Math.max(1, size / 12), `${size} px at ${pct}%`);
    }
  }
});

test('offsetPx: a share of the area, both ways', () => {
  assert.deepEqual({ ...Draw.offsetPx(512, { offsetX: 10, offsetY: -5 }) }, { x: 51.2, y: -25.6 });
  assert.deepEqual({ ...Draw.offsetPx(100, {}) }, { x: 0, y: 0 });
  assert.deepEqual({ ...Draw.offsetPx(16, { offsetX: -20, offsetY: 20 }) }, { x: -3.2, y: 3.2 });
});
