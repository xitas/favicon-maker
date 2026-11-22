'use strict';
/* The bundled font list and the pure helpers in js/fonts.js, plus the font files on disk. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScripts, ROOT } = require('../helpers/load');

const { Fonts } = loadScripts();
const KEYS = Array.from(Fonts.keys());
const FONT_DIR = path.join(ROOT, 'assets', 'fonts');

test('the font menu has 8 styles, including the old setting names', () => {
  assert.deepEqual(KEYS, ['sans', 'rounded', 'serif', 'slab', 'mono', 'display', 'geometric', 'handwritten']);
  for (const old of ['sans', 'serif', 'mono', 'display']) assert.equal(Fonts.key(old), old);
});

test('old and unknown setting names map to a known font', () => {
  assert.equal(Fonts.key('serif'), 'serif');
  assert.equal(Fonts.key('nope'), 'sans');
  assert.equal(Fonts.key(undefined), 'sans');
  assert.equal(Fonts.key('__proto__'), 'sans');
  assert.equal(Fonts.key('toString'), 'sans');
});

test('family names, labels and fallbacks', () => {
  const expected = {
    sans: ['Inter', 'Sans', 'sans-serif'],
    rounded: ['Nunito', 'Rounded', 'sans-serif'],
    serif: ['Source Serif 4', 'Serif', 'serif'],
    slab: ['Zilla Slab', 'Slab', 'serif'],
    mono: ['JetBrains Mono', 'Mono', 'monospace'],
    display: ['Anton', 'Display', 'sans-serif'],
    geometric: ['Montserrat', 'Geometric', 'sans-serif'],
    handwritten: ['Caveat', 'Handwritten', 'cursive']
  };
  for (const [k, [name, style, generic]] of Object.entries(expected)) {
    assert.equal(Fonts.family(k), `FM ${name}`);
    assert.equal(Fonts.previewFamily(k), `FM ${name} Name`);
    assert.equal(Fonts.label(k), `${name} (${style})`);
    assert.equal(Fonts.info(k).generic, generic);
  }
});

test('weights: bold is 700 when the font has it, otherwise 400', () => {
  for (const k of KEYS) {
    assert.equal(Fonts.weight(k, false), 400, k);
    assert.equal(Fonts.weight(k, true), Fonts.hasBold(k) ? 700 : 400, k);
  }
  assert.equal(Fonts.hasBold('display'), false, 'Anton has one weight');
  assert.equal(Fonts.hasBold('sans'), true);
});

test('the canvas font string', () => {
  assert.equal(Fonts.css({ font: 'sans', bold: true, emoji: 'system' }, 48), '700 48px "FM Inter", system-ui, sans-serif');
  assert.equal(Fonts.css({ font: 'serif', bold: false }, 16), '400 16px "FM Source Serif 4", system-ui, serif');
  assert.equal(Fonts.css({ font: 'display', bold: true }, 20), '400 20px "FM Anton", system-ui, sans-serif');
  assert.equal(Fonts.stack({ font: 'mono', emoji: 'bundled' }), '"FM JetBrains Mono", "FM Emoji", system-ui, monospace');
  assert.equal(Fonts.stack({ font: 'old-name' }), '"FM Inter", system-ui, sans-serif');
});

test('parseRanges', () => {
  assert.deepEqual(Array.from(Fonts.parseRanges('U+0041'), (r) => Array.from(r)), [[0x41, 0x41]]);
  assert.deepEqual(Array.from(Fonts.parseRanges('U+0000-00FF, u+0131,U+1E00-1E9F'), (r) => Array.from(r)), [[0, 0xff], [0x131, 0x131], [0x1e00, 0x1e9f]]);
  assert.throws(() => Fonts.parseRanges('0041'), /Bad unicode range/);
});

test('every font has basic Latin, accents and the euro sign', () => {
  const sample = 'AZaz09 .,!?ÀÉÎÕÜçñßøåæœŁłŚźĞğŞşİı€';
  for (const k of KEYS) {
    for (const ch of sample) assert.ok(Fonts.has(k, ch.codePointAt(0)), `${k} has ${ch}`);
  }
});

test('missing: Latin text needs nothing else', () => {
  for (const k of KEYS) {
    assert.deepEqual(Array.from(Fonts.missing('Café', k)), [], k);
    assert.deepEqual(Array.from(Fonts.missing('Zürich', k)), [], k);
  }
});

test('missing: an accent typed as a separate mark counts as the precomposed letter', () => {
  assert.deepEqual(Array.from(Fonts.missing('é', 'sans')), []);
  assert.deepEqual(Array.from(Fonts.missing('ñ', 'serif')), []);
});

test('missing: emoji are left to the emoji font', () => {
  for (const text of ['😀', '👍🏽', '👨‍👩‍👧', '🇵🇰', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '❤️', '1️⃣']) {
    assert.deepEqual(Array.from(Fonts.missing(text, 'sans')), [], text);
  }
});

test('missing: Urdu, Arabic, Chinese and Hindi are reported', () => {
  assert.deepEqual(Array.from(Fonts.missing('سلام', 'sans')), ['س', 'ل', 'ا', 'م']);
  assert.deepEqual(Array.from(Fonts.missing('اردو', 'serif')), ['ا', 'ر', 'د', 'و']);
  assert.deepEqual(Array.from(Fonts.missing('中文', 'mono')), ['中', '文']);
  assert.deepEqual(Array.from(Fonts.missing('हि', 'display')), ['ह', 'ि']);
});

test('missing: each character once, in order, mixed with Latin and emoji', () => {
  assert.deepEqual(Array.from(Fonts.missing('Aبب😀ج', 'sans')), ['ب', 'ج']);
});

test('missing: spaces and invisible characters are ignored', () => {
  assert.deepEqual(Array.from(Fonts.missing(' ​ ', 'sans')), []);
});

test('the font files, previews and licenses are on disk', () => {
  for (const k of KEYS) {
    const info = Fonts.info(k);
    const files = [...Object.values(info.files), info.preview];
    for (const rel of files) {
      const file = path.join(FONT_DIR, rel);
      assert.ok(fs.existsSync(file), rel);
      assert.equal(fs.readFileSync(file).subarray(0, 4).toString('latin1'), 'wOF2', `${rel} is woff2`);
    }
    if (!info.variable) {
      assert.deepEqual(Object.keys(info.files).map(Number).sort(), [...info.weights].sort(), `${k} has a file per weight`);
    }
    const license = fs.readFileSync(path.join(FONT_DIR, k, 'OFL.txt'), 'utf8');
    assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/, `${k} license is OFL`);
  }
  const emoji = path.join(FONT_DIR, 'emoji', 'noto-color-emoji.woff2');
  assert.equal(fs.readFileSync(emoji).subarray(0, 4).toString('latin1'), 'wOF2');
  assert.match(fs.readFileSync(path.join(FONT_DIR, 'emoji', 'OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
});

test('no font file is left over that the list does not use', () => {
  const used = new Set(['emoji/noto-color-emoji.woff2']);
  for (const k of KEYS) {
    const info = Fonts.info(k);
    for (const rel of [...Object.values(info.files), info.preview]) used.add(rel);
  }
  for (const dir of fs.readdirSync(FONT_DIR)) {
    for (const name of fs.readdirSync(path.join(FONT_DIR, dir))) {
      if (name === 'OFL.txt') continue;
      assert.ok(used.has(`${dir}/${name}`), `${dir}/${name} is used`);
    }
  }
});

test('in Node, prepare only normalizes the font name', async () => {
  const s = await Fonts.prepare({ mode: 'text', text: 'A', font: 'gone', emoji: 'system' });
  assert.equal(s.font, 'sans');
});
