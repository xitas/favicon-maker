/* Design checks: advice for designs that won't read well at small sizes. Pure functions: the page measures
   what it needs (the text's height at 16 px) and passes it in. The results are advice only; nothing here
   ever blocks a download. */
const Checks = (() => {
  'use strict';

  /** Contrast below this is hard to see at favicon sizes (WCAG's minimum for large text and graphics). */
  const MIN_CONTRAST = 3;
  /** Below this on a browser tab, an icon with no background nearly vanishes. */
  const MIN_TAB_CONTRAST = 2;
  /** Text shorter than this at 16 px is hard to read. */
  const MIN_TEXT_PX = 8;
  /** Lines thinner than this at 16 px fade out. */
  const MIN_LINE_PX = 0.9;
  /** The active tab colors of the light and dark browser previews (as in style.css). */
  const LIGHT_TAB = '#ffffff';
  const DARK_TAB = '#3a3a3a';

  /* ---------- Colors ---------- */

  function rgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
    if (!m) throw new Error('Not a #rrggbb color: ' + hex);
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function hex(c) {
    return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }

  /** Relative luminance as WCAG defines it, from sRGB channels (0-255, may be fractional). */
  function luminanceRgb(c) {
    const lin = (v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  }

  const luminance = (h) => luminanceRgb(rgb(h));

  function ratio(l1, l2) {
    const hi = Math.max(l1, l2);
    const lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  /** WCAG contrast ratio between two #rrggbb colors, from 1 to 21. */
  function contrast(a, b) {
    return ratio(luminance(a), luminance(b));
  }

  /**
   * The lowest contrast between `fg` and any point of the background: one color, or a gradient between
   * two (mixed in sRGB, as canvas and SVG draw gradients). Returns { ratio, at } with `at` from 0 to 1.
   */
  function worstContrast(fg, colors) {
    const lf = luminance(fg);
    if (colors.length < 2) return { ratio: ratio(lf, luminance(colors[0])), at: 0 };
    const a = rgb(colors[0]);
    const b = rgb(colors[1]);
    let worst = { ratio: Infinity, at: 0 };
    const steps = 200;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const c = [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t);
      const r = ratio(lf, luminanceRgb(c));
      if (r < worst.ratio) worst = { ratio: r, at: t };
    }
    return worst;
  }

  /* HSL, for changing lightness only. */

  function toHsl(h) {
    const [r, g, b] = rgb(h).map((v) => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let hue;
    if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    return [hue * 60, s, l];
  }

  function fromHsl(hue, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = l - c / 2;
    const seg = Math.floor(hue / 60) % 6;
    const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
    return hex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
  }

  /**
   * The nearest color to `fg` with the same hue and saturation, changing only its lightness, whose
   * worst contrast with the background reaches `target`. Null when no lightness can.
   */
  function fixContrast(fg, colors, target) {
    const goal = target || MIN_CONTRAST;
    const [hue, s, l] = toHsl(fg);
    const ok = (c) => worstContrast(c, colors).ratio >= goal;
    if (ok(hex(rgb(fg)))) return hex(rgb(fg));
    const step = 0.001;
    for (let d = step; d <= 1 + step; d += step) {
      // Try both directions at each distance; the first that works is the smallest change.
      const tries = [l - d, l + d].filter((x) => x >= 0 && x <= 1);
      const found = tries.map((x) => fromHsl(hue, s, x)).filter(ok);
      if (found.length === 1) return found[0];
      if (found.length === 2) {
        // Both work at the same distance: keep the one closer in contrast to the original look.
        return contrast(found[0], fg) <= contrast(found[1], fg) ? found[0] : found[1];
      }
    }
    return null;
  }

  /* ---------- Sizes ---------- */

  /** Line width of a library icon at 16 px, in pixels. */
  function iconLinePx(s) {
    return s.iconStroke * ((16 * s.iconScale) / 100) / 24;
  }

  /** The smallest line width setting (in steps of 0.25) that reaches MIN_LINE_PX at 16 px, at most 3. */
  function suggestedStroke(s) {
    const perUnit = ((16 * s.iconScale) / 100) / 24;
    return Math.min(3, Math.ceil((MIN_LINE_PX / perUnit) * 4) / 4);
  }

  /** True when the text has letters or symbols drawn in the text color (emoji bring their own colors). */
  function textUsesColor(text) {
    return /[^\s\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍︎️⃣\u{E0020}-\u{E007F}]/u.test(String(text || ''));
  }

  /* ---------- All checks ---------- */

  const fmt = (n) => (Math.round(n * 10) / 10).toString();

  /**
   * Check a design. `m` holds what the page measured: { textHeight16 } in pixels.
   * Returns { warnings: [{ id, text, action? }], skipped? }. An action is { label, field, value }: setting
   * that field to that value fixes the warning.
   */
  function run(s, m) {
    const warnings = [];
    if (s.mode === 'image') return { warnings, skipped: 'image' };
    const colored = s.mode === 'icon' || textUsesColor(s.text);

    if (colored && !s.transparent) {
      const bgs = s.bgType === 'solid' ? [s.bg] : [s.bg, s.bg2];
      if (worstContrast(s.fg, bgs).ratio < MIN_CONTRAST) {
        const fix = fixContrast(s.fg, bgs);
        warnings.push({
          id: 'contrast',
          text: 'Low contrast: this may be hard to see at small sizes.',
          action: fix ? { label: 'Fix contrast', field: 'fg', value: fix } : null
        });
      }
      if (s.dark) {
        const darkBgs = s.bgType === 'solid' ? [s.darkBg] : [s.darkBg, s.darkBg2];
        if (worstContrast(s.darkFg, darkBgs).ratio < MIN_CONTRAST) {
          const fix = fixContrast(s.darkFg, darkBgs);
          warnings.push({
            id: 'darkContrast',
            text: 'Low contrast in dark mode: this may be hard to see at small sizes.',
            action: fix ? { label: 'Fix dark mode contrast', field: 'darkFg', value: fix } : null
          });
        }
      }
    }

    if (colored && s.transparent) {
      // With no background, the browser's tab is the background.
      if (contrast(s.fg, LIGHT_TAB) < MIN_TAB_CONTRAST) {
        warnings.push({ id: 'lightTab', text: 'This icon is hard to see on light tabs.' });
      }
      if (contrast(s.dark ? s.darkFg : s.fg, DARK_TAB) < MIN_TAB_CONTRAST) {
        warnings.push({ id: 'darkTab', text: 'This icon is hard to see on dark tabs.' });
      }
    }

    if (s.mode === 'text' && m && typeof m.textHeight16 === 'number' && m.textHeight16 > 0 && m.textHeight16 < MIN_TEXT_PX) {
      warnings.push({
        id: 'smallText',
        text: 'Small text: at 16 px it is only ' + fmt(m.textHeight16) + ' px tall, so it may not be readable. Try fewer or narrower characters, or a larger text size.'
      });
    }

    if (s.mode === 'icon') {
      const px = iconLinePx(s);
      if (px < MIN_LINE_PX) {
        const better = suggestedStroke(s);
        warnings.push({
          id: 'thinLines',
          text: 'Thin lines: at 16 px they are only ' + fmt(px) + ' px wide and may fade. Try a line width of ' + better + ' or more.',
          action: better > s.iconStroke ? { label: 'Use line width ' + better, field: 'iconStroke', value: better } : null
        });
      }
    }
    return { warnings };
  }

  return {
    MIN_CONTRAST, MIN_TAB_CONTRAST, MIN_TEXT_PX, MIN_LINE_PX, LIGHT_TAB, DARK_TAB,
    rgb, hex, luminance, contrast, worstContrast, toHsl, fromHsl, fixContrast,
    iconLinePx, suggestedStroke, textUsesColor, run
  };
})();
