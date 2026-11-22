'use strict';
/* js/design.js: settings validation, versions, undo history, share links, export and import. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('../helpers/load');
const { makePng } = require('../helpers/formats');

const { Design } = loadScripts();
const Plain = loadScripts({ withoutCompression: true }).Design;
const D = { ...Design.DEFAULTS };
const plain = (o) => JSON.parse(JSON.stringify(o));

/* ---------- Validation ---------- */

test('validate: defaults for nothing, null, arrays and strings', () => {
  for (const input of [undefined, null, [], 'x', 42, true]) assert.deepEqual(plain(Design.validate(input)), D);
});

test('validate keeps every valid setting', () => {
  const good = {
    mode: 'image', text: 'AB', font: 'serif', bold: false, emoji: 'bundled', textScale: 30, fg: '#112233', bg: '#AABBCC',
    transparent: true, radius: 50, maskPad: 0, dark: true, darkFg: '#000000', darkBg: '#ffffff', fit: 'cover', pad: 30,
    appName: 'Café 😀', basePath: '/repo/', shape: 'squircle', bgType: 'radial', bg2: '#101010', angle: 360,
    darkBg2: '#202020', border: true, borderWidth: 15, borderColor: '#303030', offsetX: -20, offsetY: 20,
    icon: 'coffee', iconStroke: 1.25, iconScale: 100
  };
  assert.deepEqual(plain(Design.validate(good)), { ...good, bg: '#aabbcc' });
});

test('validate: each invalid value falls back to its default', async (t) => {
  const bad = {
    mode: ['video', 1, null, 'TEXT'],
    text: [5, null, {}, ['A']],
    font: ['comic', 1, '__proto__', 'toString', ''],
    bold: ['true', 1, null],
    emoji: ['apple', true],
    textScale: [29, 101, 70.5, '70', NaN, Infinity, null],
    fg: ['red', '#fff', '#12345g', 'url(x)', '#1234567', 0],
    bg: ['#00000', 'javascript:alert(1)'],
    transparent: ['false', 0],
    radius: [-1, 51, '22'],
    maskPad: [31, -5, 10.1],
    dark: ['yes'],
    darkFg: [12],
    darkBg: ['#zzzzzz'],
    fit: ['fill', ''],
    pad: [99, -1],
    appName: [42, '', '   ', '\u0000\u0001'],
    basePath: [7, 'x'.repeat(201)],
    shape: ['triangle', 'Circle', 1, null],
    bgType: ['gradient', 'conic', true],
    bg2: ['blue', '#12'],
    angle: [-1, 361, 45.5, '90'],
    darkBg2: ['#gggggg'],
    border: ['yes', 1],
    borderWidth: [0, 16, 2.5, '4'],
    borderColor: ['white', '#fff'],
    offsetX: [-21, 21, 0.5, '0'],
    offsetY: [100, -100, null],
    icon: ['Star', 'star!', '../x', 'a--b', '-star', 'x'.repeat(65), 5, ''],
    iconStroke: [0.25, 3.5, 1.3, '2', NaN],
    iconScale: [29, 101, 50.5]
  };
  for (const [key, values] of Object.entries(bad)) {
    for (const value of values) {
      await t.test(`${key} = ${JSON.stringify(value)}`, () => {
        assert.deepEqual(Design.validate({ [key]: value })[key], D[key]);
      });
    }
  }
});

test('validate drops unknown keys and ignores inherited ones', () => {
  const out = Design.validate(JSON.parse('{"__proto__": {"mode": "image"}, "evil": "<script>", "constructor": 1, "text": "Hi"}'));
  assert.deepEqual(Object.keys(out).sort(), Object.keys(D).sort());
  assert.equal(out.mode, 'text');
  assert.equal(out.text, 'Hi');
  assert.equal({}.mode, undefined, 'no prototype pollution');
  const inherited = Object.create({ mode: 'image' });
  assert.equal(Design.validate(inherited).mode, 'text');
});

test('validate: text is cut to 3 visible characters, without control characters, in NFC', () => {
  assert.equal(Design.validate({ text: 'Hello' }).text, 'Hel');
  assert.equal(Design.validate({ text: '👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧' }).text, '👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧');
  assert.equal(Design.validate({ text: 'A\u0000B\u001bC' }).text, 'ABC');
  assert.equal(Design.validate({ text: 'é' }).text, 'é');
  assert.equal(Design.validate({ text: '' }).text, '');
});

test('validate: app name is trimmed, cut to 45 characters, and never empty', () => {
  assert.equal(Design.validate({ appName: '  Shop  ' }).appName, 'Shop');
  assert.equal(Design.validate({ appName: 'x'.repeat(60) }).appName.length, 45);
  assert.equal(Design.validate({ appName: '\u0007' }).appName, 'My App');
});

test('same and changes', () => {
  const a = Design.validate({ text: 'A' });
  assert.equal(Design.same(a, Design.validate({ text: 'A', junk: 1 })), true);
  assert.equal(Design.same(a, Design.validate({ text: 'B' })), false);
  assert.deepEqual(plain(Design.changes(Design.validate({ text: 'A', radius: 0 }))), { text: 'A', radius: 0 });
  assert.deepEqual(plain(Design.changes(Design.validate({}))), {});
});

test('validateImage', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  assert.deepEqual(plain({ ...Design.validateImage({ type: 'image/png', bytes, name: 'a\u0000.png' }), bytes: [] }), { type: 'image/png', name: 'a.png', bytes: [] });
  assert.equal(Design.validateImage({ type: 'image/png', bytes: bytes.buffer }).bytes.length, 3, 'an ArrayBuffer is fine');
  for (const bad of [null, {}, { type: 'text/html', bytes }, { type: 'image/png', bytes: new Uint8Array(0) },
    { type: 'image/png', bytes: 'AAAA' }, { type: 'image/png', bytes: new Uint8Array(10 * 1024 * 1024 + 1) }]) {
    assert.equal(Design.validateImage(bad), null);
  }
});

/* ---------- Versions ---------- */

test('migrate: a bare settings object (format 0) becomes the current format', () => {
  const d = Design.migrate({ text: 'Z', font: 'mono', mystery: 1 });
  assert.equal(d.format, Design.FORMAT);
  assert.equal(d.settings.text, 'Z');
  assert.equal(d.settings.font, 'mono');
  assert.equal(d.settings.dark, false, 'options added later get their defaults');
  assert.equal(d.image, null);
});

test('migrate: format 1 becomes format 2 and looks the same', () => {
  const d = Design.migrate({ format: 1, settings: { text: 'Q', radius: 5, bg: '#123456', transparent: true } });
  assert.equal(d.format, 2);
  assert.deepEqual(plain(d.settings), { ...D, text: 'Q', radius: 5, bg: '#123456', transparent: true,
    shape: 'rounded', bgType: 'solid', border: false, offsetX: 0, offsetY: 0 });
});

test('migrate: format 1 settings that are missing get the format 1 defaults, unknown keys are dropped', () => {
  const d = Design.migrate({ format: 1, settings: { radius: 9, shape: 'circle', border: true, extra: 1 } });
  for (const [k, v] of Object.entries(Design.V1_DEFAULTS)) if (k !== 'radius') assert.equal(d.settings[k], v, k);
  assert.equal(d.settings.shape, 'rounded', 'format 1 had no shape: it stays the rounded square');
  assert.equal(d.settings.border, false);
  assert.equal(d.settings.extra, undefined);
  assert.equal(Design.migrate({ format: 1, settings: null }).settings.text, 'F');
  assert.equal(Design.migrate({ format: 1, settings: JSON.parse('{"__proto__": {"text": "X"}}') }).settings.text, 'F');
});

test('migrate: the image comes through every step', () => {
  const image = { type: 'image/png', bytes: new Uint8Array([1]) };
  assert.equal(Design.migrate({ format: 1, settings: {}, image }).image, image);
});

test('migrate: the current format passes through, missing settings get defaults', () => {
  const d = Design.migrate({ format: 2, settings: { radius: 5 } });
  assert.equal(d.settings.radius, 5);
  assert.equal(d.settings.maskPad, 10);
  assert.deepEqual(plain(Design.migrate({ format: 2 }).settings), D);
});

test('migrate refuses a newer format and things that are not designs', () => {
  assert.throws(() => Design.migrate({ format: Design.FORMAT + 1, settings: {} }), /newer version/);
  for (const bad of [null, 'x', [], { format: -1 }, { format: 1.5 }, { format: '1' }]) {
    assert.throws(() => Design.migrate(bad), /Not a design/, JSON.stringify(bad));
  }
});

/* ---------- Undo history ---------- */

test('History: undo and redo', () => {
  const h = new Design.History(10, 1000);
  h.reset('a');
  assert.equal(h.canUndo(), false);
  h.record('b', null, 0);
  h.record('c', null, 10);
  assert.equal(h.undo(), 'b');
  assert.equal(h.undo(), 'a');
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), 'b');
  assert.equal(h.redo(), 'c');
  assert.equal(h.redo(), null);
});

test('History: a new change clears redo, and an unchanged state is not a step', () => {
  const h = new Design.History();
  h.reset('a');
  h.record('b', null, 0);
  h.undo();
  h.record('x', null, 5000);
  assert.equal(h.canRedo(), false);
  assert.equal(h.record('x', null, 6000), false);
  assert.equal(h.undo(), 'a');
});

test('History: quick changes to one control are one step', () => {
  const h = new Design.History(100, 1000);
  h.reset(0);
  for (let i = 1; i <= 20; i++) h.record(i, 'radius', i * 50); // a slider drag
  assert.equal(h.present, 20);
  assert.equal(h.undo(), 0, 'one undo goes back to before the drag');
  h.redo();
  h.record(21, 'radius', 5000); // the same slider, much later
  h.record(22, 'text', 5010);   // another control right after
  assert.equal(h.undo(), 21);
  assert.equal(h.undo(), 20);
});

test('History: the first change after an undo starts a new step', () => {
  const h = new Design.History(100, 1000);
  h.reset(0);
  h.record(1, 'pad', 0);
  h.record(2, 'pad', 10);
  h.undo();
  h.record(3, 'pad', 20);
  assert.equal(h.undo(), 0);
});

test('History: keeps at most the limit, dropping the oldest', () => {
  const h = new Design.History(5, 1000);
  h.reset(0);
  for (let i = 1; i <= 20; i++) h.record(i, null, i * 5000);
  let steps = 0;
  let last;
  while (h.canUndo()) { last = h.undo(); steps++; }
  assert.equal(steps, 5);
  assert.equal(last, 15);
});

/* ---------- Share links ---------- */

const PNG = new Uint8Array(makePng(8, 8, (x, y) => [x * 30, y * 30, 120, 255]));
const SETTINGS = Design.validate({ text: '👍🏽Ab', font: 'handwritten', bg: '#123456', dark: true, appName: 'Émoji ✨ shop' });

for (const [label, Lib] of [['compressed', Design], ['uncompressed (no CompressionStream)', Plain]]) {
  test(`share link round trip, ${label}`, async () => {
    const hash = await Lib.encodeHash(SETTINGS, null);
    assert.match(hash, Lib === Design ? /^#d2=[0-9a-f]{8}\.[A-Za-z0-9_-]+$/ : /^#d2r=[0-9a-f]{8}\.[A-Za-z0-9_-]+$/);
    assert.equal(Lib.isShareHash(hash), true);
    const d = await Lib.decodeHash(hash);
    assert.deepEqual(plain(d.settings), plain(SETTINGS));
    assert.equal(d.image, null);
  });

  test(`share link with an image, ${label}`, async () => {
    const hash = await Lib.encodeHash(SETTINGS, { type: 'image/png', bytes: PNG });
    const d = await Lib.decodeHash(hash);
    assert.equal(d.image.type, 'image/png');
    assert.deepEqual(Array.from(d.image.bytes), Array.from(PNG));
  });
}

test('uncompressed links open everywhere; compressed ones need DecompressionStream', async () => {
  const hash = await Plain.encodeHash(SETTINGS, null);
  assert.deepEqual(plain((await Design.decodeHash(hash)).settings), plain(SETTINGS), 'a browser with compression opens uncompressed links');
  const compressed = await Design.encodeHash(SETTINGS, null);
  await assert.rejects(Plain.decodeHash(compressed), /incomplete/);
});

test('share links only carry settings that differ from the defaults', async () => {
  const short = await Design.encodeHash(Design.DEFAULTS, null);
  assert.ok(short.length < 40, short);
  assert.deepEqual(plain((await Design.decodeHash(short)).settings), D);
});

test('damaged and cut-off links are refused', async (t) => {
  const hash = await Design.encodeHash(SETTINGS, { type: 'image/png', bytes: PNG });
  const body = hash.slice(hash.indexOf('.') + 1);
  const flip = (s, i) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
  const cases = {
    'cut in half': hash.slice(0, Math.floor(hash.length / 2)),
    'last character missing': hash.slice(0, -1),
    'checksum changed': hash.replace(/=([0-9a-f])/, (m, c) => '=' + (c === '0' ? '1' : '0')),
    'one character changed': hash.slice(0, hash.indexOf('.') + 1) + flip(body, Math.floor(body.length / 2)),
    'no checksum': '#d1=' + body,
    'not base64url': hash.replace('.', '.!!'),
    'empty': '#d1=',
    'random words': '#d1=deadbeef.hello-world'
  };
  for (const [label, bad] of Object.entries(cases)) {
    await t.test(label, () => assert.rejects(Design.decodeHash(bad), /This link seems to be incomplete/));
  }
});

test('a valid link with a bad image or a newer format is refused', async () => {
  const fake = await Design.encodeHash(SETTINGS, { type: 'image/png', bytes: PNG });
  // Same checksum scheme, but claiming an unknown image type: build it by hand.
  const json = new TextEncoder().encode(JSON.stringify({ f: 1, s: {}, t: 'text/html' }));
  const payload = new Uint8Array([...json, 10, 60, 115, 62]);
  const { Zip } = loadScripts();
  const sum = (Zip.crc32(payload) >>> 0).toString(16).padStart(8, '0');
  await assert.rejects(Design.decodeHash('#d1r=' + sum + '.' + Design.toBase64Url(payload)), /incomplete/);
  const newer = new TextEncoder().encode(JSON.stringify({ f: 99, s: {} }));
  const sum2 = (Zip.crc32(newer) >>> 0).toString(16).padStart(8, '0');
  await assert.rejects(Design.decodeHash('#d1r=' + sum2 + '.' + Design.toBase64Url(newer)), /newer version/);
  assert.ok(fake.length > 0);
});

test('unsafe settings in a link are replaced by defaults', async () => {
  const json = new TextEncoder().encode(JSON.stringify({ f: 1, s: { fg: 'red;}</style><script>', mode: 'video', text: '<img src=x onerror=alert(1)>', radius: 1e9 } }));
  const { Zip } = loadScripts();
  const sum = (Zip.crc32(json) >>> 0).toString(16).padStart(8, '0');
  const d = await Design.decodeHash('#d1r=' + sum + '.' + Design.toBase64Url(json));
  assert.equal(d.settings.fg, D.fg);
  assert.equal(d.settings.mode, 'text');
  assert.equal(d.settings.radius, D.radius);
  assert.equal(d.settings.text, '<im', 'kept only as plain text, cut to 3 characters');
});

/** A share link as format 1 wrote it: only changes from the format 1 defaults, prefix #d1r=. */
async function formatOneLink(settings) {
  const { Zip } = loadScripts();
  const json = new TextEncoder().encode(JSON.stringify({ f: 1, s: settings }));
  const sum = (Zip.crc32(json) >>> 0).toString(16).padStart(8, '0');
  return '#d1r=' + sum + '.' + Design.toBase64Url(json);
}

test('a format 1 share link still opens, looking the same', async () => {
  const d = await Design.decodeHash(await formatOneLink({ text: 'Hi', radius: 30, dark: true }));
  assert.equal(d.settings.text, 'Hi');
  assert.equal(d.settings.radius, 30);
  assert.equal(d.settings.dark, true);
  assert.equal(d.settings.shape, 'rounded');
  assert.equal(d.settings.bgType, 'solid');
  assert.equal(d.settings.border, false);
  // A compressed format 1 link too.
  const { Zip } = loadScripts();
  const json = new TextEncoder().encode(JSON.stringify({ f: 1, s: { text: 'Z' } }));
  const sum = (Zip.crc32(json) >>> 0).toString(16).padStart(8, '0');
  const body = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  assert.equal((await Design.decodeHash('#d1=' + sum + '.' + Design.toBase64Url(body))).settings.text, 'Z');
});

test('a format 1 exported file still opens', () => {
  const file = JSON.stringify({ app: 'favicon-maker', format: 1, name: 'Old', saved: '2026-11-22T00:00:00Z', settings: { ...Design.V1_DEFAULTS, text: 'O', radius: 3 }, image: null });
  const d = Design.fromExport(file);
  assert.equal(d.settings.text, 'O');
  assert.equal(d.settings.radius, 3);
  assert.equal(d.settings.shape, 'rounded');
});

test('isShareHash', () => {
  for (const yes of ['#d1=x', '#d1r=x', '#d2=x']) assert.equal(Design.isShareHash(yes), true, yes);
  for (const no of ['', '#', '#top', '#d=1', 'd1=x', null]) assert.equal(Design.isShareHash(no), false, String(no));
});

test('shareLink leaves out an image that makes the link too long', async () => {
  const small = await Design.shareLink('https://example.com/app/#old', SETTINGS, { type: 'image/png', bytes: PNG });
  assert.equal(small.imageLeftOut, false);
  assert.ok(small.url.startsWith('https://example.com/app/#d2='));
  // Random bytes don't compress: 8 KB of them can never fit in an 8,000-character link.
  let seed = 12345;
  const noise = new Uint8Array(8000).map(() => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed & 255; });
  const big = await Design.shareLink('https://example.com/app/', SETTINGS, { type: 'image/png', bytes: noise });
  assert.equal(big.imageLeftOut, true);
  assert.ok(big.url.length <= Design.LINK_LIMIT);
  assert.equal((await Design.decodeHash(big.url.slice(big.url.indexOf('#')))).image, null);
  assert.ok(small.url.length <= Design.LINK_LIMIT);
});

/* ---------- Export and import ---------- */

test('export and import round trip, with the image as base64', () => {
  const text = Design.toExport('Shop icon', SETTINGS, { type: 'image/png', bytes: PNG, name: 'logo.png' }, Date.UTC(2026, 10, 22));
  const doc = JSON.parse(text);
  assert.equal(doc.app, 'favicon-maker');
  assert.equal(doc.format, Design.FORMAT);
  assert.equal(doc.saved, '2026-11-22T00:00:00.000Z');
  assert.equal(typeof doc.image.data, 'string');
  const back = Design.fromExport(text);
  assert.equal(back.name, 'Shop icon');
  assert.deepEqual(plain(back.settings), plain(SETTINGS));
  assert.deepEqual(Array.from(back.image.bytes), Array.from(PNG));
  assert.equal(back.image.name, 'logo.png');
});

test('export without an image, and import of an older bare-settings file', () => {
  assert.equal(Design.fromExport(Design.toExport('x', SETTINGS, null)).image, null);
  const old = JSON.stringify({ app: 'favicon-maker', name: 'Old', settings: { text: 'Q' } });
  const d = Design.fromExport(old);
  assert.equal(d.settings.text, 'Q');
});

test('import refuses files that are not designs, or have a bad image', () => {
  for (const bad of ['', 'not json', '[]', '{"app":"other"}', JSON.stringify({ app: 'favicon-maker', format: 99 })]) {
    assert.throws(() => Design.fromExport(bad), /favicon design|newer version/, bad);
  }
  const badImage = JSON.stringify({ app: 'favicon-maker', format: 1, settings: {}, image: { type: 'image/png', data: '%%%' } });
  assert.throws(() => Design.fromExport(badImage), /image can't be used/);
  const htmlImage = JSON.stringify({ app: 'favicon-maker', format: 1, settings: {}, image: { type: 'text/html', data: 'PGI+' } });
  assert.throws(() => Design.fromExport(htmlImage), /image can't be used/);
});

test('import cleans the name and settings', () => {
  const d = Design.fromExport(JSON.stringify({ app: 'favicon-maker', format: 1, name: '<b>\u0000Bold</b>', settings: { radius: 'lots', fg: '#ABCDEF' } }));
  assert.equal(d.name, '<b>Bold</b>', 'kept only as text; the page never treats it as HTML');
  assert.equal(d.settings.radius, D.radius);
  assert.equal(d.settings.fg, '#abcdef');
  assert.equal(Design.fromExport(JSON.stringify({ app: 'favicon-maker', format: 1, name: 5 })).name, 'Imported design');
});

test('base64 helpers', () => {
  const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
  assert.deepEqual(Array.from(Design.fromBase64(Design.toBase64(bytes))), Array.from(bytes));
  assert.deepEqual(Array.from(Design.fromBase64Url(Design.toBase64Url(bytes))), Array.from(bytes));
  assert.doesNotMatch(Design.toBase64Url(bytes), /[+/=]/);
  assert.throws(() => Design.fromBase64('a$b='));
  assert.throws(() => Design.fromBase64Url('abc+'));
});
