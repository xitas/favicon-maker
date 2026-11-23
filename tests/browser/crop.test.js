'use strict';
/* Cropping and trimming uploaded images, suggested colors, and the eyedroppers. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, openApp, settled, download, targets } = require('../helpers/browser');
const { makePng, readPng } = require('../helpers/formats');
const { loadScripts } = require('../helpers/load');

const { Design } = loadScripts();

/** 200 × 100: red on the left half, blue on the right. */
const HALVES = makePng(200, 100, (x) => (x < 100 ? [220, 20, 20, 255] : [20, 40, 220, 255]));
/** 100 × 100, transparent, with a 20 × 20 green square at (60, 10). */
const SMALL_LOGO = makePng(100, 100, (x, y) => (x >= 60 && x < 80 && y >= 10 && y < 30 ? [20, 160, 60, 255] : [0, 0, 0, 0]));
/** 80 × 80 white with a blue square in the middle. */
const ON_WHITE = makePng(80, 80, (x, y) => (x >= 20 && x < 60 && y >= 20 && y < 60 ? [30, 60, 200, 255] : [255, 255, 255, 255]));

async function upload(page, png, name, size) {
  if (await page.getAttribute('#modeImage', 'aria-pressed') !== 'true') await page.click('#modeImage');
  await page.setInputFiles('#file', { name: name || 'image.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction((size) => document.getElementById('fileNote').textContent.startsWith(size), size);
  await settled(page);
}

const crop = (page) => page.evaluate(() => ['cropZoom', 'cropX', 'cropY'].map((id) => Number(document.getElementById(id).value)));
const pixel = (png, x, y) => Array.from(png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4));
const near = (a, b, t = 12) => a.every((v, i) => Math.abs(v - b[i]) <= t);
const RED = [220, 20, 20, 255];
const BLUE = [20, 40, 220, 255];

async function bigPng(page) {
  return readPng((await download(page, 'button[aria-label="Download android-chrome-512x512.png"]')).data);
}

for (const target of targets()) {
  describe(`crop and colors from ${target.label}`, () => {
    let browser;
    let url;
    before(async () => { url = await target.start(); browser = await launch('chromium'); });
    after(async () => { await browser.close(); await target.stop(); });

    test('crop by mouse: drag moves, the wheel zooms, a pinch zooms', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        await upload(page, HALVES, 'halves.png', '200 × 100');
        await page.selectOption('#fit', 'cover');
        await settled(page);
        assert.equal(await page.locator('#cropBox').isVisible(), true);
        // Cover: the 200 × 100 image fills the frame, center between red and blue.
        let big = await bigPng(page);
        assert.ok(near(pixel(big, 200, 256), RED) && near(pixel(big, 312, 256), BLUE), 'red left of center, blue right');

        await page.locator('#crop').scrollIntoViewIfNeeded();
        const box = await page.locator('#crop').boundingBox();
        await page.mouse.move(box.x + 120, box.y + 120);
        await page.mouse.down();
        await page.mouse.move(box.x + 165, box.y + 120, { steps: 5 }); // 45 px of a 180 px frame: 25%
        await page.mouse.up();
        await settled(page);
        let [z, x, y] = await crop(page);
        assert.equal(z, 100);
        assert.equal(x, 25, 'moved right by a quarter of the frame');
        assert.equal(y, 0, 'cover: no room to move up or down');
        big = await bigPng(page);
        assert.ok(near(pixel(big, 256, 256), RED), 'more of the red half now');

        await page.mouse.move(box.x + 120, box.y + 120);
        await page.mouse.wheel(0, -300);
        await settled(page);
        [z] = await crop(page);
        assert.ok(z > 100 && z < 800, `the wheel zoomed in (${z}%)`);

        // Pinch: two pointers moving apart double the zoom.
        await page.evaluate(() => {
          const el = document.getElementById('crop');
          const r = el.getBoundingClientRect();
          const ev = (type, id, x) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: r.left + x, clientY: r.top + 120, bubbles: true, isPrimary: id === 1 }));
          document.getElementById('cropZoom').value = '100';
          ev('pointerdown', 1, 100); ev('pointerdown', 2, 140);
          ev('pointermove', 2, 180);
          ev('pointerup', 2, 180); ev('pointerup', 1, 100);
        });
        await settled(page);
        assert.equal((await crop(page))[0], 200, 'the pinch doubled the zoom');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('crop by keyboard, announced for screen readers', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await upload(page, HALVES, 'halves.png', '200 × 100');
        assert.equal(await page.getAttribute('#crop', 'tabindex'), '0');
        assert.equal(await page.getAttribute('#crop', 'aria-roledescription'), 'crop area');
        assert.match(await page.evaluate(() => document.getElementById(document.getElementById('crop').getAttribute('aria-describedby')).textContent), /arrow keys/);
        await page.focus('#crop');
        for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Shift+ArrowDown');
        assert.deepEqual(await crop(page), [100, 3, 10]);
        assert.equal(await page.locator('#cropStatus').textContent(), 'Zoom 100%. Moved 3% right and 10% down.');
        await page.keyboard.press('+');
        assert.equal((await crop(page))[0], 110);
        await page.keyboard.press('-');
        assert.equal((await crop(page))[0], 100);
        await page.keyboard.press('0');
        assert.deepEqual(await crop(page), [100, 0, 0]);
        assert.equal(await page.locator('#cropStatus').textContent(), 'Zoom 100%. Centered.');
        // Keys move the crop, not the page or the undo history of the browser.
        await page.keyboard.press('ArrowLeft');
        await settled(page);
        await page.click('#undo');
        await settled(page);
        assert.deepEqual(await crop(page), [100, 0, 0], 'undoable');
      } finally {
        await context.close();
      }
    });

    test('trim empty edges makes the logo fill the frame', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await upload(page, SMALL_LOGO, 'logo.png', '100 × 100');
        let big = await bigPng(page);
        assert.ok(!near(pixel(big, 256, 256), [20, 160, 60, 255]), 'before: the middle is empty');
        await page.click('#trimImage');
        await settled(page);
        assert.equal(await page.locator('#trimNote').textContent(), 'Trimmed the empty edges.');
        const [z, x, y] = await crop(page);
        assert.equal(z, 500);
        assert.ok(x < 0 && y > 0, `moved toward the logo (${x}, ${y})`);
        big = await bigPng(page);
        assert.ok(near(pixel(big, 256, 256), [20, 160, 60, 255]), 'after: the logo fills the middle');
        // A photo-like image with a busy edge has nothing to trim.
        await upload(page, HALVES, 'halves.png', '200 × 100');
        await page.click('#trimImage');
        assert.match(await page.locator('#trimNote').textContent(), /no empty or plain edges/);
        await page.click('#undo');
      } finally {
        await context.close();
      }
    });

    test('the crop survives a reload and a share link', async () => {
      const { context, page } = await openApp(browser, url);
      let hash;
      try {
        await upload(page, SMALL_LOGO, 'logo.png', '100 × 100');
        await page.click('#trimImage');
        await settled(page);
        const before = await crop(page);
        await page.waitForTimeout(600);
        await page.reload();
        await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('100 × 100'));
        assert.deepEqual(await crop(page), before, 'after a reload');
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } }));
        await page.click('#share');
        await page.waitForFunction(() => document.getElementById('shareUrl').value !== '');
        const link = await page.inputValue('#shareUrl');
        hash = link.slice(link.indexOf('#'));
        const d = await Design.decodeHash(hash);
        assert.deepEqual([d.settings.cropZoom, d.settings.cropX, d.settings.cropY], before);
        assert.ok(d.image, 'the small image is in the link');
      } finally {
        await context.close();
      }
      const fresh = await openApp(browser, url + hash);
      try {
        await fresh.page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('100 × 100'));
        const d = await Design.decodeHash(hash);
        assert.deepEqual(await crop(fresh.page), [d.settings.cropZoom, d.settings.cropX, d.settings.cropY]);
      } finally {
        await fresh.context.close();
      }
    });

    test('suggested background colors from the image', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await upload(page, ON_WHITE, 'logo.png', '80 × 80');
        const swatches = await page.locator('#swatches .swatch').evaluateAll((all) => all.map((b) => [b.dataset.color, b.getAttribute('aria-label')]));
        assert.equal(swatches[0][0], '#ffffff', 'the edge color first');
        assert.match(swatches[0][1], /edge color/);
        assert.ok(swatches.some(([c]) => c === '#1e3cc8'), `the logo color (${swatches.map((s) => s[0])})`);
        await page.click('#swatches .swatch[data-color="#1e3cc8"]');
        await settled(page);
        assert.equal(await page.inputValue('#bg'), '#1e3cc8');
        await page.click('#undo');
        await settled(page);
        assert.equal(await page.inputValue('#bg'), '#0b7a75');
      } finally {
        await context.close();
      }
    });

    test('eyedropper: the browser’s EyeDropper where it exists', async () => {
      const context = await browser.newContext();
      await context.addInitScript(() => {
        window.EyeDropper = class { open() { return Promise.resolve({ sRGBHex: '#abcdef' }); } };
      });
      const page = await context.newPage();
      try {
        await page.goto(url);
        await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
        const buttons = await page.locator('.eyedrop').evaluateAll((all) => all.map((b) => b.dataset.for));
        assert.deepEqual(buttons.slice().sort(), ['bg', 'bg2', 'borderColor', 'darkBg', 'darkBg2', 'darkFg', 'fg', 'iconColor'], 'one next to every color');
        await page.click('.eyedrop[data-for="bg"]');
        await page.waitForFunction(() => document.getElementById('bg').value === '#abcdef');
        assert.equal(await page.locator('#appNote').textContent(), 'Picked #abcdef for the background color.');
      } finally {
        await context.close();
      }
    });

    test('eyedropper without the API: click the crop view or the 512 px preview', async () => {
      const context = await browser.newContext({ acceptDownloads: true });
      await context.addInitScript(() => { delete window.EyeDropper; });
      const page = await context.newPage();
      try {
        await page.goto(url);
        await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
        // Text mode: the 512 px preview. Pick the default teal background into the text color.
        await page.click('.eyedrop[data-for="fg"]');
        assert.match(await page.locator('#appNote').textContent(), /^Click a pixel on the 512 px preview to pick the text color\. Press Esc to cancel\.$/);
        const preview = page.locator('#sizes canvas[aria-label="512 pixel preview"]');
        await preview.click({ position: { x: 20, y: 64 } });
        assert.equal(await page.inputValue('#fg'), '#0b7a75');
        // Esc cancels.
        await page.click('.eyedrop[data-for="bg"]');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#appNote').textContent(), 'Picking a color was cancelled.');
        await preview.click({ position: { x: 20, y: 64 } });
        assert.equal(await page.inputValue('#bg'), '#0b7a75', 'no longer picking');
        // Image mode: the crop view.
        await upload(page, HALVES, 'halves.png', '200 × 100');
        await page.click('.eyedrop[data-for="bg"]');
        await page.locator('#crop').click({ position: { x: 150, y: 120 } });
        assert.equal(await page.inputValue('#bg'), '#1428dc', 'the blue half, from the undimmed image');
      } finally {
        await context.close();
      }
    });
  });
}
