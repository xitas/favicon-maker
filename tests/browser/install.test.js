'use strict';
/* Installing the app: the manifest, Chrome's installability check, the Install app button, and opening
   image and design files with the installed app (file_handlers and launchQueue). */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, openApp, settled, download, targets, FILE_URL } = require('../helpers/browser');
const { makePng } = require('../helpers/formats');
const { loadScripts, ROOT } = require('../helpers/load');

const { Design } = loadScripts();
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
const EVIL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="window.__pwned = 1"><script>window.__pwned = 2</script><rect width="10" height="10" fill="#c00"/></svg>';
const RED = makePng(40, 40, () => [200, 30, 30, 255]);

/** Stand in for the browser's launchQueue: the test hands files to the page's consumer, as a launch would. */
const LAUNCH_QUEUE = () => {
  // Chromium has a real, read-only launchQueue: replace it.
  Object.defineProperty(window, 'launchQueue', { configurable: true, value: { setConsumer(fn) { window.__launchConsumer = fn; } } });
};
const launchWith = (page, name, type, base64) => page.evaluate(([name, type, base64]) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const file = new File([bytes], name, { type });
  window.__launchConsumer({ files: [{ kind: 'file', name, getFile: async () => file }] });
}, [name, type, Buffer.from(base64).toString('base64')]);

describe('install the app', () => {
  let browser;
  let server;
  let url;
  before(async () => { server = targets()[1]; url = await server.start(); browser = await launch('chromium'); });
  after(async () => { await browser.close(); await server.stop(); });

  test('the manifest: names, scope, standalone, light colors, and the app’s own icons', async () => {
    assert.equal(MANIFEST.name, 'Favicon Generator');
    assert.ok(MANIFEST.short_name.length <= 12);
    assert.ok(MANIFEST.description.length > 20);
    assert.equal(MANIFEST.start_url, './');
    assert.equal(MANIFEST.scope, './');
    assert.equal(MANIFEST.display, 'standalone');
    assert.equal(MANIFEST.theme_color, '#ffffff');
    assert.equal(MANIFEST.background_color, '#ffffff');
    const purposes = MANIFEST.icons.map((i) => i.purpose + ' ' + i.sizes);
    assert.deepEqual(purposes, ['any 192x192', 'any 512x512', 'maskable 192x192', 'maskable 512x512']);
    for (const icon of MANIFEST.icons) assert.ok(fs.existsSync(path.join(ROOT, icon.src)), icon.src);
    const accept = MANIFEST.file_handlers[0].accept;
    assert.deepEqual(Object.keys(accept).sort(), ['application/json', 'image/jpeg', 'image/png', 'image/svg+xml', 'image/webp']);
  });

  test('Chrome reports the app as installable, with its manifest read without errors', async () => {
    const { context, page, errors } = await openApp(browser, url);
    try {
      const cdp = await context.newCDPSession(page);
      const manifest = await cdp.send('Page.getAppManifest');
      assert.match(manifest.url, /\/manifest\.webmanifest$/);
      assert.deepEqual(manifest.errors, []);
      // Chrome checks the manifest, the icons and the page; it can take a moment after loading.
      let result;
      for (let i = 0; i < 20; i++) {
        result = await cdp.send('Page.getInstallabilityErrors');
        if (!result.installabilityErrors.length) break;
        await page.waitForTimeout(250);
      }
      assert.deepEqual(result.installabilityErrors, []);
      assert.equal(await page.locator('meta[name="theme-color"]').count(), 2);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('Install app appears when the browser offers it, and goes once used', async () => {
    const { context, page, errors } = await openApp(browser, url);
    try {
      assert.equal(await page.locator('#install').isVisible(), false, 'hidden until the browser offers it');
      await page.evaluate(() => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        e.prompt = () => { window.__prompted = true; };
        e.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(e);
        window.__prevented = e.defaultPrevented;
      });
      assert.equal(await page.evaluate(() => window.__prevented), true, 'our button instead of the banner');
      assert.equal(await page.locator('#install').isVisible(), true);
      await page.locator('#install').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => window.__prompted), true);
      await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
      assert.equal(await page.locator('#install').isVisible(), false);
      assert.equal(await page.locator('#toolbarNote').textContent(), 'Favicon Generator is installed.');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('installed (standalone), there is no Install app', async () => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q));
      window.addEventListener('DOMContentLoaded', () => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        e.prompt = () => {};
        e.userChoice = Promise.resolve({ outcome: 'dismissed' });
        setTimeout(() => window.dispatchEvent(e), 0);
      });
    });
    const page = await context.newPage();
    try {
      await page.goto(url);
      await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#install').isVisible(), false);
    } finally {
      await context.close();
    }
  });

  test('on iPhone and iPad, Install app gives the Add to Home Screen tip', async () => {
    const { context, page } = await openApp(browser, url, {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 }
    });
    try {
      assert.equal(await page.locator('#install').isVisible(), true);
      await page.click('#install');
      assert.equal(await page.locator('#toolbarNote').textContent(), 'To install, tap Share, then Add to Home Screen.');
    } finally {
      await context.close();
    }
  });

  test('opening an image with the installed app loads it like an upload; an SVG is cleaned', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    await context.addInitScript(LAUNCH_QUEUE);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    try {
      await page.goto(url);
      await page.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.__launchConsumer);
      await launchWith(page, 'logo.png', 'image/png', RED);
      await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('40 × 40'));
      assert.equal(await page.getAttribute('#modeImage', 'aria-pressed'), 'true');

      await launchWith(page, 'evil.svg', 'image/svg+xml', EVIL);
      await page.waitForFunction(() => /evil\.svg/.test(document.getElementById('dropText').textContent));
      await settled(page);
      assert.equal(await page.evaluate(() => window.__pwned), undefined, 'nothing in the SVG ran');
      const svg = (await download(page, 'button[aria-label="Download favicon.svg"]')).data.toString('utf8');
      assert.match(svg, /fill="#c00"/, 'the drawing is kept');
      assert.doesNotMatch(svg, /<script|onload|__pwned/i, 'cleaned like an upload');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('opening a design file with the installed app checks it like an import', async () => {
    const context = await browser.newContext();
    await context.addInitScript(LAUNCH_QUEUE);
    const page = await context.newPage();
    try {
      await page.goto(url);
      await page.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.__launchConsumer);
      // A design with one setting out of range: validation corrects it, as for an import.
      const doc = JSON.parse(Design.toExport('Opened', Design.validate({ text: 'Op', radius: 10 }), null, 0));
      doc.settings.radius = 999;
      doc.settings.fg = 'javascript:alert(1)';
      await launchWith(page, 'opened.json', 'application/json', JSON.stringify(doc));
      await page.waitForFunction(() => document.getElementById('text').value === 'Op');
      await settled(page);
      assert.equal(await page.inputValue('#radius'), String(Design.DEFAULTS.radius), 'an impossible value is replaced');
      assert.equal(await page.inputValue('#fg'), Design.DEFAULTS.fg);
      assert.match(await page.locator('#designsNote').textContent(), /Imported “Opened”/);

      // Not a design: explained, nothing changes.
      await launchWith(page, 'other.json', 'application/json', '{"hello": 1}');
      await page.waitForFunction(() => document.getElementById('designsNote').classList.contains('err'));
      assert.equal(await page.inputValue('#text'), 'Op');
    } finally {
      await context.close();
    }
  });

  test('from file:// there is no manifest, no Install app, and no console errors', async () => {
    const { context, page, errors } = await openApp(browser, FILE_URL);
    try {
      assert.equal(await page.locator('link[rel="manifest"]').count(), 0);
      assert.equal(await page.locator('#install').isVisible(), false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
