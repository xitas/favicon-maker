'use strict';
/* Opens the app in headless Chromium, from file:// or the local server, and collects downloads and errors. */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require('playwright');
const { ROOT } = require('./load');
const { startServer } = require('./server');

const FILE_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;

/**
 * Launch a browser: 'chromium' (Playwright's build), 'firefox', or an installed 'chrome' or 'msedge'.
 * Resolves to null when that browser isn't installed, so tests can skip it.
 */
async function launch(name = 'chromium') {
  try {
    if (name === 'chrome' || name === 'msedge') return await playwright.chromium.launch({ channel: name });
    return await playwright[name].launch();
  } catch (e) {
    if (name === 'chromium') throw e;
    return null;
  }
}

/**
 * Open the app in a new browser context.
 * @param {import('playwright').Browser} browser
 * @param {string} url
 */
async function openApp(browser, url, options = {}) {
  // No service worker: requests it answers would get past the routing below (and the tests that change or
  // fail requests). tests/browser/offline.test.js opens its own pages with the service worker.
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block', ...options });
  const page = await context.newPage();
  const errors = [];
  const externalRequests = [];

  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  // The page may only load its own files. Anything else is recorded and blocked.
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === 'file:' || u.protocol === 'data:' || u.protocol === 'blob:' || u.hostname === '127.0.0.1') {
      return route.continue();
    }
    externalRequests.push(u.href);
    return route.abort();
  });

  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await settled(page);
  return { context, page, errors, externalRequests };
}

/** Wait until the previews are drawn: the next frames, then any font loading. */
async function settled(page) {
  await nextFrames(page);
  // The page's own redraw: it waits for fonts (and tries again if one fails), so it can take more than a
  // few frames on a busy machine. <html data-drawing> is set until it has drawn (see refresh in app.js).
  await page.waitForFunction(() => !document.documentElement.dataset.drawing, null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    const mode = document.getElementById('modeIcon') && document.getElementById('modeIcon').getAttribute('aria-pressed') === 'true' ? 'icon' : 'text';
    return Outputs.prepare({ mode, text: document.getElementById('text').value, font: document.getElementById('font').value, bold: document.getElementById('bold').checked, emoji: document.getElementById('emoji').value, icon: 'star' }).catch(() => null);
  });
  await nextFrames(page);
}

/** Wait for the app's requestAnimationFrame refresh to run. */
async function nextFrames(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Click something that starts a download and return the downloaded bytes and suggested name. */
async function download(page, selector) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
  const file = await dl.path();
  return { name: dl.suggestedFilename(), data: fs.readFileSync(file) };
}

/** The two ways the page is opened: straight from disk and from a local web server. */
function targets() {
  let server;
  return [
    { label: 'file://', start: async () => FILE_URL, stop: async () => {} },
    {
      label: 'http://',
      start: async () => { server = await startServer(); return server.url; },
      stop: async () => { if (server) await server.close(); }
    }
  ];
}

module.exports = { launch, openApp, nextFrames, settled, download, targets, FILE_URL };
