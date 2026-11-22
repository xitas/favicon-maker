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
  assert.deepEqual(Object.keys(files).sort(), NAMES, 'every file in FILES');
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
  assert.equal(manifest.icons.length, 4);
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
  await nextFrames(page); // let any earlier refresh finish first
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

    test('Download all gives a ZIP with every file in text mode', async () => {
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

    test('the text box holds 3 visible characters, with a counter and a note', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        await recordText(page);
        const count = page.locator('#textCount');
        const note = page.locator('#textNote');

        assert.equal(await page.locator('#text').getAttribute('maxlength'), null, 'no misleading maxlength');
        assert.equal(await note.getAttribute('role'), 'status', 'the note is announced');
        assert.equal(await count.textContent(), '1 / 3');
        assert.equal(await note.textContent(), '');

        // Type one key at a time, past the limit.
        await page.locator('#text').press('End');
        await page.locator('#text').pressSequentially('BCD');
        await nextFrames(page);
        assert.equal(await page.inputValue('#text'), 'FBC');
        assert.equal(await count.textContent(), '3 / 3');
        assert.equal(await note.textContent(), 'Up to 3 characters fit in a favicon.');
        // Refreshes are batched per frame, so not every step is drawn, but nothing past the limit ever is.
        const drawn = await page.evaluate(() => [...new Set(window.__drawnText)]);
        assert.equal(drawn[drawn.length - 1], 'FBC');
        for (const text of drawn) assert.ok('FBC'.startsWith(text), `drew ${JSON.stringify(text)}`);

        // Typing in the middle of a full box changes nothing and keeps the caret.
        await page.locator('#text').press('Home');
        await page.locator('#text').press('ArrowRight');
        await page.keyboard.type('X');
        assert.equal(await page.inputValue('#text'), 'FBC');
        assert.equal(await page.evaluate(() => document.getElementById('text').selectionStart), 1);

        // Deleting clears the note.
        await page.locator('#text').press('End');
        await page.locator('#text').press('Backspace');
        await nextFrames(page);
        assert.equal(await page.inputValue('#text'), 'FB');
        assert.equal(await count.textContent(), '2 / 3');
        assert.equal(await note.textContent(), '');

        // A long paste keeps what fits.
        assert.deepEqual(await drawnTextFor(page, 'Hello'), ['Hel']);
        assert.equal(await page.inputValue('#text'), 'Hel');
        assert.equal(await note.textContent(), 'Up to 3 characters fit in a favicon.');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('emoji made of several parts stay whole', async (t) => {
      const { context, page } = await openApp(browser, url);
      try {
        await recordText(page);
        const cases = [
          ['👨‍👩‍👧', '👨‍👩‍👧', '1 / 3'],
          ['🇵🇰🇵🇰', '🇵🇰🇵🇰', '2 / 3'],
          ['AB👍🏽', 'AB👍🏽', '3 / 3'],
          ['A👨‍👩‍👧', 'A👨‍👩‍👧', '2 / 3'],
          ['éée', 'éée', '3 / 3'],
          ['AB👍🏽C', 'AB👍🏽', '3 / 3'],
          ['🇵🇰🇵🇰🇵🇰🇵🇰', '🇵🇰🇵🇰🇵🇰', '3 / 3'],
          ['👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧', '👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧', '3 / 3']
        ];
        for (const [typed, kept, counter] of cases) {
          await t.test(typed, async () => {
            assert.deepEqual(await drawnTextFor(page, typed), [kept.normalize('NFC')], 'drawn whole, in precomposed form');
            assert.equal(await page.inputValue('#text'), kept);
            assert.equal(await page.locator('#textCount').textContent(), counter);
          });
        }
      } finally {
        await context.close();
      }
    });

    test('a skin tone added to a full box joins the last emoji', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await page.fill('#text', 'AB👍');
        await page.locator('#text').press('End');
        await page.keyboard.insertText('🏽');
        assert.equal(await page.inputValue('#text'), 'AB👍🏽');
        assert.equal(await page.locator('#textNote').textContent(), '');
      } finally {
        await context.close();
      }
    });

    test('the snippet follows the folder field, on the page and when copied', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        await page.evaluate(() => {
          window.__copied = null;
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: (text) => { window.__copied = text; return Promise.resolve(); } }
          });
        });
        const code = page.locator('#snippet code');
        assert.equal(await page.inputValue('#basePath'), '/');
        assert.match(await code.textContent(), /href="\/favicon\.ico" sizes="16x16 32x32 48x48"/);

        for (const [typed, prefix] of [['favicon-maker', '/favicon-maker/'], ['/a/b/', '/a/b/'], ['', '/'], ['  docs//icons  ', '/docs/icons/']]) {
          await page.fill('#basePath', typed);
          await nextFrames(page);
          const text = await code.textContent();
          const hrefs = [...text.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
          assert.equal(hrefs.length, 5, typed);
          for (const href of hrefs) assert.ok(href.startsWith(prefix) && !href.slice(prefix.length).includes('/'), `${typed}: ${href}`);

          await page.click('#copySnippet');
          await page.waitForFunction(() => window.__copied !== null);
          assert.equal(await page.evaluate(() => window.__copied), text, 'copied text matches the page');
          await page.evaluate(() => { window.__copied = null; });
        }

        // The manifest inside the ZIP keeps icon paths relative, whatever the folder.
        const files = await downloadZip(page);
        const manifest = JSON.parse(files['site.webmanifest'].toString('utf8'));
        assert.deepEqual(manifest.icons.map((i) => i.src), ['android-chrome-192x192.png', 'android-chrome-512x512.png', 'maskable-icon-192x192.png', 'maskable-icon-512x512.png']);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('a failed build shows a message near the button and leaves it usable', async (t) => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        const breakToBlob = (how) => page.evaluate((how) => {
          window.__realToBlob = window.__realToBlob || HTMLCanvasElement.prototype.toBlob;
          HTMLCanvasElement.prototype.toBlob = how === 'null'
            ? function (cb) { setTimeout(() => cb(null), 0); }
            : function () { throw new DOMException('The canvas has been tainted.', 'SecurityError'); };
        }, how);
        const fixToBlob = () => page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.__realToBlob; });

        let downloads = 0;
        page.on('download', () => { downloads++; });

        for (const how of ['null', 'throw']) {
          await t.test(`toBlob ${how === 'null' ? 'returns null' : 'throws'}: Download all`, async () => {
            await breakToBlob(how);
            await page.click('#zip');
            const note = page.locator('#filesNote');
            await page.waitForFunction(() => document.getElementById('filesNote').textContent !== '');
            const message = await note.textContent();
            assert.match(message, /^Could not create favicons\.zip: .+\. Try again\.$/);
            if (how === 'null') assert.match(message, /could not make a 16 px PNG/);
            assert.equal(await note.getAttribute('role'), 'status');
            assert.match(await note.getAttribute('class'), /\berr\b/);
            assert.equal(await page.locator('#zip').isDisabled(), false);
            assert.equal(await page.locator('#zip').textContent(), 'Download all (.zip)');
            assert.equal(await page.locator('#zip').getAttribute('aria-describedby'), 'filesNote');
          });

          await t.test(`toBlob ${how === 'null' ? 'returns null' : 'throws'}: single download`, async () => {
            const button = page.locator('button[aria-label="Download favicon-32x32.png"]');
            await button.click();
            const statusId = (await button.getAttribute('aria-describedby')).split(' ')[0];
            const status = page.locator('#' + statusId);
            await page.waitForFunction((id) => document.getElementById(id).textContent !== '', statusId);
            assert.match(await status.textContent(), /^Could not create favicon-32x32\.png: .+\. Try again\.$/);
            assert.equal(await status.getAttribute('role'), 'status');
            assert.equal(await button.isDisabled(), false);
          });
        }

        await t.test('after a fix, the next try works and clears the message', async () => {
          await fixToBlob();
          const files = await downloadZip(page);
          checkZipContents(files);
          assert.equal(await page.locator('#filesNote').textContent(), '');
          const single = await download(page, 'button[aria-label="Download favicon-32x32.png"]');
          assert.ok(single.data.equals(files['favicon-32x32.png']));
        });

        assert.equal(downloads, 2, 'failed builds start no download');
        assert.deepEqual(errors, [], 'failures are handled, not thrown');
      } finally {
        await context.close();
      }
    });

    test('in image mode with no image, the Download buttons are off with a note', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        const buttons = page.locator('#zip, #files button');
        const states = () => buttons.evaluateAll((all) => all.map((b) => b.disabled));
        assert.equal(await buttons.count(), FILES.length + 1);
        assert.ok((await states()).every((d) => !d), 'on in text mode');

        await page.click('#modeImage');
        assert.ok((await states()).every((d) => d), 'off in image mode with no image');
        assert.equal(await page.locator('#filesNote').textContent(), 'Choose an image first.');
        assert.doesNotMatch(await page.locator('#filesNote').getAttribute('class'), /\berr\b/);

        await page.click('#modeText');
        assert.ok((await states()).every((d) => !d), 'on again in text mode');
        assert.equal(await page.locator('#filesNote').textContent(), '');

        await page.click('#modeImage');
        await page.setInputFiles('#file', { name: 'test.png', mimeType: 'image/png', buffer: TEST_IMAGE });
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('64 × 64'));
        assert.ok((await states()).every((d) => !d), 'on once an image is loaded');
        assert.equal(await page.locator('#filesNote').textContent(), '');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('loading a new image releases the old object URL', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        await page.evaluate(() => {
          window.__created = [];
          window.__revoked = [];
          const create = URL.createObjectURL.bind(URL);
          const revoke = URL.revokeObjectURL.bind(URL);
          URL.createObjectURL = (obj) => { const u = create(obj); window.__created.push(u); return u; };
          URL.revokeObjectURL = (u) => { window.__revoked.push(u); revoke(u); };
        });
        await page.click('#modeImage');
        const load = async (name, buffer, size) => {
          await page.setInputFiles('#file', { name, mimeType: 'image/png', buffer });
          await page.waitForFunction((s) => document.getElementById('fileNote').textContent.startsWith(s), `${size} × ${size}`);
        };
        await load('one.png', TEST_IMAGE, 64);
        await load('two.png', makePng(32, 32, () => [0, 255, 0, 255]), 32);
        await load('three.png', makePng(48, 48, () => [0, 0, 255, 255]), 48);

        const { created, revoked } = await page.evaluate(() => ({ created: window.__created, revoked: window.__revoked }));
        assert.equal(created.length, 3);
        assert.deepEqual(revoked, [created[0], created[1]], 'each replaced image is released, the current one is kept');

        // The current image still draws after the old ones are released.
        const files = await downloadZip(page);
        assert.ok(near(pixel(readPng(files['android-chrome-512x512.png']), 256, 256), [0, 0, 255, 255]));
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}
