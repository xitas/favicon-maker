'use strict';
/* js/checks.js: contrast, gradients, Fix contrast, transparent backgrounds, small text and thin lines. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('../helpers/load');

const { Checks, Design } = loadScripts();
const ids = (r) => Array.from(r.warnings, (w) => w.id);
const design = (over) => ({ ...Design.DEFAULTS, ...over });

test('contrast matches known WCAG values', () => {
  const cases = [
    ['#000000', '#ffffff', 21],
    ['#ffffff', '#ffffff', 1],
    ['#777777', '#ffffff', 4.48],
    ['#767676', '#ffffff', 4.54],
    ['#949494', '#ffffff', 3.03],
    ['#0000ff', '#ffffff', 8.59],
    ['#ff0000', '#ffffff', 4.0],
    ['#ff0000', '#000000', 5.25],
    ['#00ff00', '#000000', 15.3]
  ];
  for (const [a, b, want] of cases) {
    const got = Checks.contrast(a, b);
    assert.ok(Math.abs(got - want) < 0.01, `${a} on ${b}: ${got.toFixed(3)}, want ${want}`);
    assert.equal(Checks.contrast(b, a), got, 'the same either way round');
  }
  assert.throws(() => Checks.contrast('red', '#fff'), /Not a #rrggbb color/);
});

test('worstContrast: one color, and the worst point along a gradient', () => {
  assert.equal(Checks.worstContrast('#ffffff', ['#000000']).ratio, 21);
  // White text over black-to-white: the white end is the worst, ratio 1.
  const bw = Checks.worstContrast('#ffffff', ['#000000', '#ffffff']);
  assert.equal(bw.ratio, 1);
  assert.equal(bw.at, 1);
  // Mid gray text over black-to-white: the worst point is in the middle, where the gradient matches it.
  const mid = Checks.worstContrast('#777777', ['#000000', '#ffffff']);
  assert.ok(mid.at > 0.3 && mid.at < 0.7, `worst at ${mid.at}`);
  assert.ok(mid.ratio < 1.1, `nearly the same color there (${mid.ratio.toFixed(3)})`);
  // Never better than either end.
  for (const [fg, a, b] of [['#ffffff', '#0b7a75', '#073f3c'], ['#ffcc00', '#202020', '#ff8800']]) {
    const w = Checks.worstContrast(fg, [a, b]).ratio;
    assert.ok(w <= Checks.contrast(fg, a) + 1e-9 && w <= Checks.contrast(fg, b) + 1e-9);
  }
});

test('fixContrast keeps the hue, reaches 3:1, and changes the lightness as little as possible', () => {
  const cases = [
    ['#7fd4ff', ['#ffffff']],
    ['#ffd166', ['#fff3c4']],
    ['#ffffff', ['#9fd3c7']],
    ['#ff4d4d', ['#ff6b6b', '#c13dd6']],
    ['#444444', ['#000000']]
  ];
  for (const [fg, bgs] of cases) {
    const fixed = Checks.fixContrast(fg, bgs);
    assert.ok(fixed, `${fg} can be fixed`);
    assert.ok(Checks.worstContrast(fixed, bgs).ratio >= 3, `${fixed} reaches 3:1 against ${bgs}`);
    const [h0, s0, l0] = Checks.toHsl(fg);
    const [h1, s1, l1] = Checks.toHsl(fixed);
    if (s0 > 0.05 && l1 > 0.03 && l1 < 0.97) {
      const dh = Math.min(Math.abs(h0 - h1), 360 - Math.abs(h0 - h1));
      assert.ok(dh < 3, `${fg} -> ${fixed}: hue kept (${h0.toFixed(1)} vs ${h1.toFixed(1)})`);
      assert.ok(Math.abs(s0 - s1) < 0.06, `saturation kept (${s0.toFixed(3)} vs ${s1.toFixed(3)})`);
    }
    // Smallest change: a little less of the same change doesn't reach 3:1.
    const closer = Checks.fromHsl(h0, s0, l1 + (l0 > l1 ? 0.004 : -0.004));
    assert.ok(Checks.worstContrast(closer, bgs).ratio < 3, `${fg}: ${closer} (a step closer) still fails, so ${fixed} is the nearest`);
  }
  assert.equal(Checks.fixContrast('#000000', ['#ffffff']), '#000000', 'already fine: unchanged');
});

test('fixContrast says so when no lightness can reach 3:1', () => {
  // Against a gradient from black to white, no single color contrasts 3:1 with both ends.
  assert.equal(Checks.fixContrast('#808080', ['#000000', '#ffffff']), null);
});

test('HSL round trip', () => {
  for (const c of ['#000000', '#ffffff', '#ff0000', '#0b7a75', '#7fd4ff', '#123456', '#c13dd6']) {
    const back = Checks.fromHsl(...Checks.toHsl(c));
    const d = Checks.rgb(back).map((v, i) => Math.abs(v - Checks.rgb(c)[i]));
    assert.ok(Math.max(...d) <= 1, `${c} -> ${back}`);
  }
});

test('run: the default design looks good', () => {
  assert.deepEqual(ids(Checks.run(design({}), { textHeight16: 8.2 })), []);
  assert.deepEqual(ids(Checks.run(design({ mode: 'icon' }), {})), [], 'the default icon too');
});

test('run: low contrast, with a fix, for solid and gradient backgrounds and dark mode', () => {
  const r = Checks.run(design({ fg: '#ffffff', bg: '#9fd3c7' }), { textHeight16: 9 });
  assert.deepEqual(ids(r), ['contrast']);
  assert.equal(r.warnings[0].text, 'Low contrast: this may be hard to see at small sizes.');
  assert.equal(r.warnings[0].action.field, 'fg');
  assert.ok(Checks.contrast(r.warnings[0].action.value, '#9fd3c7') >= 3);

  // A gradient that is dark at one end and light at the other: the light end decides.
  assert.deepEqual(ids(Checks.run(design({ bgType: 'linear', bg: '#000000', bg2: '#eeeeee', fg: '#ffffff' }), { textHeight16: 9 })), ['contrast']);
  assert.deepEqual(ids(Checks.run(design({ bgType: 'radial', bg: '#000000', bg2: '#222222', fg: '#ffffff' }), { textHeight16: 9 })), []);

  const dark = Checks.run(design({ dark: true, darkFg: '#333333', darkBg: '#222222' }), { textHeight16: 9 });
  assert.deepEqual(ids(dark), ['darkContrast']);
  assert.equal(dark.warnings[0].action.field, 'darkFg');
});

test('run: emoji bring their own colors, so text of only emoji skips contrast', () => {
  assert.equal(Checks.textUsesColor('👍🏽🇵🇰'), false);
  assert.equal(Checks.textUsesColor('A😀'), true);
  assert.equal(Checks.textUsesColor('  '), false);
  assert.deepEqual(ids(Checks.run(design({ text: '😀', fg: '#0b7a75', bg: '#0b7a75' }), { textHeight16: 12 })), []);
  assert.deepEqual(ids(Checks.run(design({ text: 'A😀', fg: '#0b7a75', bg: '#0b7a75' }), { textHeight16: 12 })), ['contrast']);
});

test('run: transparent background, checked against light and dark tabs', () => {
  const r = (fg, extra) => ids(Checks.run(design({ transparent: true, fg, ...extra }), { textHeight16: 9 }));
  assert.deepEqual(r('#ffffff'), ['lightTab']);
  assert.deepEqual(r('#1a1a1a'), ['darkTab']);
  assert.deepEqual(r('#e53935'), [], 'a strong color shows on both');
  assert.deepEqual(r('#1a1a1a', { dark: true, darkFg: '#ffffff' }), [], 'the dark tab uses the dark mode color');
  const w = Checks.run(design({ transparent: true, fg: '#111111' }), { textHeight16: 9 }).warnings[0];
  assert.equal(w.text, 'This icon is hard to see on dark tabs.');
  assert.equal(Checks.DARK_TAB, '#3a3a3a');
  assert.equal(Checks.LIGHT_TAB, '#ffffff');
  assert.deepEqual(r('#000000'), ['darkTab'], 'black on a dark tab is hard to see');
  assert.equal(Checks.MIN_TAB_CONTRAST, 2);
});

test('run: small text at 16 px', () => {
  assert.deepEqual(ids(Checks.run(design({}), { textHeight16: 7.9 })), ['smallText']);
  assert.deepEqual(ids(Checks.run(design({}), { textHeight16: 8 })), []);
  assert.match(Checks.run(design({}), { textHeight16: 5.25 }).warnings[0].text, /only 5\.3 px tall/);
  assert.deepEqual(ids(Checks.run(design({}), {})), [], 'no measurement, no warning');
  assert.deepEqual(ids(Checks.run(design({ mode: 'icon' }), { textHeight16: 2 })), [], 'not for icons');
});

test('run: thin icon lines at 16 px, with a suggested width', () => {
  // Default: line width 2 at 70% is 0.93 px.
  assert.ok(Math.abs(Checks.iconLinePx(design({ mode: 'icon' })) - 0.9333) < 1e-3);
  const r = Checks.run(design({ mode: 'icon', iconStroke: 1 }), {});
  assert.deepEqual(ids(r), ['thinLines']);
  assert.match(r.warnings[0].text, /only 0\.5 px wide/);
  assert.deepEqual({ ...r.warnings[0].action }, { label: 'Use line width 2', field: 'iconStroke', value: 2 });
  assert.ok(Checks.iconLinePx(design({ mode: 'icon', iconStroke: 2 })) >= Checks.MIN_LINE_PX);
  // Small icons need thicker lines; the suggestion stops at the maximum, 3.
  assert.equal(Checks.suggestedStroke(design({ mode: 'icon', iconScale: 30 })), 3);
  assert.deepEqual(ids(Checks.run(design({ mode: 'icon', iconStroke: 3, iconScale: 100 }), {})), []);
});

test('run: images are skipped', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(Checks.run(design({ mode: 'image', fg: '#ffffff', bg: '#ffffff' }), {}))), { warnings: [], skipped: 'image' });
});
