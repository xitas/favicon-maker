'use strict';
/* index.html's own files: the app icon, styles and scripts, with relative, case-correct paths. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('../helpers/load');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);

/** True when the path exists with exactly this upper and lower case (GitHub Pages is case-sensitive). */
function existsExactly(rel) {
  let dir = ROOT;
  for (const part of rel.split('/')) {
    if (!fs.readdirSync(dir).includes(part)) return false;
    dir = path.join(dir, part);
  }
  return true;
}

test('every file index.html loads is relative and exists, with the right case', () => {
  assert.ok(refs.length >= 15, refs.join());
  for (const ref of refs) {
    assert.ok(!ref.startsWith('/'), `${ref} should be relative (the site lives in a folder)`);
    assert.ok(existsExactly(ref), `${ref} does not exist (check upper and lower case)`);
  }
});

test('the app has its own icon, made by tools/make-app-icon.js', () => {
  for (const rel of ['assets/app-icon/favicon.ico', 'assets/app-icon/favicon.svg', 'assets/app-icon/favicon-32x32.png', 'assets/app-icon/favicon-16x16.png', 'assets/app-icon/apple-touch-icon.png']) {
    assert.ok(refs.includes(rel), `${rel} is linked`);
  }
  for (const name of ['android-chrome-192x192.png', 'android-chrome-512x512.png', 'maskable-icon-192x192.png', 'maskable-icon-512x512.png']) {
    assert.ok(existsExactly('assets/app-icon/' + name), name);
  }
  // The SVG is a real favicon.svg from the app: it switches colors in dark mode.
  const svg = fs.readFileSync(path.join(ROOT, 'assets/app-icon/favicon.svg'), 'utf8');
  assert.match(svg, /prefers-color-scheme: ?dark/);
});
