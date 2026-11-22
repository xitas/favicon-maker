'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('../helpers/load');

const { Outputs } = loadScripts();
// FILES is plain data. Copy it out of the vm realm so deepStrictEqual sees ordinary arrays.
const FILES = structuredClone(Outputs.FILES);
const NAMES = new Set(FILES.map((f) => f.name));
const byName = (name) => FILES.find((f) => f.name === name);

const SETTINGS = {
  mode: 'text', image: null, text: 'F', font: 'sans', bold: true, textScale: 70,
  fg: '#ffffff', bg: '#0b7a75', transparent: false, radius: 22, fit: 'contain', pad: 0, appName: 'My App', basePath: '/'
};

async function manifest(overrides = {}) {
  const file = FILES.find((f) => f.kind === 'manifest');
  const blob = await Outputs.build(file, { ...SETTINGS, ...overrides });
  return { blob, text: await blob.text(), json: JSON.parse(await blob.text()) };
}

/** Attributes of each <link> in the HTML snippet. */
function snippetLinks(overrides = {}) {
  return Outputs.snippet({ ...SETTINGS, ...overrides }).split('\n').map((line) => ({
    rel: /rel="([^"]+)"/.exec(line)[1],
    href: /href="([^"]+)"/.exec(line)[1],
    sizes: (/sizes="([^"]+)"/.exec(line) || [])[1],
    type: (/type="([^"]+)"/.exec(line) || [])[1]
  }));
}

/** The file name at the end of a path. */
const fileOf = (href) => href.split('/').pop();

/* ---------- FILES ---------- */

test('FILES has the expected files with unique names', () => {
  assert.equal(NAMES.size, FILES.length, 'names are unique');
  assert.deepEqual([...NAMES].sort(), [
    'android-chrome-192x192.png', 'android-chrome-512x512.png', 'apple-touch-icon.png',
    'favicon-16x16.png', 'favicon-32x32.png', 'favicon.ico',
    'maskable-icon-192x192.png', 'maskable-icon-512x512.png', 'site.webmanifest'
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
    const expected = m ? Number(m[1]) : f.variant === 'apple' ? 180 : null;
    assert.ok(expected, `${f.name} has a known size`);
    if (m) assert.equal(m[1], m[2], `${f.name} is square`);
    assert.equal(f.size, expected, f.name);
    assert.equal(f.dims, `${expected} × ${expected}`, `${f.name} dims label`);
  }
});

test('the Apple touch icon and maskable icons are drawn as their own variants', () => {
  assert.deepEqual(FILES.filter((f) => f.variant === 'apple').map((f) => f.name), ['apple-touch-icon.png']);
  assert.deepEqual(FILES.filter((f) => f.variant === 'maskable').map((f) => [f.name, f.size]),
    [['maskable-icon-192x192.png', 192], ['maskable-icon-512x512.png', 512]]);
  for (const f of FILES) assert.ok([undefined, 'apple', 'maskable'].includes(f.variant), f.name);
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

/* ---------- Where the files go ---------- */

test('basePath turns any spelling of a folder into one clean form', async (t) => {
  const cases = [
    ['/', '/'],
    ['', '/'],
    ['   ', '/'],
    [undefined, '/'],
    ['//', '/'],
    ['.', '/'],
    ['./', '/'],
    ['favicon-maker', '/favicon-maker/'],
    ['/favicon-maker', '/favicon-maker/'],
    ['favicon-maker/', '/favicon-maker/'],
    ['/favicon-maker/', '/favicon-maker/'],
    ['  /favicon-maker/  ', '/favicon-maker/'],
    ['//favicon-maker//', '/favicon-maker/'],
    ['a//b///c', '/a/b/c/'],
    ['\\assets\\icons\\', '/assets/icons/'],
    ['./static/./icons', '/static/icons/'],
    ['my site', '/my%20site/'],
    ['my%20site', '/my%20site/'],
    ['café', '/caf%C3%A9/'],
    ['a"b<c>', '/a%22b%3Cc%3E/'],
    ['/icons/?v=2#top', '/icons/'],
    ['https://example.com', 'https://example.com/'],
    ['https://example.com/app', 'https://example.com/app/'],
    ['HTTPS://Example.com/app/', 'https://example.com/app/'],
    ['http://localhost:8080//x/', 'http://localhost:8080/x/']
  ];
  for (const [input, expected] of cases) {
    await t.test(JSON.stringify(input), () => assert.equal(Outputs.basePath(input), expected));
  }
});

test('basePath is stable: cleaning a clean path changes nothing', () => {
  for (const input of ['/', '/a/', '/a/b/', '/my%20site/', 'https://example.com/app/']) {
    assert.equal(Outputs.basePath(Outputs.basePath(input)), Outputs.basePath(input));
  }
});

/* ---------- HTML snippet ---------- */

test('the HTML snippet only refers to files in FILES', () => {
  for (const link of snippetLinks()) assert.ok(NAMES.has(fileOf(link.href)), link.href);
});

test('the HTML snippet links every file except the Android icons, which the manifest lists', () => {
  const linked = new Set(snippetLinks().map((l) => fileOf(l.href)));
  const expected = FILES.filter((f) => !/^(android-chrome|maskable-icon)-/.test(f.name)).map((f) => f.name);
  assert.deepEqual([...linked].sort(), expected.sort());
});

test('the HTML snippet sizes match the files', () => {
  for (const link of snippetLinks()) {
    const f = byName(fileOf(link.href));
    if (f.kind === 'png' && link.sizes) assert.equal(link.sizes, `${f.size}x${f.size}`, link.href);
    if (f.kind === 'png' && link.type) assert.equal(link.type, 'image/png', link.href);
  }
});

test('the HTML snippet lists every size inside the ICO', () => {
  const link = snippetLinks().find((l) => fileOf(l.href) === 'favicon.ico');
  assert.equal(link.sizes, byName('favicon.ico').sizes.map((z) => `${z}x${z}`).join(' '));
  assert.equal(link.sizes, '16x16 32x32 48x48');
});

test('the HTML snippet uses the site root by default', () => {
  for (const link of snippetLinks()) assert.match(link.href, /^\/[^/]+$/, link.href);
  assert.equal(Outputs.snippet({ ...SETTINGS, basePath: undefined }), Outputs.snippet(SETTINGS));
});

test('the HTML snippet paths follow the folder setting', async (t) => {
  const cases = {
    'favicon-maker': '/favicon-maker/',
    '/favicon-maker/': '/favicon-maker/',
    'a/b': '/a/b/',
    'https://cdn.example.com/icons': 'https://cdn.example.com/icons/'
  };
  for (const [basePath, prefix] of Object.entries(cases)) {
    await t.test(basePath, () => {
      for (const link of snippetLinks({ basePath })) {
        assert.ok(link.href.startsWith(prefix), link.href);
        assert.ok(NAMES.has(link.href.slice(prefix.length)), link.href);
      }
    });
  }
});

test('the HTML snippet escapes nothing it should not and breaks no attribute', () => {
  const text = Outputs.snippet({ ...SETTINGS, basePath: 'x" onload="alert(1)' });
  assert.equal(text.split('\n').length, 5);
  for (const line of text.split('\n')) assert.equal(line.split('"').length % 2, 1, line);
  assert.ok(!text.includes('onload="'));
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
});

test('the manifest only refers to files in FILES, with matching sizes', async () => {
  const { json } = await manifest();
  assert.equal(json.icons.length, 4);
  for (const icon of json.icons) {
    const f = byName(icon.src);
    assert.ok(f, `${icon.src} is in FILES`);
    assert.equal(icon.sizes, `${f.size}x${f.size}`, icon.src);
    assert.equal(icon.type, 'image/png', icon.src);
  }
  assert.deepEqual(json.icons.map((i) => i.sizes).sort(), ['192x192', '192x192', '512x512', '512x512']);
  // Every Android icon file is listed.
  const android = FILES.filter((f) => /^(android-chrome|maskable-icon)-/.test(f.name)).map((f) => f.name).sort();
  assert.deepEqual(json.icons.map((i) => i.src).sort(), android);
});

test('the manifest uses icon paths relative to the manifest file', async () => {
  for (const basePath of ['/', '/favicon-maker/']) {
    const { json } = await manifest({ basePath });
    for (const icon of json.icons) {
      assert.ok(!icon.src.includes('/'), icon.src);
      // Resolved against the manifest's own URL, the icon sits next to it.
      const manifestUrl = new URL(`https://example.com${Outputs.basePath(basePath)}site.webmanifest`);
      assert.equal(new URL(icon.src, manifestUrl).href, `https://example.com${Outputs.basePath(basePath)}${icon.src}`);
    }
  }
});

test('the manifest lists normal icons as "any" and maskable icons separately as "maskable"', async () => {
  const { json } = await manifest();
  const byPurpose = (p) => json.icons.filter((i) => i.purpose === p).map((i) => [i.src, i.sizes]);
  assert.deepEqual(byPurpose('any'), [['android-chrome-192x192.png', '192x192'], ['android-chrome-512x512.png', '512x512']]);
  assert.deepEqual(byPurpose('maskable'), [['maskable-icon-192x192.png', '192x192'], ['maskable-icon-512x512.png', '512x512']]);
  for (const icon of json.icons) {
    assert.ok(['any', 'maskable'].includes(icon.purpose), `${icon.src} has one purpose, never "any maskable"`);
    const file = byName(icon.src);
    assert.equal(file.variant === 'maskable', icon.purpose === 'maskable', icon.src);
  }
});

test('the manifest short_name never splits an emoji', async (t) => {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const cases = {
    'emoji across the cut (surrogate pair)': ['Hello World😀', 'Hello World😀'],
    'emoji with skin tone across the cut': ['Hello Worl👍🏽!', 'Hello Worl👍🏽!'],
    'flag across the cut': ['Hello Worl🇵🇰!!', 'Hello Worl🇵🇰!'],
    'family emoji across the cut': ['Hello Wo👨‍👩‍👧 and more', 'Hello Wo👨‍👩‍👧 an'],
    'combining accent across the cut': ['Hello Worlé!', 'Hello Worlé!']
  };
  for (const [label, [appName, expected]] of Object.entries(cases)) {
    await t.test(label, async () => {
      const { json } = await manifest({ appName });
      assert.equal(json.short_name, expected);
      assert.ok(json.short_name.isWellFormed(), 'no lone surrogate');
      assert.ok([...segmenter.segment(json.short_name)].length <= 12, 'at most 12 visible characters');
    });
  }
});
