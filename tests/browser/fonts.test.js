'use strict';
/*
 * Bundled fonts in real browsers, from file:// and a local server.
 * Runs in Playwright's Chromium and Firefox, and in installed Chrome and Edge when they are present.
 * A browser that isn't installed is skipped (CI installs Chromium and Firefox).
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { unzipSync } = require('fflate');
const { launch, openApp, nextFrames, settled, download, targets } = require('../helpers/browser');
const { loadScripts, ROOT } = require('../helpers/load');

const { Fonts } = loadScripts();
const KEYS = Array.from(Fonts.keys());
const BROWSERS = (process.env.FONT_TEST_BROWSERS || 'chromium,firefox,chrome,msedge').split(',');

/** Set a form control and fire the events the app listens to. */
async function setValue(page, id, value) {
  await page.evaluate(([id, value]) => {
    const el = document.getElementById(id);
    if (el.type === 'checkbox') el.checked = value; else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, value]);
  await settled(page);
}

/** Status of every face registered for a family, e.g. { '400 700': 'loaded' }. */
function faceStatus(page, family) {
  return page.evaluate((family) => {
    const out = {};
    document.fonts.forEach((f) => { if (f.family.replace(/"/g, '') === family) out[f.weight] = f.status; });
    return out;
  }, family);
}

for (const browserName of BROWSERS) {
  describe(`fonts in ${browserName}`, () => {
    let browser;
    before(async () => { browser = await launch(browserName); });
    after(async () => { if (browser) await browser.close(); });

    for (const target of targets()) {
      describe(`from ${target.label}`, () => {
        let url;
        before(async () => { url = await target.start(); });
        after(async () => { await target.stop(); });

        test('every bundled font loads in both weights, with no outside requests', async (t) => {
          if (!browser) return t.skip(`${browserName} is not installed`);
          const { context, page, errors, externalRequests } = await openApp(browser, url);
          try {
            await setValue(page, 'text', 'Ag');
            for (const k of KEYS) {
              await t.test(Fonts.label(k), async () => {
                await setValue(page, 'font', k);
                for (const bold of Fonts.hasBold(k) ? [false, true] : [false]) {
                  await setValue(page, 'bold', bold);
                  const spec = `${Fonts.weight(k, bold)} 32px "${Fonts.family(k)}"`;
                  assert.equal(await page.evaluate((spec) => document.fonts.check(spec, 'Ag'), spec), true, spec);
                }
                const status = await faceStatus(page, Fonts.family(k));
                assert.ok(Object.values(status).length > 0, 'registered');
                assert.ok(Object.values(status).every((s) => s === 'loaded'), JSON.stringify(status));
                assert.equal(await page.locator('#fontNote').evaluate((n) => n.classList.contains('err')), false);
              });
            }
            // Only the chosen fonts were downloaded: menu label fonts are separate, tiny files.
            assert.deepEqual(externalRequests, []);
            assert.deepEqual(errors, []);
          } finally {
            await context.close();
          }
        });

        test('the bundled emoji font loads and draws in color', async (t) => {
          if (!browser) return t.skip(`${browserName} is not installed`);
          const { context, page, errors, externalRequests } = await openApp(browser, url);
          try {
            await setValue(page, 'text', '😀');
            await setValue(page, 'emoji', 'bundled');
            await page.waitForFunction(() => ['ready', 'unsupported'].includes(Fonts.emojiState()));
            await settled(page);
            assert.equal(await page.evaluate(() => Fonts.emojiState()), 'ready');
            assert.equal(await page.locator('#emojiNote').textContent(), '');
            assert.deepEqual(externalRequests, []);
            assert.deepEqual(errors, []);
          } finally {
            await context.close();
          }
        });
      });
    }
  });
}

/* ---------- Behavior, in Chromium only ---------- */

for (const target of targets()) {
  describe(`font behavior from ${target.label}`, () => {
    let browser;
    let url;
    before(async () => { url = await target.start(); browser = await launch('chromium'); });
    after(async () => { await browser.close(); await target.stop(); });

    test('the font menu lists every font, each in its own font, with old names as values', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        const options = await page.locator('#font option').evaluateAll((all) => all.map((o) => [o.value, o.textContent, o.style.fontFamily]));
        assert.deepEqual(options.map((o) => o[0]), KEYS);
        for (const [value, text, family] of options) {
          assert.equal(text, Fonts.label(value));
          assert.match(family, new RegExp(`^"${Fonts.previewFamily(value)}"`));
        }
        assert.equal(await page.inputValue('#font'), 'sans');
        assert.match(await page.locator('#font').evaluate((s) => s.style.fontFamily), /FM Inter Name/);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('a font downloads only when it is chosen', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        const loaded = () => page.evaluate(() => {
          const out = [];
          document.fonts.forEach((f) => { if (f.status === 'loaded' && !/ Name$/.test(f.family.replace(/"/g, ''))) out.push(f.family.replace(/"/g, '')); });
          return [...new Set(out)].sort();
        });
        assert.deepEqual(await loaded(), ['FM Inter'], 'only the default font at start');
        await setValue(page, 'font', 'serif');
        assert.deepEqual(await loaded(), ['FM Inter', 'FM Source Serif 4']);
        assert.equal(await page.evaluate(() => Fonts.emojiState()), 'idle', 'no emoji font until chosen');
      } finally {
        await context.close();
      }
    });

    test('old setting names still draw with the matching bundled font', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        const used = await page.evaluate(async () => {
          // Record the font in use at each fillText call (Draw restores the canvas state afterwards).
          const original = CanvasRenderingContext2D.prototype.fillText;
          let lastFont = '';
          CanvasRenderingContext2D.prototype.fillText = function (...args) { lastFont = this.font; return original.apply(this, args); };
          const out = {};
          for (const font of ['sans', 'serif', 'mono', 'display', 'something-old']) {
            const s = await Fonts.prepare({ mode: 'text', text: 'A', font, bold: true, emoji: 'system', textScale: 70, fg: '#fff', bg: '#000', radius: 0 });
            Draw.render(32, s);
            out[font] = [s.font, lastFont];
          }
          CanvasRenderingContext2D.prototype.fillText = original;
          return out;
        });
        assert.deepEqual(Object.fromEntries(Object.entries(used).map(([k, v]) => [k, v[0]])),
          { sans: 'sans', serif: 'serif', mono: 'mono', display: 'display', 'something-old': 'sans' });
        assert.match(used.serif[1], /FM Source Serif 4/);
        assert.match(used.mono[1], /FM JetBrains Mono/);
        assert.match(used.display[1], /FM Anton/);
        // Browsers write weight 700 back as "bold" and leave out 400.
        assert.match(used.sans[1], /^(700|bold) .*"FM Inter"/);
        assert.match(used['something-old'][1], /"FM Inter"/);
        assert.doesNotMatch(used.display[1], /^(700|bold) /, 'Anton has no bold');
      } finally {
        await context.close();
      }
    });

    test('Bold turns off for a font with one weight', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await setValue(page, 'font', 'display');
        assert.equal(await page.locator('#bold').isDisabled(), true);
        assert.equal(await page.locator('#fontNote').textContent(), 'Anton has one weight, so Bold is off.');
        await setValue(page, 'font', 'sans');
        assert.equal(await page.locator('#bold').isDisabled(), false);
        assert.equal(await page.locator('#fontNote').textContent(), '');
      } finally {
        await context.close();
      }
    });

    test('characters the font lacks show a note', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        const note = page.locator('#glyphNote');
        assert.equal(await note.getAttribute('role'), 'status');
        assert.equal(await note.textContent(), '');
        await page.fill('#text', 'سلام');
        await settled(page);
        assert.equal(await page.inputValue('#text'), 'سلا', 'Urdu letters count as characters too');
        assert.equal(await note.textContent(), "These characters aren't in the chosen font, so they may look different on other computers.");
        await page.fill('#text', 'Aب');
        await settled(page);
        assert.equal(await note.textContent(), "This character isn't in the chosen font, so it may look different on other computers.");
        await page.fill('#text', 'Aé😀');
        await settled(page);
        assert.equal(await note.textContent(), '', 'Latin and emoji need no note');

        // Downloads still work: the missing characters come from the system font.
        await page.fill('#text', 'سلا');
        await settled(page);
        const { data } = await download(page, '#zip');
        assert.equal(Object.keys(unzipSync(new Uint8Array(data))).length, loadScripts().Outputs.FILES.length - 1, 'every file but favicon.svg');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('downloads wait for the font to load', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        // Make every font file slow, then choose a new font and download straight away.
        let delayed = 0;
        await context.route(/\.woff2$/, async (route) => {
          delayed++;
          await new Promise((r) => setTimeout(r, 1500));
          await route.continue();
        });
        await page.evaluate(() => {
          const el = document.getElementById('font');
          el.value = 'slab';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const first = await download(page, 'button[aria-label="Download android-chrome-192x192.png"]');
        await settled(page);
        const second = await download(page, 'button[aria-label="Download android-chrome-192x192.png"]');
        assert.ok(first.data.equals(second.data), 'the first download already used the loaded font');

        // And it really differs from the same icon in the default font.
        await page.unroute(/\.woff2$/);
        await setValue(page, 'font', 'sans');
        const sans = await download(page, 'button[aria-label="Download android-chrome-192x192.png"]');
        assert.ok(!sans.data.equals(first.data));
        if (target.label === 'http://') assert.ok(delayed > 0, 'font requests were slowed down');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('a font that fails to load blocks downloads with a message', async (t) => {
      if (target.label !== 'http://') return t.skip('needs the server to fail the request');
      const { context, page } = await openApp(browser, url);
      try {
        await context.route(/montserrat-.*\.woff2$/, (route) => route.fulfill({ status: 404, body: '' }));
        let downloads = 0;
        page.on('download', () => { downloads++; });
        await setValue(page, 'font', 'geometric');
        assert.match(await page.locator('#fontNote').textContent(), /Could not load the font: the Montserrat font could not be loaded/);
        await page.click('#zip');
        await page.waitForFunction(() => document.getElementById('filesNote').textContent !== '');
        assert.match(await page.locator('#filesNote').textContent(), /Could not create favicons\.zip: the Montserrat font could not be loaded/);
        assert.equal(downloads, 0);
      } finally {
        await context.close();
      }
    });

    test('Same everywhere falls back to system emoji with a note when the font draws nothing', async (t) => {
      if (target.label !== 'http://') return t.skip('needs the server to swap the font');
      const { context, page } = await openApp(browser, url);
      try {
        // Act like a browser without COLRv1 color fonts: serve Noto's 😀 with its color tables removed.
        // The glyph is there but its outline is empty, so it draws nothing.
        const colorless = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'emoji-without-color.woff2'));
        await context.route(/noto-color-emoji\.woff2$/, (route) => route.fulfill({ status: 200, contentType: 'font/woff2', body: colorless }));
        await page.fill('#text', '😀');
        await setValue(page, 'emoji', 'bundled');
        await page.waitForFunction(() => Fonts.emojiState() === 'unsupported');
        await settled(page);
        assert.equal(await page.locator('#emojiNote').textContent(), "This browser can't draw the bundled emoji, so this device's emoji are used instead.");
        const { data } = await download(page, 'button[aria-label="Download favicon-32x32.png"]');
        assert.ok(data.length > 0, 'downloads still work');
      } finally {
        await context.close();
      }
    });
  });
}
