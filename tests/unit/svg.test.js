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

test('glyphBounds: exact bounds of lines and curves, y down', () => {
  const plain = (b) => b && { ...b };
  // A square from (10, 20) to (30, 50) in font units (y up): y down, top is -50.
  assert.deepEqual(plain(Svg.glyphBounds('m10 20l20 0l0 30l-20 0z')), { left: 10, top: -50, right: 30, bottom: -20 });
  // A quadratic arch from (0, 0) to (100, 0) with its control point at (50, 100) peaks at y = 50.
  assert.deepEqual(plain(Svg.glyphBounds('m0 0q50 100 100 0z')), { left: 0, top: -50, right: 100, bottom: -0 });
  // A cubic with control points (0, 100) and (100, 100) peaks at y = 75; its control points reach 100.
  assert.deepEqual(plain(Svg.glyphBounds('m0 0c0 100 100 100 100 0z')), { left: 0, top: -75, right: 100, bottom: -0 });
  // A cubic that bulges sideways past its end points: from (0, 0) to (0, 100) through x = 100 controls.
  assert.equal(Svg.glyphBounds('m0 0c100 0 100 100 0 100z').right, 75);
  assert.equal(Svg.glyphBounds(''), null);
  assert.throws(() => Svg.glyphBounds('m1 1x'), /Bad glyph data/);
});

test('glyphBounds of real glyphs lies within their control points', () => {
  const { Fonts: F } = loadScripts();
  const ctx = vm.createContext({ Fonts: F });
  const file = path.join(ROOT, 'assets', 'fonts', F.info('serif').glyphs['400']);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  const data = F.glyphs('serif', 400);
  for (const ch of 'AgQ@&Sß') {
    const g = data.glyphs[ch.codePointAt(0)];
    const b = Svg.glyphBounds(g);
    const nums = Svg.glyphPath(g, 1, 0, 0).match(/-?[\d.]+/g).map(Number);
    const ends = [];
    for (let i = 0; i + 1 < nums.length; i += 2) ends.push([nums[i], nums[i + 1]]);
    const xs = ends.map((p) => p[0]);
    const ys = ends.map((p) => p[1]);
    assert.ok(b.right - b.left > 0 && b.bottom - b.top > 0, ch);
    // A curve stays inside its control points, so the bounds do too.
    assert.ok(b.left >= Math.min(...xs) - 1e-6 && b.right <= Math.max(...xs) + 1e-6, `${ch}: within the control points`);
    assert.ok(b.top >= Math.min(...ys) - 1e-6 && b.bottom <= Math.max(...ys) + 1e-6, `${ch}: within the control points`);
  }
});

test('glyphPath rounds to 2 decimals and rejects bad data', () => {
  assert.equal(Svg.glyphPath('m1 1z', 1 / 3, 0, 0), 'M0.33 -0.33Z');
  assert.throws(() => Svg.glyphPath('m1 1x', 1, 0, 0), /Bad glyph data/);
  assert.equal(Svg.glyphPath('', 1, 0, 0), '');
});

/* ---------- Shapes and gradients ---------- */

/** Points of a path made of M, L, H, V and Z (enough for the shapes without arcs). */
function polygonPoints(d) {
  const pts = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, args] of d.matchAll(/([MLHVZ])([^MLHVZ]*)/g)) {
    const n = args.trim() ? args.trim().split(/[\s,]+/).map(Number) : [];
    if (cmd === 'M' || cmd === 'L') { [x, y] = n; pts.push([x, y]); }
    if (cmd === 'H') { x = n[0]; pts.push([x, y]); }
    if (cmd === 'V') { y = n[0]; pts.push([x, y]); }
  }
  return pts;
}

test('shapePath: square, rounded, circle', () => {
  assert.equal(Svg.shapePath('square', 512, 100), 'M0 0H512V512H0Z');
  assert.equal(Svg.shapePath('rounded', 512, 0), 'M0 0H512V512H0Z', 'no radius is a square');
  assert.equal(Svg.shapePath('rounded', 100, 20), 'M20 0H80A20 20 0 0 1 100 20V80A20 20 0 0 1 80 100H20A20 20 0 0 1 0 80V20A20 20 0 0 1 20 0Z');
  assert.equal(Svg.shapePath('rounded', 100, 999), Svg.shapePath('rounded', 100, 50), 'radius is capped at half the size');
  assert.equal(Svg.shapePath('circle', 100), 'M0 50A50 50 0 1 1 100 50A50 50 0 1 1 0 50Z');
  assert.equal(Svg.shapePath('unknown', 100, 10), 'M0 0H100V100H0Z');
});

test('shapePath: the squircle is a smooth superellipse between a circle and a square', () => {
  const pts = polygonPoints(Svg.shapePath('squircle', 512));
  assert.equal(pts.length, 192);
  const c = 256;
  for (const [x, y] of pts) {
    // On the curve |x|^5 + |y|^5 = 1 (within rounding).
    const v = Math.abs((x - c) / c) ** 5 + Math.abs((y - c) / c) ** 5;
    assert.ok(Math.abs(v - 1) < 0.02, `point ${x},${y} is on the curve (${v.toFixed(4)})`);
    assert.ok(x >= 0 && x <= 512 && y >= 0 && y <= 512);
  }
  // Touches the middle of each side, and its corner is fuller than a circle's but short of the square's.
  for (const p of [[512, 256], [256, 512], [0, 256], [256, 0]]) {
    assert.ok(pts.some(([x, y]) => Math.abs(x - p[0]) < 0.01 && Math.abs(y - p[1]) < 0.01), `touches ${p}`);
  }
  const diagonal = Math.max(...pts.map(([x, y]) => Math.hypot(x - c, y - c)));
  assert.ok(diagonal > 256 * 1.05 && diagonal < 256 * Math.SQRT2 * 0.95, `corner distance ${diagonal.toFixed(1)}`);
  // Symmetric left and right.
  for (const [x, y] of pts) assert.ok(pts.some(([a, b]) => Math.abs(a - (512 - x)) < 0.02 && Math.abs(b - y) < 0.02));
});

test('gradientLine follows CSS angles and reaches the corners', () => {
  const r = (g) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, Math.round(v * 1000) / 1000 + 0]));
  assert.deepEqual(r(Svg.gradientLine(100, 0)), { x1: 50, y1: 100, x2: 50, y2: 0 }, '0 deg goes up');
  assert.deepEqual(r(Svg.gradientLine(100, 90)), { x1: 0, y1: 50, x2: 100, y2: 50 }, '90 deg goes right');
  assert.deepEqual(r(Svg.gradientLine(100, 180)), { x1: 50, y1: 0, x2: 50, y2: 100 }, '180 deg goes down');
  assert.deepEqual(r(Svg.gradientLine(100, 270)), { x1: 100, y1: 50, x2: 0, y2: 50 });
  assert.deepEqual(r(Svg.gradientLine(100, 360)), r(Svg.gradientLine(100, 0)));
  // 45 deg: from the bottom-left corner to the top-right corner.
  assert.deepEqual(r(Svg.gradientLine(100, 45)), { x1: 0, y1: 100, x2: 100, y2: 0 });
  assert.deepEqual(r(Svg.gradientLine(100, 135)), { x1: 0, y1: 0, x2: 100, y2: 100 });
  // Any angle: the line passes through the center.
  for (const a of [10, 77, 200, 333]) {
    const g = Svg.gradientLine(64, a);
    assert.ok(Math.abs((g.x1 + g.x2) / 2 - 32) < 1e-9 && Math.abs((g.y1 + g.y2) / 2 - 32) < 1e-9);
  }
  assert.ok(Math.abs(Svg.radialRadius(100) - 70.7107) < 1e-4, 'radial reaches the corners');
});

/* ---------- The icon document ---------- */

const ROUNDED = Svg.shapePath('rounded', 512, 112.64);
const BASE = {
  size: 512, shape: ROUNDED, background: { type: 'solid', color: '#0b7a75', color2: '#073f3c', angle: 135 },
  foreground: '#ffffff', dark: null, border: null, path: 'M0 0L10 0L10 10Z'
};

test('icon: valid XML with a 512 view box, the shape and the colors', () => {
  const text = Svg.icon(BASE);
  const doc = parseXml(text);
  const root = doc.documentElement;
  assert.equal(root.localName, 'svg');
  assert.equal(root.getAttribute('xmlns'), 'http://www.w3.org/2000/svg');
  assert.equal(root.getAttribute('viewBox'), '0 0 512 512');
  assert.equal(root.getAttribute('width'), '512');
  assert.equal(root.getAttribute('height'), '512');
  assert.equal(doc.getElementsByTagName('clipPath')[0].getElementsByTagName('path')[0].getAttribute('d'), ROUNDED);
  assert.equal(Array.from(doc.getElementsByTagName('path')).find((p) => p.getAttribute('class') === 'fm-fg').getAttribute('d'), BASE.path);
  const css = doc.getElementsByTagName('style')[0].textContent;
  assert.match(css, /\.fm-bg\{fill:#0b7a75\}/);
  assert.match(css, /\.fm-fg\{fill:#ffffff\}/);
  assert.doesNotMatch(css, /@media/);
  assert.equal(doc.getElementsByTagName('linearGradient').length, 0);
});

test('icon: every shape is the clip path', () => {
  for (const shape of ['rounded', 'circle', 'squircle', 'square']) {
    const d = Svg.shapePath(shape, 512, 100);
    const doc = parseXml(Svg.icon({ ...BASE, shape: d }));
    assert.equal(doc.getElementsByTagName('clipPath')[0].getElementsByTagName('path')[0].getAttribute('d'), d, shape);
  }
});

test('icon: linear and radial gradients are real SVG gradients', () => {
  const linear = parseXml(Svg.icon({ ...BASE, background: { type: 'linear', color: '#FF0000', color2: '#0000ff', angle: 90 } }));
  const lg = linear.getElementsByTagName('linearGradient')[0];
  assert.deepEqual(['gradientUnits', 'x1', 'y1', 'x2', 'y2'].map((a) => lg.getAttribute(a)), ['userSpaceOnUse', '0', '256', '512', '256']);
  assert.equal(lg.getElementsByTagName('stop').length, 2);
  const css = linear.getElementsByTagName('style')[0].textContent;
  assert.match(css, /\.fm-s0\{stop-color:#ff0000\}\.fm-s1\{stop-color:#0000ff\}/);
  assert.equal(Array.from(linear.getElementsByTagName('rect')).find((r) => r.getAttribute('fill') === 'url(#fm-0bg)') !== undefined, true);

  const radial = parseXml(Svg.icon({ ...BASE, background: { type: 'radial', color: '#ffffff', color2: '#000000' } }));
  const rg = radial.getElementsByTagName('radialGradient')[0];
  assert.deepEqual(['cx', 'cy', 'r'].map((a) => rg.getAttribute(a)), ['256', '256', '362.04']);
});

test('icon: dark mode colors go in a prefers-color-scheme media query, gradients too', () => {
  const doc = parseXml(Svg.icon({ ...BASE, dark: { background: '#111111', background2: '#222222', foreground: '#EEEEEE' } }));
  const css = doc.getElementsByTagName('style')[0].textContent;
  assert.match(css, /@media \(prefers-color-scheme:dark\)\{\.fm-bg\{fill:#111111\}\.fm-fg\{fill:#eeeeee\}\}$/);
  const grad = parseXml(Svg.icon({ ...BASE, background: { type: 'radial', color: '#ffffff', color2: '#000000' }, dark: { background: '#111111', background2: '#222222', foreground: '#eeeeee' } }));
  assert.match(grad.getElementsByTagName('style')[0].textContent, /@media \(prefers-color-scheme:dark\)\{\.fm-s0\{stop-color:#111111\}\.fm-s1\{stop-color:#222222\}\.fm-fg\{fill:#eeeeee\}\}$/);
});

test('icon: transparent background has no background rectangle', () => {
  const doc = parseXml(Svg.icon({ ...BASE, background: null, dark: { background: '#111111', foreground: '#000000' } }));
  assert.equal(doc.getElementsByTagName('rect').length, 0);
  const css = doc.getElementsByTagName('style')[0].textContent;
  assert.doesNotMatch(css, /fm-bg|fm-s0/);
  assert.match(css, /@media \(prefers-color-scheme:dark\)\{\.fm-fg\{fill:#000000\}\}/);
});

test('icon: the border follows the shape, twice as wide with the outer half clipped', () => {
  const d = Svg.shapePath('circle', 512);
  const doc = parseXml(Svg.icon({ ...BASE, shape: d, border: { width: 20.48, color: '#ABCDEF' } }));
  const border = Array.from(doc.getElementsByTagName('path')).find((p) => p.getAttribute('stroke'));
  assert.deepEqual(['d', 'fill', 'stroke', 'stroke-width'].map((a) => border.getAttribute(a)), [d, 'none', '#abcdef', '40.96']);
  assert.equal(border.parentNode.getAttribute('clip-path'), 'url(#fm-0shape)');
  assert.equal(parseXml(Svg.icon(BASE)).getElementsByTagName('path').length, 2, 'no border path without a border');
});

test('icon: colors that are not #rrggbb never reach the style sheet', () => {
  const text = Svg.icon({ ...BASE, background: { type: 'linear', color: 'red}</style><script>alert(1)</script>', color2: 'url(x)', angle: 5 }, foreground: 'url(http://evil.test/x)', border: { width: 4, color: '"/><script>' } });
  parseXml(text);
  assert.doesNotMatch(text, /script|evil|url\(http|url\(x/);
  assert.match(text, /\.fm-s0\{stop-color:#ffffff\}/);
});

test('icon: an uploaded SVG is placed in its rectangle and clipped to its box', () => {
  const clean = sanitize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10" fill="red"><rect width="20" height="10"/></svg>');
  const doc = parseXml(Svg.icon({ ...BASE, path: undefined, image: { svg: clean, clip: { x: 51.2, y: 51.2, size: 409.6 }, x: -100, y: 51.2, w: 819.2, h: 409.6 } }));
  const nested = doc.documentElement.getElementsByTagName('svg')[0];
  assert.deepEqual(['x', 'y', 'width', 'height', 'viewBox'].map((a) => nested.getAttribute(a)), ['-100', '51.2', '819.2', '409.6', '0 0 20 10']);
  assert.equal(nested.getAttribute('fill'), 'red', 'root attributes of the upload are kept');
  assert.equal(nested.getElementsByTagName('rect').length, 1);
  assert.equal(nested.parentNode.getAttribute('clip-path'), 'url(#fm-0img)');
  const clip = Array.from(doc.getElementsByTagName('clipPath')).find((c) => c.getAttribute('id') === 'fm-0img').getElementsByTagName('rect')[0];
  assert.deepEqual(['x', 'y', 'width', 'height'].map((a) => clip.getAttribute(a)), ['51.2', '51.2', '409.6', '409.6']);
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
