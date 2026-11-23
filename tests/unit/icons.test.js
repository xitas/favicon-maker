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

/** Every point a path's commands end on, relative ones resolved: [[x, y], ...]. */
function pathPoints(d) {
  const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  const NUMBER = /^[\s,]*([-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?)/i;
  const FLAG = /^[\s,]*([01])/; // arc flags are one digit, and may touch the next number ("017.07")
  const points = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  let rest = d;
  while ((rest = rest.replace(/^[\s,]+/, ''))) {
    if (/^[a-z]/i.test(rest)) {
      cmd = rest[0];
      rest = rest.slice(1);
    }
    const lower = cmd.toLowerCase();
    const rel = cmd === lower;
    if (lower === 'z') { x = sx; y = sy; points.push([x, y]); continue; }
    const v = [];
    for (let k = 0; k < ARGS[lower]; k++) {
      const m = (lower === 'a' && (k === 3 || k === 4) ? FLAG : NUMBER).exec(rest);
      assert.ok(m, `bad path data near "${rest.slice(0, 12)}"`);
      v.push(Number(m[1]));
      rest = rest.slice(m[0].length);
    }
    if (lower === 'h') x = rel ? x + v[0] : v[0];
    else if (lower === 'v') y = rel ? y + v[0] : v[0];
    else {
      const ex = v[v.length - 2];
      const ey = v[v.length - 1];
      x = rel ? x + ex : ex;
      y = rel ? y + ey : ey;
    }
    if (lower === 'm') {
      sx = x; sy = y;
      cmd = rel ? 'l' : 'L'; // pairs after a move are line-tos
    }
    points.push([x, y]);
  }
  return points;
}

test('pathPoints follows relative commands, and joined paths', () => {
  assert.deepEqual(pathPoints('M12 19h8M4 17l6-6-6-6'), [[12, 19], [20, 19], [4, 17], [10, 11], [4, 5]]);
  // Joined after another path, a relative move starts from where that one ended.
  assert.deepEqual(pathPoints('M12 19h8m4 17 6-6-6-6').slice(2), [[24, 36], [30, 30], [24, 24]]);
});

test('every icon stays inside its 24 × 24 grid', () => {
  // Every end point, relative ones included: a part of an icon placed from the wrong start point lands
  // outside the grid (824 icons did, when joined paths kept a leading relative move).
  for (const name of Icons.search('')) {
    for (const [x, y] of pathPoints(Icons.get(name))) {
      assert.ok(x >= -1 && x <= 25 && y >= -1 && y <= 25, `${name}: a point at ${x}, ${y}`);
    }
  }
});

test('icon settings are validated', () => {
  const s = Design.validate({ mode: 'icon', icon: 'coffee', iconStroke: 2.75, iconScale: 40 });
  assert.deepEqual([s.mode, s.icon, s.iconStroke, s.iconScale], ['icon', 'coffee', 2.75, 40]);
  const bad = Design.validate({ mode: 'icon', icon: '<svg onload=x>', iconStroke: 9, iconScale: 'big' });
  assert.deepEqual([bad.icon, bad.iconStroke, bad.iconScale], ['star', 2, 70]);
});
