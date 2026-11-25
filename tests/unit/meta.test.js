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

/* ---------- Sharing and search ---------- */

const meta = (attr, name) => {
  const m = new RegExp(`<meta ${attr}="${name.replace(/[.:]/g, '\\$&')}" content="([^"]*)"`).exec(html);
  return m ? m[1] : null;
};

test('the page is named Favicon Maker, with a description and a canonical address', () => {
  assert.match(html, /<title>Favicon Maker[^<]*<\/title>/);
  assert.match(html, /<h1>Favicon Maker<\/h1>/);
  assert.doesNotMatch(html, /Favicon Generator/);
  assert.ok(meta('name', 'description').length > 80);
  assert.match(html, /<link rel="canonical" href="https:\/\/xitas\.github\.io\/favicon-maker\/">/);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'Favicon Maker');
});

test('a shared link shows a large preview: Open Graph and Twitter card tags', () => {
  const image = 'https://xitas.github.io/favicon-maker/og-image.png';
  assert.equal(meta('property', 'og:type'), 'website');
  assert.equal(meta('property', 'og:url'), 'https://xitas.github.io/favicon-maker/');
  assert.equal(meta('property', 'og:title'), 'Favicon Maker');
  assert.ok(meta('property', 'og:description').length > 40);
  assert.equal(meta('property', 'og:image'), image);
  assert.equal(meta('property', 'og:image:width'), '1200');
  assert.equal(meta('property', 'og:image:height'), '630');
  assert.ok(meta('property', 'og:image:alt').length > 20);
  assert.equal(meta('name', 'twitter:card'), 'summary_large_image');
  assert.equal(meta('name', 'twitter:image'), image);
  // The image itself: a 1200 × 630 PNG at the site root.
  const png = fs.readFileSync(path.join(ROOT, 'og-image.png'));
  assert.equal(png.toString('latin1', 1, 4), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
});

test('structured data describes a WebApplication, and robots.txt and sitemap.xml point to the site', () => {
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'JSON-LD is there');
  const data = JSON.parse(m[1]);
  assert.equal(data['@context'], 'https://schema.org');
  assert.equal(data['@type'], 'WebApplication');
  assert.equal(data.name, 'Favicon Maker');
  assert.equal(data.url, 'https://xitas.github.io/favicon-maker/');
  const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Sitemap: https:\/\/xitas\.github\.io\/favicon-maker\/sitemap\.xml$/m);
  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /<loc>https:\/\/xitas\.github\.io\/favicon-maker\/<\/loc>/);
});
