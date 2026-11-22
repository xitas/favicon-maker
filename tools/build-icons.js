#!/usr/bin/env node
'use strict';
/*
 * Builds the bundled icon set in assets/icons/ from Lucide (https://lucide.dev, ISC license).
 * For maintainers only: the page never runs this, and nothing here is needed to use or test the app.
 *
 *     node tools/build-icons.js
 *
 * It downloads lucide-static's icon shapes, search tags and license, turns each icon's shapes (paths,
 * circles, rects, lines...) into one SVG path, and writes assets/icons/lucide.js. That file calls
 * Icons.addSet() and is loaded with a <script> tag only when the Icon source is chosen, so it works
 * offline and from file://. Each icon is stroked, never filled, as Lucide draws them.
 */
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const VERSION = '1.77.0';
const BASE = `https://cdn.jsdelivr.net/npm/lucide-static@${VERSION}/`;
const OUT = path.join(__dirname, '..', 'assets', 'icons');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`${url}: HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

/** A number with at most 3 decimals, as short as possible. */
const n = (v) => String(Math.round(Number(v) * 1000) / 1000);

/** One shape element as SVG path data. */
function nodeToPath(tag, a) {
  switch (tag) {
    case 'path':
      return a.d;
    case 'circle': {
      const r = Number(a.r);
      return `M${n(a.cx - r)} ${n(a.cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0`;
    }
    case 'ellipse': {
      const rx = Number(a.rx);
      const ry = Number(a.ry);
      return `M${n(a.cx - rx)} ${n(a.cy)}a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0`;
    }
    case 'rect': {
      const x = Number(a.x || 0);
      const y = Number(a.y || 0);
      const w = Number(a.width);
      const h = Number(a.height);
      let rx = a.rx !== undefined ? Number(a.rx) : a.ry !== undefined ? Number(a.ry) : 0;
      let ry = a.ry !== undefined ? Number(a.ry) : rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (!rx || !ry) return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
      const arc = (dx, dy) => `a${n(rx)} ${n(ry)} 0 0 1 ${n(dx)} ${n(dy)}`;
      return `M${n(x + rx)} ${n(y)}h${n(w - 2 * rx)}${arc(rx, ry)}v${n(h - 2 * ry)}${arc(-rx, ry)}h${n(-(w - 2 * rx))}${arc(-rx, -ry)}v${n(-(h - 2 * ry))}${arc(rx, -ry)}Z`;
    }
    case 'line':
      return `M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}`;
    case 'polyline':
    case 'polygon': {
      const pts = String(a.points).trim().split(/[\s,]+/).map(Number);
      let d = `M${n(pts[0])} ${n(pts[1])}`;
      for (let i = 2; i < pts.length; i += 2) d += `L${n(pts[i])} ${n(pts[i + 1])}`;
      return tag === 'polygon' ? d + 'Z' : d;
    }
    default:
      throw new Error('Unknown shape: ' + tag);
  }
}

async function main() {
  console.log(`Lucide ${VERSION}`);
  const [nodesText, tagsText, license] = await Promise.all([get(BASE + 'icon-nodes.json'), get(BASE + 'tags.json'), get(BASE + 'LICENSE')]);
  const nodes = JSON.parse(nodesText);
  const tags = JSON.parse(tagsText);
  const icons = {};
  for (const name of Object.keys(nodes).sort()) {
    const d = nodes[name].map(([tag, attrs]) => nodeToPath(tag, attrs)).join('');
    // Tags as one string of words, without repeats and without the words already in the name.
    const nameWords = new Set(name.split('-'));
    const words = [...new Set((tags[name] || []).join(' ').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !nameWords.has(w)))];
    icons[name] = [words.join(' '), d];
  }
  fs.mkdirSync(OUT, { recursive: true });
  const body = `/* Lucide icons ${VERSION} (https://lucide.dev), ISC license: see LICENSE in this folder. Made by tools/build-icons.js. */\n` +
    `Icons.addSet(${JSON.stringify({ version: VERSION, icons })});\n`;
  fs.writeFileSync(path.join(OUT, 'lucide.js'), body);
  fs.writeFileSync(path.join(OUT, 'LICENSE'), license);
  console.log(`${Object.keys(icons).length} icons, ${(Buffer.byteLength(body) / 1024).toFixed(0)} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
