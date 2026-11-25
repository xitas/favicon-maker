#!/usr/bin/env node
'use strict';
/*
 * Makes the README's pictures from the real page, in Playwright's Chromium:
 *   docs/screenshot-light.png, docs/screenshot-dark.png   the page in each theme (the README shows the one
 *                                                          matching the reader's GitHub theme)
 *   docs/demo.gif                                          pick a template, change the text, switch the
 *                                                          shape, look at the previews, Download all
 * For maintainers only; the files are committed. They are not part of the app (not kept for offline use).
 *
 *     node tools/make-readme-media.js        (or: npm run readme-media)
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer } = require('../tests/helpers/server');
const { encodeGif } = require('./lib/gif');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const VIEW = { width: 1200, height: 760 };

/** A fresh page in one theme, with the design reset, and nothing from earlier runs. */
async function open(browser, url, theme) {
  const context = await browser.newContext({ viewport: VIEW, colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: true });
  await context.addInitScript((theme) => { try { localStorage.setItem('favicon-maker.theme', theme); } catch (e) { /* none */ } }, theme);
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  return { context, page };
}

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  .then(() => page.waitForTimeout(120));

async function screenshots(browser, url) {
  for (const theme of ['light', 'dark']) {
    const { context, page } = await open(browser, url, theme);
    // An example design: a template, with one letter.
    await page.click('#secTemplates > summary');
    await page.getByRole('button', { name: 'Night glow' }).click();
    await page.fill('#text', 'F');
    await page.click('#secTemplates > summary');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    await settle(page);
    await page.screenshot({ path: path.join(DOCS, `screenshot-${theme}.png`) });
    console.log(`docs/screenshot-${theme}.png`);
    await context.close();
  }
}

async function demo(browser, url) {
  const { context, page } = await open(browser, url, 'light');
  const frames = [];
  /** Keep what's on screen now, shown for `ms` milliseconds. */
  const shot = async (ms) => {
    await settle(page);
    frames.push({ png: await page.screenshot(), delay: ms });
  };

  await shot(1200);
  // Pick a template.
  await page.click('#secTemplates > summary');
  await page.waitForFunction(() => document.querySelectorAll('#templates canvas[data-drawn]').length === document.querySelectorAll('#templates canvas').length);
  await shot(900);
  await page.getByRole('button', { name: 'Gradient circle' }).hover();
  await shot(500);
  await page.getByRole('button', { name: 'Gradient circle' }).click();
  await shot(1300);
  // Change the text, a letter at a time.
  await page.click('#secTemplates > summary');
  await page.fill('#text', '');
  await shot(400);
  for (const ch of 'Hi') {
    await page.type('#text', ch);
    await shot(450);
  }
  await shot(900);
  // Switch the shape.
  for (const shape of ['squircle', 'rounded']) {
    await page.locator('#shape').scrollIntoViewIfNeeded();
    await page.selectOption('#shape', shape);
    await shot(1000);
  }
  // The previews.
  for (const tab of ['browser', 'home', 'zoom', 'sizes']) {
    await page.click('#ptab-' + tab);
    await shot(1400);
  }
  // Download all.
  await page.locator('#zip').scrollIntoViewIfNeeded();
  await shot(700);
  await page.locator('#zip').hover();
  await shot(400);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#zip')]);
  await shot(800);
  console.log('demo: ' + frames.length + ' frames, downloaded ' + dl.suggestedFilename());
  await shot(2200);
  await context.close();

  if (process.env.README_MEDIA_FRAMES) {
    // For checking the demo frame by frame.
    fs.mkdirSync(process.env.README_MEDIA_FRAMES, { recursive: true });
    frames.forEach((f, i) => fs.writeFileSync(path.join(process.env.README_MEDIA_FRAMES, String(i).padStart(2, '0') + '.png'), f.png));
  }
  const gif = encodeGif(VIEW.width, VIEW.height, frames);
  fs.writeFileSync(path.join(DOCS, 'demo.gif'), gif);
  console.log('docs/demo.gif: ' + (gif.length / 1048576).toFixed(2) + ' MB');
}

async function main() {
  fs.mkdirSync(DOCS, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    await screenshots(browser, server.url);
    await demo(browser, server.url);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
