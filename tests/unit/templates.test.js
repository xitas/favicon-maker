'use strict';
/* js/templates.js: the template gallery and Surprise me. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScripts, ROOT } = require('../helpers/load');

const { Templates, Design, Checks, Fonts } = loadScripts();
const plain = (o) => JSON.parse(JSON.stringify(o));
const ICON_DATA = fs.readFileSync(path.join(ROOT, 'assets', 'icons', 'lucide.js'), 'utf8');
const iconExists = (name) => ICON_DATA.includes(JSON.stringify(name) + ':');

/** A small seeded random number generator, so failures can be repeated. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONTRAST_IDS = ['contrast', 'darkContrast', 'lightTab', 'darkTab'];

test('there are 12 to 16 templates, with unique ids and names', () => {
  assert.ok(Templates.LIST.length >= 12 && Templates.LIST.length <= 16, `${Templates.LIST.length} templates`);
  assert.equal(new Set(Templates.LIST.map((t) => t.id)).size, Templates.LIST.length);
  assert.equal(new Set(Templates.LIST.map((t) => t.name)).size, Templates.LIST.length);
});

test('every template is a valid design: validation keeps it exactly as written', () => {
  for (const t of Templates.LIST) {
    for (const key of Object.keys(t.settings)) assert.ok(key in Design.DEFAULTS, `${t.id}: ${key} is a real setting`);
    const s = Templates.design(t, null);
    assert.deepEqual(plain(Design.validate(s)), plain(s), `${t.id} is stable under validation`);
    for (const [key, value] of Object.entries(t.settings)) assert.deepEqual(plain(s[key]), plain(value), `${t.id}: ${key} kept`);
    if (s.mode === 'icon') assert.ok(iconExists(s.icon), `${t.id}: the icon ${s.icon} is in the library`);
    if (s.mode === 'text') assert.ok(Fonts.keys().includes(s.font), `${t.id}: a bundled font`);
  }
});

test('every template passes every design check', () => {
  // The small text check needs a measurement from the page; the browser tests cover it.
  for (const t of Templates.LIST) {
    const s = Templates.design(t, null);
    assert.deepEqual(plain(Checks.run(s).warnings.map((w) => w.id)), [], t.id);
  }
});

test('a template keeps the site settings and the person’s text, and replaces the rest', () => {
  const current = Design.validate({ ...Design.DEFAULTS, text: 'Hi', appName: 'Shop', basePath: '/icons/', emoji: 'bundled', fg: '#123456', shape: 'circle' });
  const s = Templates.design('slab-stamp', current);
  assert.equal(s.text, 'Hi');
  assert.equal(s.appName, 'Shop');
  assert.equal(s.basePath, '/icons/');
  assert.equal(s.emoji, 'bundled');
  assert.equal(s.font, 'slab');
  assert.equal(s.fg, Templates.byId('slab-stamp').settings.fg);
  assert.equal(s.shape, 'rounded', 'a template sets the whole look, defaults included');
  // An icon template keeps its icon; a text template given an icon design uses its own sample text.
  assert.equal(Templates.design('leaf', current).mode, 'icon');
  const fromIcon = Templates.design('poster', { ...current, mode: 'icon' });
  assert.equal(fromIcon.text, 'Go');
  assert.equal(Templates.design('poster', { ...current, text: '  ' }).text, 'Go', 'blank text uses the sample');
  assert.throws(() => Templates.design('nope', current), /No such template/);
});

test('Surprise me always passes the contrast check, over many random runs', () => {
  const rand = seeded(20261123);
  const modes = ['text', 'icon', 'text'];
  for (let i = 0; i < 3000; i++) {
    const current = Design.validate({ ...Design.DEFAULTS, mode: modes[i % 3], text: 'Ab' });
    const s = Templates.surprise(current, rand);
    const ids = plain(Checks.run(s).warnings.map((w) => w.id));
    assert.deepEqual(ids.filter((id) => CONTRAST_IDS.includes(id)), [], `run ${i}: ${JSON.stringify({ fg: s.fg, bg: s.bg, bg2: s.bg2, bgType: s.bgType })}`);
    assert.deepEqual(ids, [], `run ${i}: no other warning either`);
    const bgs = s.bgType === 'solid' ? [s.bg] : [s.bg, s.bg2];
    assert.ok(Checks.worstContrast(s.fg, bgs).ratio >= Templates.SURPRISE_CONTRAST - 1e-9, `run ${i}: aims above the threshold`);
    assert.deepEqual(plain(Design.validate(s)), plain(s), `run ${i}: a valid design`);
  }
});

test('Surprise me keeps the text, the image and the site settings, and changes the look', () => {
  const current = Design.validate({ ...Design.DEFAULTS, text: 'Q', appName: 'Notes', basePath: '/a/', cropZoom: 250 });
  const looks = new Set();
  const rand = seeded(7);
  for (let i = 0; i < 40; i++) {
    const s = Templates.surprise(current, rand);
    assert.equal(s.text, 'Q');
    assert.equal(s.mode, 'text');
    assert.equal(s.appName, 'Notes');
    assert.equal(s.basePath, '/a/');
    assert.equal(s.cropZoom, 250);
    assert.equal(s.transparent, false);
    looks.add([s.font, s.shape, s.bg].join());
  }
  assert.ok(looks.size > 30, `varied results (${looks.size} of 40)`);
  // An icon design gets another icon from the list, always one that exists.
  for (let i = 0; i < 50; i++) {
    const s = Templates.surprise({ ...current, mode: 'icon', icon: 'star' }, rand);
    assert.notEqual(s.icon, 'star');
    assert.ok(Templates.SURPRISE_ICONS.includes(s.icon) && iconExists(s.icon), s.icon);
  }
  // An image design keeps its image mode; only the shape and background change.
  assert.equal(Templates.surprise({ ...current, mode: 'image' }, rand).mode, 'image');
});

test('Surprise me with the default random source', () => {
  const s = Templates.surprise(Design.DEFAULTS);
  assert.deepEqual(plain(Design.validate(s)), plain(s));
});
