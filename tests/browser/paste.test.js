'use strict';
/* Pasting and dropping images: files, SVG text, links, and hostile SVG. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, openApp, settled, download, targets } = require('../helpers/browser');
const { makePng } = require('../helpers/formats');

const RED = makePng(40, 20, () => [220, 30, 30, 255]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 10"><rect width="30" height="10" fill="#1e40af"/></svg>';
const EVIL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="window.__pwned = 1">
  <script>window.__pwned = 2</script><image href="https://evil.test/x.png" width="1" height="1"/>
  <rect width="10" height="10" fill="#2050c0"/></svg>`;

/** Fire a paste event at `target` with clipboard data built in the page. */
function paste(page, target, data) {
  return page.evaluate(([target, data]) => {
    const dt = new DataTransfer();
    if (data.png) dt.items.add(new File([Uint8Array.from(data.png)], 'image.png', { type: 'image/png' }));
    if (data.svgFile) dt.items.add(new File([data.svgFile], 'logo.svg', { type: 'image/svg+xml' }));
    for (const [type, value] of Object.entries(data.strings || {})) dt.setData(type, value);
    const el = target ? document.querySelector(target) : document.body;
    if (target) el.focus();
    const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  }, [target, data]);
}

/** Fire a drop at `selector` with the given data. */
function drop(page, selector, data) {
  return page.evaluate(([selector, data]) => {
    const dt = new DataTransfer();
    if (data.png) dt.items.add(new File([Uint8Array.from(data.png)], 'dropped.png', { type: 'image/png' }));
    for (const [type, value] of Object.entries(data.strings || {})) dt.setData(type, value);
    const el = document.querySelector(selector);
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    const e = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  }, [selector, data]);
}

const mode = (page) => page.evaluate(() => ['modeText', 'modeIcon', 'modeImage'].find((id) => document.getElementById(id).getAttribute('aria-pressed') === 'true'));

for (const target of targets()) {
  describe(`pasting and dropping from ${target.label}`, () => {
    let browser;
    let url;
    before(async () => { url = await target.start(); browser = await launch('chromium'); });
    after(async () => { await browser.close(); await target.stop(); });

    test('Ctrl+V with a PNG switches to Image mode and uses it, as one undo step', async () => {
      const { context, page, errors, externalRequests } = await openApp(browser, url);
      try {
        assert.equal(await mode(page), 'modeText');
        assert.equal(await paste(page, null, { png: [...RED] }), true, 'handled');
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('40 × 20'));
        assert.equal(await mode(page), 'modeImage');
        assert.equal(await page.locator('#dropText').textContent(), 'Pasted image.png');
        await settled(page);
        await page.click('#undo');
        await settled(page);
        assert.equal(await mode(page), 'modeText', 'undo goes back to before the paste');
        assert.deepEqual(externalRequests, []);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('an SVG file and SVG code pasted as text', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await paste(page, null, { svgFile: SVG });
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('30 × 10'));
        assert.equal(await page.locator('#dropText').textContent(), 'logo.svg');
        await paste(page, null, { strings: { 'text/plain': SVG.replace('30 10', '20 10').replace('width="30"', 'width="20"') } });
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('20 × 10'));
        assert.equal(await page.locator('#dropText').textContent(), 'Pasted SVG.svg');
        await settled(page);
        const svg = (await download(page, 'button[aria-label="Download favicon.svg"]')).data.toString('utf8');
        assert.match(svg, /#1e40af/);
      } finally {
        await context.close();
      }
    });

    test('a hostile SVG pasted as text is cleaned', async () => {
      const { context, page, errors, externalRequests } = await openApp(browser, url);
      try {
        await paste(page, null, { strings: { 'text/plain': EVIL } });
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('10 × 10'));
        await settled(page);
        const svg = (await download(page, 'button[aria-label="Download favicon.svg"]')).data.toString('utf8');
        assert.doesNotMatch(svg, /script|onload|evil\.test/i);
        assert.equal(await page.evaluate(() => window.__pwned), undefined);
        assert.deepEqual(externalRequests, []);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('a link alone is explained and nothing is fetched, for pastes and drops', async () => {
      const { context, page, externalRequests } = await openApp(browser, url);
      try {
        await paste(page, null, { strings: { 'text/plain': 'https://example.com/logo.png' } });
        assert.equal(await page.locator('#appNote').textContent(), 'Save the image first, then drop or paste it here.');
        assert.equal(await mode(page), 'modeText', 'nothing changed');
        // Dragged from another tab: only an address and some HTML.
        await page.click('#modeImage');
        await drop(page, '#drop', { strings: { 'text/uri-list': 'https://example.com/logo.png', 'text/html': '<img src="https://example.com/logo.png">' } });
        assert.equal(await page.locator('#fileNote').textContent(), 'Save the image first, then drop or paste it here.');
        assert.match(await page.locator('#fileNote').getAttribute('class'), /\berr\b/);
        assert.deepEqual(externalRequests, [], 'no request to the address');
      } finally {
        await context.close();
      }
    });

    test('drops anywhere on the page, and pasting in a text field stays normal', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        assert.equal(await drop(page, '#previewTitle', { png: [...RED] }), true, 'the browser does not open the file');
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('40 × 20'));
        assert.equal(await page.locator('#dropText').textContent(), 'dropped.png');
        await page.click('#modeText');
        const handled = await paste(page, '#appName', { strings: { 'text/plain': 'https://example.com/x.png' } });
        assert.equal(handled, false, 'the text field keeps its own paste');
        assert.equal(await page.locator('#appNote').textContent(), '');
      } finally {
        await context.close();
      }
    });

    test('the Paste image button reads the clipboard where allowed', async (t) => {
      if (target.label !== 'http://') return t.skip('clipboard permission needs an http origin');
      const { context, page } = await openApp(browser, url);
      try {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
        await page.click('#modeImage');
        await page.evaluate(async (png) => {
          const blob = new Blob([Uint8Array.from(png)], { type: 'image/png' });
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        }, [...RED]);
        await page.click('#pasteImage');
        await page.waitForFunction(() => document.getElementById('fileNote').textContent.startsWith('40 × 20'));
        // Only a link on the clipboard.
        await page.evaluate(() => navigator.clipboard.writeText('https://example.com/logo.png'));
        await page.click('#pasteImage');
        await page.waitForFunction(() => /Save the image first/.test(document.getElementById('fileNote').textContent));
      } finally {
        await context.close();
      }
    });
  });
}
