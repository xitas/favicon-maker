/* Ready-made starting points and "Surprise me". Pure: a template is a normal design (settings) made only
   from the app's own options, and goes through Design.validate like any other. Depends on Design, Fonts
   and Checks. */
const Templates = (() => {
  'use strict';

  /* Settings that belong to the site or the person, not to the look: a template or a surprise keeps them. */
  const KEEP = ['appName', 'basePath', 'emoji', 'maskPad'];

  /**
   * The templates. Each one lists only what differs from Design.DEFAULTS. All are original: plain letters,
   * Lucide icons and color pairs, none made to look like a real brand's logo or colors.
   * `text` is a sample: a text template keeps the person's own text when they have some.
   */
  const LIST = [
    { id: 'gradient-circle', name: 'Gradient circle', settings: { text: 'A', textScale: 74, shape: 'circle', bgType: 'linear', bg: '#c2185b', bg2: '#5e35b1', angle: 135, fg: '#ffffff' } },
    { id: 'dev-badge', name: 'Developer badge', settings: { text: '{}', font: 'mono', textScale: 74, shape: 'rounded', radius: 14, bg: '#16181d', fg: '#8ae9c1', border: true, borderWidth: 3, borderColor: '#2e3440' } },
    { id: 'pastel-squircle', name: 'Soft pastel', settings: { text: 'b', font: 'rounded', textScale: 76, shape: 'squircle', bg: '#ffd9e3', fg: '#8a2f55' } },
    { id: 'dark-minimal', name: 'Dark minimal', settings: { text: 'M', font: 'sans', bold: false, textScale: 74, radius: 24, bg: '#141414', fg: '#f2f2f2', dark: true, darkBg: '#f2f2f2', darkFg: '#141414' } },
    { id: 'handwritten', name: 'Handwritten initial', settings: { text: 'J', font: 'handwritten', textScale: 80, shape: 'circle', bg: '#fff1dc', fg: '#9c3d10' } },
    { id: 'serif-monogram', name: 'Serif monogram', settings: { text: 'R', font: 'serif', textScale: 82, shape: 'square', bg: '#1c2f4a', fg: '#f1e6cc', border: true, borderWidth: 4, borderColor: '#c9a54a' } },
    { id: 'slab-stamp', name: 'Slab stamp', settings: { text: 'S', font: 'slab', textScale: 84, radius: 10, bg: '#f3e9d2', fg: '#6b2a1a', border: true, borderWidth: 7, borderColor: '#6b2a1a' } },
    { id: 'poster', name: 'Bold poster', settings: { text: 'Go', font: 'display', textScale: 75, shape: 'square', bg: '#ffd23f', fg: '#1a1a1a' } },
    { id: 'geometric-ring', name: 'Geometric ring', settings: { text: 'O', font: 'geometric', shape: 'circle', bg: '#ffffff', fg: '#1d4ed8', border: true, borderWidth: 5, borderColor: '#1d4ed8', textScale: 80 } },
    { id: 'night-glow', name: 'Night glow', settings: { text: 'N', font: 'geometric', textScale: 78, shape: 'circle', bgType: 'radial', bg: '#4a2a8a', bg2: '#120a2a', fg: '#ffd27a' } },
    { id: 'leaf', name: 'Green leaf', settings: { mode: 'icon', icon: 'leaf', shape: 'squircle', bgType: 'linear', bg: '#2e7d4f', bg2: '#1b4d31', angle: 160, fg: '#ffffff', iconStroke: 2.25, iconScale: 64 } },
    { id: 'sparkles', name: 'Warm sparkle', settings: { mode: 'icon', icon: 'sparkles', shape: 'circle', bg: '#fdf0d5', fg: '#b8400a', iconStroke: 2.25, iconScale: 62 } },
    { id: 'terminal', name: 'Terminal', settings: { mode: 'icon', icon: 'terminal', radius: 18, bg: '#0f172a', fg: '#7dd3fc', iconStroke: 2.5, iconScale: 66 } },
    { id: 'outline-book', name: 'Line art on white', settings: { mode: 'icon', icon: 'book-open', radius: 20, bg: '#ffffff', fg: '#1f2937', border: true, borderWidth: 4, borderColor: '#1f2937', iconStroke: 2.5, iconScale: 60 } },
    { id: 'no-background', name: 'No background', settings: { text: 'K', font: 'sans', textScale: 74, transparent: true, fg: '#5b21b6', dark: true, darkFg: '#c4b5fd' } },
    { id: 'sunrise', name: 'Sunrise gradient', settings: { mode: 'icon', icon: 'sun', shape: 'rounded', radius: 30, bgType: 'linear', bg: '#b3261e', bg2: '#8a3b12', angle: 180, fg: '#fff3d6', iconStroke: 2.25, iconScale: 68 } }
  ];

  const byId = (id) => LIST.find((t) => t.id === id) || null;

  /** Keep the person's own text when a text design meets a text template. */
  function textFor(templateMode, sample, current) {
    if (templateMode !== 'text') return sample;
    return current && current.mode === 'text' && String(current.text || '').trim() ? current.text : sample;
  }

  /**
   * The full design a template makes, given the current one: the template over the defaults, keeping
   * the site's settings (and the person's text, for a text template). Validated like any design.
   */
  function design(template, current) {
    const t = typeof template === 'string' ? byId(template) : template;
    if (!t) throw new Error('No such template');
    const out = Object.assign({}, Design.DEFAULTS, t.settings);
    if (current) KEEP.forEach((k) => { if (k in current) out[k] = current[k]; });
    out.text = textFor(out.mode, t.settings.text !== undefined ? t.settings.text : Design.DEFAULTS.text, current);
    return Design.validate(out);
  }

  /* ---------- Surprise me ---------- */

  const SURPRISE_ICONS = ['leaf', 'sparkles', 'rocket', 'heart', 'sun', 'moon', 'zap', 'coffee', 'camera', 'feather',
    'flower', 'anchor', 'star', 'cloud', 'compass', 'mountain', 'book-open', 'terminal', 'palette', 'flame', 'globe',
    'gem', 'key', 'bell', 'lightbulb', 'paw-print', 'bird', 'fish', 'shell', 'tree-pine', 'umbrella', 'code'];
  // Surprises aim above the warning threshold, so they read well and never trip the contrast check.
  const SURPRISE_CONTRAST = 4.5;

  const wrapHue = (h) => ((h % 360) + 360) % 360;

  /** A background (one or two colors) and a text color that reach SURPRISE_CONTRAST everywhere on it. */
  function colors(rand) {
    const pick = (list) => list[Math.floor(rand() * list.length) % list.length];
    const hue = rand() * 360;
    const lightText = rand() < 0.6;
    const sat = 0.45 + rand() * 0.4;
    const bgL = lightText ? 0.2 + rand() * 0.16 : 0.84 + rand() * 0.1;
    const bg = Checks.fromHsl(wrapHue(hue), sat, bgL);
    const bgType = pick(['solid', 'solid', 'linear', 'radial']);
    const shift = pick([-40, -25, 25, 40]);
    const bg2 = Checks.fromHsl(wrapHue(hue + shift), sat, Math.min(0.95, Math.max(0.12, bgL + (lightText ? -0.08 : 0.04))));
    const bgs = bgType === 'solid' ? [bg] : [bg, bg2];
    // Text: white or a pale tint on dark backgrounds, a deep shade on light ones, of a related hue.
    const fgHue = wrapHue(hue + pick([0, 0, 30, 180, 200]));
    let fg = lightText
      ? (rand() < 0.5 ? '#ffffff' : Checks.fromHsl(fgHue, 0.85, 0.88))
      : Checks.fromHsl(fgHue, 0.55 + rand() * 0.3, 0.18 + rand() * 0.1);
    if (Checks.worstContrast(fg, bgs).ratio < SURPRISE_CONTRAST) {
      fg = Checks.fixContrast(fg, bgs, SURPRISE_CONTRAST) || (lightText ? '#ffffff' : '#111111');
    }
    if (Checks.worstContrast(fg, bgs).ratio < SURPRISE_CONTRAST) {
      // Some bright hues (greens, mostly) at this lightness can't reach it with any text shade: keep white
      // or near-black text and move the background's lightness instead, on a plain background.
      const text = lightText ? '#ffffff' : '#111111';
      return { bgType: 'solid', bg: Checks.fixContrast(bg, [text], SURPRISE_CONTRAST) || (lightText ? '#111111' : '#ffffff'), bg2, fg: text };
    }
    return { bgType, bg, bg2, fg };
  }

  /**
   * A random, good-looking design from the current one: new colors, shape and font (for text) or icon
   * (for an icon). Text, an uploaded image and the site's settings stay. `rand` returns numbers in [0, 1).
   */
  function surprise(current, rand) {
    const r = rand || Math.random;
    const pick = (list) => list[Math.floor(r() * list.length) % list.length];
    const base = Object.assign({}, Design.DEFAULTS, current || {});
    const c = colors(r);
    const out = Object.assign(base, c, {
      transparent: false,
      dark: false,
      shape: pick(Design.CHOICES.shape),
      radius: 12 + Math.floor(r() * 7) * 4,
      angle: pick([90, 135, 180, 225]),
      offsetX: 0,
      offsetY: 0,
      border: r() < 0.2,
      borderWidth: 3 + Math.floor(r() * 4)
    });
    out.borderColor = out.fg;
    if (out.mode === 'text') {
      out.font = pick(Fonts.keys());
      out.bold = r() < 0.8;
      out.textScale = 60 + Math.floor(r() * 5) * 5;
    } else if (out.mode === 'icon') {
      out.icon = pick(SURPRISE_ICONS.filter((n) => n !== base.icon));
      out.iconScale = 58 + Math.floor(r() * 4) * 4;
      out.iconStroke = 2;
      if (Checks.iconLinePx(out) < Checks.MIN_LINE_PX) out.iconStroke = Checks.suggestedStroke(out);
    }
    return Design.validate(out);
  }

  return { LIST, KEEP, SURPRISE_ICONS, SURPRISE_CONTRAST, byId, design, surprise };
})();
