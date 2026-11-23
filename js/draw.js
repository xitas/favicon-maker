/* Icon drawing on <canvas>. Pure: everything it needs comes in through `settings`. Depends on Svg, ImageTools, Fonts, Icons, Shrink.
   Fonts and their outlines must already be loaded (see Fonts.prepare), so nothing is drawn with a fallback font. */
const Draw = (() => {
  'use strict';

  function roundedPath(ctx, size, r) {
    r = Math.min(r, size / 2);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(size, 0, size, size, r);
    ctx.arcTo(size, size, 0, size, r);
    ctx.arcTo(0, size, 0, 0, r);
    ctx.arcTo(0, 0, size, 0, r);
    ctx.closePath();
  }

  /**
   * Round a font size the way Firefox does on canvas (7 significant binary digits: 11.2 px is drawn at
   * 11.25 px, 358.4 px at 360 px). Every browser then draws the same size, so icons match everywhere.
   */
  function snapSize(px) {
    if (!(px > 0)) return px;
    const step = Math.pow(2, Math.floor(Math.log2(px)) - 6);
    return Math.round(px / step) * step;
  }

  const INK_REF = 400; // font size used to find the ink box of what the browser draws
  // Font size used to measure where letters go. Chromium on Linux rounds text widths to whole pixels (and
  // hints them at small sizes); at this size the rounding is under 0.0003 em.
  const MEASURE_REF = 2000;
  const INVISIBLE = /^[\p{Cc}\p{Cf}]+$/u;
  const pieceCache = new Map();
  const shapeCache = new Map();
  const inkCache = new Map();

  /** The text's user-perceived characters, or its code points where Intl.Segmenter is missing. */
  function graphemes(text) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (g) => g.segment);
    }
    return Array.from(text);
  }

  /**
   * How the text is drawn, piece by piece. A character the icon font has is drawn from the font's own
   * outline (the .glyphs.js data favicon.svg uses), so every browser on every system draws the same shape:
   * { text, glyph, x }. Anything else (emoji, or a script the font doesn't cover) is drawn by the browser
   * in runs, so letters that join stay joined: { text, x }. `x` is in ems from the start of the text,
   * measured by the browser at a large size: that keeps the font's kerning, without each engine's
   * rounding and hinting at small sizes.
   * Throws when the outlines are needed but not loaded (see Fonts.prepare): nothing is drawn with a fallback.
   */
  function pieces(text, s) {
    const font = Fonts.key(s.font);
    const w = Fonts.weight(font, s.bold);
    const css = Fonts.css(s, MEASURE_REF);
    const cacheKey = css + '\n' + text;
    if (pieceCache.has(cacheKey)) return pieceCache.get(cacheKey);

    const data = Fonts.glyphs(font, w);
    const list = [];
    for (const g of graphemes(text)) {
      const own = Array.from(g).length === 1 && Fonts.has(font, g.codePointAt(0)) && !INVISIBLE.test(g);
      if (own && !data) throw new Error('the outlines of the ' + Fonts.label(font) + ' font are not loaded');
      const glyph = own ? data.glyphs[g.codePointAt(0)] : undefined;
      const last = list[list.length - 1];
      if (glyph !== undefined) list.push({ text: g, glyph });
      else if (last && last.glyph === undefined) last.text += g;
      else list.push({ text: g });
    }

    // Where each piece starts: the width of the text up to and including it, minus its own width.
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = css;
    let prefix = '';
    for (const p of list) {
      prefix += p.text;
      p.x = (ctx.measureText(prefix).width - ctx.measureText(p.text).width) / MEASURE_REF;
    }
    const out = { font, weight: w, upm: data ? data.upm : 1000, list };
    if (pieceCache.size > 200) pieceCache.clear();
    pieceCache.set(cacheKey, out);
    return out;
  }

  /** A glyph outline as a Path2D in font units (y down), made once. */
  function glyphShape(p, glyph) {
    const id = p.font + '|' + p.weight + '|' + glyph;
    let shape = shapeCache.get(id);
    if (!shape) {
      shape = new Path2D(Svg.glyphPath(glyph, 1, 0, 0));
      if (shapeCache.size > 2000) shapeCache.clear();
      shapeCache.set(id, shape);
    }
    return shape;
  }

  /** Draw the pieces in the current fill style, starting on the alphabetic baseline at (x, y), at `px` pixels. */
  function drawPieces(ctx, p, s, x, y, px) {
    const k = px / p.upm;
    for (const piece of p.list) {
      if (piece.glyph !== undefined) {
        ctx.save();
        ctx.translate(x + piece.x * px, y);
        ctx.scale(k, k);
        ctx.fill(glyphShape(p, piece.glyph));
        ctx.restore();
      } else {
        ctx.font = Fonts.css(s, px);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(piece.text, x + piece.x * px, y);
      }
    }
  }

  /** The ink box of the pieces drawn by the browser (not from outlines), from pixels, in ems; null if none. */
  function runsInkBox(p, s) {
    const runs = { font: p.font, weight: p.weight, upm: p.upm, list: p.list.filter((piece) => piece.glyph === undefined) };
    if (!runs.list.length) return null;
    const last = runs.list[runs.list.length - 1];
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = Fonts.css(s, INK_REF);
    const margin = INK_REF;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((last.x * INK_REF) + probe.measureText(last.text).width + margin * 2);
    canvas.height = INK_REF * 3;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000';
    const ox = margin;
    const oy = INK_REF * 2;
    drawPieces(ctx, runs, s, ox, oy, INK_REF);

    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let left = width;
    let right = -1;
    let top = height;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
      const row = y * width * 4;
      for (let x = 0; x < width; x++) {
        if (data[row + x * 4 + 3] > 64) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    return right < 0 ? null : {
      left: (left - ox) / INK_REF,
      right: (right + 1 - ox) / INK_REF,
      top: (top - oy) / INK_REF,
      bottom: (bottom + 1 - oy) / INK_REF
    };
  }

  /**
   * The ink box of `text`, in ems, relative to its start point on the alphabetic baseline: left, right,
   * top (negative, above the baseline) and bottom. Exact for letters drawn from outlines; found from pixels
   * for anything the browser draws. Null when nothing is drawn (only spaces).
   */
  function inkBox(text, s) {
    const cacheKey = Fonts.css(s, INK_REF) + '\n' + text;
    if (inkCache.has(cacheKey)) return inkCache.get(cacheKey);
    const p = pieces(text, s);
    const boxes = [runsInkBox(p, s)];
    for (const piece of p.list) {
      if (piece.glyph === undefined) continue;
      const b = Svg.glyphBounds(piece.glyph);
      if (b) boxes.push({ left: piece.x + b.left / p.upm, right: piece.x + b.right / p.upm, top: b.top / p.upm, bottom: b.bottom / p.upm });
    }
    const found = boxes.filter(Boolean);
    const box = found.length ? {
      left: Math.min(...found.map((b) => b.left)),
      right: Math.max(...found.map((b) => b.right)),
      top: Math.min(...found.map((b) => b.top)),
      bottom: Math.max(...found.map((b) => b.bottom))
    } : null;
    if (inkCache.size > 200) inkCache.clear();
    inkCache.set(cacheKey, box);
    return box;
  }

  /**
   * Where the text goes in a square of `size`: the text (precomposed), its font size, and its start
   * point on the alphabetic baseline. The PNG and SVG outputs both use this, so they match.
   * Null when there is nothing to draw.
   */
  function textLayout(size, s) {
    if (!s.text) return null;
    // Precomposed form, so an accent typed as a separate mark uses the font's own accented letter.
    const text = String(s.text).normalize('NFC');
    const box = inkBox(text, s);
    if (!box) return null;

    // Shrink text that would be too wide, then center its ink (not the font box) in the square.
    let px = (size * s.textScale) / 100;
    const maxWidth = size * 0.92;
    if ((box.right - box.left) * px > maxWidth) px = maxWidth / (box.right - box.left);
    px = snapSize(px);
    return {
      text, px,
      x: size / 2 - ((box.left + box.right) / 2) * px,
      y: size / 2 - ((box.top + box.bottom) / 2) * px,
      height: (box.bottom - box.top) * px // the ink's height, for the small text check
    };
  }

  function drawText(ctx, area, s) {
    const t = textLayout(area.size, s);
    if (!t) return;
    ctx.fillStyle = s.fg;
    drawPieces(ctx, pieces(t.text, s), s, area.x + t.x, area.y + t.y, t.px);
  }

  /**
   * The text in a square of `size` as one SVG path, moved by (dx, dy): the same outlines at the same
   * places as on the canvas. Null when some of it is drawn by the browser (emoji, other scripts).
   */
  function textOutline(size, s, dx, dy) {
    const t = textLayout(size, s);
    if (!t) return '';
    const p = pieces(t.text, s);
    if (p.list.some((piece) => piece.glyph === undefined)) return null;
    const scale = t.px / p.upm;
    return p.list.map((piece) => Svg.glyphPath(piece.glyph, scale, t.x + dx + piece.x * t.px, t.y + dy)).join('');
  }

  /**
   * Where the image goes in a square of `size`: the padded box it is clipped to, and the rectangle it is
   * drawn in (contain or cover, then the crop's zoom and position). The PNG and SVG outputs both use this.
   */
  function imageLayout(size, s, iw, ih) {
    const pad = (size * s.pad) / 100;
    const box = size - pad * 2;
    const zoom = (s.cropZoom || 100) / 100;
    const r = ImageTools.cropRect(box, iw, ih, s.fit, zoom, (s.cropX || 0) / 100, (s.cropY || 0) / 100);
    return { clip: { x: pad, y: pad, size: box }, x: pad + r.x, y: pad + r.y, w: r.w, h: r.h };
  }

  /* ---------- Shrinking images ---------- */

  const PYRAMID_MAX = 4096; // longest side kept from an upload
  const pyramids = new WeakMap(); // image -> [{ canvas, width, height }], largest first

  function toCanvas(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').putImageData(new ImageData(Shrink.unpremultiply(img.data), img.width, img.height), 0, 0);
    return canvas;
  }

  /** The image halved again and again (premultiplied), made once per image and kept. */
  function pyramid(image) {
    if (pyramids.has(image)) return pyramids.get(image);
    const iw = image.naturalWidth || 512;
    const ih = image.naturalHeight || 512;
    const k = Math.min(1, PYRAMID_MAX / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * k));
    const h = Math.max(1, Math.round(ih * k));
    const first = document.createElement('canvas');
    first.width = w;
    first.height = h;
    const ctx = first.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, w, h);
    const levels = [{ canvas: first, width: w, height: h }];
    let img = { width: w, height: h, data: Shrink.premultiply(ctx.getImageData(0, 0, w, h).data) };
    // Stop at 8 px on the shorter side: the smallest icon is 16 px.
    while (Math.min(img.width, img.height) > 8) {
      img = Shrink.halve(img);
      levels.push({ canvas: toCanvas(img), width: img.width, height: img.height });
    }
    pyramids.set(image, levels);
    return levels;
  }

  /** What to draw a raster image from at `w` × `h`: a halving step less than twice that size. */
  function shrinkSource(image, w, h) {
    const levels = pyramid(image);
    return levels[Shrink.pick(levels.map((l) => [l.width, l.height]), w, h)].canvas;
  }

  function drawImage(ctx, area, s) {
    const image = s.image;
    if (!image) return;
    const l = imageLayout(area.size, s, image.naturalWidth || 512, image.naturalHeight || 512);
    // Vector images (SVG) are drawn straight at the target size; raster images are shrunk in steps.
    const source = s.imageVector ? image : shrinkSource(image, l.w, l.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x + l.clip.x, area.y + l.clip.y, l.clip.size, l.clip.size);
    ctx.clip();
    ctx.drawImage(source, area.x + l.x, area.y + l.y, l.w, l.h);
    ctx.restore();
  }

  /* ---------- Library icons ---------- */

  /**
   * Where a library icon goes in a square of `size`: its 24-unit grid scaled by `k` and placed at (x, y),
   * and its stroke width in grid units. The PNG and SVG outputs both use this.
   */
  function iconLayout(size, s) {
    const box = (size * s.iconScale) / 100;
    const k = box / Icons.GRID;
    return { x: (size - box) / 2, y: (size - box) / 2, k, stroke: s.iconStroke };
  }

  function drawLibraryIcon(ctx, area, s) {
    const d = Icons.get(s.icon);
    if (!d) return;
    const l = iconLayout(area.size, s);
    ctx.save();
    ctx.translate(area.x + l.x, area.y + l.y);
    ctx.scale(l.k, l.k);
    ctx.lineWidth = l.stroke;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.fg;
    ctx.stroke(new Path2D(d));
    ctx.restore();
  }

  /* ---------- Maskable icons ---------- */

  /** Android keeps the middle circle of a maskable icon: its radius is 40% of the icon (80% across). */
  const SAFE_ZONE_RADIUS = 0.4;
  /** Default maskable padding per side, in %: the design area is then as wide as the safe zone. */
  const MASK_PAD_DEFAULT = 10;

  /** The square the design is drawn in, inside a maskable icon of `size` with `pad`% padding per side. */
  function maskArea(size, pad) {
    const p = Math.min(Math.max(Number.isFinite(pad) ? pad : MASK_PAD_DEFAULT, 0), 40);
    const inset = (size * p) / 100;
    return { x: inset, y: inset, size: size - inset * 2 };
  }

  /** True when the point is inside the safe zone circle of an icon of `size`. */
  function inSafeZone(size, x, y) {
    const c = size / 2;
    return Math.hypot(x - c, y - c) <= size * SAFE_ZONE_RADIUS;
  }

  /** The shapes Android cuts maskable icons to, as a path in a square of `size`. */
  function maskShape(ctx, size, shape) {
    const c = size / 2;
    ctx.beginPath();
    if (shape === 'circle') {
      ctx.arc(c, c, c, 0, Math.PI * 2);
    } else if (shape === 'squircle') {
      // Superellipse |x|^4 + |y|^4 = 1.
      for (let i = 0; i <= 96; i++) {
        const t = (i / 96) * Math.PI * 2;
        const cos = Math.cos(t);
        const sin = Math.sin(t);
        const x = c + c * Math.sign(cos) * Math.pow(Math.abs(cos), 0.5);
        const y = c + c * Math.sign(sin) * Math.pow(Math.abs(sin), 0.5);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    } else if (shape === 'teardrop') {
      // Rounded on three corners, square at the bottom right.
      ctx.moveTo(c, 0);
      ctx.arc(c, c, c, -Math.PI / 2, 0);
      ctx.lineTo(size, size);
      ctx.lineTo(c, size);
      ctx.arc(c, c, c, Math.PI / 2, Math.PI * 1.5);
    } else {
      roundedPath(ctx, size, size * 0.2);
      return;
    }
    ctx.closePath();
  }

  /* ---------- Shape, background, border and position ---------- */

  /**
   * Border width in pixels for an icon of `size`, from a width in % of the icon. It grows with the
   * icon, but never past a twelfth of it (so small icons aren't swallowed), and is at least 1 px.
   */
  function borderPx(size, pct) {
    return Math.max(1, Math.min((size * pct) / 100, size / 12));
  }

  /** How far the content moves, in pixels, for an area of `size` and offsets in % (‑20 to 20). */
  function offsetPx(size, s) {
    return { x: (size * (s.offsetX || 0)) / 100, y: (size * (s.offsetY || 0)) / 100 };
  }

  /** The fill for the background: a color, or a gradient across the square. */
  function backgroundPaint(ctx, size, s, colors) {
    if (s.bgType === 'linear') {
      const g = Svg.gradientLine(size, s.angle);
      const grad = ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2);
      grad.addColorStop(0, colors.bg);
      grad.addColorStop(1, colors.bg2);
      return grad;
    }
    if (s.bgType === 'radial') {
      const c = size / 2;
      const grad = ctx.createRadialGradient(c, c, 0, c, c, Svg.radialRadius(size));
      grad.addColorStop(0, colors.bg);
      grad.addColorStop(1, colors.bg2);
      return grad;
    }
    return colors.bg;
  }

  /* ---------- Whole icons ---------- */

  /** Normalize the variant: 'apple' (also `true`), 'maskable', or 'normal'. */
  function variantOf(v) {
    return v === true || v === 'apple' ? 'apple' : v === 'maskable' ? 'maskable' : 'normal';
  }

  /**
   * Draw an icon. 'apple' and 'maskable' are full-bleed opaque squares: iOS and Android cut their own
   * shapes, and a transparent background becomes white. 'maskable' keeps the design inside the safe zone.
   */
  function icon(ctx, size, s, variant) {
    const kind = variantOf(variant);
    const square = kind !== 'normal';
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // The same outline favicon.svg uses. The Apple and maskable icons are full squares: the system cuts them.
    const shape = new Path2D(Svg.shapePath(square ? 'square' : s.shape, size, (size * s.radius) / 100));
    ctx.save();
    ctx.clip(shape);

    if (square && s.transparent) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
    } else if (!s.transparent) {
      ctx.fillStyle = backgroundPaint(ctx, size, s, { bg: s.bg, bg2: s.bg2 });
      ctx.fillRect(0, 0, size, size);
    }

    const base = kind === 'maskable' ? maskArea(size, s.maskPad) : { x: 0, y: 0, size };
    const shift = offsetPx(base.size, s);
    const area = { x: base.x + shift.x, y: base.y + shift.y, size: base.size };
    if (s.mode === 'text') drawText(ctx, area, s);
    else if (s.mode === 'icon') drawLibraryIcon(ctx, area, s);
    else drawImage(ctx, area, s);

    // A border inside the edge of the shape: a stroke twice as wide, with the outer half clipped away.
    if (!square && s.border) {
      ctx.lineWidth = borderPx(size, s.borderWidth) * 2;
      ctx.strokeStyle = s.borderColor;
      ctx.stroke(shape);
    }
    ctx.restore();
  }

  /** Draw onto a new offscreen canvas of the given size. */
  function render(size, s, variant) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    icon(canvas.getContext('2d'), size, s, variant);
    return canvas;
  }

  return {
    icon, render, snapSize, textLayout, textOutline, imageLayout, iconLayout, borderPx, offsetPx,
    maskArea, inSafeZone, maskShape, SAFE_ZONE_RADIUS, MASK_PAD_DEFAULT
  };
})();
