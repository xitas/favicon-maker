'use strict';
/* Maskable icons for Android: the files, the manifest, the shape previews and the safe zone overlay. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { unzipSync } = require('fflate');
const { launch, openApp, settled, download, targets } = require('../helpers/browser');
const { readPng } = require('../helpers/formats');

const BG = [11, 122, 117, 255]; // default background #0b7a75

const near = (a, b, tolerance = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
const pixel = (png, x, y) => Array.from(png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4));

/** Bounds of every pixel that isn't the background color. */
function designBounds(png, bg) {
  let minX = png.width, minY = png.height, maxX = -1, maxY = -1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (!near(pixel(png, x, y), bg, 40)) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Pixels of the design that fall outside the safe zone circle (radius 40%). */
function outsideSafeZone(png, bg) {
  const c = png.width / 2;
  const r = png.width * 0.4;
  let n = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (!near(pixel(png, x, y), bg, 40) && Math.hypot(x + 0.5 - c, y + 0.5 - c) > r) n++;
    }
  }
  return n;
}

async function setValue(page, id, value) {
  await page.evaluate(([id, value]) => {
    const el = document.getElementById(id);
    if (el.type === 'checkbox') el.checked = value; else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, value]);
  await settled(page);
}

async function zipFiles(page) {
  const { data } = await download(page, '#zip');
  return Object.fromEntries(Object.entries(unzipSync(new Uint8Array(data))).map(([k, v]) => [k, Buffer.from(v)]));
}

/** RGBA of a preview canvas, read in the page. */
function canvasPixels(page, selector) {
  return page.evaluate((selector) => {
    const c = document.querySelector(selector);
    return { width: c.width, data: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data) };
  }, selector);
}

for (const target of targets()) {
  describe(`maskable icons from ${target.label}`, () => {
    let browser;
    let url;
    before(async () => { url = await target.start(); browser = await launch('chromium'); });
    after(async () => { await browser.close(); await target.stop(); });

    test('the maskable files are full-bleed, opaque squares with the design in the safe zone', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        await page.fill('#text', 'WM'); // wide letters, the hardest case for the circle
        await settled(page);
        const files = await zipFiles(page);
        for (const [name, size] of [['maskable-icon-192x192.png', 192], ['maskable-icon-512x512.png', 512]]) {
          const png = readPng(files[name]);
          assert.equal(png.width, size, name);
          assert.equal(png.height, size, name);
          for (let i = 3; i < png.data.length; i += 4) assert.equal(png.data[i], 255, `${name} is opaque`);
          for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) {
            assert.ok(near(pixel(png, x, y), BG), `${name} corner ${x},${y} is background, not rounded`);
          }
          assert.equal(outsideSafeZone(png, BG), 0, `${name}: nothing outside the safe zone`);
        }

        // The single download gives the same file.
        const single = await download(page, 'button[aria-label="Download maskable-icon-512x512.png"]');
        assert.ok(single.data.equals(files['maskable-icon-512x512.png']));

        const manifest = JSON.parse(files['site.webmanifest'].toString('utf8'));
        assert.deepEqual(manifest.icons.map((i) => [i.src, i.purpose]), [
          ['android-chrome-192x192.png', 'any'], ['android-chrome-512x512.png', 'any'],
          ['maskable-icon-192x192.png', 'maskable'], ['maskable-icon-512x512.png', 'maskable']
        ]);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('a transparent background becomes white in the maskable icon', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await setValue(page, 'transparent', true);
        const { data } = await download(page, 'button[aria-label="Download maskable-icon-192x192.png"]');
        const png = readPng(data);
        assert.deepEqual(pixel(png, 0, 0), [255, 255, 255, 255]);
        assert.deepEqual(pixel(png, 96, 3), [255, 255, 255, 255]);
      } finally {
        await context.close();
      }
    });

    test('Maskable padding shrinks the design', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        assert.equal(await page.inputValue('#maskPad'), '10');
        assert.equal(await page.locator('#maskPadOut').textContent(), '10%');
        const widthAt = async (pad) => {
          await setValue(page, 'maskPad', String(pad));
          const png = readPng((await download(page, 'button[aria-label="Download maskable-icon-512x512.png"]')).data);
          const b = designBounds(png, BG);
          return b.maxX - b.minX;
        };
        const w0 = await widthAt(0);
        const w10 = await widthAt(10);
        const w30 = await widthAt(30);
        assert.ok(w0 > w10 && w10 > w30, `design width ${w0} > ${w10} > ${w30}`);
        assert.ok(Math.abs(w10 / w0 - 0.8) < 0.03, 'at 10% padding the design is 80% as wide');
        assert.equal(await page.locator('#maskPadOut').textContent(), '30%');
      } finally {
        await context.close();
      }
    });

    test('the shape previews cut the maskable icon to Android shapes', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        const shapes = await page.locator('#masks canvas').evaluateAll((all) => all.map((c) => [c.dataset.shape, c.getAttribute('aria-label')]));
        assert.deepEqual(shapes.map((s) => s[0]), ['circle', 'squircle', 'rounded', 'teardrop']);
        for (const [, label] of shapes) assert.match(label, /^Maskable icon cut to a /);

        const alphaAt = async (shape, x, y) => {
          const { width, data } = await canvasPixels(page, `#masks canvas[data-shape="${shape}"]`);
          return data[(y * width + x) * 4 + 3];
        };
        // 96 px previews: all are opaque in the middle.
        for (const shape of ['circle', 'squircle', 'rounded', 'teardrop']) assert.equal(await alphaAt(shape, 48, 48), 255, shape);
        // Circle: corners and the area just inside them are cut.
        assert.equal(await alphaAt('circle', 1, 1), 0);
        assert.equal(await alphaAt('circle', 10, 10), 0);
        // Squircle: corners cut, but fuller than a circle near them.
        assert.equal(await alphaAt('squircle', 1, 1), 0);
        assert.equal(await alphaAt('squircle', 12, 12), 255);
        assert.equal(await alphaAt('circle', 12, 12), 0);
        // Rounded square: only the very corner is cut.
        assert.equal(await alphaAt('rounded', 1, 1), 0);
        assert.equal(await alphaAt('rounded', 48, 1), 255);
        // Teardrop: three round corners, square at the bottom right.
        assert.equal(await alphaAt('teardrop', 1, 1), 0);
        assert.equal(await alphaAt('teardrop', 94, 1), 0);
        assert.equal(await alphaAt('teardrop', 1, 94), 0);
        assert.equal(await alphaAt('teardrop', 94, 94), 255);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('Show safe zone draws a dashed circle on the previews', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await page.fill('#text', '');
        await settled(page);
        const before = await canvasPixels(page, '#masks canvas[data-shape="rounded"]');
        await setValue(page, 'safeZone', true);
        const after = await canvasPixels(page, '#masks canvas[data-shape="rounded"]');
        const n = before.width;
        const changed = [];
        for (let i = 0; i < before.data.length; i += 4) {
          if (Math.abs(before.data[i] - after.data[i]) + Math.abs(before.data[i + 1] - after.data[i + 1]) > 30) {
            const p = i / 4;
            changed.push(Math.hypot((p % n) + 0.5 - n / 2, Math.floor(p / n) + 0.5 - n / 2));
          }
        }
        assert.ok(changed.length > 50, `the circle is drawn (${changed.length} pixels)`);
        for (const d of changed) assert.ok(Math.abs(d - n * 0.4) < 3, `changed pixel at radius ${d.toFixed(1)} lies on the safe zone circle`);

        await setValue(page, 'safeZone', false);
        const off = await canvasPixels(page, '#masks canvas[data-shape="rounded"]');
        assert.deepEqual(off.data, before.data, 'turning it off removes the circle');
        // The overlay is only on the preview, never in the files.
        const { data } = await download(page, 'button[aria-label="Download maskable-icon-192x192.png"]');
        await setValue(page, 'safeZone', true);
        const withOverlay = await download(page, 'button[aria-label="Download maskable-icon-192x192.png"]');
        assert.ok(data.equals(withOverlay.data));
      } finally {
        await context.close();
      }
    });
  });
}
