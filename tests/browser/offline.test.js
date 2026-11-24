'use strict';
/*
 * Offline use over a local server: the service worker keeps the app's files, so after one visit the app
 * works without a connection. Fonts, emoji and icons work offline once used, or after "Make everything
 * available offline". A new version is offered with a Reload button, never loaded by itself.
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { unzipSync } = require('fflate');
const { launch, openApp, settled, download, FILE_URL } = require('../helpers/browser');
const { startServer } = require('../helpers/server');
const { ROOT } = require('../helpers/load');
const build = require('../../tools/build-sw');

// While offline, the browser itself logs each file that can't be fetched; that's expected.
const OFFLINE_FETCH = /Failed to load resource: net::ERR_(INTERNET_DISCONNECTED|FAILED)/;

/** A new context with the app open and its service worker in control, with nothing blocked in between. */
async function openOnline(browser, url) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
  // The files used before the service worker took over are kept too.
  await page.waitForFunction(() => /\d+ KB of|Everything is available/.test(document.getElementById('offlineStatus').textContent) && !/ 1 KB of/.test(document.getElementById('offlineStatus').textContent), null, { timeout: 30000 });
  await settled(page);
  return { context, page, errors };
}

/** Wait until the autosaved design (localStorage) has the font now chosen, so a reload brings it back. */
async function autosaved(page) {
  await page.waitForFunction(() => {
    try {
      const cur = JSON.parse(localStorage.getItem('favicon-maker.current'));
      const font = document.getElementById('font').value;
      const text = document.getElementById('text').value;
      // Nothing saved yet is fine while the form still shows the default design.
      if (!cur) return font === Design.DEFAULTS.font && text === Design.DEFAULTS.text;
      return cur.settings.font === font && cur.settings.text === text;
    } catch (e) {
      return false;
    }
  });
}

async function reloadOffline(context, page) {
  await autosaved(page);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 30000 });
  await settled(page);
}

const cacheNames = (page) => page.evaluate(() => caches.keys());
const optionalKept = (page) => page.evaluate(async () => (await (await caches.open('favicon-maker-optional')).keys()).map((r) => new URL(r.url).pathname.slice(1)));

async function pick(page, selector, value) {
  await page.selectOption(selector, value);
  await settled(page);
  await page.waitForTimeout(300);
  await settled(page);
}

describe('offline use', () => {
  let browser;
  let server;
  before(async () => { browser = await launch('chromium'); server = await startServer(); });
  after(async () => { await browser.close(); await server.close(); });

  test('after one visit, everything works offline: icons, downloads, ZIP, previews, designs and links', async () => {
    const { context, page, errors } = await openOnline(browser, server.url);
    try {
      // The core files are kept at install; the font the page used (Inter bold) is kept as it was used.
      const names = await cacheNames(page);
      assert.ok(names.some((n) => /^favicon-maker-core-\w+$/.test(n)), names.join());
      assert.deepEqual((await optionalKept(page)).sort(), ['assets/fonts/sans/inter-700.glyphs.js', 'assets/fonts/sans/inter-variable.woff2']);
      assert.match(await page.locator('#offlineAll').textContent(), /^Make everything available offline \(\d+\.\d MB\)$/);

      await reloadOffline(context, page);
      assert.equal(await page.evaluate(() => navigator.onLine), false);

      // Make an icon.
      await page.fill('#text', 'Ok');
      await settled(page);
      assert.match(await page.locator('#checks').textContent(), /Looks good at every size/);
      // Every download, and the ZIP.
      const files = await page.evaluate(() => Outputs.FILES.map((f) => f.name));
      for (const name of files) {
        const d = await download(page, `button[aria-label="Download ${name}"]`);
        assert.ok(d.data.length > 50, name);
      }
      const zip = unzipSync(new Uint8Array((await download(page, '#zip')).data));
      assert.deepEqual(Object.keys(zip).sort(), files.slice().sort());
      // Every preview tab.
      for (const tab of ['#ptab-browser', '#ptab-home', '#ptab-zoom', '#ptab-sizes']) {
        await page.click(tab);
        await settled(page);
        assert.equal(await page.getAttribute(tab, 'aria-selected'), 'true');
      }
      // My designs: save, then open it again after an offline reload.
      await page.fill('#designName', 'Offline one');
      await page.click('#saveDesign');
      await page.waitForFunction(() => /Saved “Offline one”/.test(document.getElementById('designsNote').textContent));
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
      await settled(page);
      assert.equal(await page.inputValue('#text'), 'Ok', 'the autosaved design comes back offline');
      assert.ok(await page.locator('#designs').getByText('Offline one').count());
      // A share link opens offline.
      await page.click('#share');
      await page.waitForFunction(() => /#d\d/.test(document.getElementById('shareUrl').value));
      const link = await page.inputValue('#shareUrl');
      const other = await context.newPage();
      await other.goto(server.url + link.slice(link.indexOf('#')));
      await other.waitForFunction(() => document.documentElement.dataset.ready === '1' && document.getElementById('text').value === 'Ok');
      await other.close();

      assert.deepEqual(errors.filter((e) => !OFFLINE_FETCH.test(e)), []);
    } finally {
      await context.close();
    }
  });

  test('offline, a font used before works; an unused font or emoji style says so and keeps the design', async () => {
    const { context, page, errors } = await openOnline(browser, server.url);
    try {
      // Use Source Serif 4 once while online.
      await pick(page, '#font', 'serif');
      for (let i = 0; i < 50 && !(await optionalKept(page)).includes('assets/fonts/serif/sourceserif4-700.glyphs.js'); i++) await page.waitForTimeout(100);
      await pick(page, '#font', 'sans');
      await reloadOffline(context, page);

      await pick(page, '#font', 'serif');
      assert.equal(await page.inputValue('#font'), 'serif', 'a font used before works offline');
      assert.equal(await page.locator('#fontNote').textContent(), '');

      const before = await page.evaluate(() => [document.getElementById('font').value, document.getElementById('emoji').value]);
      await pick(page, '#font', 'slab');
      assert.equal(await page.locator('#fontNote').textContent(), 'This font isn’t available offline yet.');
      assert.equal(await page.inputValue('#font'), 'serif', 'the design stays as it was');
      // The failed change isn't an undo step: one undo goes back to Inter, the font before Serif.
      await page.click('#undo');
      await settled(page);
      assert.equal(await page.inputValue('#font'), 'sans');
      await page.click('#redo');
      await settled(page);
      assert.equal(await page.inputValue('#font'), before[0]);
      assert.equal(await page.locator('#redo').isDisabled(), true, 'nothing to redo past it');

      await page.fill('#text', '😀');
      await settled(page);
      await pick(page, '#emoji', 'bundled');
      assert.equal(await page.locator('#emojiNote').textContent(), 'This font isn’t available offline yet.');
      assert.equal(await page.inputValue('#emoji'), 'system');

      // Icons not used before: the same.
      await page.click('#modeIcon');
      await settled(page);
      await page.waitForTimeout(300);
      await settled(page);
      assert.equal(await page.locator('#iconNote').textContent(), 'The icons aren’t available offline yet.');
      assert.equal(await page.getAttribute('#modeText', 'aria-pressed'), 'true');

      // Templates: those in kept fonts draw and apply; the rest say so. (With letters: emoji need no font.)
      await page.fill('#text', 'Ab');
      await settled(page);
      await page.click('#secTemplates > summary');
      await page.waitForFunction(() => document.querySelector('[data-template="gradient-circle"] canvas[data-drawn]') && document.querySelector('[data-template="slab-stamp"] canvas[data-offline]'));
      assert.equal(await page.locator('#templatesOffline').isVisible(), true);
      await page.getByRole('button', { name: 'Slab stamp' }).click();
      const dialog = page.locator('#dialog[open]');
      if (await dialog.count()) await page.click('#dialogOk');
      await page.waitForFunction(() => document.getElementById('toolbarNote').textContent === 'This font isn’t available offline yet.');
      await settled(page);
      assert.notEqual(await page.inputValue('#font'), 'slab');
      assert.deepEqual(errors.filter((e) => !OFFLINE_FETCH.test(e)), []);
    } finally {
      await context.close();
    }
  });

  test('Make everything available offline: size, progress, cancel, then every font and the emoji offline', async () => {
    // Slow answers, so there is time to cancel.
    const slow = await startServer({ delay: (p) => (/\.(woff2|glyphs\.js)$/.test(p) && !/-name\.woff2$/.test(p) ? 150 : 0) });
    const { context, page, errors } = await openOnline(browser, slow.url);
    try {
      await page.click('#secOffline > summary');
      const label = await page.locator('#offlineAll').textContent();
      const total = /\((\d+\.\d) MB\)/.exec(label)[1];
      await page.click('#offlineAll');
      await page.waitForFunction(() => !document.getElementById('offlineProgress').hidden && document.getElementById('offlineProgress').value > 0, null, { timeout: 30000 });
      assert.match(await page.locator('#offlineNote').textContent(), /^Downloading [\d.]+ (MB|KB) for offline use…$/);
      await page.click('#offlineCancel');
      await page.waitForFunction(() => /Cancelled/.test(document.getElementById('offlineNote').textContent));
      assert.equal(await page.locator('#offlineProgress').isVisible(), false);
      const partial = (await optionalKept(page)).length;
      assert.ok(partial > 2 && partial < 27, `${partial} files kept so far`);
      assert.equal(await page.locator('#offlineAll').isDisabled(), false);

      await page.click('#offlineAll');
      await page.waitForFunction(() => document.getElementById('offlineNote').textContent === 'Everything is available offline.', null, { timeout: 120000 });
      assert.equal(await page.locator('#offlineAll').isDisabled(), true);
      assert.match(await page.locator('#offlineStatus').textContent(), /^Everything is available offline/);
      assert.ok(Number(total) > 4, label);

      await reloadOffline(context, page);
      const keys = await page.evaluate(() => Fonts.keys());
      for (const font of keys) {
        for (const bold of [true, false]) {
          await pick(page, '#font', font);
          if (await page.locator('#bold').isEnabled()) {
            await page.setChecked('#bold', bold);
            await settled(page);
          }
          assert.equal(await page.inputValue('#font'), font, font);
          // (A font with one weight says so when Bold is on; that's not about being offline.)
          assert.doesNotMatch(await page.locator('#fontNote').textContent(), /offline/, `${font} ${bold ? 'bold' : 'regular'} works offline`);
        }
      }
      await page.fill('#text', '😀');
      await pick(page, '#emoji', 'bundled');
      assert.equal(await page.inputValue('#emoji'), 'bundled');
      assert.equal(await page.locator('#emojiNote').textContent(), '');
      await page.click('#modeIcon');
      await page.waitForFunction(() => document.querySelectorAll('#iconGrid button, .icon-grid button').length > 10, null, { timeout: 10000 }).catch(() => {});
      await settled(page);
      assert.equal(await page.locator('#iconNote').textContent(), '');
      await page.click('#secTemplates > summary');
      await page.waitForFunction(() => document.querySelectorAll('#templates canvas[data-drawn]').length === document.querySelectorAll('#templates canvas').length);
      assert.deepEqual(errors.filter((e) => !OFFLINE_FETCH.test(e)), []);
    } finally {
      await context.close();
      await slow.close();
    }
  });

  test('a new version is offered, never loaded by itself; Reload keeps the design and removes old caches', async () => {
    // A copy of the site that the test can change, like publishing a new version.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'favicon-maker-update-'));
    for (const f of build.coreFiles(ROOT).concat(build.optionalFiles(ROOT), ['sw.js'])) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
    }
    const site = await startServer({ root: dir });
    const { context, page, errors } = await openOnline(browser, site.url);
    try {
      const oldCaches = await cacheNames(page);
      await page.fill('#text', 'Up');
      await page.selectOption('#font', 'mono');
      await settled(page);

      // Publish a change.
      fs.appendFileSync(path.join(dir, 'js', 'checks.js'), '\n// a new version\n');
      assert.equal(build.writeBlock(dir), true);
      await page.evaluate(() => { window.__samePage = true; });
      await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
      await page.waitForFunction(() => !document.getElementById('updateBar').hidden, null, { timeout: 30000 });
      assert.equal(await page.locator('#updateText').textContent(), 'A new version is available.');
      await page.waitForTimeout(1500);
      assert.equal(await page.evaluate(() => window.__samePage), true, 'nothing reloads by itself');

      // Not now hides it; it's offered again next time.
      await page.click('#updateLater');
      assert.equal(await page.locator('#updateBar').isVisible(), false);
      await page.evaluate(() => { document.getElementById('updateBar').hidden = false; });

      await Promise.all([page.waitForEvent('load'), page.click('#updateReload')]);
      await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
      await settled(page);
      assert.equal(await page.evaluate(() => window.__samePage), undefined, 'reloaded');
      assert.equal(await page.inputValue('#text'), 'Up', 'the design is kept');
      assert.equal(await page.inputValue('#font'), 'mono');
      assert.equal(await page.locator('#updateBar').isVisible(), false);
      const newCaches = await cacheNames(page);
      const core = newCaches.filter((n) => /core/.test(n));
      assert.equal(core.length, 1, newCaches.join());
      assert.ok(!oldCaches.includes(core[0]), 'the new version’s cache');
      assert.ok(newCaches.includes('favicon-maker-optional'), 'fonts used before stay kept');
      assert.ok((await optionalKept(page)).includes('assets/fonts/mono/jetbrainsmono-700.glyphs.js'));
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
      await site.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('saving a design asks the browser to keep the app’s storage, and says what it answered', async () => {
    const { context, page } = await openApp(browser, server.url);
    try {
      assert.equal(await page.locator('#persistNote').textContent(), '');
      await page.fill('#designName', 'Keep me');
      await page.click('#saveDesign');
      await page.waitForFunction(() => document.getElementById('persistNote').textContent !== '');
      assert.match(await page.locator('#persistNote').textContent(), /^(This browser keeps your saved designs, even when space runs low\.|This browser may clear saved designs when space runs low\. Export the ones you want to keep\.)$/);
    } finally {
      await context.close();
    }
  });

  test('from file:// there is no service worker and no offline section, quietly', async () => {
    const { context, page, errors } = await openApp(browser, FILE_URL);
    try {
      assert.equal(await page.locator('#secOffline').isVisible(), false);
      assert.equal(await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)), false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
