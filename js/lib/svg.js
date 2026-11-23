/* SVG favicon pieces: glyph outlines to paths, the icon document, and a sanitizer for uploaded SVGs.
   Pure string and DOM work with no page state. sanitize() needs DOMParser and XMLSerializer, which every
   browser has (tests pass them in). No dependencies. */
const Svg = (() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  const XML_NS = 'http://www.w3.org/XML/1998/namespace';

  /** A number for SVG: at most 2 decimals, no trailing zeros. */
  function num(n) {
    const r = Math.round(n * 100) / 100;
    return String(Object.is(r, -0) ? 0 : r);
  }

  /** Only #rrggbb colors go into the SVG's style sheet, so a setting can never inject CSS. */
  function color(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toLowerCase() : fallback;
  }

  function escapeAttr(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------- Glyph outlines ---------- */

  /**
   * Turn a compact glyph outline (relative whole numbers in font units, y up, as written by
   * tools/build-fonts.py) into an absolute SVG path: scaled by `scale`, y flipped, starting at (ox, oy).
   */
  function glyphPath(encoded, scale, ox, oy) {
    const source = String(encoded);
    if (!/^(?:[mlqcz]|-?\d+|\s)*$/.test(source)) throw new Error('Bad glyph data: ' + source.slice(0, 20));
    const tokens = source.match(/[mlqcz]|-?\d+/g) || [];
    const out = [];
    let x = 0;
    let y = 0;
    let startX = 0;
    let startY = 0;
    let i = 0;
    const pt = (dx, dy) => [x + dx, y + dy];
    const fmt = (px, py) => num(ox + px * scale) + ' ' + num(oy - py * scale);
    while (i < tokens.length) {
      const cmd = tokens[i++];
      const take = (n) => tokens.slice(i, (i += n)).map(Number);
      if (cmd === 'm' || cmd === 'l') {
        const [dx, dy] = take(2);
        [x, y] = pt(dx, dy);
        if (cmd === 'm') { startX = x; startY = y; }
        out.push(cmd.toUpperCase() + fmt(x, y));
      } else if (cmd === 'q') {
        const [ax, ay, bx, by] = take(4);
        const c = pt(ax, ay);
        [x, y] = pt(bx, by);
        out.push('Q' + fmt(c[0], c[1]) + ' ' + fmt(x, y));
      } else if (cmd === 'c') {
        const [ax, ay, bx, by, cx, cy] = take(6);
        const c1 = pt(ax, ay);
        const c2 = pt(bx, by);
        [x, y] = pt(cx, cy);
        out.push('C' + fmt(c1[0], c1[1]) + ' ' + fmt(c2[0], c2[1]) + ' ' + fmt(x, y));
      } else if (cmd === 'z') {
        out.push('Z');
        x = startX;
        y = startY;
      } else {
        throw new Error('Bad glyph data: ' + cmd);
      }
    }
    return out.join('');
  }

  /* ---------- Shapes and gradients ---------- */

  const SHAPES = ['rounded', 'circle', 'squircle', 'square'];
  /** Exponent of the squircle: |x|^n + |y|^n = 1. 5 is a smooth, rounded-square look. */
  const SQUIRCLE_N = 5;
  const SQUIRCLE_STEPS = 192;

  /**
   * The icon's outline as SVG path data, in a square of `size`. Both the canvas (through Path2D) and
   * favicon.svg draw this same path, so their shapes match exactly. `radius` is for the rounded square.
   */
  function shapePath(shape, size, radius) {
    const s = size;
    const c = s / 2;
    if (shape === 'circle') {
      return 'M0 ' + num(c) + 'A' + num(c) + ' ' + num(c) + ' 0 1 1 ' + num(s) + ' ' + num(c) +
        'A' + num(c) + ' ' + num(c) + ' 0 1 1 0 ' + num(c) + 'Z';
    }
    if (shape === 'squircle') {
      const pts = [];
      for (let i = 0; i < SQUIRCLE_STEPS; i++) {
        const t = (i / SQUIRCLE_STEPS) * Math.PI * 2;
        const cos = Math.cos(t);
        const sin = Math.sin(t);
        const x = c + c * Math.sign(cos) * Math.pow(Math.abs(cos), 2 / SQUIRCLE_N);
        const y = c + c * Math.sign(sin) * Math.pow(Math.abs(sin), 2 / SQUIRCLE_N);
        pts.push(num(x) + ' ' + num(y));
      }
      return 'M' + pts.join('L') + 'Z';
    }
    const r = shape === 'rounded' ? Math.min(Math.max(radius || 0, 0), c) : 0;
    if (r <= 0) return 'M0 0H' + num(s) + 'V' + num(s) + 'H0Z';
    const R = num(r);
    const arc = 'A' + R + ' ' + R + ' 0 0 1 ';
    return 'M' + R + ' 0H' + num(s - r) + arc + num(s) + ' ' + R + 'V' + num(s - r) + arc + num(s - r) + ' ' + num(s) +
      'H' + R + arc + '0 ' + num(s - r) + 'V' + R + arc + R + ' 0Z';
  }

  /**
   * Where a linear gradient runs across a square of `size`, for an angle in degrees as in CSS:
   * 0 goes up, 90 to the right, 180 down. The line is long enough that the colors reach the corners.
   */
  function gradientLine(size, angle) {
    const a = ((Number(angle) % 360) + 360) % 360 * (Math.PI / 180);
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const half = (size / 2) * (Math.abs(dx) + Math.abs(dy));
    const c = size / 2;
    return { x1: c - dx * half, y1: c - dy * half, x2: c + dx * half, y2: c + dy * half };
  }

  /** Radius of a radial gradient from the center to the corners. */
  const radialRadius = (size) => size / Math.SQRT2;

  /* ---------- The icon document ---------- */

  /**
   * Build favicon.svg.
   * @param {object} o
   * @param {number} o.size              view box size (the icon is square)
   * @param {string} o.shape             outline, from shapePath()
   * @param {object|null} o.background   null for transparent, or { type: 'solid'|'linear'|'radial', color, color2, angle }
   * @param {string} o.foreground        #rrggbb for the text
   * @param {object|null} o.dark         { background, background2, foreground } colors for dark mode, or null
   * @param {object|null} o.border       { width, color } in view box units, or null
   * @param {string} [o.path]            text outlines, as one path
   * @param {object} [o.image]           { svg: sanitize() result, clip: { x, y, size }, x, y, w, h } for an uploaded
   *                                     SVG: drawn in the rectangle (x, y, w, h), clipped to the square box
   * @param {object} [o.icon]            { d, x, y, k, stroke } for a library icon: a path on its own grid,
   *                                     placed at (x, y), scaled by k, stroked with round ends
   */
  function icon(o) {
    const size = o.size;
    const s = num(size);
    const shape = o.shape || shapePath('square', size, 0);
    const bg = o.background;
    const c1 = bg ? color(bg.color, '#ffffff') : null;
    const c2 = bg ? color(bg.color2, c1) : null;
    const gradient = bg && (bg.type === 'linear' || bg.type === 'radial');
    const fg = color(o.foreground, '#000000');

    // Colors go in a style sheet, so dark mode can switch them.
    const rules = [];
    const paint = (colors) => {
      const out = [];
      if (bg && !gradient) out.push('.fm-bg{fill:' + colors.c1 + '}');
      if (gradient) out.push('.fm-s0{stop-color:' + colors.c1 + '}.fm-s1{stop-color:' + colors.c2 + '}');
      if (o.path) out.push('.fm-fg{fill:' + colors.fg + '}');
      if (o.icon) out.push('.fm-icon{stroke:' + colors.fg + '}');
      return out.join('');
    };
    const light = paint({ c1, c2, fg });
    if (light) rules.push(light);
    if (o.dark) {
      const dark = paint({
        c1: color(o.dark.background, c1), c2: color(o.dark.background2, c2), fg: color(o.dark.foreground, fg)
      });
      if (dark) rules.push('@media (prefers-color-scheme:dark){' + dark + '}');
    }

    const parts = [
      '<svg xmlns="' + SVG_NS + '" xmlns:xlink="' + XLINK_NS + '" viewBox="0 0 ' + s + ' ' + s + '" width="' + s + '" height="' + s + '">'
    ];
    if (rules.length) parts.push('<style>' + rules.join('') + '</style>');
    const defs = ['<clipPath id="fm-0shape"><path d="' + shape + '"/></clipPath>'];
    const stops = '<stop offset="0" class="fm-s0"/><stop offset="1" class="fm-s1"/>';
    if (gradient && bg.type === 'linear') {
      const g = gradientLine(size, bg.angle);
      defs.push('<linearGradient id="fm-0bg" gradientUnits="userSpaceOnUse" x1="' + num(g.x1) + '" y1="' + num(g.y1) +
        '" x2="' + num(g.x2) + '" y2="' + num(g.y2) + '">' + stops + '</linearGradient>');
    } else if (gradient) {
      defs.push('<radialGradient id="fm-0bg" gradientUnits="userSpaceOnUse" cx="' + num(size / 2) + '" cy="' + num(size / 2) +
        '" r="' + num(radialRadius(size)) + '">' + stops + '</radialGradient>');
    }
    parts.push('<defs>' + defs.join('') + '</defs>');
    parts.push('<g clip-path="url(#fm-0shape)">');
    if (bg) {
      parts.push(gradient
        ? '<rect width="' + s + '" height="' + s + '" fill="url(#fm-0bg)"/>'
        : '<rect class="fm-bg" width="' + s + '" height="' + s + '"/>');
    }
    if (o.path) parts.push('<path class="fm-fg" d="' + o.path + '"/>');
    if (o.icon) {
      const ic = o.icon;
      // The icon path comes from the bundled set; only its own characters are allowed through.
      const d = String(ic.d).replace(/[^MmLlHhVvCcSsQqTtAaZz0-9.,\s-]/g, '');
      parts.push('<path class="fm-icon" d="' + d + '" transform="translate(' + num(ic.x) + ' ' + num(ic.y) + ') scale(' + Number(ic.k).toFixed(4).replace(/\.?0+$/, '') +
        ')" fill="none" stroke-width="' + num(ic.stroke) + '" stroke-linecap="round" stroke-linejoin="round"/>');
    }
    if (o.image) {
      const im = o.image;
      const vb = im.svg.viewBox.map(num).join(' ');
      const c = im.clip;
      // The image keeps its own proportions in its rectangle, and only its part inside the box shows.
      parts.push('<clipPath id="fm-0img"><rect x="' + num(c.x) + '" y="' + num(c.y) + '" width="' + num(c.size) + '" height="' + num(c.size) + '"/></clipPath>');
      parts.push('<g clip-path="url(#fm-0img)"><svg x="' + num(im.x) + '" y="' + num(im.y) + '" width="' + num(im.w) + '" height="' + num(im.h) +
        '" viewBox="' + vb + '" preserveAspectRatio="xMidYMid meet" overflow="hidden"' + im.svg.rootAttrs + '>' + im.svg.inner + '</svg></g>');
    }
    // The border follows the shape inside its edge: a stroke twice as wide, half of it clipped away.
    if (o.border) {
      parts.push('<path d="' + shape + '" fill="none" stroke="' + color(o.border.color, '#ffffff') + '" stroke-width="' + num(o.border.width * 2) + '"/>');
    }
    parts.push('</g></svg>');
    return parts.join('') + '\n';
  }

  /* ---------- Sanitizing uploaded SVGs ---------- */

  // Elements that only draw. Everything else (script, foreignObject, iframe, animate, set, feImage, a,
  // metadata, editor elements...) is removed with all its content.
  const ELEMENTS = new Set(['svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line',
    'polyline', 'polygon', 'text', 'tspan', 'textPath', 'linearGradient', 'radialGradient', 'stop', 'pattern',
    'clipPath', 'mask', 'marker', 'title', 'desc', 'style', 'image', 'filter', 'feBlend', 'feColorMatrix',
    'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap',
    'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur',
    'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight',
    'feTile', 'feTurbulence']);

  // Raster images may stay only as data inside the file.
  const SAFE_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]*$/i;

  /** True when every url(...) in the value points inside the document (#id). */
  function urlsAreLocal(value) {
    const re = /url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
    let m;
    while ((m = re.exec(value))) if (!/^\s*#/.test(m[2])) return false;
    return !/url\s*\(\s*$/i.test(value);
  }

  /** CSS without imports, outside urls or script-like features. Returns '' if anything can't be made safe. */
  function cleanCss(css) {
    let out = String(css)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@import[^;]*;?/gi, '')
      .replace(/@namespace[^;]*;?/gi, '')
      .replace(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (whole, q, target) => (/^\s*#/.test(target) ? whole : 'none'));
    if (/expression\s*\(|-moz-binding|behavior\s*:|javascript:|@import|url\s*\(/i.test(out.replace(/url\s*\(\s*(['"]?)\s*#[^)]*\)/gi, ''))) out = '';
    return out;
  }

  /** Keep an attribute? Returns the (maybe cleaned) value, or null to remove it. */
  function cleanAttribute(el, attr) {
    const name = attr.name;
    const local = attr.localName || name;
    const value = attr.value;
    const ns = attr.namespaceURI;
    if (ns && ns !== XLINK_NS && ns !== XML_NS) return null; // editor attributes like inkscape:label
    if (/^on/i.test(local)) return null;
    if (/^xmlns/i.test(name)) return null; // written again by the serializer
    if (/javascript:|vbscript:|data:text|data:application/i.test(value.replace(/\s+/g, ''))) return null;
    if (local === 'href') {
      if (/^\s*#/.test(value)) return value;
      if (el.localName === 'image' && SAFE_IMAGE.test(value)) return value;
      return null;
    }
    if (local === 'style') {
      const css = cleanCss(value);
      return css.trim() ? css : null;
    }
    if (/url\s*\(/i.test(value) && !urlsAreLocal(value)) return null;
    return value;
  }

  function cleanNode(node) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 1) {
        const ok = child.namespaceURI === SVG_NS && ELEMENTS.has(child.localName);
        if (!ok) {
          node.removeChild(child);
          continue;
        }
        if (child.localName === 'image') {
          const href = child.getAttribute('href') || child.getAttributeNS(XLINK_NS, 'href') || '';
          if (!SAFE_IMAGE.test(href)) {
            node.removeChild(child);
            continue;
          }
        }
        for (const attr of Array.from(child.attributes)) {
          const kept = cleanAttribute(child, attr);
          if (kept === null) child.removeAttributeNode(attr);
          else if (kept !== attr.value) attr.value = kept;
        }
        if (child.localName === 'style') {
          child.textContent = cleanCss(child.textContent);
          continue;
        }
        cleanNode(child);
      } else if (child.nodeType === 3 || child.nodeType === 4) {
        // Text and CDATA: fine (text content, style rules handled above).
      } else {
        // Comments, processing instructions such as <?xml-stylesheet?>, and anything else.
        node.removeChild(child);
      }
    }
  }

  function parseLength(value) {
    const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(value || '');
    return m ? parseFloat(m[1]) : null;
  }

  /**
   * Clean an uploaded SVG so it can't run code or load anything from outside: scripts, event attributes,
   * <foreignObject>, outside links and references, animations and style imports are removed.
   * Returns { standalone, inner, rootAttrs, viewBox }: a complete SVG with its own width and height (for
   * drawing it), its content and root attributes (for nesting it in favicon.svg), and its view box.
   * Throws when the file isn't a readable SVG.
   */
  function sanitize(text, dom) {
    const Parser = (dom && dom.DOMParser) || (typeof DOMParser !== 'undefined' ? DOMParser : null);
    const Serializer = (dom && dom.XMLSerializer) || (typeof XMLSerializer !== 'undefined' ? XMLSerializer : null);
    const source = String(text);
    // Entity declarations can expand without limit or point outside: refuse them.
    if (/<!ENTITY/i.test(source)) throw new Error('This SVG uses entity declarations, which are not allowed');
    // Browsers only draw an SVG that declares the SVG namespace; some parsers would assume it.
    if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(source)) throw new Error('This SVG could not be read');
    let doc;
    try {
      doc = new Parser().parseFromString(source, 'image/svg+xml');
    } catch (e) {
      throw new Error('This SVG could not be read');
    }
    const root = doc && doc.documentElement;
    if (!root || root.localName !== 'svg' || root.namespaceURI !== SVG_NS || doc.getElementsByTagName('parsererror').length) {
      throw new Error('This SVG could not be read');
    }

    // The view box: from viewBox, or from width and height, or a square.
    let viewBox = null;
    const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) viewBox = vb;
    if (!viewBox) {
      const w = parseLength(root.getAttribute('width'));
      const h = parseLength(root.getAttribute('height'));
      viewBox = w && h ? [0, 0, w, h] : [0, 0, 512, 512];
    }

    // Clean the root's own attributes, then everything inside.
    for (const attr of Array.from(root.attributes)) {
      const kept = cleanAttribute(root, attr);
      if (kept === null) root.removeAttributeNode(attr);
      else if (kept !== attr.value) attr.value = kept;
    }
    cleanNode(root);
    for (const child of Array.from(doc.childNodes)) if (child !== root) doc.removeChild(child);

    // Attributes that place the root are set by us; the rest (fill, stroke, style...) are kept for nesting.
    const placing = new Set(['x', 'y', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'version', 'baseProfile', 'overflow']);
    let rootAttrs = '';
    for (const attr of Array.from(root.attributes)) {
      if (placing.has(attr.name) || attr.namespaceURI) continue;
      rootAttrs += ' ' + attr.name + '="' + escapeAttr(attr.value) + '"';
    }
    const serializer = new Serializer();
    const inner = Array.from(root.childNodes).map((n) => serializer.serializeToString(n)).join('');

    for (const name of placing) root.removeAttribute(name);
    root.setAttribute('viewBox', viewBox.map(num).join(' '));
    root.setAttribute('width', num(viewBox[2]));
    root.setAttribute('height', num(viewBox[3]));
    const standalone = serializer.serializeToString(root);
    return { standalone, inner, rootAttrs, viewBox };
  }

  return { glyphPath, icon, sanitize, cleanCss, num, color, shapePath, gradientLine, radialRadius, SHAPES };
})();
