'use strict';
/* The Icon source: loading the Lucide set, search, keyboard, files, SVG, saving and share links. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { unzipSync } = require('fflate');
const { launch, openApp, settled, download, targets } = require('../helpers/browser');
const { readPng } = require('../helpers/formats');
const { loadScripts } = require('../helpers/load');

const { Outputs, Design } = loadScripts();
const FILES = structuredClone(Outputs.FILES);

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

/** Pick the Icon source and wait for the grid. */
async function iconMode(page) {
  await page.click('#modeIcon');
  await page.waitForFunction(() => document.querySelectorAll('#iconGrid .icon-option').length > 0);
  await settled(page);
}

const selected = (page) => page.locator('#iconGrid [aria-selected="true"]').getAttribute('data-name');

for (const target of targets()) {
  describe(`icons from ${target.label}`, () => {
    let browser;
    let url;
    before(async () => { url = await target.start(); browser = await launch('chromium'); });
    after(async () => { await browser.close(); await target.stop(); });

    test('the icon set loads only when the Icon source is chosen', async () => {
      const { context, page, errors, externalRequests } = await openApp(browser, url);
      try {
        const requested = [];
        page.on('request', (r) => { if (r.url().includes('lucide')) requested.push(r.url()); });
        assert.equal(await page.evaluate(() => Icons.loaded()), false);
        assert.equal(await page.locator('#iconPanel').isVisible(), false);
        await iconMode(page);
        assert.equal(requested.length, 1, 'one file, once');
        assert.match(await page.locator('#iconCount').textContent(), /^\d{4} icons\. Showing the first 150; search to find others\.$/);
        assert.equal(await page.locator('#iconGrid .icon-option').count(), 150);
        assert.equal(await selected(page), 'star', 'the default icon is selected and shown first');
        assert.equal(await page.locator('#textPanel').isVisible(), false);
        assert.deepEqual(externalRequests, []);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('search, and keyboard navigation through the grid', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await iconMode(page);
        await page.fill('#iconSearch', 'coffee');
        await page.waitForFunction(() => document.querySelector('#iconGrid .icon-option').dataset.name === 'coffee');
        assert.match(await page.locator('#iconCount').textContent(), /^\d+ icons? match(es)? “coffee”\.$/);
        await page.fill('#iconSearch', 'zzzz');
        assert.equal(await page.locator('#iconCount').textContent(), 'No icons match “zzzz”.');
        assert.equal(await page.locator('#iconGrid .icon-option').count(), 0);

        await page.fill('#iconSearch', 'arrow');
        await page.waitForFunction(() => document.querySelectorAll('#iconGrid .icon-option').length > 20);
        // Tab from the search box goes into the grid, onto one option only.
        await page.focus('#iconSearch');
        await page.keyboard.press('Tab');
        const focused = () => page.evaluate(() => {
          const o = document.activeElement.closest('.icon-option');
          return o ? [...o.parentElement.children].indexOf(o) : -1;
        });
        assert.equal(await focused(), 0);
        assert.equal(await page.locator('#iconGrid [tabindex="0"]').count(), 1);
        const cols = await page.evaluate(() => {
          const opts = [...document.querySelectorAll('#iconGrid .icon-option')];
          return opts.findIndex((o) => o.offsetTop !== opts[0].offsetTop);
        });
        assert.ok(cols > 2, `${cols} columns`);
        await page.keyboard.press('ArrowRight');
        assert.equal(await focused(), 1);
        await page.keyboard.press('ArrowDown');
        assert.equal(await focused(), 1 + cols);
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowLeft');
        assert.equal(await focused(), 0);
        await page.keyboard.press('ArrowLeft');
        assert.equal(await focused(), 0, 'stays at the start');
        await page.keyboard.press('End');
        const last = await focused();
        assert.equal(last, (await page.locator('#iconGrid .icon-option').count()) - 1);
        await page.keyboard.press('Home');
        await page.keyboard.press('ArrowRight');
        const name = await page.evaluate(() => document.activeElement.dataset.name);
        await page.keyboard.press('Enter');
        await settled(page);
        assert.equal(await selected(page), name, 'Enter chooses it');
        assert.equal(await page.locator('#iconGrid [aria-selected="true"]').count(), 1);
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press(' ');
        await settled(page);
        assert.notEqual(await selected(page), name, 'Space chooses too');
        const a11y = await page.evaluate(() => {
          const g = document.getElementById('iconGrid');
          const o = g.querySelector('[aria-selected="true"]');
          return [g.getAttribute('role'), o.getAttribute('role'), o.getAttribute('aria-label').length > 0];
        });
        assert.deepEqual(a11y, ['listbox', 'option', true]);
        // Undo goes back to the previous icon.
        const now = await selected(page);
        await page.click('#undo');
        await settled(page);
        await page.waitForFunction((n) => document.querySelector('#iconGrid [aria-selected="true"]')?.dataset.name !== n, now);
      } finally {
        await context.close();
      }
    });

    test('icons in every file, and the SVG matches the PNG', async (t) => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        await iconMode(page);
        for (const [icon, extra] of [
          ['star', {}],
          ['coffee', { iconStroke: 1, iconScale: 90, fg: '#ffcc00' }],
          ['house', { iconStroke: 3, iconScale: 40, shape: 'circle', bgType: 'radial', bg2: '#202020', border: true, offsetY: 5 }],
          ['rocket', { shape: 'squircle', bgType: 'linear', angle: 45, transparent: false }]
        ]) {
          await t.test(icon, async () => {
            await page.fill('#iconSearch', icon);
            await page.waitForSelector(`#icon-${icon}`);
            await page.click(`#icon-${icon}`);
            await setAll(page, extra);
            const files = await zipFiles(page);
            assert.deepEqual(Object.keys(files).sort(), FILES.map((f) => f.name).sort(), 'every file, favicon.svg included');
            const big = readPng(files['android-chrome-512x512.png']);
            let ink = 0;
            const fg = (extra.fg || '#ffffff').slice(1).match(/../g).map((h) => parseInt(h, 16));
            for (let i = 0; i < big.data.length; i += 4) {
              if (Math.abs(big.data[i] - fg[0]) < 20 && Math.abs(big.data[i + 1] - fg[1]) < 20 && Math.abs(big.data[i + 2] - fg[2]) < 20) ink++;
            }
            assert.ok(ink > 2000, `the icon is drawn in its color (${ink} px)`);
            const svg = files['favicon.svg'].toString('utf8');
            assert.match(svg, /class="fm-icon"/);
            assert.match(svg, /stroke-linecap="round"/);
            const r = compare(big, await rasterizeSvg(page, svg, 512));
            assert.ok(r.meanDiff < 1.5, `SVG vs PNG mean difference ${r.meanDiff.toFixed(2)}`);
            assert.ok(r.overlap > 0.995, `overlap ${r.overlap.toFixed(4)}`);
          });
        }
        assert.match(await page.locator('#snippet code').textContent(), /favicon\.svg/);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('the icon color is the text color', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await iconMode(page);
        await setAll(page, { iconColor: '#123456' });
        assert.equal(await page.inputValue('#fg'), '#123456');
        await setAll(page, { fg: '#abcdef' });
        assert.equal(await page.inputValue('#iconColor'), '#abcdef');
      } finally {
        await context.close();
      }
    });

    test('saved designs and share links keep the icon by name', async () => {
      const { context, page, errors } = await openApp(browser, url);
      let link;
      try {
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } }));
        await iconMode(page);
        await page.fill('#iconSearch', 'leaf');
        await page.click('#icon-leaf');
        await setAll(page, { iconStroke: 1.5 });
        await page.fill('#designName', 'Leafy');
        await page.click('#saveDesign');
        await page.waitForFunction(() => document.querySelectorAll('#designs li').length === 1);
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('favicon-maker.designs'))[0].settings);
        assert.equal(stored.icon, 'leaf');
        assert.ok(Object.values(stored).every((v) => typeof v !== 'string' || !/^[Mm]-?\d/.test(v)), 'no drawing stored, only the name');

        await page.click('#share');
        await page.waitForFunction(() => document.getElementById('shareUrl').value !== '');
        link = await page.inputValue('#shareUrl');
        const d = await Design.decodeHash(link.slice(link.indexOf('#')));
        assert.deepEqual([d.settings.mode, d.settings.icon, d.settings.iconStroke], ['icon', 'leaf', 1.5]);
        assert.ok(link.length < 200, `a short link (${link.length} characters)`);

        // Reload: the icon design comes back.
        await page.reload();
        await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
        await page.waitForSelector('#iconGrid [aria-selected="true"]');
        assert.equal(await selected(page), 'leaf');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }

      // The link in a fresh browser.
      const fresh = await openApp(browser, url + link.slice(link.indexOf('#')));
      try {
        await fresh.page.waitForSelector('#iconGrid [aria-selected="true"]');
        assert.equal(await selected(fresh.page), 'leaf');
        assert.equal(await fresh.page.inputValue('#iconStroke'), '1.5');
      } finally {
        await fresh.context.close();
      }
    });

    test('an icon name the set doesn’t have says so, and draws nothing', async () => {
      const hash = await Design.encodeHash(Design.validate({ mode: 'icon', icon: 'no-such-icon' }), null);
      const { context, page } = await openApp(browser, url + hash);
      try {
        await page.waitForFunction(() => document.getElementById('iconNote').textContent !== '');
        assert.equal(await page.locator('#iconNote').textContent(), 'The icon “no-such-icon” isn’t in the library. Choose another one.');
        assert.equal(await page.locator('#iconGrid [aria-selected="true"]').count(), 0);
        await page.fill('#iconSearch', 'star');
        await page.click('#icon-star');
        await settled(page);
        assert.equal(await page.locator('#iconNote').textContent(), '');
      } finally {
        await context.close();
      }
    });
  });
}
