'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const decodeIco = require('decode-ico');
const { loadScripts, toBuffer } = require('../helpers/load');
const { parseIco, makePng, readPng, toArrayBuffer } = require('../helpers/formats');

const { Ico } = loadScripts();

/** A PNG per size, each with a different pattern so mixed-up images are caught. */
function samplePngs(sizes) {
  return sizes.map((size, n) => makePng(size, size, (x, y) => [(x * 7 + n * 40) & 255, (y * 5) & 255, n * 60, (x + y) % 3 ? 255 : 128]));
}

async function buildIco(sizes) {
  const pngs = samplePngs(sizes);
  const out = Ico.make(sizes, pngs.map(toArrayBuffer));
  return { pngs, buf: await toBuffer(out), out };
}

test('make returns an ArrayBuffer', async () => {
  const { out } = await buildIco([16]);
  assert.equal(Object.prototype.toString.call(out), '[object ArrayBuffer]');
});

test('header and directory are correct for 16, 32, 48 and 256 px', async () => {
  const sizes = [16, 32, 48, 256];
  const { pngs, buf } = await buildIco(sizes);
  const ico = parseIco(buf);

  assert.deepEqual(ico.header, { reserved: 0, type: 1, count: sizes.length });

  const dirEnd = 6 + 16 * sizes.length;
  assert.equal(buf.length, dirEnd + pngs.reduce((sum, p) => sum + p.length, 0), 'file size');

  ico.entries.forEach((e, i) => {
    const size = sizes[i];
    const expectedByte = size === 256 ? 0 : size;
    assert.equal(e.widthByte, expectedByte, `width byte for ${size}`);
    assert.equal(e.heightByte, expectedByte, `height byte for ${size}`);
    assert.equal(e.colors, 0);
    assert.equal(e.reserved, 0);
    assert.equal(e.planes, 1);
    assert.equal(e.bitCount, 32);
    assert.equal(e.size, pngs[i].length, `size of ${size} px entry`);
    assert.ok(e.offset >= dirEnd, 'image data starts after the directory');
    assert.ok(e.offset + e.size <= buf.length, 'image data ends inside the file');
    assert.ok(e.data.equals(pngs[i]), `stored PNG for ${size} px is unchanged`);
  });

  const ranges = ico.entries.map((e) => [e.offset, e.offset + e.size]).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) {
    assert.ok(ranges[i][0] >= ranges[i - 1][1], 'image data ranges do not overlap');
  }
});

test('each stored image decodes to the right size', async () => {
  const sizes = [16, 32, 48, 256];
  const { buf } = await buildIco(sizes);
  parseIco(buf).entries.forEach((e, i) => {
    const png = readPng(e.data);
    assert.equal(png.width, sizes[i]);
    assert.equal(png.height, sizes[i]);
  });
});

test('an independent decoder (decode-ico) reads it', async () => {
  const sizes = [16, 32, 48, 256];
  const { pngs, buf } = await buildIco(sizes);
  const images = decodeIco(buf);

  assert.equal(images.length, sizes.length);
  images.forEach((img, i) => {
    assert.equal(img.type, 'png');
    assert.equal(img.width, sizes[i]);
    assert.equal(img.height, sizes[i]);
    assert.ok(Buffer.from(img.data).equals(pngs[i]));
  });
});

test('a single image works', async () => {
  const { pngs, buf } = await buildIco([48]);
  const ico = parseIco(buf);
  assert.equal(ico.header.count, 1);
  assert.equal(ico.entries[0].offset, 22);
  assert.ok(ico.entries[0].data.equals(pngs[0]));
});

test('sizes over 256 are refused with a clear error', () => {
  const buffers = samplePngs([16, 16]).map(toArrayBuffer);
  for (const size of [257, 512, 1024]) {
    assert.throws(() => Ico.make([16, size], buffers), (err) => {
      assert.equal(err.name, 'RangeError');
      assert.match(err.message, new RegExp(`1 to 256 px, but got ${size} px`));
      return true;
    }, `${size} px`);
  }
});

test('sizes that are not whole positive numbers are refused', () => {
  const buffers = samplePngs([16]).map(toArrayBuffer);
  for (const size of [0, -16, 15.5, NaN, '16']) {
    assert.throws(() => Ico.make([size], buffers), { name: 'RangeError' }, String(size));
  }
});

test('a different number of sizes and images is refused', () => {
  const buffers = samplePngs([16, 32]).map(toArrayBuffer);
  assert.throws(() => Ico.make([16], buffers), /one image per size: got 1 sizes and 2 images/);
});

test('1 px and 255 px are written as themselves, only 256 is written as 0', async () => {
  const sizes = [1, 255, 256];
  const { buf } = await buildIco(sizes);
  assert.deepEqual(parseIco(buf).entries.map((e) => [e.widthByte, e.heightByte]), [[1, 1], [255, 255], [0, 0]]);
});
