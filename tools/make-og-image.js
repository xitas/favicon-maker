#!/usr/bin/env node
'use strict';
/*
 * Makes og-image.png, the 1200 × 630 picture shown when a link to the app is shared. It opens the real page
 * in Playwright's Chromium and draws everything there with the app's own code: its icon (the design from
 * tools/make-app-icon.js), the name in the bundled Inter font, and a row of example icons from the
 * templates. For maintainers only; the PNG is committed.
 *
 *     node tools/make-og-image.js        (or: npm run og-image)
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer } = require('../tests/helpers/server');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'og-image.png');
const TAGLINE = 'Make every favicon your site needs, from text, an emoji, an icon or your own image.';
const NOTE = 'Runs in your browser. Your images never leave your device.';
const ADDRESS = 'xitas.github.io/favicon-maker';
// The app's own icon: the same design as tools/make-app-icon.js.
const APP_ICON = {
  mode: 'icon', icon: 'wand-sparkles', iconStroke: 2.25, iconScale: 66, fg: '#ffffff', bg: '#0a0a0a',
  shape: 'rounded', radius: 22
};
// Examples, in color: a few of the templates, each with its own sample text or icon.
const EXAMPLES = ['gradient-circle', 'dev-badge', 'pastel-squircle', 'handwritten', 'leaf', 'night-glow', 'sunrise'];

async function main() {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
    const png = await page.evaluate(async ({ appIcon, examples, tagline, note, address }) => {
      const W = 1200;
      const H = 630;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');

      // Monochrome, like the interface: white, with a soft gray glow at the top left.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      const glow = ctx.createRadialGradient(120, -60, 0, 120, -60, 760);
      glow.addColorStop(0, 'rgba(0, 0, 0, 0.06)');
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      // The interface's text, in the bundled Inter (loaded the way the app loads fonts).
      const font = (weight, px) => weight + ' ' + px + 'px "' + Fonts.family('sans') + '", system-ui, sans-serif';
      await Fonts.prepare({ mode: 'text', text: 'Favicon Maker', font: 'sans', bold: true, emoji: 'system' });
      await Fonts.prepare({ mode: 'text', text: 'a', font: 'sans', bold: false, emoji: 'system' });
      await document.fonts.load(font(400, 30), tagline + note + address);

      /** Draw a design at (x, y), `size` pixels, with the app's own drawing code. */
      const icon = async (settings, x, y, size) => {
        const s = await Outputs.prepare(Design.validate(Object.assign({}, Design.DEFAULTS, settings)));
        ctx.drawImage(Draw.render(size, s), x, y, size, size);
      };

      // The app icon and the name.
      await icon(appIcon, 80, 84, 124);
      ctx.fillStyle = '#0a0a0a';
      ctx.textBaseline = 'alphabetic';
      ctx.font = font(700, 84);
      ctx.fillText('Favicon Maker', 236, 176);
      ctx.fillStyle = '#404040';
      ctx.font = font(400, 30);
      // The tagline, wrapped to the width.
      const words = tagline.split(' ');
      const lines = [''];
      for (const w of words) {
        const next = (lines[lines.length - 1] + ' ' + w).trim();
        if (ctx.measureText(next).width > W - 236 - 80) lines.push(w);
        else lines[lines.length - 1] = next;
      }
      lines.forEach((line, i) => ctx.fillText(line, 238, 236 + i * 42));

      // A row of example icons, in color.
      const size = 112;
      const gap = (W - 160 - examples.length * size) / (examples.length - 1);
      for (let i = 0; i < examples.length; i++) {
        await icon(Templates.design(examples[i], null), 80 + i * (size + gap), 368, size);
      }

      // The note and the address.
      ctx.fillStyle = '#525252';
      ctx.font = font(400, 24);
      ctx.fillText(note, 80, 560);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#0a0a0a';
      ctx.font = font(700, 24);
      ctx.fillText(address, W - 80, 560);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { appIcon: APP_ICON, examples: EXAMPLES, tagline: TAGLINE, note: NOTE, address: ADDRESS });
    fs.writeFileSync(OUT, Buffer.from(png, 'base64'));
    console.log('og-image.png: ' + fs.statSync(OUT).size + ' bytes');
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
