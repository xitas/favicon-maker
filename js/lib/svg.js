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

  /* ---------- The icon document ---------- */

  /**
   * Build favicon.svg.
   * @param {object} o
   * @param {number} o.size          view box size (the icon is square)
   * @param {number} o.radius        corner radius in view box units
   * @param {string|null} o.background   #rrggbb, or null for transparent
   * @param {string} o.foreground    #rrggbb for text
   * @param {{background: string, foreground: string}|null} o.dark   colors for dark mode, or null
   * @param {string} [o.path]        text outlines, as one path
   * @param {object} [o.image]       { svg: sanitize() result, x, y, size, fit } for an uploaded SVG
   */
  function icon(o) {
    const size = o.size;
    const r = Math.min(Math.max(o.radius || 0, 0), size / 2);
    const bg = o.background ? color(o.background, '#ffffff') : null;
    const fg = color(o.foreground, '#000000');
    const rules = [];
    if (bg) rules.push('.fm-bg{fill:' + bg + '}');
    if (o.path) rules.push('.fm-fg{fill:' + fg + '}');
    if (o.dark) {
      const dark = [];
      if (bg) dark.push('.fm-bg{fill:' + color(o.dark.background, bg) + '}');
      if (o.path) dark.push('.fm-fg{fill:' + color(o.dark.foreground, fg) + '}');
      if (dark.length) rules.push('@media (prefers-color-scheme:dark){' + dark.join('') + '}');
    }

    const s = num(size);
    const parts = [
      '<svg xmlns="' + SVG_NS + '" xmlns:xlink="' + XLINK_NS + '" viewBox="0 0 ' + s + ' ' + s + '" width="' + s + '" height="' + s + '">'
    ];
    if (rules.length) parts.push('<style>' + rules.join('') + '</style>');
    if (r > 0) {
      parts.push('<defs><clipPath id="fm-0shape"><rect width="' + s + '" height="' + s + '" rx="' + num(r) + '"/></clipPath></defs>');
      parts.push('<g clip-path="url(#fm-0shape)">');
    } else {
      parts.push('<g>');
    }
    if (bg) parts.push('<rect class="fm-bg" width="' + s + '" height="' + s + '"/>');
    if (o.path) parts.push('<path class="fm-fg" d="' + o.path + '"/>');
    if (o.image) {
      const im = o.image;
      const vb = im.svg.viewBox.map(num).join(' ');
      const fit = im.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
      parts.push('<svg x="' + num(im.x) + '" y="' + num(im.y) + '" width="' + num(im.size) + '" height="' + num(im.size) +
        '" viewBox="' + vb + '" preserveAspectRatio="' + fit + '" overflow="hidden"' + im.svg.rootAttrs + '>' + im.svg.inner + '</svg>');
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

  return { glyphPath, icon, sanitize, cleanCss, num, color };
})();
