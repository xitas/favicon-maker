'use strict';
/* Design checks in the page, and how fast the previews redraw while a slider is dragged. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, openApp, settled, download, targets } = require('../helpers/browser');
const { makePng } = require('../helpers/formats');
const { loadScripts } = require('../helpers/load');

const { Checks } = loadScripts();
const REPORT = !!process.env.PERF_REPORT;

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

const notes = (page) => page.evaluate(() => [...document.querySelectorAll('#checks > *')].map((n) => n.dataset.check || n.textContent));

describe('design checks', () => {
  let browser;
  let url;
  const server = targets()[1];
  before(async () => { url = await server.start(); browser = await launch('chromium'); });
  after(async () => { await browser.close(); await server.stop(); });

  test('the default design looks good, and the checks are announced', async () => {
    const { context, page } = await openApp(browser, url);
    try {
      assert.deepEqual(await notes(page), ['Looks good at every size.']);
      assert.equal(await page.getAttribute('#checks', 'role'), 'status');
      assert.equal(await page.getAttribute('#checks', 'aria-label'), 'Design checks');
    } finally {
      await context.close();
    }
  });

  test('low contrast: warns, Fix contrast keeps the hue and reaches 3:1, and undo brings it back', async () => {
    const { context, page, errors } = await openApp(browser, url);
    try {
      await setAll(page, { fg: '#7fd4ff', bg: '#ffffff' });
      assert.deepEqual(await notes(page), ['contrast']);
      assert.equal(await page.locator('[data-check="contrast"] p').textContent(), 'Low contrast: this may be hard to see at small sizes.');
      await page.click('[data-check="contrast"] button');
      await settled(page);
      const fixed = await page.inputValue('#fg');
      assert.ok(Checks.contrast(fixed, '#ffffff') >= 3, `${fixed} reaches 3:1`);
      const hue = (c) => Checks.toHsl(c)[0];
      assert.ok(Math.abs(hue(fixed) - hue('#7fd4ff')) < 3, 'same hue');
      assert.deepEqual(await notes(page), ['Looks good at every size.']);
      await page.click('#undo');
      await settled(page);
      assert.equal(await page.inputValue('#fg'), '#7fd4ff', 'undo brings the old color back');
      assert.deepEqual(await notes(page), ['contrast']);
      // Advice, never a block: everything still downloads.
      const { data } = await download(page, '#zip');
      assert.ok(data.length > 1000);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('gradients use their worst point; dark mode has its own check', async () => {
    const { context, page } = await openApp(browser, url);
    try {
      await setAll(page, { bgType: 'linear', bg: '#000000', bg2: '#f0f0f0', fg: '#ffffff' });
      assert.deepEqual(await notes(page), ['contrast'], 'white text is lost at the light end');
      await setAll(page, { bg2: '#303030' });
      assert.deepEqual(await notes(page), ['Looks good at every size.']);
      await page.click('#secDark > summary');
      await setAll(page, { dark: true, darkFg: '#ffffff', darkBg: '#f4f4f4', darkBg2: '#ffffff' });
      assert.deepEqual(await notes(page), ['darkContrast']);
      await page.click('[data-check="darkContrast"] button');
      await settled(page);
      assert.ok(Checks.worstContrast(await page.inputValue('#darkFg'), ['#f4f4f4', '#ffffff']).ratio >= 3);
      assert.deepEqual(await notes(page), ['Looks good at every size.']);
    } finally {
      await context.close();
    }
  });

  test('transparent background: says which tab the icon vanishes on', async () => {
    const { context, page } = await openApp(browser, url);
    try {
      await setAll(page, { transparent: true, fg: '#ffffff' });
      assert.deepEqual(await notes(page), ['lightTab']);
      assert.equal(await page.locator('[data-check="lightTab"] p').textContent(), 'This icon is hard to see on light tabs.');
      await setAll(page, { fg: '#111111' });
      assert.deepEqual(await notes(page), ['darkTab']);
      assert.equal(await page.locator('[data-check="darkTab"] p').textContent(), 'This icon is hard to see on dark tabs.');
      await setAll(page, { fg: '#e53935' });
      assert.deepEqual(await notes(page), ['Looks good at every size.']);
    } finally {
      await context.close();
    }
  });

  test('small text at 16 px', async () => {
    const { context, page } = await openApp(browser, url);
    try {
      await page.fill('#text', 'WWW');
      await settled(page);
      assert.deepEqual(await notes(page), ['smallText']);
      assert.match(await page.locator('[data-check="smallText"] p').textContent(), /^Small text: at 16 px it is only \d+(\.\d)? px tall/);
      await page.fill('#text', 'F');
      await settled(page);
      assert.deepEqual(await notes(page), ['Looks good at every size.']);
    } finally {
      await context.close();
    }
  });

  test('thin icon lines, with a button for a thicker line', async () => {
    const { context, page } = await openApp(browser, url);
    try {
      await page.click('#modeIcon');
      await page.waitForSelector('#iconGrid .icon-option');
      await settled(page);
      assert.deepEqual(await notes(page), ['Looks good at every size.']);
      await setAll(page, { iconStroke: 1 });
      assert.deepEqual(await notes(page), ['thinLines']);
      assert.equal(await page.locator('[data-check="thinLines"] button').textContent(), 'Use line width 2');
      await page.click('[data-check="thinLines"] button');
      await settled(page);
      assert.equal(await page.inputValue('#iconStroke'), '2');
      assert.deepEqual(await notes(page), ['Looks good at every size.']);
      await page.click('#undo');
      await settled(page);
      assert.equal(await page.inputValue('#iconStroke'), '1');
    } finally {
      await context.close();
    }
  });

  test('images skip the color checks, with a note', async () => {
    const { context, page } = await openApp(browser, url);
    try {
      await page.click('#modeImage');
      await page.setInputFiles('#file', { name: 'x.png', mimeType: 'image/png', buffer: makePng(32, 32, () => [255, 255, 255, 255]) });
      await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('32 × 32'));
      await setAll(page, { bg: '#ffffff' });
      assert.match((await notes(page))[0], /Contrast isn’t checked for uploaded images/);
    } finally {
      await context.close();
    }
  });

  test('dragging a slider stays smooth with each preview tab open', async (t) => {
    const { context, page } = await openApp(browser, url);
    const rows = [];
    try {
      await page.fill('#text', 'Ag');
      for (const tab of ['sizes', 'browser', 'home', 'zoom']) {
        await t.test(tab, async () => {
          await page.click('#ptab-' + tab);
          await settled(page);
          // Time frames in turns: 15 frames while nothing happens, then 15 while the corner radius slider
          // moves one step every frame, as a drag does, eight times over. Taking turns means a busy test
          // machine (other tests running in parallel) slows both alike. The difference is what redrawing
          // the previews costs; absolute times depend on the machine and are only reported.
          const samples = await page.evaluate(() => new Promise((resolve) => {
            const r = document.getElementById('radius');
            const out = { idle: [], drag: [] };
            const BLOCK = 15;
            const ROUNDS = 8;
            let last = performance.now();
            let i = 0;
            const step = () => {
              const now = performance.now();
              const block = Math.floor(i / BLOCK);
              const kind = block % 2 ? 'drag' : 'idle';
              if (i % BLOCK) out[kind].push(now - last); // skip each block's first frame, which straddles turns
              last = now;
              if (++i >= BLOCK * 2 * ROUNDS) { resolve(out); return; }
              if (Math.floor(i / BLOCK) % 2) {
                r.value = String(10 + (i % 40));
                r.dispatchEvent(new Event('input', { bubbles: true }));
              }
              requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          }));
          const stats = (times) => {
            const t = times.slice().sort((a, b) => a - b);
            return { avg: t.reduce((a, b) => a + b, 0) / t.length, median: t[t.length >> 1], p95: t[Math.floor(t.length * 0.95)], max: t[t.length - 1] };
          };
          const idle = stats(samples.idle);
          const drag = stats(samples.drag);
          rows.push({ tab, idle, drag });
          const allowed = 8 + idle.median * 0.25;
          assert.ok(drag.median - idle.median < allowed,
            `${tab}: dragging adds under ${allowed.toFixed(1)} ms a frame (median ${idle.median.toFixed(1)} -> ${drag.median.toFixed(1)} ms)`);
        });
      }
    } finally {
      if (REPORT) {
        console.log('\nTab       idle avg   drag avg   drag 95th  drag slowest');
        for (const r of rows) {
          console.log(`${r.tab.padEnd(9)} ${r.idle.avg.toFixed(1).padStart(6)} ms  ${r.drag.avg.toFixed(1).padStart(6)} ms  ${r.drag.p95.toFixed(1).padStart(6)} ms  ${r.drag.max.toFixed(1).padStart(6)} ms`);
        }
      }
      await context.close();
    }
  });
});
