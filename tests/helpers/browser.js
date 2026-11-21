'use strict';
/* Opens the app in headless Chromium, from file:// or the local server, and collects downloads and errors. */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { ROOT } = require('./load');
const { startServer } = require('./server');

const FILE_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;

/** Hosts the page is allowed to contact. Google Fonts is answered locally with an empty stylesheet so tests run offline. */
const STUBBED_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

async function launch() {
  return chromium.launch();
}

/**
 * Open the app in a new browser context.
 * @param {import('playwright').Browser} browser
 * @param {string} url
 */
async function openApp(browser, url) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  const externalRequests = [];

  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === 'file:' || u.protocol === 'data:' || u.protocol === 'blob:' || u.hostname === '127.0.0.1') {
      return route.continue();
    }
    if (STUBBED_HOSTS.has(u.hostname)) {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    externalRequests.push(u.href);
    return route.abort();
  });

  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('#files li').length > 0);
  await nextFrames(page);
  return { context, page, errors, externalRequests };
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

module.exports = { launch, openApp, nextFrames, download, targets, FILE_URL };
