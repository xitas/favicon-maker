'use strict';
/* Visible-character helpers in js/outputs.js: graphemes, clip and limitEdit, with and without Intl.Segmenter. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('../helpers/load');

const withSegmenter = loadScripts().Outputs;
const withoutSegmenter = loadScripts({ withoutSegmenter: true }).Outputs;

const plain = (arr) => Array.from(arr); // copy out of the vm realm for deepStrictEqual

// Each case: text and the visible characters it is made of.
const CASES = {
  'plain letters': ['ABC', ['A', 'B', 'C']],
  'family emoji (ZWJ sequence)': ['👨‍👩‍👧', ['👨‍👩‍👧']],
  'two flags': ['🇵🇰🇵🇰', ['🇵🇰', '🇵🇰']],
  'three flags': ['🇵🇰🇺🇸🇯🇵', ['🇵🇰', '🇺🇸', '🇯🇵']],
  'letters then a skin tone emoji': ['AB👍🏽', ['A', 'B', '👍🏽']],
  'precomposed accents': ['éèñ', ['é', 'è', 'ñ']],
  'combining accents': ['éèñ', ['é', 'è', 'ñ']],
  'letter with two combining marks': ['á̧b', ['á̧', 'b']],
  'emoji with variation selector': ['❤️A', ['❤️', 'A']],
  'keycap': ['1️⃣#', ['1️⃣', '#']],
  'rainbow flag (ZWJ + variation selector)': ['🏳️‍🌈X', ['🏳️‍🌈', 'X']],
  'subdivision flag (tag characters)': ['🏴󠁧󠁢󠁳󠁣󠁴󠁿Z', ['🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'Z']],
  'skin tone in a ZWJ sequence': ['👩🏽‍💻!', ['👩🏽‍💻', '!']],
  'empty string': ['', []]
};

for (const [label, Outputs] of [['Intl.Segmenter', withSegmenter], ['fallback without Intl.Segmenter', withoutSegmenter]]) {
  test(`graphemes with ${label}`, async (t) => {
    for (const [name, [text, expected]] of Object.entries(CASES)) {
      await t.test(name, () => assert.deepEqual(plain(Outputs.graphemes(text)), expected));
    }
  });

  test(`clip never splits a character (${label})`, async (t) => {
    const cases = [
      ['👨‍👩‍👧', 3, '👨‍👩‍👧'],
      ['👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧', 3, '👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧'],
      ['🇵🇰🇵🇰', 1, '🇵🇰'],
      ['🇵🇰🇵🇰🇵🇰🇵🇰', 3, '🇵🇰🇵🇰🇵🇰'],
      ['AB👍🏽', 3, 'AB👍🏽'],
      ['AB👍🏽C', 3, 'AB👍🏽'],
      ['Aéio', 3, 'Aéi'],
      ['Aéio', 3, 'Aéi'],
      ['Hello', 3, 'Hel']
    ];
    for (const [text, max, expected] of cases) {
      await t.test(`${JSON.stringify(text)} to ${max}`, () => assert.equal(Outputs.clip(text, max), expected));
    }
  });
}

test('the fallback is actually used when Intl.Segmenter is missing', () => {
  // Intl.Segmenter splits Hangul syllables built from jamo into one character; the simple fallback does not.
  const jamo = '가';
  assert.equal(withSegmenter.graphemes(jamo).length, 1);
  assert.equal(withoutSegmenter.graphemes(jamo).length, 2);
});

test('the text limit is 3 visible characters', () => {
  assert.equal(withSegmenter.TEXT_MAX, 3);
  assert.equal(withSegmenter.SHORT_NAME_MAX, 12);
});

test('limitEdit', async (t) => {
  const { limitEdit } = withSegmenter;
  const run = (prev, start, end, next) => ({ ...limitEdit(prev, start, end, next, 3) });

  await t.test('leaves edits within the limit alone', () => {
    assert.deepEqual(run('AB', 2, 2, 'ABC'), { value: 'ABC', caret: -1, over: false });
    assert.deepEqual(run('ABC', 1, 2, 'AXC'), { value: 'AXC', caret: -1, over: false });
  });

  await t.test('refuses typing into a full box, keeping the caret where it was', () => {
    assert.deepEqual(run('ABC', 3, 3, 'ABCD'), { value: 'ABC', caret: 3, over: true });
    assert.deepEqual(run('ABC', 1, 1, 'AXBC'), { value: 'ABC', caret: 1, over: true });
  });

  await t.test('keeps as much of a paste as fits', () => {
    assert.deepEqual(run('', 0, 0, 'Hello'), { value: 'Hel', caret: 3, over: true });
    assert.deepEqual(run('A', 1, 1, 'AXYZ'), { value: 'AXY', caret: 3, over: true });
    assert.deepEqual(run('AC', 1, 1, 'AXYZC'), { value: 'AXC', caret: 2, over: true });
  });

  await t.test('replacing a selection with a long paste keeps the start of the paste', () => {
    assert.deepEqual(run('ABC', 0, 3, 'Hello'), { value: 'Hel', caret: 3, over: true });
  });

  await t.test('never splits an emoji that does not fit', () => {
    assert.deepEqual(run('AB', 2, 2, 'AB👨‍👩‍👧👍🏽'), { value: 'AB👨‍👩‍👧', caret: 2 + '👨‍👩‍👧'.length, over: true });
    assert.deepEqual(run('AB', 2, 2, 'AB🇵🇰🇵🇰'), { value: 'AB🇵🇰', caret: 6, over: true });
  });

  await t.test('a skin tone added to a full box joins the last character', () => {
    assert.deepEqual(run('AB👍', 4, 4, 'AB👍🏽'), { value: 'AB👍🏽', caret: -1, over: false });
  });

  await t.test('falls back to clipping when the edit cannot be located', () => {
    assert.deepEqual(run('ABC', 0, 0, 'WXYZ'), { value: 'WXY', caret: 3, over: true });
  });
});
