'use strict';
/* js/lib/svg.js and the favicon.svg parts of js/outputs.js and the glyph data. Uses xmldom for DOMParser. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { loadScripts, ROOT } = require('../helpers/load');

const loaded = loadScripts();
const { Svg, Fonts, Outputs } = loaded;
const DOM = { DOMParser, XMLSerializer };
const sanitize = (text) => Svg.sanitize(text, DOM);

/** Parse XML strictly: throws on any error, so this also checks the output is well formed. */
function parseXml(text) {
  const errors = [];
  const doc = new DOMParser({ onError: (level, msg) => { if (level !== 'warning') errors.push(msg); } }).parseFromString(text, 'image/svg+xml');
  if (errors.length) throw new Error('Not valid XML: ' + errors.join('; '));
  return doc;
}

/* ---------- Glyph paths ---------- */

test('glyphPath turns relative font units into absolute SVG coordinates, y flipped', () => {
  assert.equal(Svg.glyphPath('m10 20l5 0q5 5 10 0z', 1, 0, 100), 'M10 80L15 80Q20 75 25 80Z');
  assert.equal(Svg.glyphPath('m100 200l0-100z', 0.5, 10, 300), 'M60 200L60 250Z');
  assert.equal(Svg.glyphPath('m0 0c10 0 20 10 20 20z', 1, 0, 0), 'M0 0C10 0 20-10 20-20Z'.replace('20-10', '20 -10').replace('20-20', '20 -20'));
});

test('glyphPath: after z, the next move starts from the start of the last contour', () => {
  // Two squares: the second "m" is relative to the first contour's start (10, 10), as in SVG.
  assert.equal(Svg.glyphPath('m10 10l10 0l0 10l-10 0zm30 0l10 0z', 1, 0, 0), 'M10 -10L20 -10L20 -20L10 -20ZM40 -10L50 -10Z');
});

test('glyphPath rounds to 2 decimals and rejects bad data', () => {
  assert.equal(Svg.glyphPath('m1 1z', 1 / 3, 0, 0), 'M0.33 -0.33Z');
  assert.throws(() => Svg.glyphPath('m1 1x', 1, 0, 0), /Bad glyph data/);
  assert.equal(Svg.glyphPath('', 1, 0, 0), '');
});

/* ---------- The icon document ---------- */

const BASE = { size: 512, radius: 112.64, background: '#0b7a75', foreground: '#ffffff', dark: null, path: 'M0 0L10 0L10 10Z' };

test('icon: valid XML with a 512 view box, the shape and the colors', () => {
  const text = Svg.icon(BASE);
  const doc = parseXml(text);
  const root = doc.documentElement;
  assert.equal(root.localName, 'svg');
  assert.equal(root.getAttribute('xmlns'), 'http://www.w3.org/2000/svg');
  assert.equal(root.getAttribute('viewBox'), '0 0 512 512');
  assert.equal(root.getAttribute('width'), '512');
  assert.equal(root.getAttribute('height'), '512');
  assert.equal(doc.getElementsByTagName('clipPath')[0].getElementsByTagName('rect')[0].getAttribute('rx'), '112.64');
  assert.equal(doc.getElementsByTagName('path')[0].getAttribute('d'), BASE.path);
  const css = doc.getElementsByTagName('style')[0].textContent;
  assert.match(css, /\.fm-bg\{fill:#0b7a75\}/);
  assert.match(css, /\.fm-fg\{fill:#ffffff\}/);
  assert.doesNotMatch(css, /@media/);
});

test('icon: dark mode colors go in a prefers-color-scheme media query', () => {
  const doc = parseXml(Svg.icon({ ...BASE, dark: { background: '#111111', foreground: '#EEEEEE' } }));
  const css = doc.getElementsByTagName('style')[0].textContent;
  assert.match(css, /@media \(prefers-color-scheme:dark\)\{\.fm-bg\{fill:#111111\}\.fm-fg\{fill:#eeeeee\}\}$/);
});

test('icon: transparent background has no background rectangle', () => {
  const doc = parseXml(Svg.icon({ ...BASE, background: null, dark: { background: '#111111', foreground: '#000000' } }));
  assert.equal(Array.from(doc.getElementsByTagName('rect')).filter((r) => r.getAttribute('class') === 'fm-bg').length, 0);
  const css = doc.getElementsByTagName('style')[0].textContent;
  assert.doesNotMatch(css, /fm-bg/);
  assert.match(css, /@media \(prefers-color-scheme:dark\)\{\.fm-fg\{fill:#000000\}\}/);
});

test('icon: no corner radius means no clip path', () => {
  const doc = parseXml(Svg.icon({ ...BASE, radius: 0 }));
  assert.equal(doc.getElementsByTagName('clipPath').length, 0);
  assert.equal(parseXml(Svg.icon({ ...BASE, radius: 9999 })).getElementsByTagName('rect')[0].getAttribute('rx'), '256');
});

test('icon: colors that are not #rrggbb never reach the style sheet', () => {
  const text = Svg.icon({ ...BASE, background: 'red}</style><script>alert(1)</script>', foreground: 'url(http://evil.test/x)' });
  parseXml(text);
  assert.doesNotMatch(text, /script|evil|url\(http/);
  assert.match(text, /\.fm-bg\{fill:#ffffff\}/);
});

test('icon: an uploaded SVG is nested with contain or cover', () => {
  const clean = sanitize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10" fill="red"><rect width="20" height="10"/></svg>');
  for (const [fit, par] of [['contain', 'xMidYMid meet'], ['cover', 'xMidYMid slice']]) {
    const doc = parseXml(Svg.icon({ ...BASE, path: undefined, image: { svg: clean, x: 51.2, y: 51.2, size: 409.6, fit } }));
    const nested = doc.documentElement.getElementsByTagName('svg')[0];
    assert.equal(nested.getAttribute('viewBox'), '0 0 20 10');
    assert.equal(nested.getAttribute('preserveAspectRatio'), par);
    assert.equal(nested.getAttribute('x'), '51.2');
    assert.equal(nested.getAttribute('width'), '409.6');
    assert.equal(nested.getAttribute('fill'), 'red', 'root attributes of the upload are kept');
    assert.equal(nested.getElementsByTagName('rect').length, 1);
  }
});

/* ---------- Sanitizer ---------- */

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">';
const SHAPE = '<rect id="keep" width="10" height="10" fill="blue"/>';

/** Everything an output may never contain. */
function assertSafe(result, label) {
  // Namespace declarations (xmlns="http://www.w3.org/...") are names, not requests, so leave them out.
  for (const text of [result.standalone, result.inner, result.rootAttrs].map((t) => t.replace(/xmlns(:\w+)?="[^"]*"/g, ''))) {
    assert.doesNotMatch(text, /<script|<foreignObject|<iframe|<embed|<object|<animate|<set\b|<feImage|<a\b|<audio|<video|<handler|<listener/i, label);
    assert.doesNotMatch(text, /\son[a-z]+\s*=/i, `${label}: event attribute`);
    assert.doesNotMatch(text, /javascript:|vbscript:|data:text|data:image\/svg/i, `${label}: script URL`);
    assert.doesNotMatch(text, /https?:|\/\/evil|evil\.test/i, `${label}: outside reference`);
    assert.doesNotMatch(text, /@import|expression\(|-moz-binding|behavior:/i, `${label}: CSS`);
    assert.doesNotMatch(text, /<\?xml-stylesheet|<!DOCTYPE|<!ENTITY/i, `${label}: declarations`);
  }
  parseXml(result.standalone);
  assert.match(result.standalone, /id="keep"/, `${label}: safe content is kept`);
}

const MALICIOUS = {
  'script element': `${SVG_OPEN}<script>alert(1)</script>${SHAPE}</svg>`,
  'script in a CDATA section': `${SVG_OPEN}<script><![CDATA[alert(1)]]></script>${SHAPE}</svg>`,
  'onload on the root': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert(1)">${SHAPE}</svg>`,
  'event attributes on shapes': `${SVG_OPEN}<rect width="1" height="1" onclick="alert(1)" onmouseover="alert(2)" ONFOCUS="x"/>${SHAPE}</svg>`,
  'foreignObject with HTML': `${SVG_OPEN}<foreignObject width="10" height="10"><body xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></body></foreignObject>${SHAPE}</svg>`,
  'javascript: link': `${SVG_OPEN}<a href="javascript:alert(1)"><rect width="5" height="5"/></a>${SHAPE}</svg>`,
  'xlink javascript link': `${SVG_OPEN}<a xlink:href="javascript:alert(1)"><text>x</text></a>${SHAPE}</svg>`,
  'external image': `${SVG_OPEN}<image href="https://evil.test/track.png" width="10" height="10"/>${SHAPE}</svg>`,
  'protocol-relative image': `${SVG_OPEN}<image xlink:href="//evil.test/x.png" width="10" height="10"/>${SHAPE}</svg>`,
  'SVG data image (can carry scripts)': `${SVG_OPEN}<image href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+"/>${SHAPE}</svg>`,
  'external use': `${SVG_OPEN}<use href="https://evil.test/sprite.svg#icon"/>${SHAPE}</svg>`,
  'external filter and fill urls': `${SVG_OPEN}<rect width="5" height="5" fill="url(https://evil.test/a.svg#g)" filter="url('http://evil.test/f')"/>${SHAPE}</svg>`,
  'style element with import and outside url': `${SVG_OPEN}<style>@import url(https://evil.test/a.css); rect { fill: url(https://evil.test/p.png) }</style>${SHAPE}</svg>`,
  'style attribute with outside url': `${SVG_OPEN}<rect width="5" height="5" style="fill:url(https://evil.test/x);stroke:red"/>${SHAPE}</svg>`,
  'CSS expression': `${SVG_OPEN}<style>rect { width: expression(alert(1)); -moz-binding: url(x.xml#b) }</style>${SHAPE}</svg>`,
  'animation that sets an href': `${SVG_OPEN}<a><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="href" values="javascript:alert(1)"/></a>${SHAPE}</svg>`,
  'feImage loading a file': `${SVG_OPEN}<filter id="f"><feImage href="https://evil.test/x.png"/></filter>${SHAPE}</svg>`,
  'iframe, embed and object': `${SVG_OPEN}<iframe xmlns="http://www.w3.org/1999/xhtml" src="https://evil.test"/><embed src="x"/><object data="x"/>${SHAPE}</svg>`,
  'xml-stylesheet instruction': `<?xml-stylesheet href="https://evil.test/a.css"?>${SVG_OPEN}${SHAPE}</svg>`,
  'handler and listener elements': `${SVG_OPEN}<handler type="text/javascript">alert(1)</handler><listener event="load" handler="#h"/>${SHAPE}</svg>`,
  'audio and video': `${SVG_OPEN}<audio src="https://evil.test/a.mp3"/><video src="https://evil.test/v.mp4"/>${SHAPE}</svg>`,
  'editor namespaces with script-like values': `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 10 10" inkscape:onload="alert(1)"><g inkscape:label="javascript:alert(1)">${SHAPE}</g></svg>`,
  'entity in a value with spaces': `${SVG_OPEN}<a href=" java&#x09;script:alert(1)"><rect width="1" height="1"/></a>${SHAPE}</svg>`
};

for (const [label, text] of Object.entries(MALICIOUS)) {
  test(`sanitize removes: ${label}`, () => assertSafe(sanitize(text), label));
}

test('sanitize refuses entity declarations (billion laughs, outside entities)', () => {
  const laughs = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "lol"><!ENTITY b "&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg">&b;</svg>';
  assert.throws(() => sanitize(laughs), /entity declarations/);
  const external = '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>';
  assert.throws(() => sanitize(external), /entity declarations/);
});

test('sanitize refuses files that are not SVG', () => {
  assert.throws(() => sanitize('<html><body>hi</body></html>'), /could not be read/);
  assert.throws(() => sanitize('<svg>no namespace</svg>'), /could not be read/);
  assert.throws(() => sanitize('not xml at all <'), /could not be read/);
  assert.throws(() => sanitize(''), /could not be read/);
});

test('sanitize keeps safe drawing: gradients, local references, text and data images', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const text = `${SVG_OPEN}<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient>
    <clipPath id="c"><circle cx="5" cy="5" r="5"/></clipPath><path id="p" d="M0 0L10 10"/></defs>
    <style>.a { fill: url(#g) }</style>
    <rect class="a" width="10" height="10" fill="url(#g)" clip-path="url(#c)" style="stroke:url(#g)"/>
    <use href="#p"/><use xlink:href="#p"/><text x="1" y="9">Hi</text><image href="${png}" width="2" height="2"/>${SHAPE}</svg>`;
  const r = sanitize(text);
  assertSafe(r, 'safe file');
  for (const kept of ['linearGradient', 'clipPath', 'fill="url(#g)"', 'clip-path="url(#c)"', 'href="#p"', '>Hi</text>', png, 'stroke:url(#g)', '.a { fill: url(#g) }']) {
    assert.ok(r.standalone.includes(kept), `kept ${kept}`);
  }
});

test('sanitize sets the view box and size from viewBox, or from width and height', () => {
  const a = sanitize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 300 150" width="50%" preserveAspectRatio="none"><g/></svg>');
  assert.deepEqual(Array.from(a.viewBox), [10, 20, 300, 150]);
  const root = parseXml(a.standalone).documentElement;
  assert.equal(root.getAttribute('width'), '300');
  assert.equal(root.getAttribute('height'), '150');
  assert.equal(root.hasAttribute('preserveAspectRatio'), false, 'the upload cannot stretch itself');
  assert.deepEqual(Array.from(sanitize('<svg xmlns="http://www.w3.org/2000/svg" width="64px" height="32"/>').viewBox), [0, 0, 64, 32]);
  assert.deepEqual(Array.from(sanitize('<svg xmlns="http://www.w3.org/2000/svg"/>').viewBox), [0, 0, 512, 512]);
});

test('cleanCss', () => {
  assert.equal(Svg.cleanCss('a{fill:red}'), 'a{fill:red}');
  assert.equal(Svg.cleanCss('@import "x.css"; a{fill:red}').trim(), 'a{fill:red}');
  assert.equal(Svg.cleanCss('a{fill:url(http://x/y)}'), 'a{fill:none}');
  assert.equal(Svg.cleanCss('a{fill:url(#g)}'), 'a{fill:url(#g)}');
  assert.equal(Svg.cleanCss('a{x:expression(1)}'), '');
});

/* ---------- Glyph data ---------- */

test('glyph outlines exist for every bundled font, weight and character', () => {
  const context = loaded.context;
  for (const k of Array.from(Fonts.keys())) {
    const info = Fonts.info(k);
    assert.deepEqual(Object.keys(info.glyphs).map(Number).sort(), [...info.weights].sort(), `${k}: a file per weight`);
    for (const w of info.weights) {
      const file = path.join(ROOT, 'assets', 'fonts', info.glyphs[String(w)]);
      vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
      const data = Fonts.glyphs(k, w);
      assert.ok(data && data.upm > 0, `${k} ${w} registered`);
      const ranges = Fonts.parseRanges(info.ranges);
      let count = 0;
      for (const [a, b] of ranges) {
        for (let cp = a; cp <= b; cp++) {
          assert.equal(typeof data.glyphs[cp], 'string', `${k} ${w} has U+${cp.toString(16)}`);
          count++;
        }
      }
      assert.equal(Object.keys(data.glyphs).length, count, `${k} ${w}: nothing extra`);
      for (const ch of 'AZaz09&ÉßŁ€') {
        const d = Svg.glyphPath(data.glyphs[ch.codePointAt(0)], 0.1, 0, 0);
        assert.match(d, /^M.*Z$/, `${k} ${w} ${ch} has an outline`);
      }
      assert.equal(data.glyphs[32], '', 'space has no outline');
      // Every outline parses.
      for (const g of Object.values(data.glyphs)) Svg.glyphPath(g, 1, 0, 0);
    }
  }
});

/* ---------- Outputs ---------- */

const SETTINGS = { mode: 'text', text: 'Ag', font: 'sans', bold: true, basePath: '/', image: null };

test('favicon.svg is in the file list', () => {
  const svg = Array.from(Outputs.FILES).find((f) => f.name === 'favicon.svg');
  assert.equal(svg.kind, 'svg');
  assert.equal(svg.dims, 'Vector');
});

test('svgStatus: text in the font works; emoji and other scripts say why not', () => {
  const status = (over) => ({ ...Outputs.svgStatus({ ...SETTINGS, ...over }) });
  assert.deepEqual(status({}), { ok: true });
  assert.deepEqual(status({ text: '' }), { ok: true });
  assert.deepEqual(status({ text: 'É€©' }), { ok: true });
  assert.deepEqual(status({ text: 'é' }), { ok: true }, 'combining accent becomes one letter');
  for (const text of ['😀', 'A👍🏽', '🇵🇰', '❤️', '1️⃣']) {
    assert.deepEqual(status({ text }), { ok: false, reason: "SVG isn't available for emoji, so browsers use the PNG files." }, text);
  }
  for (const text of ['سلا', '中', 'Aन']) {
    assert.deepEqual(status({ text }), { ok: false, reason: "SVG isn't available for characters outside the chosen font, so browsers use the PNG files." }, text);
  }
  assert.deepEqual(status({ mode: 'image', image: null }), { ok: false, reason: 'Choose an image first.' });
  assert.deepEqual(status({ mode: 'image', image: {}, imageSvg: null }), { ok: false, reason: "SVG isn't available for PNG, JPG or WebP images, so browsers use the PNG files." });
  assert.deepEqual(status({ mode: 'image', image: {}, imageSvg: {} }), { ok: true });
  const file = Array.from(Outputs.FILES).find((f) => f.name === 'favicon.svg');
  assert.equal(Outputs.available(file, { ...SETTINGS, text: '😀' }), false);
  assert.equal(Outputs.available(Outputs.FILES[0], { ...SETTINGS, text: '😀' }), true, 'other files are always made');
});

test('snippet: with favicon.svg, the ICO is 32x32 and the SVG "any"; without it, the ICO lists every size', () => {
  const withSvg = Outputs.snippet(SETTINGS).split('\n');
  assert.deepEqual(withSvg.slice(0, 2), [
    '<link rel="icon" href="/favicon.ico" sizes="32x32">',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml" sizes="any">'
  ]);
  const without = Outputs.snippet({ ...SETTINGS, text: '😀' });
  assert.doesNotMatch(without, /favicon\.svg/);
  assert.match(without, /href="\/favicon\.ico" sizes="16x16 32x32 48x48"/);
  assert.match(Outputs.snippet({ ...SETTINGS, basePath: 'repo' }), /href="\/repo\/favicon\.svg"/);
});
