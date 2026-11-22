'use strict';
/*
 * Image shrinking quality: the icon made from a large upload, compared with a high-quality reference resize
 * (sharp, Lanczos3) at 16, 32 and 48 px. "Before" is one drawImage call, as the app used to do; "after" is
 * the app's step-by-step shrink. Runs in Chromium, and in Firefox when installed.
 * Set SHRINK_REPORT=1 to print the numbers, and SHRINK_EXTRA_IMAGE=path to add your own image (a real photo).
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sharp = require('sharp');
const { launch, openApp, targets } = require('../helpers/browser');
const { readPng } = require('../helpers/formats');
const images = require('../helpers/images');

const SIZES = [16, 32, 48];
const REPORT = !!process.env.SHRINK_REPORT;

/** Root mean square difference in premultiplied RGBA (0-255), and how much darker edge pixels are on average. */
function compare(out, ref) {
  let sq = 0;
  let fringe = 0;
  let edges = 0;
  for (let i = 0; i < ref.data.length; i += 4) {
    const ao = out.data[i + 3] / 255;
    const ar = ref.data[i + 3] / 255;
    for (let k = 0; k < 3; k++) sq += (out.data[i + k] * ao - ref.data[i + k] * ar) ** 2;
    sq += (out.data[i + 3] - ref.data[i + 3]) ** 2;
    // Fringe: on see-through edge pixels, how much darker the color is than the reference.
    if (ref.data[i + 3] > 20 && ref.data[i + 3] < 235 && out.data[i + 3] > 0) {
      const lum = (d) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      fringe += lum(ref.data) - lum(out.data);
      edges++;
    }
  }
  return { rmse: Math.sqrt(sq / ref.data.length), fringe: edges ? fringe / edges : 0 };
}

/** Shrink in the page, both ways, for each size. Returns PNG buffers. */
function shrinkInPage(page, dataUrl) {
  return page.evaluate(async ([dataUrl, sizes]) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const settings = { mode: 'image', image: img, imageVector: false, transparent: true, radius: 0, pad: 0, fit: 'contain' };
    return sizes.map((n) => {
      const before = document.createElement('canvas');
      before.width = before.height = n;
      const ctx = before.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, n, n);
      return { before: before.toDataURL(), after: Draw.render(n, settings).toDataURL() };
    });
  }, [dataUrl, SIZES]);
}

const decode = (u) => readPng(Buffer.from(u.split(',')[1], 'base64'));

async function reference(png, n) {
  const buf = await sharp(png).resize(n, n, { kernel: 'lanczos3', fit: 'fill' }).png().toBuffer();
  return readPng(buf);
}

describe('step-by-step shrinking is closer to a high-quality resize', () => {
  const sources = [['photo', images.photo()], ['logo', images.logo()], ['line art', images.lineArt()]];
  if (process.env.SHRINK_EXTRA_IMAGE) sources.push(['your image', fs.readFileSync(process.env.SHRINK_EXTRA_IMAGE)]);
  const rows = [];
  const browsers = {};
  let server;
  let url;

  before(async () => {
    server = targets()[1];
    url = await server.start();
    browsers.chromium = await launch('chromium');
    browsers.firefox = await launch('firefox');
  });

  after(async () => {
    if (REPORT) {
      console.log('\nBrowser   Image       Size  RMSE before  RMSE after  Change   Fringe before  Fringe after');
      for (const r of rows) {
        console.log(`${r.browser.padEnd(10)}${r.image.padEnd(12)}${String(r.size).padStart(4)}  ${r.before.rmse.toFixed(2).padStart(11)}  ${r.after.rmse.toFixed(2).padStart(10)}  ${(((r.after.rmse - r.before.rmse) / r.before.rmse) * 100).toFixed(0).padStart(5)}%  ${r.before.fringe.toFixed(1).padStart(13)}  ${r.after.fringe.toFixed(1).padStart(12)}`);
      }
    }
    for (const b of Object.values(browsers)) if (b) await b.close();
    await server.stop();
  });

  for (const browserName of ['chromium', 'firefox']) {
    for (const [name, png] of sources) {
      test(`${browserName}: ${name}`, async (t) => {
        const browser = browsers[browserName];
        if (!browser) return t.skip(`${browserName} is not installed`);
        // A real photo may not be square: make every source square so all three resizes match exactly.
        const square = await sharp(png).resize(1024, 1024, { fit: 'fill' }).png().toBuffer();
        const source = name === 'your image' ? square : png;
        const { context, page } = await openApp(browser, url);
        try {
          const results = await shrinkInPage(page, 'data:image/png;base64,' + source.toString('base64'));
          for (let i = 0; i < SIZES.length; i++) {
            const ref = await reference(source, SIZES[i]);
            const b = compare(decode(results[i].before), ref);
            const a = compare(decode(results[i].after), ref);
            rows.push({ browser: browserName, image: name, size: SIZES[i], before: b, after: a });
            // Never worse than before, and close to the reference.
            assert.ok(a.rmse <= b.rmse * 1.02 + 0.2, `${SIZES[i]} px: ${a.rmse.toFixed(2)} after vs ${b.rmse.toFixed(2)} before`);
            assert.ok(a.fringe < 8, `${SIZES[i]} px: no dark fringe (${a.fringe.toFixed(1)})`);
          }
        } finally {
          await context.close();
        }
      });
    }
  }
});
