#!/usr/bin/env node
'use strict';
/*
 * Writes the lists of files the service worker keeps (sw.js), with a hash of each file's contents, and a
 * cache version made from those hashes. Run it after changing any of the app's files:
 *
 *     node tools/build-sw.js        (or: npm run build-sw)
 *
 * tests/unit/sw.test.js fails when the lists in sw.js are out of date, so a change can't be published
 * without a new version (which would leave visitors on old files).
 *
 * Core files are kept when the service worker installs: the page, styles, every script, the font menu's
 * label fonts, and the app's own icons and manifest. Optional files are large and only needed for some
 * designs: each icon font, its glyph outlines, the emoji font and the icon library. They are kept the first
 * time they are used (or all at once with "Make everything available offline"), so the sizes are listed too.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const START = '// <files> written by tools/build-sw.js; do not edit by hand';
const END = '// </files>';
const TEXT = /\.(html|css|js|json|webmanifest|svg|txt)$/;

/** Files under `dir` (relative to root), recursively, as sorted forward-slash paths. */
function walk(root, dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir + '/' + entry.name;
    if (entry.isDirectory()) out.push(...walk(root, rel));
    else out.push(rel);
  }
  return out.sort();
}

/** Core files: kept when the service worker installs. */
function coreFiles(root = ROOT) {
  return [
    'index.html',
    'manifest.webmanifest',
    'css/style.css',
    ...walk(root, 'js').filter((f) => f.endsWith('.js')),
    ...walk(root, 'assets/fonts').filter((f) => /-name\.woff2$/.test(f)),
    ...walk(root, 'assets/app-icon')
  ];
}

/** Optional files: kept the first time they are used. */
function optionalFiles(root = ROOT) {
  return [
    ...walk(root, 'assets/fonts').filter((f) => (/\.woff2$/.test(f) && !/-name\.woff2$/.test(f)) || /\.glyphs\.js$/.test(f)),
    'assets/icons/lucide.js'
  ];
}

/** A file's contents, with \n line endings for text, so a Windows checkout hashes like the server's copy. */
function contents(root, file) {
  const data = fs.readFileSync(path.join(root, file));
  return TEXT.test(file) ? Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : data;
}

function fileHash(root, file) {
  return crypto.createHash('sha256').update(contents(root, file)).digest('hex').slice(0, 16);
}

function filesBlock(root = ROOT) {
  const core = coreFiles(root);
  const optional = optionalFiles(root);
  const coreHashes = core.map((f) => [f, fileHash(root, f)]);
  const optionalInfo = optional.map((f) => [f, fileHash(root, f), contents(root, f).length]);
  const version = crypto.createHash('sha256')
    .update(coreHashes.map(([f, h]) => f + ':' + h).concat(optionalInfo.map(([f, h]) => f + ':' + h)).join('\n'))
    .digest('hex').slice(0, 12);
  const list = (rows, fmt) => rows.map((r, i) => '  ' + fmt(r) + (i < rows.length - 1 ? ',' : '')).join('\n');
  return [
    START,
    `var VERSION = ${JSON.stringify(version)};`,
    'var CORE = {',
    list(coreHashes, ([f, h]) => `${JSON.stringify(f)}: ${JSON.stringify(h)}`),
    '};',
    'var OPTIONAL = {',
    list(optionalInfo, ([f, h, n]) => `${JSON.stringify(f)}: [${JSON.stringify(h)}, ${n}]`),
    '};',
    END
  ].join('\n');
}

/** The block as it is in sw.js now. */
function currentBlock(root = ROOT) {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8').replace(/\r\n/g, '\n');
  const a = sw.indexOf(START);
  const b = sw.indexOf(END);
  if (a < 0 || b < a) throw new Error('sw.js has no <files> block');
  return sw.slice(a, b + END.length);
}

/** Write the block into sw.js. Returns true when it changed. */
function writeBlock(root = ROOT) {
  const file = path.join(root, 'sw.js');
  const sw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const next = sw.replace(currentBlock(root), filesBlock(root));
  fs.writeFileSync(file, next);
  return next !== sw;
}

module.exports = { ROOT, coreFiles, optionalFiles, fileHash, filesBlock, currentBlock, writeBlock };

if (require.main === module) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : ROOT;
  console.log(writeBlock(root) ? 'sw.js: new file lists and version written' : 'sw.js: already up to date');
}
