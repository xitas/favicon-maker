'use strict';
/* Shapes, gradient backgrounds, borders and position offsets, in the previews and every downloaded file. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const decodeIco = require('decode-ico');
const { unzipSync } = require('fflate');
const { launch, openApp, settled, download, targets } = require('../helpers/browser');
const { readPng, pngSize } = require('../helpers/formats');
const { loadScripts } = require('../helpers/load');

const { Outputs, Design, Zip } = loadScripts();
const FILES = structuredClone(Outputs.FILES);

const SHAPES = ['rounded', 'circle', 'squircle', 'square'];
const BACKGROUNDS = ['solid', 'linear', 'radial'];

async function setAll(page, values) {
  await page.evaluate((values) => {
    for (const [id, value] of Object.entries(values)) {
      const el = document.getElementById(id);
      if (el.type === 'checkbox') el.checked = value; else el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, values);
  await settled(page);
}

async function zipFiles(page) {
  const { data } = await download(page, '#zip');
  return Object.fromEntries(Object.entries(unzipSync(new Uint8Array(data))).map(([k, v]) => [k, Buffer.from(v)]));
}

const px = (png, x, y) => Array.from(png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4));
const near = (a, b, t = 6) => a.every((v, i) => Math.abs(v - b[i]) <= t);
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];

/** Expected alpha at a point of an icon of `size` for each shape: is the point inside? */
function inside(shape, size, x, y) {
  const c = size / 2;
  const u = (x + 0.5 - c) / c;
  const v = (y + 0.5 - c) / c;
  if (shape === 'square') return true;
  if (shape === 'circle') return u * u + v * v <= 1;
  if (shape === 'squircle') return Math.abs(u) ** 5 + Math.abs(v) ** 5 <= 1;
  const r = 0.22; // rounded square, default corner radius 22%
  const dx = Math.max(Math.abs(u) - (1 - 2 * r), 0);
  const dy = Math.max(Math.abs(v) - (1 - 2 * r), 0);
  return Math.hypot(dx, dy) <= 2 * r;
}

/** Check a PNG follows the shape: clearly-inside points are opaque and clearly-outside points transparent. */
function checkShape(png, shape, label) {
  const n = png.width;
  const probes = [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1], [Math.round(n * 0.08), Math.round(n * 0.08)], [Math.round(n * 0.15), Math.round(n * 0.04)], [n >> 1, 1], [1, n >> 1]];
  for (const [x, y] of probes) {
    // Skip points close to the edge, where antialiasing decides.
    const margin = 1.5;
    const certain = [[-margin, 0], [margin, 0], [0, -margin], [0, margin]].every(([dx, dy]) => inside(shape, n, x + dx, y + dy) === inside(shape, n, x, y));
    if (!certain) continue;
    const a = px(png, x, y)[3];
    if (inside(shape, n, x, y)) assert.ok(a > 200, `${label}: ${x},${y} should be inside (alpha ${a})`);
    else assert.ok(a < 30, `${label}: ${x},${y} should be outside (alpha ${a})`);
  }
}

async function rasterizeSvg(page, svgText, size) {
  const url = await page.evaluate(async ([svgText, size]) => {
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(img, 0, 0, size, size);
    return c.toDataURL();
  }, [svgText, size]);
  return readPng(Buffer.from(url.split(',')[1], 'base64'));
}

function compare(a, b) {
  let diff = 0;
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let k = 0; k < 4; k++) diff += Math.abs(a.data[i + k] - b.data[i + k]);
    const inkA = a.data[i + 3] >= 128;
    const inkB = b.data[i + 3] >= 128;
    if (inkA && inkB) both++;
    if (inkA || inkB) either++;
  }
  return { meanDiff: diff / a.data.length, overlap: either ? both / either : 1 };
}

describe('shapes, backgrounds and borders', () => {
  let browser;
  let url;
  const server = targets()[1];
  before(async () => { url = await server.start(); browser = await launch('chromium'); });
  after(async () => { await browser.close(); await server.stop(); });

  test('every shape × background × border, in the previews and every file, with the SVG matching the PNG', async (t) => {
    const { context, page, errors } = await openApp(browser, url);
    try {
      await page.fill('#text', 'Ag');
      for (const shape of SHAPES) {
        for (const bgType of BACKGROUNDS) {
          for (const border of [false, true]) {
            const label = `${shape}, ${bgType}, ${border ? 'border' : 'no border'}`;
            await t.test(label, async () => {
              await setAll(page, { shape, bgType, border, bg: '#204080', bg2: '#e0a020', angle: 90, borderColor: '#ffffff', borderWidth: 6 });
              const files = await zipFiles(page);
              assert.deepEqual(Object.keys(files).sort(), FILES.map((f) => f.name).sort());

              for (const f of FILES.filter((x) => x.kind === 'png')) {
                const png = readPng(files[f.name]);
                assert.deepEqual([png.width, png.height], [f.size, f.size], f.name);
                if (f.variant) {
                  // Apple and maskable icons stay full, opaque squares.
                  for (let i = 3; i < png.data.length; i += 4) assert.equal(png.data[i], 255, `${f.name} is opaque`);
                } else {
                  checkShape(png, shape, `${label}: ${f.name}`);
                }
              }
              for (const img of decodeIco(files['favicon.ico'])) {
                checkShape(readPng(Buffer.from(img.data)), shape, `${label}: favicon.ico ${img.width}`);
              }

              // The preview canvases follow the shape too.
              const preview = await page.evaluate(() => {
                const all = document.querySelectorAll('#sizes canvas');
                return all[all.length - 1].toDataURL(); // the 512 px preview
              });
              checkShape(readPng(Buffer.from(preview.split(',')[1], 'base64')), shape, `${label}: 512 preview`);

              const big = readPng(files['android-chrome-512x512.png']);
              const r = compare(big, await rasterizeSvg(page, files['favicon.svg'].toString('utf8'), 512));
              assert.ok(r.meanDiff < 1.5, `SVG vs PNG mean difference ${r.meanDiff.toFixed(2)}`);
              assert.ok(r.overlap > 0.995, `SVG vs PNG overlap ${r.overlap.toFixed(4)}`);
            });
          }
        }
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('gradients: colors and direction', async () => {
    const { context, page } = await openApp(browser, url);
    try {
      await page.fill('#text', '');
      await setAll(page, { shape: 'square', bgType: 'linear', bg: '#ff0000', bg2: '#0000ff', angle: 90 });
      let png = readPng((await download(page, 'button[aria-label="Download android-chrome-512x512.png"]')).data);
      assert.ok(near(px(png, 1, 256), [255, 0, 0, 255], 8), `left is the first color ${px(png, 1, 256)}`);
      assert.ok(near(px(png, 510, 256), [0, 0, 255, 255], 8), `right is the second ${px(png, 510, 256)}`);
      const mid = px(png, 256, 256);
      assert.ok(mid[0] > 100 && mid[2] > 100, `the middle is a mix ${mid}`);
      assert.ok(near(px(png, 256, 1), mid, 4), '90 degrees: no change from top to bottom');

      await setAll(page, { angle: 0 });
      png = readPng((await download(page, 'button[aria-label="Download android-chrome-512x512.png"]')).data);
      assert.ok(near(px(png, 256, 510), [255, 0, 0, 255], 8), '0 degrees: first color at the bottom');
      assert.ok(near(px(png, 256, 1), [0, 0, 255, 255], 8), 'second at the top');

      await setAll(page, { bgType: 'radial' });
      png = readPng((await download(page, 'button[aria-label="Download android-chrome-512x512.png"]')).data);
      assert.ok(near(px(png, 256, 256), [255, 0, 0, 255], 8), 'radial: first color in the middle');
      assert.ok(near(px(png, 0, 0), [0, 0, 255, 255], 12), 'second color in the corners');

      // The Apple and maskable icons use the gradient too.
      const apple = readPng((await download(page, 'button[aria-label="Download apple-touch-icon.png"]')).data);
      assert.ok(near(px(apple, 90, 90), [255, 0, 0, 255], 10) && near(px(apple, 0, 0), [0, 0, 255, 255], 14));

      // The manifest uses the first color.
      const manifest = JSON.parse((await download(page, 'button[aria-label="Download site.webmanifest"]')).data.toString('utf8'));
      assert.equal(manifest.theme_color, '#ff0000');
      assert.equal(manifest.background_color, '#ff0000');
    } finally {
      await context.close();
    }
  });

  test('the border follows the shape and scales with the size, at least 1 px', async () => {
    const { context, page } = await openApp(browser, url);
    try {
      await page.fill('#text', '');
      await setAll(page, { shape: 'square', bg: '#000000', border: true, borderColor: '#ffffff', borderWidth: 4 });
      const files = await zipFiles(page);
      const edgeWidth = (png) => {
        let n = 0;
        while (n < png.width / 2 && px(png, n, png.width >> 1)[0] > 127) n++;
        return n;
      };
      const big = readPng(files['android-chrome-512x512.png']);
      assert.ok(Math.abs(edgeWidth(big) - 20.48) <= 1, `512 px: about 20 px (${edgeWidth(big)})`);
      const small = readPng(files['favicon-16x16.png']);
      assert.equal(edgeWidth(small), 1, '16 px: 1 px, not 0.64');
      assert.ok(px(small, 8, 8)[0] < 40, 'and the middle of a 16 px icon stays clear');
      // Not on the Apple or maskable icons: the system cuts them, so a border would be cut off.
      const apple = readPng(files['apple-touch-icon.png']);
      assert.ok(px(apple, 1, 90)[0] < 40, 'no border on the Apple touch icon');
      // On a circle, the border runs along the circle.
      await setAll(page, { shape: 'circle' });
      const circle = readPng((await download(page, 'button[aria-label="Download android-chrome-512x512.png"]')).data);
      assert.ok(px(circle, 8, 256)[0] > 200, 'white just inside the circle');
      assert.equal(px(circle, 30, 30)[3], 0, 'outside the circle stays transparent');
    } finally {
      await context.close();
    }
  });

  test('position offsets move the content, and Center again puts it back', async () => {
    const { context, page } = await openApp(browser, url);
    try {
      await setAll(page, { transparent: true, fg: '#000000', shape: 'square' });
      const inkCenter = async () => {
        const png = readPng((await download(page, 'button[aria-label="Download android-chrome-512x512.png"]')).data);
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) if (px(png, x, y)[3] > 128) { sx += x; sy += y; n++; }
        return [sx / n, sy / n];
      };
      const [x0, y0] = await inkCenter();
      await page.click('#secPosition > summary');
      assert.equal(await page.locator('#centerOffsets').isDisabled(), true);
      await setAll(page, { offsetX: 10, offsetY: -5 });
      assert.equal(await page.locator('#offsetXOut').textContent(), '+10%');
      assert.equal(await page.locator('#offsetYOut').textContent(), '-5%');
      const [x1, y1] = await inkCenter();
      assert.ok(Math.abs(x1 - x0 - 51.2) < 1, `moved right by 10% (${(x1 - x0).toFixed(1)} px)`);
      assert.ok(Math.abs(y1 - y0 + 25.6) < 1, `moved up by 5% (${(y1 - y0).toFixed(1)} px)`);
      const files = await zipFiles(page);
      const r = compare(readPng(files['android-chrome-512x512.png']), await rasterizeSvg(page, files['favicon.svg'].toString('utf8'), 512));
      assert.ok(r.overlap > 0.99, 'the SVG moves the same way');
      await page.click('#centerOffsets');
      await settled(page);
      assert.deepEqual(await inkCenter(), [x0, y0]);
      await page.click('#undo');
      await settled(page);
      assert.equal(await page.inputValue('#offsetX'), '10', 'centering can be undone');
    } finally {
      await context.close();
    }
  });

  test('dark mode with a gradient: the SVG switches both colors, the dark tab shows them', async () => {
    const { context, page } = await openApp(browser, url);
    try {
      await page.fill('#text', ''); // sample the background, not the letter
      await page.click('#secDark > summary');
      await setAll(page, { bgType: 'radial', bg: '#ff0000', bg2: '#00ff00', dark: true, darkBg: '#111111', darkBg2: '#333333' });
      assert.equal(await page.locator('#darkBg2Field').isVisible(), true);
      const svg = (await download(page, 'button[aria-label="Download favicon.svg"]')).data.toString('utf8');
      assert.match(svg, /@media \(prefers-color-scheme:dark\)\{\.fm-s0\{stop-color:#111111\}\.fm-s1\{stop-color:#333333\}/);
      await page.emulateMedia({ colorScheme: 'dark' });
      const dark = await rasterizeSvg(page, svg, 64);
      assert.ok(near(px(dark, 32, 32), [0x11, 0x11, 0x11, 255], 8), `dark center ${px(dark, 32, 32)}`);
      await page.click('#ptab-browser');
      await settled(page);
      const tab = await page.evaluate(() => Array.from(document.getElementById('tabB').getContext('2d').getImageData(8, 8, 1, 1).data));
      assert.ok(tab[0] < 60 && tab[1] < 60, `the dark tab shows dark colors ${tab}`);
    } finally {
      await context.close();
    }
  });

  test('designs saved before shapes existed (format 1) still open and look the same', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await context.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('favicon-maker.current', JSON.stringify({
        format: 1, settings: { mode: 'text', text: 'Old', radius: 30, bg: '#336699', fg: '#ffffff', transparent: false }, imageId: null, baseline: '', from: null
      }));
    });
    const page = await context.newPage();
    try {
      await page.goto(url);
      await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
      await settled(page);
      assert.equal(await page.inputValue('#text'), 'Old');
      assert.equal(await page.inputValue('#radius'), '30');
      assert.equal(await page.inputValue('#shape'), 'rounded');
      assert.equal(await page.inputValue('#bgType'), 'solid');
      assert.equal(await page.locator('#border').isChecked(), false);

      // A share link from format 1.
      const json = new TextEncoder().encode(JSON.stringify({ f: 1, s: { text: 'L1', radius: 5 } }));
      const sum = (Zip.crc32(json) >>> 0).toString(16).padStart(8, '0');
      await page.evaluate((h) => { location.hash = h; }, '#d1r=' + sum + '.' + Design.toBase64Url(json));
      await page.waitForSelector('#dialog[open]');
      await page.click('#dialogOk');
      await page.waitForFunction(() => document.getElementById('text').value === 'L1');
      assert.equal(await page.inputValue('#radius'), '5');
      assert.equal(await page.inputValue('#shape'), 'rounded');
    } finally {
      await context.close();
    }
  });
});
