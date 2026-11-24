'use strict';
/*
 * The service worker's file lists (sw.js) must match the files as they are now, so a change can't be
 * published without a new cache version. When this fails: run `npm run build-sw` and commit sw.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadScripts, ROOT } = require('../helpers/load');
const build = require('../../tools/build-sw');

const { Fonts } = loadScripts();
const SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const CODE = SW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // without comments

test('sw.js lists every file with its current hash (run `npm run build-sw` if not)', () => {
  assert.equal(build.currentBlock(ROOT), build.filesBlock(ROOT), 'sw.js is out of date: run `npm run build-sw` and commit sw.js');
});

test('core files: everything index.html loads, every script, the menu fonts, the app icon and manifest', () => {
  const core = new Set(build.coreFiles(ROOT));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
  for (const ref of refs) assert.ok(core.has(ref), `${ref} is loaded by index.html but not kept at install`);
  assert.ok(core.has('index.html') && core.has('manifest.webmanifest') && core.has('css/style.css'));
  for (const file of fs.readdirSync(path.join(ROOT, 'js'))) if (file.endsWith('.js')) assert.ok(core.has('js/' + file), file);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) assert.ok(core.has(icon.src), icon.src);
  for (const k of Fonts.keys()) assert.ok(core.has('assets/fonts/' + Fonts.info(k).preview), `${k}: the menu's label font`);
});

test('optional files: every icon font, every outline file, the emoji font and the icon library', () => {
  const optional = new Set(build.optionalFiles(ROOT));
  for (const k of Fonts.keys()) {
    const info = Fonts.info(k);
    for (const file of Object.values(info.files)) assert.ok(optional.has('assets/fonts/' + file), file);
    for (const file of Object.values(info.glyphs)) assert.ok(optional.has('assets/fonts/' + file), file);
  }
  assert.ok(optional.has('assets/fonts/emoji/noto-color-emoji.woff2'));
  assert.ok(optional.has('assets/icons/lucide.js'));
  // None of them is also a core file, and the large ones aren't kept at install.
  const core = new Set(build.coreFiles(ROOT));
  for (const f of optional) assert.ok(!core.has(f), f);
});

test('the sizes add up, and nothing outside the app’s own files is listed', () => {
  const block = build.filesBlock(ROOT);
  const optional = new Function(block.replace(/\/\/.*$/gm, '') + '; return OPTIONAL;')();
  const total = Object.values(optional).reduce((n, [, bytes]) => n + bytes, 0);
  assert.ok(total > 4e6 && total < 12e6, `${total} bytes`);
  const all = build.coreFiles(ROOT).concat(build.optionalFiles(ROOT));
  for (const f of all) {
    assert.ok(!/^(tests|tools|node_modules|\.github)\//.test(f), f);
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  }
});

test('the service worker only ever caches the listed files, never images or designs', () => {
  // Every cache.put stores a listed file (a core file at install, or an optional file by its key).
  const puts = [...SW.matchAll(/cache\.put\(([^,]+),/g)].map((m) => m[1].trim());
  assert.deepEqual(puts.sort(), ['SCOPE + file', 'key'].sort());
  assert.match(SW, /if \(Object\.prototype\.hasOwnProperty\.call\(OPTIONAL, file\)\) \{/);
  assert.doesNotMatch(CODE, /indexedDB|localStorage|blob:/i);
  // Updates wait for the person: the only skipWaiting is the answer to the page's message.
  assert.equal(SW.match(/skipWaiting\(\)/g).length, 1);
  assert.match(SW, /data\.type === 'skip-waiting'\) self\.skipWaiting\(\)/);
});

test('a changed file changes its hash and the cache version; line endings alone do not', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-test-'));
  try {
    for (const f of build.coreFiles(ROOT).concat(build.optionalFiles(ROOT), ['sw.js'])) {
      fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
    }
    const version = (block) => /VERSION = "(\w+)"/.exec(block)[1];
    const before = build.filesBlock(tmp);
    const app = path.join(tmp, 'js', 'app.js');
    fs.writeFileSync(app, fs.readFileSync(app, 'utf8').replace(/\r?\n/g, '\r\n'));
    assert.equal(build.filesBlock(tmp), before, 'Windows line endings change nothing');
    fs.appendFileSync(app, '\n// changed\n');
    const after = build.filesBlock(tmp);
    assert.notEqual(version(after), version(before));
    // A changed optional file (a font's outlines) changes its hash too, so its old copy is replaced.
    const glyphs = path.join(tmp, 'assets/fonts/sans/inter-700.glyphs.js');
    const hashOf = (block) => /"assets\/fonts\/sans\/inter-700\.glyphs\.js": \["(\w+)"/.exec(block)[1];
    fs.appendFileSync(glyphs, '\n');
    assert.notEqual(hashOf(build.filesBlock(tmp)), hashOf(after));
    // writeBlock updates sw.js in place.
    assert.equal(build.writeBlock(tmp), true);
    assert.equal(build.currentBlock(tmp), build.filesBlock(tmp));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
