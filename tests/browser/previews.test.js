'use strict';
/* The realistic previews: browser tabs, bookmarks, search result, home screens and wallpapers. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, openApp, settled, download, targets } = require('../helpers/browser');
const { readPng } = require('../helpers/formats');

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

/** RGBA at a point given in CSS pixels of a canvas (works at any pixel density). */
function pixelAt(page, id, cx, cy) {
  return page.evaluate(([id, cx, cy]) => {
    const c = document.getElementById(id);
    const k = c.width / parseFloat(c.style.width || c.width);
    return Array.from(c.getContext('2d').getImageData(Math.floor(cx * k), Math.floor(cy * k), 1, 1).data);
  }, [id, cx, cy]);
}

const near = (a, b, t = 12) => a.every((v, i) => Math.abs(v - b[i]) <= t);
const RED = [255, 0, 0, 255];

for (const target of targets()) {
  describe(`previews from ${target.label}`, () => {
    let browser;
    let url;
    before(async () => { url = await target.start(); browser = await launch('chromium'); });
    after(async () => { await browser.close(); await target.stop(); });

    test('preview tabs: roles, keyboard, and the chosen tab is remembered', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        const state = () => page.evaluate(() => [...document.querySelectorAll('.ptabs [role="tab"]')].map((t) => ({
          id: t.id, selected: t.getAttribute('aria-selected'), tabindex: t.tabIndex, panelHidden: document.getElementById(t.getAttribute('aria-controls')).hidden,
          labelled: document.getElementById(t.getAttribute('aria-controls')).getAttribute('aria-labelledby') === t.id
        })));
        let s = await state();
        assert.equal(await page.locator('.ptabs').getAttribute('role'), 'tablist');
        assert.deepEqual(s.map((t) => t.selected), ['true', 'false', 'false', 'false']);
        assert.ok(s.every((t) => t.labelled), 'each panel is labelled by its tab');
        assert.deepEqual(s.map((t) => t.tabindex), [0, -1, -1, -1], 'only the chosen tab is in the tab order');

        await page.focus('#ptab-sizes');
        await page.keyboard.press('ArrowRight');
        s = await state();
        assert.deepEqual(s.map((t) => [t.selected, t.panelHidden]), [['false', true], ['true', false], ['false', true], ['false', true]]);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'ptab-browser');
        await page.keyboard.press('End');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'ptab-zoom');
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'ptab-sizes', 'wraps around');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'ptab-home');
        // Tab moves into the panel content, not to the next tab.
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'pp-home');

        await page.reload();
        await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
        assert.equal(await page.getAttribute('#ptab-home', 'aria-selected'), 'true');
      } finally {
        await context.close();
      }
    });

    test('browser previews: real sizes, the current design, live updates, and the dark tab', async () => {
      const { context, page, errors } = await openApp(browser, url, { deviceScaleFactor: 2 });
      try {
        await page.click('#ptab-browser');
        await settled(page);
        const sizes = await page.evaluate(() => ['tabA', 'tabB', 'bmIcon', 'serpIcon'].map((id) => {
          const c = document.getElementById(id);
          return [id, c.getBoundingClientRect().width, c.width];
        }));
        assert.deepEqual(sizes, [['tabA', 16, 32], ['tabB', 16, 32], ['bmIcon', 16, 32], ['serpIcon', 18, 36]], 'real CSS size, sharp on a 2x screen');

        await setAll(page, { shape: 'square', bg: '#ff0000' });
        for (const id of ['tabA', 'tabB', 'bmIcon', 'serpIcon']) assert.ok(near(await pixelAt(page, id, 1, 1), RED), `${id} shows the new color`);
        await setAll(page, { bg: '#0000ff' });
        assert.ok(near(await pixelAt(page, 'tabA', 1, 1), [0, 0, 255, 255]), 'updates live');

        await setAll(page, { appName: 'Bakery', basePath: 'shop/cakes' });
        assert.equal(await page.locator('#tabTitleA').textContent(), 'Bakery');
        assert.equal(await page.locator('#bmLabel').textContent(), 'Bakery');
        assert.equal(await page.locator('#serpName').textContent(), 'Bakery');
        assert.equal(await page.locator('#serpUrl').textContent(), 'example.com › shop › cakes');
        await setAll(page, { basePath: 'https://cdn.example.org/brand/' });
        assert.equal(await page.locator('#serpUrl').textContent(), 'cdn.example.org › brand');

        // Dark mode colors on the dark tab only.
        await page.click('#secDark > summary');
        await setAll(page, { dark: true, darkBg: '#00ff00' });
        assert.ok(near(await pixelAt(page, 'tabB', 1, 1), [0, 255, 0, 255]), 'dark tab: dark mode color');
        assert.ok(near(await pixelAt(page, 'tabA', 1, 1), [0, 0, 255, 255]), 'light tab: normal color');
        assert.match(await page.locator('#darkTabNote').textContent(), /dark mode colors/);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('home screens: rounded iPhone corners, the chosen Android shape, and wallpapers', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        await page.fill('#text', ''); // sample the background, not the letter
        await setAll(page, { bg: '#ff0000', radius: 0 });
        // Choose the teardrop under Sizes, by keyboard.
        await page.focus('#masks [aria-checked="true"]');
        await page.keyboard.press('End');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.getAttribute('#masks [aria-checked="true"]', 'data-shape'), 'circle', 'arrows wrap: back to the first');
        await page.keyboard.press('ArrowLeft');
        assert.equal(await page.getAttribute('#masks [aria-checked="true"]', 'data-shape'), 'teardrop');
        assert.equal(await page.locator('#masks [role="radio"]').count(), 4);

        await page.click('#ptab-home');
        await settled(page);
        const box = await page.evaluate(() => ['iosIcon', 'androidIcon'].map((id) => document.getElementById(id).getBoundingClientRect().width));
        assert.deepEqual(box, [60, 48]);
        // iPhone: inside red, corner cut off by the system's rounded corners (the file itself is square).
        assert.ok(near(await pixelAt(page, 'iosIcon', 30, 30), RED));
        assert.equal((await pixelAt(page, 'iosIcon', 0.5, 0.5))[3], 0);
        // Android teardrop: square bottom-right corner, round top-left.
        assert.ok(near(await pixelAt(page, 'androidIcon', 47, 47), RED, 30), 'bottom-right is square');
        assert.equal((await pixelAt(page, 'androidIcon', 1, 1))[3], 0, 'top-left is round');
        assert.equal(await page.locator('#androidCaption').textContent(), 'Android: the maskable icon, cut to a teardrop');
        assert.equal(await page.locator('#iosLabel').textContent(), 'My App');

        // Wallpapers.
        const wall = () => page.evaluate(() => [document.getElementById('iosScreen').dataset.wall, document.getElementById('androidScreen').dataset.wall, getComputedStyle(document.getElementById('iosScreen')).backgroundImage]);
        assert.equal((await wall())[0], 'light');
        await page.click('.wall-choice [data-wall="dark"]');
        let w = await wall();
        assert.deepEqual(w.slice(0, 2), ['dark', 'dark']);
        await page.keyboard.press('ArrowRight');
        w = await wall();
        assert.deepEqual(w.slice(0, 2), ['color', 'color']);
        assert.match(w[2], /linear-gradient/);
        assert.equal(await page.getAttribute('.wall-choice [data-wall="color"]', 'aria-checked'), 'true');
        await page.reload();
        await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
        assert.equal((await wall())[0], 'color', 'remembered');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('zoom: the 16 and 32 px files, 8 times larger, pixel for pixel, with an optional grid', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        await page.fill('#text', 'Ag');
        await page.click('#ptab-zoom');
        await settled(page);
        for (const n of [16, 32]) {
          const file = readPng((await download(page, `button[aria-label="Download favicon-${n}x${n}.png"]`)).data);
          const zoom = await page.evaluate((n) => {
            const c = document.getElementById('zoom' + n);
            return { w: c.width, css: c.getBoundingClientRect().width, rendering: getComputedStyle(c).imageRendering, data: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data) };
          }, n);
          assert.equal(zoom.css, n * 8);
          assert.equal(zoom.w, n * 8);
          assert.equal(zoom.rendering, 'pixelated');
          // The middle of each 8 × 8 block is exactly the file's pixel.
          for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
              const z = ((y * 8 + 4) * zoom.w + (x * 8 + 4)) * 4;
              const p = (y * n + x) * 4;
              assert.deepEqual(zoom.data.slice(z, z + 4), Array.from(file.data.subarray(p, p + 4)), `${n} px: pixel ${x},${y}`);
              // Sharp edges: the whole block is one color.
              const corner = ((y * 8 + 1) * zoom.w + (x * 8 + 1)) * 4;
              assert.deepEqual(zoom.data.slice(corner, corner + 4), zoom.data.slice(z, z + 4), `${n} px: block ${x},${y} is flat`);
            }
          }
        }

        // The grid: lines between the pixels, and it's remembered.
        const lineAt = () => page.evaluate(() => {
          const c = document.getElementById('zoom16');
          const ctx = c.getContext('2d');
          const line = Array.from(ctx.getImageData(8, 60, 1, 1).data);
          const inside = Array.from(ctx.getImageData(12, 60, 1, 1).data);
          return JSON.stringify(line) !== JSON.stringify(inside);
        });
        assert.equal(await lineAt(), false, 'no grid at first');
        await page.check('#zoomGrid');
        await settled(page);
        assert.equal(await lineAt(), true, 'grid lines between pixels');
        await page.reload();
        await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
        await settled(page);
        assert.equal(await page.isChecked('#zoomGrid'), true);
        assert.equal(await lineAt(), true);
        // The zoom follows the design live.
        const before = await page.evaluate(() => document.getElementById('zoom16').toDataURL());
        await setAll(page, { bg: '#ff00ff' });
        assert.notEqual(await page.evaluate(() => document.getElementById('zoom16').toDataURL()), before);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}
