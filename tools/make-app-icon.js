#!/usr/bin/env node
'use strict';
/*
 * Makes the favicon maker's own icon with the favicon maker: it opens the real page in Playwright's
 * Chromium, builds every file with the page's own output code (Outputs.build), and writes them to
 * assets/app-icon/. It also writes the <head> links between the app-icon markers in index.html.
 * For maintainers only; the files are committed.
 *
 *     node tools/make-app-icon.js        (or: npm run app-icon)
 *
 * Change DESIGN below to change the icon. After running it, run `npm run build-sw` as well, since the
 * icon files are part of what the service worker keeps for offline use.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer } = require('../tests/helpers/server');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = 'assets/app-icon/';

/** The design: a white wand on a near-black rounded square, inverted in dark mode (favicon.svg). */
const DESIGN = {
  mode: 'icon',
  icon: 'wand-sparkles',
  iconStroke: 2.25,
  iconScale: 66,
  fg: '#ffffff',
  bg: '#0a0a0a',
  shape: 'rounded',
  radius: 22,
  dark: true,
  darkFg: '#0a0a0a',
  darkBg: '#f5f5f5',
  appName: 'Favicon Maker',
  basePath: '/' + OUT_DIR
};

const START = '<!-- app-icon: written by tools/make-app-icon.js -->';
const END = '<!-- /app-icon -->';

async function main() {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
    const out = await page.evaluate(async (design) => {
      const s = Design.validate(Object.assign({}, Design.DEFAULTS, design));
      const warnings = Checks.run(s).warnings.map((w) => w.text);
      const ready = await Outputs.prepare(s);
      const files = [];
      for (const file of Outputs.FILES) {
        // The app has its own manifest.webmanifest, so the generated one isn't used.
        if (file.kind === 'manifest' || !Outputs.available(file, ready)) continue;
        const blob = await Outputs.build(file, ready);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        files.push({ name: file.name, base64: btoa(bin) });
      }
      return { files, snippet: Outputs.snippet(ready), warnings };
    }, DESIGN);
    if (out.warnings.length) throw new Error('The design has warnings: ' + out.warnings.join(' '));

    fs.mkdirSync(path.join(ROOT, OUT_DIR), { recursive: true });
    for (const f of out.files) {
      fs.writeFileSync(path.join(ROOT, OUT_DIR, f.name), Buffer.from(f.base64, 'base64'));
      console.log(OUT_DIR + f.name);
    }

    // The page's own <head> links: relative paths (the site lives in a folder on GitHub Pages), and no
    // manifest link here (index.html adds manifest.webmanifest itself, only over http and https).
    const links = out.snippet.split('\n')
      .filter((l) => !/rel="manifest"/.test(l))
      .map((l) => '  ' + l.replace(/(href=")\//, '$1'));
    const htmlPath = path.join(ROOT, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8').replace(/\r\n/g, '\n');
    const a = html.indexOf(START);
    const b = html.indexOf(END);
    if (a < 0 || b < a) throw new Error('index.html has no app-icon markers');
    fs.writeFileSync(htmlPath, html.slice(0, a) + START + '\n' + links.join('\n') + '\n  ' + html.slice(b));
    console.log('index.html: <head> links written');
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
