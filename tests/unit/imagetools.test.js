'use strict';
/* js/imagetools.js: what pastes and drops hold. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('../helpers/load');

const { ImageTools } = loadScripts();
const kind = (parts) => ImageTools.classify(parts).kind;
const file = (type, name) => ({ type, name: name || 'x' });

test('an image file wins over any text', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']) {
    const r = ImageTools.classify({ files: [file(type)], text: 'https://example.com/a.png' });
    assert.equal(r.kind, 'file', type);
    assert.equal(r.file.type, type);
  }
  assert.equal(kind({ files: [file('', 'logo.svg')] }), 'file', 'an SVG named .svg without a type');
  assert.equal(kind({ files: [file('application/pdf', 'a.pdf')] }), 'none');
  assert.equal(kind({ files: [file('text/plain', 'a.txt'), file('image/png')] }), 'file', 'the first image among other files');
});

test('SVG code pasted as text', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
  for (const text of [svg, '  \n' + svg + '\n', '<?xml version="1.0"?>\n' + svg, '<!-- made by hand -->' + svg,
    '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">' + svg, '﻿' + svg]) {
    const r = ImageTools.classify({ text });
    assert.equal(r.kind, 'svg', JSON.stringify(text.slice(0, 30)));
    assert.equal(r.text, text.trim());
  }
  for (const text of ['<svg', 'hello <svg></svg>', '<div><svg></svg></div>', '<svgfoo></svgfoo>', '']) {
    assert.notEqual(kind({ text }), 'svg', text);
  }
});

test('only a link: explained, never downloaded', () => {
  const cases = [
    { text: 'https://example.com/logo.png' },
    { text: 'http://example.com/a.svg\n' },
    { uriList: 'https://example.com/logo.png' },
    { text: '//cdn.example.com/a.png' },
    { text: 'data:image/png;base64,AAAA' },
    { html: '<meta charset="utf-8"><img src="https://example.com/logo.png" alt="">' },
    { text: 'https://a.example/1.png\nhttps://a.example/2.png' }
  ];
  for (const parts of cases) {
    const r = ImageTools.classify(parts);
    assert.equal(r.kind, 'address', JSON.stringify(parts));
    assert.equal(r.message, 'Save the image first, then drop or paste it here.');
  }
});

test('ordinary text is left alone', () => {
  for (const text of ['hello', 'my logo https://example.com', 'Café ☕', '   ']) {
    assert.equal(kind({ text }), 'none', text);
  }
  assert.equal(kind({}), 'none');
  assert.equal(kind({ html: '<p>text only</p>' }), 'none');
});
