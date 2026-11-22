/* Icon drawing on <canvas>. Pure: everything it needs comes in through `settings`. Depends on Fonts.
   Fonts must already be loaded (see Fonts.prepare), so nothing is drawn with a fallback font. */
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

  const INK_REF = 400; // font size used to find the ink box
  const inkCache = new Map();

  /**
   * The ink box of `text`, in ems, relative to its start point on the alphabetic baseline: left, right,
   * top (negative, above the baseline) and bottom. Found from pixels, not from the browser's text
   * metrics, because browsers round those differently. Null when nothing is drawn (only spaces).
   */
  function inkBox(text, s) {
    const font = Fonts.css(s, INK_REF);
    const cacheKey = font + '\n' + text;
    if (inkCache.has(cacheKey)) return inkCache.get(cacheKey);

    const canvas = document.createElement('canvas');
    const probe = canvas.getContext('2d');
    probe.font = font;
    const advance = probe.measureText(text).width;
    const margin = INK_REF;
    canvas.width = Math.ceil(advance + margin * 2);
    canvas.height = INK_REF * 3;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000';
    const ox = margin;
    const oy = INK_REF * 2;
    ctx.fillText(text, ox, oy);

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
    const box = right < 0 ? null : {
      left: (left - ox) / INK_REF,
      right: (right + 1 - ox) / INK_REF,
      top: (top - oy) / INK_REF,
      bottom: (bottom + 1 - oy) / INK_REF
    };
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
    return { text, px, x: size / 2 - ((box.left + box.right) / 2) * px, y: size / 2 - ((box.top + box.bottom) / 2) * px };
  }

  function drawText(ctx, area, s) {
    const t = textLayout(area.size, s);
    if (!t) return;
    ctx.font = Fonts.css(s, t.px);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = s.fg;
    ctx.fillText(t.text, area.x + t.x, area.y + t.y);
  }

  /**
   * Where the image goes in a square of `size`: the padded box it is clipped to, and the rectangle it is
   * drawn in (contain or cover, centered). The PNG and SVG outputs both use this.
   */
  function imageLayout(size, s, iw, ih) {
    const pad = (size * s.pad) / 100;
    const box = size - pad * 2;
    const k = s.fit === 'cover' ? Math.max(box / iw, box / ih) : Math.min(box / iw, box / ih);
    const w = iw * k;
    const h = ih * k;
    return { clip: { x: pad, y: pad, size: box }, x: (size - w) / 2, y: (size - h) / 2, w, h };
  }

  function drawImage(ctx, area, s) {
    const image = s.image;
    if (!image) return;
    const l = imageLayout(area.size, s, image.naturalWidth || 512, image.naturalHeight || 512);
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x + l.clip.x, area.y + l.clip.y, l.clip.size, l.clip.size);
    ctx.clip();
    ctx.drawImage(image, area.x + l.x, area.y + l.y, l.w, l.h);
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

    ctx.save();
    roundedPath(ctx, size, square ? 0 : (size * s.radius) / 100);
    ctx.clip();

    if (square) {
      ctx.fillStyle = s.transparent ? '#ffffff' : s.bg;
      ctx.fillRect(0, 0, size, size);
    } else if (!s.transparent) {
      ctx.fillStyle = s.bg;
      ctx.fillRect(0, 0, size, size);
    }

    const area = kind === 'maskable' ? maskArea(size, s.maskPad) : { x: 0, y: 0, size };
    if (s.mode === 'text') drawText(ctx, area, s);
    else drawImage(ctx, area, s);

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
    icon, render, snapSize, textLayout, imageLayout,
    maskArea, inSafeZone, maskShape, SAFE_ZONE_RADIUS, MASK_PAD_DEFAULT
  };
})();
