'use strict';
/*
 * "Same everywhere": the same icon drawn in Chromium and Firefox with each bundled font should match.
 * Small antialiasing differences are fine; different letter shapes are not.
 * Compares the ink (alpha) of each icon at 16, 32 and 512 px. Skipped when Firefox isn't installed.
 * Set SAME_EVERYWHERE_REPORT=1 to print the numbers.
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, openApp, targets } = require('../helpers/browser');
const { readPng } = require('../helpers/formats');
const { loadScripts } = require('../helpers/load');

const { Fonts } = loadScripts();
const KEYS = Array.from(Fonts.keys());
const SIZES = [16, 32, 512];
const TEXT = 'Ag';
const EMOJI = '😀👍🏽';
const REPORT = !!process.env.SAME_EVERYWHERE_REPORT;

// Limits: mean alpha difference per pixel (0-255), and the overlap of the inked areas (1 = identical).
// At 512 px the browsers match almost exactly, so any change of letter shape fails (Inter vs Source Serif 4
// overlaps 0.44). At 16 and 32 px only antialiasing differs, and a few edge pixels move the overlap of
// thin strokes a lot, so those sizes rely mostly on the mean difference.
const MAX_MEAN_DIFF = { 16: 12, 32: 7, 512: 1 };
const MIN_OVERLAP = { 16: 0.65, 32: 0.85, 512: 0.99 };

/** Draw an icon in the page with transparent background, and return each size as a PNG. */
async function renderSet(page, settings) {
  const urls = await page.evaluate(async ([settings, sizes]) => {
    const s = await Fonts.prepare(settings);
    return sizes.map((size) => Draw.render(size, s).toDataURL('image/png'));
  }, [settings, SIZES]);
  return urls.map((u) => readPng(Buffer.from(u.split(',')[1], 'base64')));
}

/** Mean alpha difference and ink overlap (intersection over union at alpha >= 128). */
function compare(a, b) {
  let diff = 0;
  let both = 0;
  let either = 0;
  for (let i = 3; i < a.data.length; i += 4) {
    diff += Math.abs(a.data[i] - b.data[i]);
    const inkA = a.data[i] >= 128;
    const inkB = b.data[i] >= 128;
    if (inkA && inkB) both++;
    if (inkA || inkB) either++;
  }
  return { meanDiff: diff / (a.data.length / 4), overlap: either ? both / either : 1 };
}

function settingsFor(font, text, emoji) {
  return {
    mode: 'text', text, font, bold: true, emoji, textScale: 70,
    fg: '#000000', bg: '#ffffff', transparent: true, radius: 0, fit: 'contain', pad: 0
  };
}

describe('same everywhere: Chromium and Firefox draw the same icons', () => {
  let chromium;
  let firefox;
  let server;
  let url;
  const results = [];

  before(async () => {
    [chromium, firefox] = await Promise.all([launch('chromium'), launch('firefox')]);
    server = targets()[1];
    url = await server.start();
  });

  after(async () => {
    if (REPORT && results.length) {
      console.log('\nCase                      size  mean diff  overlap');
      for (const r of results) {
        console.log(`${r.name.padEnd(26)}${String(r.size).padStart(4)}  ${r.meanDiff.toFixed(2).padStart(9)}  ${r.overlap.toFixed(3).padStart(7)}`);
      }
    }
    await Promise.all([chromium && chromium.close(), firefox && firefox.close()]);
    await server.stop();
  });

  const cases = [
    ...KEYS.map((k) => ({ name: Fonts.label(k), settings: settingsFor(k, TEXT, 'system') })),
    { name: 'Noto Color Emoji', settings: settingsFor('sans', EMOJI, 'bundled') }
  ];

  for (const c of cases) {
    test(c.name, async (t) => {
      if (!firefox) return t.skip('Firefox is not installed');
      const pages = await Promise.all([openApp(chromium, url), openApp(firefox, url)]);
      try {
        const [inChromium, inFirefox] = await Promise.all(pages.map((p) => renderSet(p.page, c.settings)));
        SIZES.forEach((size, i) => {
          const r = compare(inChromium[i], inFirefox[i]);
          results.push({ name: c.name, size, ...r });
          assert.ok(r.meanDiff <= MAX_MEAN_DIFF[size], `${size} px: mean alpha difference ${r.meanDiff.toFixed(2)}`);
          assert.ok(r.overlap >= MIN_OVERLAP[size], `${size} px: ink overlap ${r.overlap.toFixed(3)}`);
        });
        for (const p of pages) assert.deepEqual(p.errors, []);
      } finally {
        await Promise.all(pages.map((p) => p.context.close()));
      }
    });
  }

  test('control: two different fonts in the same browser do not pass as the same', async () => {
    const { context, page } = await openApp(chromium, url);
    try {
      const [inter, serif] = await Promise.all([renderSet(page, settingsFor('sans', TEXT, 'system')), renderSet(page, settingsFor('serif', TEXT, 'system'))]);
      const r = compare(inter[2], serif[2]);
      results.push({ name: 'control: Inter vs Source Serif 4', size: 512, ...r });
      assert.ok(r.overlap < MIN_OVERLAP[512], `different letter shapes are caught (overlap ${r.overlap.toFixed(3)})`);
    } finally {
      await context.close();
    }
  });
});
