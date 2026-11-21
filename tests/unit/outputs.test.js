'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('../helpers/load');

const { Outputs } = loadScripts();
const { SNIPPET } = Outputs;
// FILES is plain data. Copy it out of the vm realm so deepStrictEqual sees ordinary arrays.
const FILES = structuredClone(Outputs.FILES);
const NAMES = new Set(FILES.map((f) => f.name));
const byName = (name) => FILES.find((f) => f.name === name);

const SETTINGS = {
  mode: 'text', image: null, text: 'F', font: 'sans', bold: true, textScale: 70,
  fg: '#ffffff', bg: '#0b7a75', transparent: false, radius: 22, fit: 'contain', pad: 0, appName: 'My App'
};

async function manifest(overrides = {}) {
  const file = FILES.find((f) => f.kind === 'manifest');
  const blob = await Outputs.build(file, { ...SETTINGS, ...overrides });
  return { blob, text: await blob.text(), json: JSON.parse(await blob.text()) };
}

/** href values in the HTML snippet, keyed by rel. */
function snippetLinks() {
  return SNIPPET.split('\n').map((line) => ({
    rel: /rel="([^"]+)"/.exec(line)[1],
    href: /href="([^"]+)"/.exec(line)[1],
    sizes: (/sizes="([^"]+)"/.exec(line) || [])[1],
    type: (/type="([^"]+)"/.exec(line) || [])[1]
  }));
}

/** Strip a leading slash so both "/a.png" and "a.png" map to a file name. */
const fileOf = (href) => href.replace(/^\//, '');

/* ---------- FILES ---------- */

test('FILES has the 7 expected files with unique names', () => {
  assert.equal(FILES.length, 7);
  assert.equal(NAMES.size, FILES.length, 'names are unique');
  assert.deepEqual([...NAMES].sort(), [
    'android-chrome-192x192.png', 'android-chrome-512x512.png', 'apple-touch-icon.png',
    'favicon-16x16.png', 'favicon-32x32.png', 'favicon.ico', 'site.webmanifest'
  ]);
});

test('each file kind matches its extension', () => {
  for (const f of FILES) {
    const ext = f.name.split('.').pop();
    assert.equal({ png: 'png', ico: 'ico', webmanifest: 'manifest' }[ext], f.kind, f.name);
  }
});

test('PNG sizes match the size in the file name', () => {
  for (const f of FILES.filter((x) => x.kind === 'png')) {
    const m = /(\d+)x(\d+)/.exec(f.name);
    const expected = m ? Number(m[1]) : f.apple ? 180 : null;
    assert.ok(expected, `${f.name} has a known size`);
    if (m) assert.equal(m[1], m[2], `${f.name} is square`);
    assert.equal(f.size, expected, f.name);
    assert.equal(f.dims, `${expected} × ${expected}`, `${f.name} dims label`);
  }
});

test('only the Apple touch icon is drawn as an opaque square', () => {
  assert.deepEqual(FILES.filter((f) => f.apple).map((f) => f.name), ['apple-touch-icon.png']);
});

test('the ICO holds 16, 32 and 48 px', () => {
  const ico = byName('favicon.ico');
  assert.deepEqual([...ico.sizes], [16, 32, 48]);
  assert.equal(ico.dims, ico.sizes.join(', '));
});

test('every file has a note and a dims label', () => {
  for (const f of FILES) {
    assert.ok(f.note && f.note.length > 0, f.name);
    assert.ok(f.dims && f.dims.length > 0, f.name);
  }
});

/* ---------- HTML snippet ---------- */

test('the HTML snippet only refers to files in FILES', () => {
  for (const link of snippetLinks()) assert.ok(NAMES.has(fileOf(link.href)), link.href);
});

test('the HTML snippet links every file except the Android icons', () => {
  const linked = new Set(snippetLinks().map((l) => fileOf(l.href)));
  const expected = FILES.filter((f) => !f.name.startsWith('android-chrome')).map((f) => f.name);
  assert.deepEqual([...linked].sort(), expected.sort());
});

test('the HTML snippet sizes match the files', () => {
  for (const link of snippetLinks()) {
    const f = byName(fileOf(link.href));
    if (f.kind === 'png' && link.sizes) assert.equal(link.sizes, `${f.size}x${f.size}`, link.href);
    if (f.kind === 'png' && link.type) assert.equal(link.type, 'image/png', link.href);
    if (f.kind === 'ico') assert.ok(f.sizes.map((z) => `${z}x${z}`).includes(link.sizes), link.href);
  }
});

test('the HTML snippet uses relative paths', { todo: 'paths start with "/", which breaks sites in a subfolder such as GitHub Pages' }, () => {
  for (const link of snippetLinks()) assert.ok(!link.href.startsWith('/'), link.href);
});

/* ---------- Manifest ---------- */

test('the manifest is valid JSON with the right content type', async () => {
  const { blob, text } = await manifest();
  assert.equal(blob.type, 'application/manifest+json');
  assert.doesNotThrow(() => JSON.parse(text));
  assert.ok(text.endsWith('\n'));
});

test('the manifest name, display and colors come from the settings', async () => {
  const { json } = await manifest({ appName: 'Favicon Test', bg: '#123456' });
  assert.equal(json.name, 'Favicon Test');
  assert.equal(json.short_name, 'Favicon Test');
  assert.equal(json.display, 'standalone');
  assert.equal(json.theme_color, '#123456');
  assert.equal(json.background_color, '#123456');
});

test('the manifest uses white when the background is transparent', async () => {
  const { json } = await manifest({ bg: '#123456', transparent: true });
  assert.equal(json.theme_color, '#ffffff');
  assert.equal(json.background_color, '#ffffff');
});

test('the manifest short_name is at most 12 characters', async () => {
  const { json } = await manifest({ appName: 'A very long application name' });
  assert.equal(json.short_name, 'A very long ');
  assert.ok(json.short_name.length <= 12);
});

test('the manifest only refers to files in FILES, with matching sizes', async () => {
  const { json } = await manifest();
  assert.ok(json.icons.length >= 2);
  for (const icon of json.icons) {
    const f = byName(fileOf(icon.src));
    assert.ok(f, `${icon.src} is in FILES`);
    assert.equal(icon.sizes, `${f.size}x${f.size}`, icon.src);
    assert.equal(icon.type, 'image/png', icon.src);
  }
  assert.deepEqual(json.icons.map((i) => i.sizes).sort(), ['192x192', '512x512']);
});

test('the manifest uses relative icon paths', { todo: 'icon src paths start with "/", which breaks sites in a subfolder such as GitHub Pages' }, async () => {
  const { json } = await manifest();
  for (const icon of json.icons) assert.ok(!icon.src.startsWith('/'), icon.src);
});

test('the manifest has a maskable icon', { todo: 'no icon has purpose "maskable", so Android crops the regular icon' }, async () => {
  const { json } = await manifest();
  assert.ok(json.icons.some((i) => (i.purpose || '').split(/\s+/).includes('maskable')));
});

test('the manifest short_name never splits an emoji', { todo: 'short_name uses slice(0, 12), which can cut a character in half' }, async (t) => {
  const cases = {
    'emoji across the cut (surrogate pair)': 'Hello World😀',
    'emoji with skin tone across the cut': 'Hello Worl👍🏽',
    'flag across the cut': 'Hello Worl🇵🇰',
    'family emoji across the cut': 'Hello Wo👨‍👩‍👧'
  };
  for (const [label, appName] of Object.entries(cases)) {
    await t.test(label, async () => {
      const { json } = await manifest({ appName });
      assert.ok(json.short_name.isWellFormed(), 'no lone surrogate');
      const whole = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(appName)].map((s) => s.segment);
      const kept = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(json.short_name)].map((s) => s.segment);
      assert.deepEqual(kept, whole.slice(0, kept.length), 'only whole characters are kept');
    });
  }
});
