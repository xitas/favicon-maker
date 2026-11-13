/* Icon drawing on <canvas>. Pure: everything it needs comes in through `settings`. */
const Draw = (() => {
  'use strict';

  const FONTS = {
    sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    display: 'Impact, "Arial Black", "Helvetica Neue", sans-serif'
  };

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

  function drawText(ctx, size, s) {
    if (!s.text) return;
    const weight = s.bold ? '700' : '400';
    const family = FONTS[s.font] || FONTS.sans;
    let px = (size * s.textScale) / 100;
    ctx.font = weight + ' ' + px + 'px ' + family;
    const width = ctx.measureText(s.text).width;
    const maxWidth = size * 0.92;
    if (width > maxWidth) px *= maxWidth / width;
    ctx.font = weight + ' ' + px + 'px ' + family;

    const m = ctx.measureText(s.text);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = s.fg;
    // Center the ink, not the font box, so letters sit in the middle.
    ctx.fillText(s.text, size / 2, size / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
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

  return { icon, render };
})();
