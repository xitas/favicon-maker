'use strict';
/* js/icons.js and the bundled Lucide set. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadScripts, ROOT } = require('../helpers/load');

const loaded = loadScripts();
const { Icons, Design } = loaded;
const DATA = path.join(ROOT, 'assets', 'icons', 'lucide.js');

const SAMPLE = {
  'star': ['favorite like rating', 'M1 1'],
  'star-half': ['rating', 'M2 2'],
  'sparkles': ['star magic shine', 'M3 3'],
  'coffee': ['drink cup mug cafe', 'M4 4'],
  'heart': ['like love', 'M5 5'],
  'shooting-star': ['wish night', 'M6 6'],
  'cup-soda': ['drink', 'M7 7']
};

test('validName', () => {
  for (const ok of ['star', 'star-half', 'a-arrow-down', 'x2']) assert.equal(Icons.validName(ok), true, ok);
  for (const bad of ['Star', 'star half', 'star_', '-star', 'star-', 'a--b', '../star', '', 'x'.repeat(65), 7, null]) {
    assert.equal(Icons.validName(bad), false, String(bad));
  }
});

test('search ranks the exact name, then names that start with it, then words, then tags', () => {
  const r = (q) => Array.from(Icons.search(q, SAMPLE));
  assert.deepEqual(r('star'), ['star', 'star-half', 'shooting-star', 'sparkles']);
  assert.deepEqual(r('STAR  half'), ['star-half']);
  assert.deepEqual(r('drink'), ['coffee', 'cup-soda']);
  assert.deepEqual(r('cup'), ['cup-soda', 'coffee'], 'a name word beats a tag');
  assert.deepEqual(r('like'), ['heart', 'star']);
  assert.deepEqual(r('magic star'), ['sparkles']);
  assert.deepEqual(r('nothing here'), []);
  assert.deepEqual(r(''), Object.keys(SAMPLE).sort(), 'an empty search lists everything');
  assert.deepEqual(r('<script>'), []);
});

test('before the set is loaded, nothing is found and nothing is drawn', () => {
  const { Icons: fresh } = loadScripts();
  assert.equal(fresh.loaded(), false);
  assert.equal(fresh.get('star'), null);
  assert.equal(fresh.count(), 0);
});

test('the bundled set loads, has the license next to it, and every icon is a valid path', () => {
  vm.runInContext(fs.readFileSync(DATA, 'utf8'), loaded.context, { filename: DATA });
  assert.equal(Icons.loaded(), true);
  assert.ok(Icons.count() > 1500, `${Icons.count()} icons`);
  assert.match(Icons.version(), /^\d+\.\d+\.\d+$/);
  const license = fs.readFileSync(path.join(ROOT, 'assets', 'icons', 'LICENSE'), 'utf8');
  assert.match(license, /^ISC License/);
  for (const name of Icons.search('')) {
    assert.equal(Icons.validName(name), true, name);
    const d = Icons.get(name);
    assert.match(d, /^[Mm][MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/, `${name} is plain path data`);
  }
  // Common icons people look for.
  for (const name of ['star', 'heart', 'house', 'coffee', 'rocket', 'sun', 'camera', 'leaf']) assert.ok(Icons.get(name), name);
  assert.deepEqual(Array.from(Icons.search('star')).slice(0, 1), ['star']);
  assert.ok(Icons.search('love').includes('heart'), 'tags are searchable');
  assert.equal(Icons.get('__proto__'), null);
  assert.equal(Icons.get('constructor'), null);
});

test('every icon stays inside its 24 × 24 grid', () => {
  // Absolute coordinates of M, L, H, V and C/Q end points only (relative ones are skipped): a rough check
  // that nothing in the set is far outside the grid the layout assumes.
  for (const name of Icons.search('')) {
    const d = Icons.get(name);
    for (const m of d.matchAll(/([MLC])\s*(-?[\d.]+)[\s,]*(-?[\d.]+)/g)) {
      const x = Number(m[2]);
      const y = Number(m[3]);
      assert.ok(x >= -1 && x <= 25 && y >= -1 && y <= 25, `${name}: ${m[0]}`);
    }
  }
});

test('icon settings are validated', () => {
  const s = Design.validate({ mode: 'icon', icon: 'coffee', iconStroke: 2.75, iconScale: 40 });
  assert.deepEqual([s.mode, s.icon, s.iconStroke, s.iconScale], ['icon', 'coffee', 2.75, 40]);
  const bad = Design.validate({ mode: 'icon', icon: '<svg onload=x>', iconStroke: 9, iconScale: 'big' });
  assert.deepEqual([bad.icon, bad.iconStroke, bad.iconScale], ['star', 2, 70]);
});
