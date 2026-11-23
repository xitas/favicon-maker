'use strict';
/* Autosave, undo and redo, My designs, export and import, and share links, in the real page. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, openApp, settled, download, targets } = require('../helpers/browser');
const { makePng, readPng } = require('../helpers/formats');
const { loadScripts } = require('../helpers/load');

const { Design } = loadScripts();
const RED = makePng(48, 48, () => [220, 20, 20, 255]);
const EVIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="window.__pwned = 1">
  <script>window.__pwned = 2</script>
  <image href="https://evil.test/track.png" width="1" height="1"/>
  <foreignObject width="5" height="5"><div xmlns="http://www.w3.org/1999/xhtml" onclick="window.__pwned = 3">x</div></foreignObject>
  <rect width="10" height="10" fill="#2050c0"/>
</svg>`;

async function setValue(page, id, value) {
  await page.evaluate(([id, value]) => {
    const el = document.getElementById(id);
    if (el.type === 'checkbox') el.checked = value; else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, value]);
  await settled(page);
}

/** Wait until the autosaved design matches `check(saved)`. */
async function saved(page, check) {
  await page.waitForFunction((check) => {
    try {
      const cur = JSON.parse(localStorage.getItem('favicon-maker.current'));
      return !!cur && new Function('cur', 'return ' + check)(cur);
    } catch (e) {
      return false;
    }
  }, check);
}

async function reload(page) {
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await settled(page);
}

/**
 * Answer the next dialog: wait for it to open, then confirm (typing `text` first for a prompt) or cancel
 * with Esc. Resolves to its title and message.
 */
async function answerDialog(page, accept, text) {
  await page.waitForSelector('#dialog[open]');
  const said = await page.evaluate(() => document.getElementById('dialogTitle').textContent + ' ' + document.getElementById('dialogMessage').textContent);
  if (text !== undefined) await page.fill('#dialogInput', text);
  if (accept) await page.click('#dialogOk'); else await page.keyboard.press('Escape');
  await page.waitForSelector('#dialog:not([open])', { state: 'attached' });
  return said;
}

const values = (page) => page.evaluate(() => ({
  text: document.getElementById('text').value,
  radius: document.getElementById('radius').value,
  bg: document.getElementById('bg').value,
  mode: document.getElementById('modeImage').getAttribute('aria-pressed') === 'true' ? 'image' : 'text'
}));

for (const target of targets()) {
  describe(`saving and sharing designs from ${target.label}`, () => {
    let browser;
    let url;
    before(async () => { url = await target.start(); browser = await launch('chromium'); });
    after(async () => { await browser.close(); await target.stop(); });

    test('a text design survives a reload', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        assert.equal(await page.locator('#appNote').textContent(), '', 'storage works: no note');
        await page.fill('#text', 'Hi');
        await setValue(page, 'bg', '#224466');
        await setValue(page, 'radius', '5');
        await saved(page, "cur.settings.text === 'Hi' && cur.settings.radius === 5");
        await reload(page);
        assert.deepEqual(await values(page), { text: 'Hi', radius: '5', bg: '#224466', mode: 'text' });
        assert.equal(await page.locator('#textCount').textContent(), '2 / 3');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('an image design survives a reload, PNG and SVG', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        await page.click('#modeImage');
        await page.setInputFiles('#file', { name: 'red.png', mimeType: 'image/png', buffer: RED });
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('48 × 48'));
        await saved(page, "cur.settings.mode === 'image' && !!cur.imageId");
        await reload(page);
        assert.equal((await values(page)).mode, 'image');
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('48 × 48'));
        assert.equal(await page.locator('#dropText').textContent(), 'red.png');
        const png = readPng((await download(page, 'button[aria-label="Download favicon-32x32.png"]')).data);
        assert.deepEqual(Array.from(png.data.subarray((16 * 32 + 16) * 4, (16 * 32 + 16) * 4 + 3)), [220, 20, 20]);

        await page.setInputFiles('#file', { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(EVIL_SVG) });
        await page.waitForFunction(() => document.getElementById('dropText').textContent === 'logo.svg');
        await settled(page);
        await page.waitForTimeout(600);
        await reload(page);
        await page.waitForFunction(() => document.getElementById('dropText').textContent === 'logo.svg');
        await settled(page);
        const svg = (await download(page, 'button[aria-label="Download favicon.svg"]')).data.toString('utf8');
        assert.doesNotMatch(svg, /script|onload|evil|foreignObject/i);
        assert.equal(await page.evaluate(() => window.__pwned), undefined);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('without storage the app works in memory and says so once', async () => {
      // Block localStorage and IndexedDB before the page loads, as private windows and some file:// pages do.
      const blocked = await browser.newContext({ acceptDownloads: true });
      await blocked.addInitScript(() => {
        const fail = () => { throw new DOMException('blocked', 'SecurityError'); };
        Object.defineProperty(window, 'localStorage', { get: fail });
        Object.defineProperty(window, 'indexedDB', { get: fail });
      });
      const p = await blocked.newPage();
      const pageErrors = [];
      p.on('pageerror', (e) => pageErrors.push(String(e)));
      try {
        await p.goto(url);
        await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
        await settled(p);
        assert.equal(await p.locator('#appNote').textContent(), "Designs can't be saved in this browser window.");
        await p.fill('#text', 'OK');
        await settled(p);
        await p.click('#saveDesign');
        await p.waitForFunction(() => document.querySelectorAll('#designs li').length === 1);
        assert.equal(await p.locator('#appNote').textContent(), "Designs can't be saved in this browser window.", 'shown once, not repeated');
        const { data } = await download(p, '#zip');
        assert.ok(data.length > 1000, 'downloads still work');
        assert.deepEqual(pageErrors, []);
      } finally {
        await blocked.close();
      }
    });

    test('undo and redo with the keyboard and the buttons', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        assert.equal(await page.locator('#undo').isDisabled(), true);
        await setValue(page, 'radius', '10');
        await setValue(page, 'bg', '#333333');
        await page.locator('h1').click();
        await page.keyboard.press('Control+z');
        await settled(page);
        assert.equal((await values(page)).bg, '#0b7a75');
        await page.keyboard.press('Control+z');
        await settled(page);
        assert.equal((await values(page)).radius, '22');
        assert.equal(await page.locator('#undo').isDisabled(), true);
        await page.keyboard.press('Control+Shift+Z');
        await settled(page);
        assert.equal((await values(page)).radius, '10');
        await page.keyboard.press('Control+y');
        await settled(page);
        assert.equal((await values(page)).bg, '#333333');
        assert.equal(await page.locator('#redo').isDisabled(), true);

        await page.click('#undo');
        await settled(page);
        assert.equal((await values(page)).bg, '#0b7a75');
        await page.click('#redo');
        await settled(page);
        assert.equal((await values(page)).bg, '#333333');
      } finally {
        await context.close();
      }
    });

    test('a slider drag is one undo step', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await page.evaluate(() => {
          const r = document.getElementById('radius');
          for (let v = 23; v <= 40; v++) {
            r.value = String(v);
            r.dispatchEvent(new Event('input', { bubbles: true }));
          }
          r.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await settled(page);
        await page.click('#undo');
        await settled(page);
        assert.equal((await values(page)).radius, '22');
        assert.equal(await page.locator('#undo').isDisabled(), true);
      } finally {
        await context.close();
      }
    });

    test('in a text field, Ctrl+Z is the browser’s own undo', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await setValue(page, 'radius', '7');
        await page.click('#secSite > summary'); // the app name is in a section that starts closed
        await page.locator('#appName').click();
        await page.keyboard.press('End');
        await page.keyboard.type('XY');
        await settled(page);
        assert.equal(await page.inputValue('#appName'), 'My AppXY');
        await page.keyboard.press('Control+z');
        await settled(page);
        assert.notEqual(await page.inputValue('#appName'), 'My AppXY', 'the field undid its own typing');
        assert.equal((await values(page)).radius, '7', 'the design history was not used');
      } finally {
        await context.close();
      }
    });

    test('Reset to default, and undo it', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await page.fill('#text', 'Q');
        await setValue(page, 'bg', '#123123');
        await page.click('#reset');
        await settled(page);
        assert.deepEqual(await values(page), { text: 'F', radius: '22', bg: '#0b7a75', mode: 'text' });
        await page.click('#undo');
        await settled(page);
        assert.equal((await values(page)).bg, '#123123');
        assert.equal((await values(page)).text, 'Q');
      } finally {
        await context.close();
      }
    });

    test('My designs: save, rename, duplicate, delete and undo the delete, open', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        const names = () => page.locator('#designs .name').allTextContents();
        assert.equal(await page.locator('#designsEmpty').isVisible(), true);
        await page.fill('#text', 'A');
        await settled(page);
        await page.fill('#designName', 'First');
        await page.click('#saveDesign');
        await page.waitForFunction(() => document.querySelectorAll('#designs li').length === 1);
        assert.deepEqual(await names(), ['First']);
        assert.match(await page.locator('#designsNote').textContent(), /Saved “First”/);
        assert.match(await page.locator('#designs img').getAttribute('src'), /^data:image\/png;base64,/);
        assert.ok((await page.locator('#designs .date').textContent()).length > 4);

        // A second design.
        await page.fill('#text', 'B');
        await settled(page);
        await page.fill('#designName', 'Second');
        await page.click('#saveDesign');
        await page.waitForFunction(() => document.querySelectorAll('#designs li').length === 2);
        assert.deepEqual(await names(), ['Second', 'First']);

        // Rename.
        const renamed = answerDialog(page, true, 'Renamed <b>one</b>');
        await page.click('button[aria-label="Rename First"]');
        await renamed;
        await page.waitForFunction(() => [...document.querySelectorAll('#designs .name')].some((n) => n.textContent === 'Renamed <b>one</b>'));
        assert.equal(await page.locator('#designs b').count(), 0, 'names are text, never HTML');

        // Duplicate.
        await page.click('button[aria-label="Duplicate Second"]');
        assert.deepEqual(await names(), ['Second copy', 'Second', 'Renamed <b>one</b>']);

        // Delete, then undo.
        await page.click('button[aria-label="Delete Second copy"]');
        assert.deepEqual(await names(), ['Second', 'Renamed <b>one</b>']);
        assert.equal(await page.locator('#designsNote').textContent(), 'Deleted “Second copy”.');
        assert.equal(await page.locator('#undoDelete').isVisible(), true);
        await page.click('#undoDelete');
        assert.deepEqual(await names(), ['Second copy', 'Second', 'Renamed <b>one</b>']);
        assert.equal(await page.locator('#undoDelete').isVisible(), false);

        // Open with unsaved changes: asks first. No keeps everything; yes opens.
        await page.fill('#text', 'Z');
        await settled(page);
        const declined = answerDialog(page, false);
        await page.click('button[aria-label="Open Renamed <b>one</b>"]');
        assert.match(await declined, /unsaved|aren’t saved/);
        assert.equal((await values(page)).text, 'Z');
        const accepted = answerDialog(page, true);
        await page.click('button[aria-label="Open Renamed <b>one</b>"]');
        await accepted;
        await settled(page);
        assert.equal((await values(page)).text, 'A');
        assert.equal(await page.inputValue('#designName'), 'Renamed <b>one</b>');

        // Opening a saved design when nothing changed doesn't ask.
        await page.click('button[aria-label="Open Second"]');
        await settled(page);
        assert.equal(await page.locator('#dialog').getAttribute('open'), null, 'no question asked');
        assert.equal((await values(page)).text, 'B');

        // Saved designs survive a reload.
        await reload(page);
        assert.deepEqual(await names(), ['Second copy', 'Second', 'Renamed <b>one</b>']);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('export, then import in a fresh browser, with the image', async () => {
      const first = await openApp(browser, url);
      let exported;
      try {
        await first.page.click('#modeImage');
        await first.page.setInputFiles('#file', { name: 'red.png', mimeType: 'image/png', buffer: RED });
        await first.page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('48 × 48'));
        await setValue(first.page, 'radius', '3');
        await first.page.fill('#designName', 'Red square');
        exported = await download(first.page, '#exportDesign');
        assert.equal(exported.name, 'red-square.json');
        const doc = JSON.parse(exported.data.toString('utf8'));
        assert.equal(doc.app, 'favicon-maker');
        assert.equal(doc.format, Design.FORMAT);
        assert.equal(doc.image.type, 'image/png');
        assert.deepEqual(Buffer.from(doc.image.data, 'base64'), RED);
      } finally {
        await first.context.close();
      }

      const { context, page, errors } = await openApp(browser, url);
      try {
        await page.setInputFiles('#importFile', { name: 'red-square.json', mimeType: 'application/json', buffer: exported.data });
        await page.waitForFunction(() => document.querySelectorAll('#designs li').length === 1);
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('48 × 48'));
        assert.deepEqual(await page.locator('#designs .name').allTextContents(), ['Red square']);
        assert.equal((await values(page)).radius, '3');
        assert.equal((await values(page)).mode, 'image');
        assert.match(await page.locator('#designsNote').textContent(), /Imported “Red square”/);

        // A file that isn't a design changes nothing.
        await page.setInputFiles('#importFile', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') });
        await page.waitForFunction(() => document.getElementById('designsNote').classList.contains('err'));
        assert.match(await page.locator('#designsNote').textContent(), /isn't a favicon design/);
        assert.equal((await values(page)).radius, '3');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('an imported file with a hostile SVG is cleaned', async () => {
      const file = Design.toExport('Evil', Design.validate({ mode: 'image' }), { type: 'image/svg+xml', bytes: new TextEncoder().encode(EVIL_SVG), name: 'evil.svg' });
      const { context, page, errors, externalRequests } = await openApp(browser, url);
      try {
        await page.setInputFiles('#importFile', { name: 'evil.json', mimeType: 'application/json', buffer: Buffer.from(file) });
        await page.waitForFunction(() => document.querySelectorAll('#designs li').length === 1);
        await settled(page);
        const svg = (await download(page, 'button[aria-label="Download favicon.svg"]')).data.toString('utf8');
        assert.doesNotMatch(svg, /script|onload|onclick|evil\.test|foreignObject/i);
        assert.match(svg, /#2050c0/, 'the drawing is kept');
        assert.equal(await page.evaluate(() => window.__pwned), undefined);
        assert.deepEqual(externalRequests, []);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('Forget all saved data', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await page.fill('#text', 'K');
        await settled(page);
        await page.click('#modeImage');
        await page.setInputFiles('#file', { name: 'red.png', mimeType: 'image/png', buffer: RED });
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('48 × 48'));
        await page.click('#saveDesign');
        await page.waitForFunction(() => document.querySelectorAll('#designs li').length === 1);
        const declined = answerDialog(page, false);
        await page.click('#forgetAll');
        await declined;
        assert.equal(await page.locator('#designs li').count(), 1, 'No keeps everything');

        const accepted = answerDialog(page, true);
        await page.click('#forgetAll');
        assert.match(await accepted, /can’t be undone/);
        await page.waitForFunction(() => document.querySelectorAll('#designs li').length === 0);
        const left = await page.evaluate(async () => {
          const keys = Object.keys(localStorage).filter((k) => k.startsWith('favicon-maker.'));
          const images = await new Promise((resolve) => {
            const req = indexedDB.open('favicon-maker');
            req.onsuccess = () => {
              const tx = req.result.transaction('images', 'readonly');
              const all = tx.objectStore('images').getAllKeys();
              all.onsuccess = () => resolve(all.result.length);
            };
            req.onerror = () => resolve(-1);
          });
          return { keys, images };
        });
        assert.deepEqual(left, { keys: [], images: 0 });
        await reload(page);
        assert.deepEqual(await values(page), { text: 'F', radius: '22', bg: '#0b7a75', mode: 'text' });
        assert.equal(await page.locator('#designs li').count(), 0);
      } finally {
        await context.close();
      }
    });

    test('a share link opens in a fresh browser, and leaves the address bar after a change', async () => {
      const first = await openApp(browser, url);
      let link;
      try {
        await first.page.evaluate(() => {
          window.__copied = null;
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } } });
        });
        await first.page.fill('#text', '✨Ü');
        await setValue(first.page, 'font', 'serif');
        await setValue(first.page, 'radius', '40');
        await first.page.click('#share');
        await first.page.waitForFunction(() => document.getElementById('shareNote').textContent !== '');
        link = await first.page.inputValue('#shareUrl');
        assert.equal(await first.page.evaluate(() => window.__copied), link);
        assert.equal(await first.page.locator('#shareNote').textContent(), 'Link copied.');
        if (target.label === 'file://') assert.ok(link.startsWith('https://xitas.github.io/favicon-maker/#d' + Design.FORMAT + '='), link);
        else assert.ok(link.startsWith(url + '#d' + Design.FORMAT + '='), link);
      } finally {
        await first.context.close();
      }

      const hash = link.slice(link.indexOf('#'));
      const { context, page, errors } = await openApp(browser, url + hash);
      try {
        assert.deepEqual(await values(page), { text: '✨Ü', radius: '40', bg: '#0b7a75', mode: 'text' });
        assert.equal(await page.inputValue('#font'), 'serif');
        assert.equal(await page.locator('#appNote').textContent(), 'Opened a shared design.');
        assert.equal(await page.evaluate(() => location.hash), hash, 'the link stays until something changes');
        await setValue(page, 'radius', '41');
        await page.waitForFunction(() => location.hash === '');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('a share link with a small image includes it; a big one says so', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await page.click('#modeImage');
        await page.setInputFiles('#file', { name: 'red.png', mimeType: 'image/png', buffer: RED });
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('48 × 48'));
        await page.click('#share');
        await page.waitForFunction(() => document.getElementById('shareNote').textContent !== '');
        assert.doesNotMatch(await page.locator('#shareNote').textContent(), /too big/);
        const small = await page.inputValue('#shareUrl');
        const d = await Design.decodeHash(small.slice(small.indexOf('#')));
        assert.equal(d.image.type, 'image/png');

        let seed = 7;
        const noisy = makePng(128, 128, () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return [seed & 255, (seed >> 8) & 255, (seed >> 16) & 255, 255]; });
        await page.setInputFiles('#file', { name: 'photo.png', mimeType: 'image/png', buffer: noisy });
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('128 × 128'));
        await page.click('#share');
        await page.waitForFunction(() => /too big/.test(document.getElementById('shareNote').textContent));
        assert.match(await page.locator('#shareNote').textContent(), /The image is too big for a link\. Export the design to share it with the image\./);
        const big = await page.inputValue('#shareUrl');
        assert.ok(big.length <= Design.LINK_LIMIT);
        assert.equal((await Design.decodeHash(big.slice(big.indexOf('#')))).image, null);
      } finally {
        await context.close();
      }
    });

    test('a share link asks before replacing unsaved changes', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await page.fill('#text', 'Mine');
        await settled(page);
        await saved(page, "cur.settings.text === 'Min'");
        const hash = await Design.encodeHash(Design.validate({ text: 'S', radius: 1 }), null);

        const declined = answerDialog(page, false);
        await page.goto(url + hash);
        assert.match(await declined, /Open the shared design\?/);
        await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
        await settled(page);
        assert.equal((await values(page)).text, 'Min', 'kept');

        // The same link again, in the same page: the hash changes, and this time the answer is yes.
        const accepted = answerDialog(page, true);
        await page.evaluate((h) => { location.hash = h; }, hash);
        await accepted;
        await page.waitForFunction(() => document.getElementById('text').value === 'S');
        await settled(page);
        assert.equal((await values(page)).text, 'S');
        assert.equal((await values(page)).radius, '1');
        // Undo brings the previous design back.
        await page.click('#undo');
        await settled(page);
        assert.equal((await values(page)).text, 'Min');
      } finally {
        await context.close();
      }
    });

    test('a share link with a hostile SVG is cleaned', async () => {
      const hash = await Design.encodeHash(Design.validate({ mode: 'image', pad: 5 }), { type: 'image/svg+xml', bytes: new TextEncoder().encode(EVIL_SVG) });
      const { context, page, errors, externalRequests } = await openApp(browser, url + hash);
      try {
        await page.waitForFunction(() => document.getElementById('modeImage').getAttribute('aria-pressed') === 'true');
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('10 × 10'));
        await settled(page);
        const svg = (await download(page, 'button[aria-label="Download favicon.svg"]')).data.toString('utf8');
        assert.doesNotMatch(svg, /script|onload|onclick|evil\.test|foreignObject/i);
        assert.equal(await page.evaluate(() => window.__pwned), undefined);
        assert.deepEqual(externalRequests, []);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('a damaged or cut-off link changes nothing', async (t) => {
      const good = await Design.encodeHash(Design.validate({ text: 'L', radius: 2 }), null);
      for (const [label, hash] of [['cut off', good.slice(0, -6)], ['changed', good.replace(/\.(.)/, (m, c) => '.' + (c === 'A' ? 'B' : 'A'))], ['nonsense', '#d1=<img src=x onerror=alert(1)>']]) {
        await t.test(label, async () => {
          const { context, page, errors } = await openApp(browser, url + hash);
          try {
            assert.equal(await page.locator('#appNote').textContent(), 'This link seems to be incomplete.');
            assert.match(await page.locator('#appNote').getAttribute('class'), /\berr\b/);
            assert.deepEqual(await values(page), { text: 'F', radius: '22', bg: '#0b7a75', mode: 'text' });
            assert.equal(await page.locator('#appNote img').count(), 0);
            assert.deepEqual(errors, []);
          } finally {
            await context.close();
          }
        });
      }
    });
  });
}


/* ---------- Collapsible sections ---------- */

describe('collapsible sections in the controls panel', () => {
  let browser;
  let url;
  const target = targets()[0];
  before(async () => { url = await target.start(); browser = await launch('chromium'); });
  after(async () => { await browser.close(); await target.stop(); });

  const openState = (page) => page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('.controls details.section')].map((d) => [d.id, d.open])
  ));

  test('the most used sections start open, the rest closed, and toggles are remembered', async () => {
    const { context, page } = await openApp(browser, url);
    try {
      assert.deepEqual(await openState(page), {
        secTemplates: false, secSource: true, textPanel: true, iconPanel: true, imagePanel: true, secShape: true, secBorder: false, secPosition: false, secDark: false, secSite: false
      });
      assert.equal(await page.locator('#imagePanel').isVisible(), false, 'the image section only shows in image mode');
      assert.equal(await page.locator('#dark').isVisible(), false);

      // Keyboard: Tab to a section heading, then Enter or Space toggles it.
      await page.focus('#secDark > summary');
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#dark').isVisible(), true);
      await page.focus('#secShape > summary');
      await page.keyboard.press(' ');
      assert.equal(await page.locator('#bg').isVisible(), false);
      const summary = await page.evaluate(() => {
        const s = document.querySelector('#secDark > summary');
        return { tag: s.tagName, text: s.textContent.trim(), expanded: s.parentElement.open };
      });
      assert.deepEqual(summary, { tag: 'SUMMARY', text: 'Dark mode', expanded: true });

      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
      assert.deepEqual(await openState(page), {
        secTemplates: false, secSource: true, textPanel: true, iconPanel: true, imagePanel: true, secShape: false, secBorder: false, secPosition: false, secDark: true, secSite: false
      });
    } finally {
      await context.close();
    }
  });

  test('on desktop, scrolling the controls keeps the preview in view', async () => {
    const { context, page } = await openApp(browser, url, { viewport: { width: 1280, height: 720 } });
    try {
      await page.evaluate(() => document.querySelectorAll('.controls details.section').forEach((d) => { d.open = true; }));
      const box = await page.locator('.controls').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 200);
      for (let i = 0; i < 15; i++) await page.mouse.wheel(0, 400);
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => ({
        pageScroll: window.scrollY,
        controlsScroll: document.querySelector('.controls').scrollTop,
        previewTop: document.getElementById('previewTitle').getBoundingClientRect().top
      }));
      assert.ok(r.controlsScroll > 100, 'the controls scrolled');
      assert.equal(r.pageScroll, 0, 'the page did not');
      assert.ok(r.previewTop > 0 && r.previewTop < 720, 'the preview is on screen');
    } finally {
      await context.close();
    }
  });
});

/* ---------- Dialogs: keyboard and screen readers ---------- */

describe('custom dialogs', () => {
  let browser;
  let url;
  const target = targets()[1];
  before(async () => { url = await target.start(); browser = await launch('chromium'); });
  after(async () => { await browser.close(); await target.stop(); });

  const focusInfo = (page) => page.evaluate(() => {
    const a = document.activeElement;
    return { id: a.id, label: a.getAttribute('aria-label'), inDialog: !!a.closest('#dialog') };
  });

  test('Forget all: modal, labelled, Cancel focused, Esc cancels and focus goes back', async () => {
    const { context, page } = await openApp(browser, url);
    try {
      await page.focus('#forgetAll');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#dialog[open]');
      const a11y = await page.evaluate(() => {
        const d = document.getElementById('dialog');
        return {
          modal: d.matches(':modal'),
          labelledby: document.getElementById(d.getAttribute('aria-labelledby')).textContent,
          describedby: document.getElementById(d.getAttribute('aria-describedby')).textContent,
          ok: document.getElementById('dialogOk').textContent,
          okDanger: document.getElementById('dialogOk').classList.contains('danger')
        };
      });
      assert.deepEqual(a11y, {
        modal: true,
        labelledby: 'Forget all saved data?',
        describedby: 'This removes every saved design and the autosaved design from this browser. It can’t be undone. Export any design you want to keep first.',
        ok: 'Forget everything',
        okDanger: true
      });
      assert.deepEqual(await focusInfo(page), { id: 'dialogCancel', label: null, inDialog: true }, 'the safe button has focus');
      // Tab stays inside the dialog.
      await page.keyboard.press('Tab');
      assert.equal((await focusInfo(page)).inDialog, true);
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#dialog:not([open])', { state: 'attached' });
      assert.equal((await focusInfo(page)).id, 'forgetAll', 'focus is back on the button that opened it');
      // Enter on the focused Cancel button cancels too.
      await page.keyboard.press('Enter');
      await page.waitForSelector('#dialog[open]');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#dialog:not([open])', { state: 'attached' });
      assert.equal((await focusInfo(page)).id, 'forgetAll');
    } finally {
      await context.close();
    }
  });

  test('rename: the field has focus, Enter confirms, an empty name is refused', async () => {
    const { context, page } = await openApp(browser, url);
    try {
      await page.fill('#designName', 'Alpha');
      await page.click('#saveDesign');
      await page.waitForFunction(() => document.querySelectorAll('#designs li').length === 1);
      await page.focus('button[aria-label="Rename Alpha"]');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#dialog[open]');
      assert.deepEqual(await focusInfo(page), { id: 'dialogInput', label: null, inDialog: true });
      assert.equal(await page.locator('#dialogTitle').textContent(), 'Rename “Alpha”');
      assert.equal(await page.evaluate(() => document.getElementById('dialogInput').labels[0].textContent.trim()), 'New name');
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#dialogError').textContent(), 'Enter a name.');
      assert.equal(await page.locator('#dialogError').getAttribute('role'), 'alert');
      assert.equal(await page.locator('#dialog').getAttribute('open'), '', 'still open');
      await page.keyboard.type('Beta');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#dialog:not([open])', { state: 'attached' });
      assert.deepEqual(await page.locator('#designs .name').allTextContents(), ['Beta']);
    } finally {
      await context.close();
    }
  });

  test('unsaved changes: the main button is focused, and Esc keeps the current design', async () => {
    const { context, page } = await openApp(browser, url);
    try {
      await page.click('#saveDesign');
      await page.waitForFunction(() => document.querySelectorAll('#designs li').length === 1);
      await page.fill('#text', 'X');
      await settled(page);
      await page.click('#designs button:has-text("Open")');
      await page.waitForSelector('#dialog[open]');
      assert.match(await page.locator('#dialogTitle').textContent(), /^Open “Design 1”\?$/);
      assert.equal((await focusInfo(page)).id, 'dialogOk');
      assert.equal(await page.locator('#dialogCancel').textContent(), 'Keep current design');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#dialog:not([open])', { state: 'attached' });
      assert.equal(await page.inputValue('#text'), 'X');
      assert.match((await focusInfo(page)).label || '', /^Open Design 1$/, 'focus is back on the Open button');
    } finally {
      await context.close();
    }
  });
});
