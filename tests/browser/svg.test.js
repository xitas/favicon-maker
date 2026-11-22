'use strict';
/* favicon.svg in the real page: downloads, matching the PNG, dark mode, and uploaded SVGs made safe. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { unzipSync } = require('fflate');
const { DOMParser } = require('@xmldom/xmldom');
const { launch, openApp, settled, download, targets } = require('../helpers/browser');
const { readPng, makePng } = require('../helpers/formats');
const { loadScripts } = require('../helpers/load');

const { Fonts } = loadScripts();
const KEYS = Array.from(Fonts.keys());
const REPORT = !!process.env.SVG_REPORT;

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

/** Draw an SVG (text) on a canvas in the page at `size`, under the page's current color scheme. */
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

/** Mean RGBA difference and overlap of the inked (opaque) areas. */
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

const pixel = (png, x, y) => Array.from(png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4));
const near = (a, b, t = 3) => a.every((v, i) => Math.abs(v - b[i]) <= t);

for (const target of targets()) {
  describe(`favicon.svg from ${target.label}`, () => {
    let browser;
    let url;
    const rows = [];
    before(async () => { url = await target.start(); browser = await launch('chromium'); });
    after(async () => {
      if (REPORT && rows.length) {
        console.log('\nFont                       mean diff  overlap');
        for (const r of rows) console.log(`${r.name.padEnd(26)} ${r.meanDiff.toFixed(2).padStart(9)}  ${r.overlap.toFixed(4)}`);
      }
      await browser.close();
      await target.stop();
    });

    test('favicon.svg downloads, is valid SVG, and matches its copy in the ZIP', async () => {
      const { context, page, errors, externalRequests } = await openApp(browser, url);
      try {
        const files = await zipFiles(page);
        const svg = files['favicon.svg'];
        assert.ok(svg, 'in the ZIP');
        const doc = new DOMParser({ onError: (level, msg) => { if (level !== 'warning') throw new Error(msg); } }).parseFromString(svg.toString('utf8'), 'image/svg+xml');
        assert.equal(doc.documentElement.getAttribute('viewBox'), '0 0 512 512');
        assert.ok(doc.getElementsByTagName('path')[0].getAttribute('d').length > 50, 'the text is outlines');
        assert.equal(doc.getElementsByTagName('text').length, 0, 'no text that needs a font');
        assert.doesNotMatch(svg.toString('utf8'), /@font-face|font-family|<image|data:/, 'no fonts or embedded pictures');
        const single = await download(page, 'button[aria-label="Download favicon.svg"]');
        assert.equal(single.name, 'favicon.svg');
        assert.ok(single.data.equals(svg));
        assert.match(await page.locator('#snippet code').textContent(), /href="\/favicon\.svg" type="image\/svg\+xml" sizes="any"/);
        assert.deepEqual(externalRequests, []);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('the SVG looks the same as the PNG at 512 px in every font', async (t) => {
      const { context, page } = await openApp(browser, url);
      try {
        await setValue(page, 'transparent', true);
        await setValue(page, 'fg', '#000000');
        await setValue(page, 'radius', '0');
        for (const k of KEYS) {
          for (const [text, bold] of [['Ag', true], ['Éq', false]]) {
            const name = `${Fonts.label(k)} ${text}${bold ? ' bold' : ''}`;
            await t.test(name, async () => {
              await page.fill('#text', text);
              await setValue(page, 'font', k);
              await setValue(page, 'bold', bold);
              const files = await zipFiles(page);
              const png = readPng(files['android-chrome-512x512.png']);
              const svg = await rasterizeSvg(page, files['favicon.svg'].toString('utf8'), 512);
              const r = compare(png, svg);
              rows.push({ name, ...r });
              assert.ok(r.meanDiff < 1, `mean difference ${r.meanDiff.toFixed(2)}`);
              assert.ok(r.overlap > 0.98, `ink overlap ${r.overlap.toFixed(4)}`);
            });
          }
        }
      } finally {
        await context.close();
      }
    });

    test('the SVG with colors and rounded corners matches the PNG too', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await setValue(page, 'font', 'serif');
        const files = await zipFiles(page);
        const r = compare(readPng(files['android-chrome-512x512.png']), await rasterizeSvg(page, files['favicon.svg'].toString('utf8'), 512));
        rows.push({ name: 'Default design, colored', ...r });
        assert.ok(r.meanDiff < 1.5, `mean difference ${r.meanDiff.toFixed(2)}`);
      } finally {
        await context.close();
      }
    });

    test('Different colors in dark mode: the SVG switches with the color scheme, and the dark tab shows it', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        assert.equal(await page.locator('#darkColors').isHidden(), true);
        await setValue(page, 'dark', true);
        assert.equal(await page.locator('#darkColors').isVisible(), true);
        await setValue(page, 'darkBg', '#222222');
        await setValue(page, 'darkFg', '#ffcc00');
        const svg = (await download(page, 'button[aria-label="Download favicon.svg"]')).data.toString('utf8');
        assert.match(svg, /@media \(prefers-color-scheme:dark\)\{\.fm-bg\{fill:#222222\}\.fm-fg\{fill:#ffcc00\}\}/);

        await page.emulateMedia({ colorScheme: 'light' });
        const light = await rasterizeSvg(page, svg, 64);
        await page.emulateMedia({ colorScheme: 'dark' });
        const dark = await rasterizeSvg(page, svg, 64);
        assert.ok(near(pixel(light, 32, 4), [11, 122, 117, 255]), `light background ${pixel(light, 32, 4)}`);
        assert.ok(near(pixel(dark, 32, 4), [0x22, 0x22, 0x22, 255]), `dark background ${pixel(dark, 32, 4)}`);
        const hasColor = (png, rgb) => { for (let i = 0; i < png.data.length; i += 4) if (near(Array.from(png.data.subarray(i, i + 3)), rgb, 10)) return true; return false; };
        assert.ok(hasColor(dark, [0xff, 0xcc, 0x00]), 'dark text color');
        assert.ok(!hasColor(light, [0xff, 0xcc, 0x00]), 'not in light mode');

        // The preview: the dark browser tab shows the dark colors, the light tab the normal ones.
        const tab = (id) => page.evaluate((id) => Array.from(document.getElementById(id).getContext('2d').getImageData(16, 2, 1, 1).data), id);
        assert.ok(near(await tab('tabB'), [0x22, 0x22, 0x22, 255]), 'dark tab');
        assert.ok(near(await tab('tabA'), [11, 122, 117, 255]), 'light tab');

        // PNGs keep the normal colors.
        const png = readPng((await download(page, 'button[aria-label="Download favicon-32x32.png"]')).data);
        assert.ok(near(pixel(png, 16, 2), [11, 122, 117, 255]));

        await setValue(page, 'dark', false);
        const plain = (await download(page, 'button[aria-label="Download favicon.svg"]')).data.toString('utf8');
        assert.doesNotMatch(plain, /prefers-color-scheme/);
      } finally {
        await context.close();
      }
    });

    test('emoji and other scripts: no SVG, with the reason in the file list', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        const button = page.locator('button[aria-label="Download favicon.svg"]');
        const status = page.locator('#' + (await button.getAttribute('aria-describedby')).split(' ')[0]);
        for (const [text, reason] of [
          ['A😀', "SVG isn't available for emoji, so browsers use the PNG files."],
          ['سلا', "SVG isn't available for characters outside the chosen font, so browsers use the PNG files."]
        ]) {
          await page.fill('#text', text);
          await settled(page);
          assert.equal(await button.isDisabled(), true, text);
          assert.equal(await status.textContent(), reason);
          assert.doesNotMatch(await page.locator('#snippet code').textContent(), /favicon\.svg/);
          const files = await zipFiles(page);
          assert.equal(files['favicon.svg'], undefined, 'left out of the ZIP');
          assert.ok(files['favicon.ico'] && files['favicon-32x32.png']);
        }
        await page.fill('#text', 'AB');
        await settled(page);
        assert.equal(await button.isDisabled(), false);
        assert.equal(await status.textContent(), '');
      } finally {
        await context.close();
      }
    });

    test('a raster image leaves the SVG out with a note', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await page.click('#modeImage');
        await page.setInputFiles('#file', { name: 'photo.png', mimeType: 'image/png', buffer: makePng(64, 64, () => [200, 0, 0, 255]) });
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('64 × 64'));
        await settled(page);
        const button = page.locator('button[aria-label="Download favicon.svg"]');
        assert.equal(await button.isDisabled(), true);
        const status = page.locator('#' + (await button.getAttribute('aria-describedby')).split(' ')[0]);
        assert.equal(await status.textContent(), "SVG isn't available for PNG, JPG or WebP images, so browsers use the PNG files.");
      } finally {
        await context.close();
      }
    });

    test('an uploaded SVG is cleaned, framed by the design, and matches the PNG', async () => {
      const { context, page, errors, externalRequests } = await openApp(browser, url);
      try {
        const evil = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 50" onload="window.__pwned = 1">
          <script>window.__pwned = 2</script>
          <style>@import url(https://evil.test/x.css); .a { fill: #1060d0 }</style>
          <rect class="a" width="100" height="50"/>
          <circle cx="50" cy="25" r="20" fill="#f0c020"/>
          <image href="https://evil.test/track.png" width="10" height="10"/>
          <foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml" onclick="window.__pwned = 3">x</div></foreignObject>
          <a href="javascript:window.__pwned = 4"><rect width="1" height="1"/></a>
        </svg>`;
        await page.click('#modeImage');
        await page.setInputFiles('#file', { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(evil) });
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('100 × 50'));
        await setValue(page, 'pad', '10');
        const files = await zipFiles(page);
        const svg = files['favicon.svg'].toString('utf8');
        for (const bad of [/<script/i, /onload|onclick/i, /evil\.test/, /foreignObject/i, /javascript:/i, /@import/]) {
          assert.doesNotMatch(svg, bad);
        }
        assert.match(svg, /preserveAspectRatio="xMidYMid meet"/);
        assert.match(svg, /<svg x="51\.2" y="51\.2" width="409\.6" height="409\.6" viewBox="0 0 100 50"/);
        assert.equal(await page.evaluate(() => window.__pwned), undefined, 'nothing ran');
        assert.deepEqual(externalRequests, [], 'nothing was loaded from outside');

        const r = compare(readPng(files['android-chrome-512x512.png']), await rasterizeSvg(page, svg, 512));
        rows.push({ name: 'Uploaded SVG', ...r });
        assert.ok(r.meanDiff < 1.5, `mean difference ${r.meanDiff.toFixed(2)}`);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('an SVG that cannot be read shows an error', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await page.click('#modeImage');
        await page.setInputFiles('#file', { name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<!DOCTYPE svg [<!ENTITY a "x">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>') });
        await page.waitForFunction(() => document.getElementById('fileNote').classList.contains('err'));
        assert.match(await page.locator('#fileNote').textContent(), /entity declarations/);
      } finally {
        await context.close();
      }
    });
  });
}
