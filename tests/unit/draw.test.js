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
