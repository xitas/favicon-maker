'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const decodeIco = require('decode-ico');
const { unzipSync } = require('fflate');
const { launch, openApp, nextFrames, download, targets } = require('../helpers/browser');
const { parseIco, pngSize, readPng, makePng } = require('../helpers/formats');
const { loadScripts } = require('../helpers/load');

const FILES = structuredClone(loadScripts().Outputs.FILES);
const NAMES = FILES.map((f) => f.name).sort();

/** A 64 × 64 test image: solid red with a blue square in the top-left corner. */
const TEST_IMAGE = makePng(64, 64, (x, y) => (x < 16 && y < 16 ? [0, 0, 255, 255] : [255, 0, 0, 255]));

const pixel = (png, x, y) => Array.from(png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4));
const isOpaque = (png) => { for (let i = 3; i < png.data.length; i += 4) if (png.data[i] !== 255) return false; return true; };
const near = (a, b, tolerance = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
const countPixels = (png, rgba) => { let n = 0; for (let i = 0; i < png.data.length; i += 4) if (near(Array.from(png.data.subarray(i, i + 4)), rgba)) n++; return n; };

async function downloadZip(page) {
  const { name, data } = await download(page, '#zip');
  assert.equal(name, 'favicons.zip');
  const files = unzipSync(new Uint8Array(data));
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)]));
}

/** Check every file in the ZIP has the right format and size. */
function checkZipContents(files) {
  assert.deepEqual(Object.keys(files).sort(), NAMES, 'all 7 files');
  for (const f of FILES.filter((x) => x.kind === 'png')) {
    assert.deepEqual(pngSize(files[f.name]), { width: f.size, height: f.size }, f.name);
  }

  const ico = files['favicon.ico'];
  const parsed = parseIco(ico);
  assert.equal(parsed.header.type, 1);
  assert.deepEqual(parsed.entries.map((e) => e.widthByte), [16, 32, 48]);
  const images = decodeIco(ico);
  assert.deepEqual(images.map((i) => [i.type, i.width, i.height]), [['png', 16, 16], ['png', 32, 32], ['png', 48, 48]]);
  for (const img of images) assert.deepEqual(pngSize(Buffer.from(img.data)), { width: img.width, height: img.height });

  const manifest = JSON.parse(files['site.webmanifest'].toString('utf8'));
  assert.equal(typeof manifest.name, 'string');
  assert.equal(manifest.icons.length, 2);
  return { manifest };
}

/** Record every string the page draws with fillText. */
async function recordText(page) {
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    window.__drawnText = [];
    CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
      window.__drawnText.push(text);
      return original.call(this, text, ...rest);
    };
  });
}

/** Type into the text box and return the distinct strings drawn on the canvases. */
async function drawnTextFor(page, value) {
  await page.evaluate(() => { window.__drawnText = []; });
  await page.fill('#text', value);
  await nextFrames(page);
  return page.evaluate(() => [...new Set(window.__drawnText)]);
}

for (const target of targets()) {
  describe(`app opened from ${target.label}`, () => {
    let browser;
    let url;

    before(async () => {
      url = await target.start();
      browser = await launch();
    });

    after(async () => {
      if (browser) await browser.close();
      await target.stop();
    });

    test('loads with no console errors and no external requests', async () => {
      const { context, page, errors, externalRequests } = await openApp(browser, url);
      try {
        await page.click('#modeImage');
        await page.click('#modeText');
        await nextFrames(page);
        assert.deepEqual(errors, []);
        assert.deepEqual(externalRequests, [], 'only Google Fonts may be requested');
        assert.equal(await page.locator('#files li').count(), FILES.length);
      } finally {
        await context.close();
      }
    });

    test('Download all gives a ZIP with all 7 files in text mode', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        const files = await downloadZip(page);
        const { manifest } = checkZipContents(files);
        assert.equal(manifest.name, 'My App');

        // The default design: white "F" on #0b7a75.
        const big = readPng(files['android-chrome-512x512.png']);
        assert.ok(countPixels(big, [11, 122, 117, 255]) > 512 * 512 * 0.3, 'background color is drawn');
        assert.ok(countPixels(big, [255, 255, 255, 255]) > 512 * 512 * 0.02, 'white text is drawn');
        assert.equal(pixel(big, 0, 0)[3], 0, 'rounded corner is transparent');
        assert.ok(isOpaque(readPng(files['apple-touch-icon.png'])), 'Apple touch icon is opaque');

        assert.equal(await page.locator('#zip').textContent(), 'Download all (.zip)', 'button label is restored');
        assert.equal(await page.locator('#zip').isDisabled(), false, 'button is enabled again');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('the Apple touch icon has no transparency with a transparent background', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        await page.check('#transparent');
        await nextFrames(page);
        const files = await downloadZip(page);
        checkZipContents(files);

        const apple = readPng(files['apple-touch-icon.png']);
        assert.ok(isOpaque(apple), 'every pixel is opaque');
        assert.deepEqual(pixel(apple, 0, 0), [255, 255, 255, 255], 'white fills in for the transparent background');

        const small = readPng(files['favicon-32x32.png']);
        assert.ok(!isOpaque(small), 'the other icons do keep transparency');

        const manifest = JSON.parse(files['site.webmanifest'].toString('utf8'));
        assert.equal(manifest.background_color, '#ffffff');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('each single Download button gives the same file as the ZIP', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        const zipped = await downloadZip(page);
        for (const f of FILES) {
          const single = await download(page, `button[aria-label="Download ${f.name}"]`);
          assert.equal(single.name, f.name);
          assert.ok(single.data.equals(zipped[f.name]), `${f.name} matches the copy in the ZIP`);
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('image mode produces files from an uploaded image', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        await page.click('#modeImage');
        await page.setInputFiles('#file', { name: 'test.png', mimeType: 'image/png', buffer: TEST_IMAGE });
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('64 × 64'));
        assert.equal(await page.locator('#dropText').textContent(), 'test.png');
        await nextFrames(page);

        const files = await downloadZip(page);
        checkZipContents(files);

        const big = readPng(files['android-chrome-512x512.png']);
        assert.ok(near(pixel(big, 256, 256), [255, 0, 0, 255]), 'center is the red of the image');
        assert.ok(near(pixel(big, 64, 64), [0, 0, 255, 255]), 'top-left area is the blue of the image');
        assert.ok(countPixels(big, [11, 122, 117, 255]) === 0, 'the image covers the background');

        const apple = readPng(files['apple-touch-icon.png']);
        assert.ok(isOpaque(apple));
        assert.ok(near(pixel(apple, 90, 90), [255, 0, 0, 255]));

        for (const f of FILES.filter((x) => x.kind === 'png')) {
          const single = await download(page, `button[aria-label="Download ${f.name}"]`);
          assert.ok(single.data.equals(files[f.name]), `${f.name} matches the copy in the ZIP`);
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('a file that is not an image shows an error', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await page.click('#modeImage');
        await page.setInputFiles('#file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
        await page.waitForFunction(() => document.getElementById('fileNote').classList.contains('err'));
        assert.match(await page.locator('#fileNote').textContent(), /not an image/);
      } finally {
        await context.close();
      }
    });

    test('short text and single emoji are drawn whole', async (t) => {
      const { context, page } = await openApp(browser, url);
      try {
        await recordText(page);
        for (const value of ['AB', 'F', '🇵🇰', '👍🏽', '😀']) {
          await t.test(value, async () => {
            assert.deepEqual(await drawnTextFor(page, value), [value]);
          });
        }
      } finally {
        await context.close();
      }
    });

    test('text longer than 3 characters is drawn in full', { todo: 'readSettings cuts the text to 3 characters although the box allows 12, with no message' }, async (t) => {
      const { context, page } = await openApp(browser, url);
      try {
        await recordText(page);
        for (const value of ['ABCD', 'Hello']) {
          await t.test(value, async () => {
            assert.deepEqual(await drawnTextFor(page, value), [value]);
          });
        }
      } finally {
        await context.close();
      }
    });

    test('emoji made of several parts are never split', { todo: 'the 3-character cut counts code points, so it can split an emoji in the middle' }, async (t) => {
      const { context, page } = await openApp(browser, url);
      try {
        await recordText(page);
        const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
        for (const value of ['👨‍👩‍👧', '🇵🇰🇵🇰', 'AB👍🏽', 'A👨‍👩‍👧']) {
          await t.test(value, async () => {
            const [drawn] = await drawnTextFor(page, value);
            const whole = [...segmenter.segment(value)].map((s) => s.segment);
            const kept = [...segmenter.segment(drawn)].map((s) => s.segment);
            assert.deepEqual(kept, whole.slice(0, kept.length), `drew ${JSON.stringify(drawn)}`);
          });
        }
      } finally {
        await context.close();
      }
    });
  });
}
