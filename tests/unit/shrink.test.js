'use strict';
/* js/lib/shrink.js: premultiplied alpha and halving. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('../helpers/load');

const { Shrink } = loadScripts();
const px = (...values) => new Uint8ClampedArray(values);
const plain = (a) => Array.from(a);

test('premultiply and unpremultiply', () => {
  assert.deepEqual(plain(Shrink.premultiply(px(255, 128, 0, 255, 255, 128, 0, 128, 10, 20, 30, 0))),
    [255, 128, 0, 255, 128, 64, 0, 128, 0, 0, 0, 0]);
  assert.deepEqual(plain(Shrink.unpremultiply(px(128, 64, 0, 128, 0, 0, 0, 0))), [255, 128, 0, 128, 0, 0, 0, 0]);
});

test('opaque pixels survive a premultiply round trip exactly', () => {
  const data = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) data.set([i, 255 - i, (i * 7) % 256, 255], i * 4);
  assert.deepEqual(plain(Shrink.unpremultiply(Shrink.premultiply(data))), plain(data));
});

test('halve averages each 2×2 block', () => {
  const img = { width: 2, height: 2, data: px(0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 100, 100, 100, 255) };
  const out = Shrink.halve(img);
  assert.equal(out.width, 1);
  assert.equal(out.height, 1);
  assert.deepEqual(plain(out.data), [100, 100, 100, 255]);
});

test('halve rounds odd sizes up and averages the smaller edge blocks', () => {
  // 3×1: [10, 20, 90] -> [15, 90]
  const img = { width: 3, height: 1, data: px(10, 10, 10, 255, 20, 20, 20, 255, 90, 90, 90, 255) };
  const out = Shrink.halve(img);
  assert.deepEqual([out.width, out.height], [2, 1]);
  assert.deepEqual(plain(out.data), [15, 15, 15, 255, 90, 90, 90, 255]);
  assert.deepEqual([Shrink.halve({ width: 1, height: 1, data: px(1, 2, 3, 4) }).width], [1]);
});

test('no dark fringe: a red pixel next to transparent black stays red', () => {
  // Transparent pixels often hold black. Averaging without premultiplying would give dark red (128, 0, 0).
  const straight = px(255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0);
  const half = Shrink.halve({ width: 2, height: 2, data: Shrink.premultiply(straight) });
  assert.deepEqual(plain(Shrink.unpremultiply(half.data)), [255, 0, 0, 128]);
});

test('steps halve down to the minimum size, largest first', () => {
  assert.deepEqual(Array.from(Shrink.steps(100, 60, 8), (s) => Array.from(s)),
    [[100, 60], [50, 30], [25, 15], [13, 8]]);
  assert.deepEqual(Array.from(Shrink.steps(5, 5, 8), (s) => Array.from(s)), [[5, 5]]);
});

test('pick: the smallest step still at least the target size', () => {
  const levels = [[1024, 1024], [512, 512], [256, 256], [128, 128], [64, 64], [32, 32], [16, 16]];
  assert.equal(Shrink.pick(levels, 16, 16), 6);
  assert.equal(Shrink.pick(levels, 17, 17), 5);
  assert.equal(Shrink.pick(levels, 48, 48), 4);
  assert.equal(Shrink.pick(levels, 512, 512), 1);
  assert.equal(Shrink.pick(levels, 2000, 2000), 0, 'bigger than the image: draw from the original');
  assert.equal(Shrink.pick(levels, 100, 20), 3, 'both sides must fit');
});
