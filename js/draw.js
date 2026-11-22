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

  function drawText(ctx, size, s) {
    if (!s.text) return;
    // Precomposed form, so an accent typed as a separate mark uses the font's own accented letter.
    const text = String(s.text).normalize('NFC');
    const box = inkBox(text, s);
    if (!box) return;

    // Shrink text that would be too wide, then center its ink (not the font box) in the icon.
    let px = (size * s.textScale) / 100;
    const maxWidth = size * 0.92;
    if ((box.right - box.left) * px > maxWidth) px = maxWidth / (box.right - box.left);
    px = snapSize(px);

    ctx.font = Fonts.css(s, px);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = s.fg;
    ctx.fillText(text, size / 2 - ((box.left + box.right) / 2) * px, size / 2 - ((box.top + box.bottom) / 2) * px);
  }

  function drawImage(ctx, size, s) {
    const image = s.image;
    if (!image) return;
    const pad = (size * s.pad) / 100;
    const box = size - pad * 2;
    const iw = image.naturalWidth || 512;
    const ih = image.naturalHeight || 512;
    const k = s.fit === 'cover' ? Math.max(box / iw, box / ih) : Math.min(box / iw, box / ih);
    const w = iw * k;
    const h = ih * k;
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad, pad, box, box);
    ctx.clip();
    ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
    ctx.restore();
  }

  /** `apple` draws a full-bleed opaque square, because iOS adds its own rounded corners. */
  function icon(ctx, size, s, apple) {
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.save();
    roundedPath(ctx, size, apple ? 0 : (size * s.radius) / 100);
    ctx.clip();

    if (apple) {
      ctx.fillStyle = s.transparent ? '#ffffff' : s.bg;
      ctx.fillRect(0, 0, size, size);
    } else if (!s.transparent) {
      ctx.fillStyle = s.bg;
      ctx.fillRect(0, 0, size, size);
    }

    if (s.mode === 'text') drawText(ctx, size, s);
    else drawImage(ctx, size, s);

    ctx.restore();
  }

  /** Draw onto a new offscreen canvas of the given size. */
  function render(size, s, apple) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    icon(canvas.getContext('2d'), size, s, !!apple);
    return canvas;
  }

  return { icon, render, snapSize };
})();
