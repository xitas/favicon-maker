/* The files the generator produces, and how to build each one, plus the pure text and path helpers they use.
   Depends on Svg, Fonts, Icons, Draw, Ico, Zip. */
const Outputs = (() => {
  'use strict';

  /** Most visible characters that still read at 16 px. */
  const TEXT_MAX = 3;
  /** Most visible characters in the manifest short_name. */
  const SHORT_NAME_MAX = 12;

  const FILES = [
    { name: 'favicon.ico', kind: 'ico', sizes: [16, 32, 48], note: 'Legacy browsers. Holds 16, 32 and 48 px.', dims: '16, 32, 48' },
    { name: 'favicon.svg', kind: 'svg', note: 'Modern browsers. Sharp at every size, and can change colors in dark mode.', dims: 'Vector' },
    { name: 'favicon-16x16.png', kind: 'png', size: 16, note: 'Browser tab', dims: '16 × 16' },
    { name: 'favicon-32x32.png', kind: 'png', size: 32, note: 'Browser tab on high-DPI screens', dims: '32 × 32' },
    { name: 'apple-touch-icon.png', kind: 'png', size: 180, variant: 'apple', note: 'iPhone and iPad home screen (square, no transparency)', dims: '180 × 180' },
    { name: 'android-chrome-192x192.png', kind: 'png', size: 192, note: 'Android home screen', dims: '192 × 192' },
    { name: 'android-chrome-512x512.png', kind: 'png', size: 512, note: 'Android splash screen and installs', dims: '512 × 512' },
    { name: 'maskable-icon-192x192.png', kind: 'png', size: 192, variant: 'maskable', note: 'Android icon that fills any shape (square, design inside the safe zone)', dims: '192 × 192' },
    { name: 'maskable-icon-512x512.png', kind: 'png', size: 512, variant: 'maskable', note: 'Large Android icon that fills any shape', dims: '512 × 512' },
    { name: 'site.webmanifest', kind: 'manifest', note: 'Web app manifest that points to the Android icons', dims: 'JSON' }
  ];

  /* ---------- Visible characters ---------- */

  const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

  // Fallback for browsers without Intl.Segmenter. Not the full Unicode rules, but it keeps the common cases
  // whole: combining accents, variation selectors, skin tones, ZWJ sequences, keycaps, flags and tag flags.
  const EXTEND = /^[\p{M}\p{Emoji_Modifier}‍\u{E0020}-\u{E007F}]$/u;
  const REGIONAL = /^\p{Regional_Indicator}$/u;

  function fallbackGraphemes(text) {
    const out = [];
    let afterJoiner = false; // the previous code point was a zero-width joiner
    let openFlag = false;    // the last cluster is a single regional indicator, waiting for its pair
    for (const ch of text) {
      const regional = REGIONAL.test(ch);
      const attach = out.length > 0 && (afterJoiner || EXTEND.test(ch) || (regional && openFlag));
      if (attach) out[out.length - 1] += ch;
      else out.push(ch);
      openFlag = regional && !attach;
      afterJoiner = ch === '‍';
    }
    return out;
  }

  /** Split text into visible characters (grapheme clusters). */
  function graphemes(text) {
    const s = String(text);
    if (segmenter) return Array.from(segmenter.segment(s), (part) => part.segment);
    return fallbackGraphemes(s);
  }

  /** The first `max` visible characters of `text`, never splitting one. */
  function clip(text, max) {
    return graphemes(text).slice(0, max).join('');
  }

  /**
   * Apply an edit to a text box that holds at most `max` visible characters.
   * `prev` is the value before the edit, [start, end] the selection it replaced, and `next` the value after.
   * Keeps the text around the edit and as much of the inserted text as fits, in whole characters.
   * @returns {{ value: string, caret: number, over: boolean }} `over` is true when something was cut
   */
  function limitEdit(prev, start, end, next, max) {
    if (graphemes(next).length <= max) return { value: next, caret: -1, over: false };
    const before = prev.slice(0, start);
    const after = prev.slice(end);
    if (next.length >= before.length + after.length && next.startsWith(before) && next.endsWith(after)) {
      const inserted = graphemes(next.slice(before.length, next.length - after.length));
      for (let k = inserted.length - 1; k >= 0; k--) {
        const middle = inserted.slice(0, k).join('');
        const value = before + middle + after;
        if (graphemes(value).length <= max) return { value, caret: before.length + middle.length, over: true };
      }
    }
    const value = clip(next, max);
    return { value, caret: value.length, over: true };
  }

  /* ---------- Where the files go ---------- */

  function decodeSegment(seg) {
    try { return decodeURIComponent(seg); } catch (e) { return seg; }
  }

  /**
   * Turn what the user typed for "Where will the files go?" into one clean form:
   * "/" for the site root, otherwise "/folder/sub/" (or "https://host/folder/" for a full URL).
   * Accepts input with or without slashes at either end.
   */
  function basePath(input) {
    let s = String(input == null ? '' : input).trim().replace(/\\/g, '/');
    let origin = '';
    const full = /^https?:\/\/[^/?#]+/i.exec(s);
    if (full) {
      try {
        origin = new URL(full[0]).origin;
        s = s.slice(full[0].length);
      } catch (e) {
        origin = '';
      }
    }
    s = s.replace(/[?#].*$/, '');
    const segments = s.split('/').filter((seg) => seg && seg !== '.').map((seg) => encodeURIComponent(decodeSegment(seg)));
    return origin + '/' + segments.map((seg) => seg + '/').join('');
  }

  /* ---------- favicon.svg ---------- */

  const SVG_SIZE = 512;
  const SVG_NOTES = {
    emoji: "SVG isn't available for emoji, so browsers use the PNG files.",
    chars: "SVG isn't available for characters outside the chosen font, so browsers use the PNG files.",
    raster: "SVG isn't available for PNG, JPG or WebP images, so browsers use the PNG files.",
    noImage: 'Choose an image first.'
  };
  const EMOJI_LIKE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3\uFE0F]/u;

  /**
   * Can favicon.svg be made for these settings? Text needs every character as an outline in the chosen
   * font; an image must be an SVG. Returns { ok: true } or { ok: false, reason }.
   */
  function svgStatus(s) {
    if (s.mode === 'icon') return { ok: true }; // icons are vectors
    if (s.mode === 'image') {
      if (!s.image) return { ok: false, reason: SVG_NOTES.noImage };
      return s.imageSvg ? { ok: true } : { ok: false, reason: SVG_NOTES.raster };
    }
    const font = Fonts.key(s.font);
    for (const g of graphemes(String(s.text || '').normalize('NFC'))) {
      const points = Array.from(g);
      if (points.length === 1 && Fonts.has(font, g.codePointAt(0))) continue;
      return { ok: false, reason: EMOJI_LIKE.test(g) ? SVG_NOTES.emoji : SVG_NOTES.chars };
    }
    return { ok: true };
  }

  /** Is this file made for these settings? Only favicon.svg can be left out. */
  function available(file, s) {
    return file.kind !== 'svg' || svgStatus(s).ok;
  }

  /** The text as outlines: one path, placed exactly where the canvas draws the text. */
  async function textPath(s) {
    const t = Draw.textLayout(SVG_SIZE, s);
    if (!t) return '';
    const shift = Draw.offsetPx(SVG_SIZE, s);
    const w = Fonts.weight(s.font, s.bold);
    const data = await Fonts.loadGlyphs(s.font, w);
    // Where each character starts: the width of the text up to and including it, minus its own width.
    // That keeps the browser's kerning, so the outlines line up with the canvas glyph for glyph.
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = Fonts.css(s, t.px);
    const scale = t.px / data.upm;
    let prefix = '';
    let d = '';
    for (const ch of Array.from(t.text)) {
      prefix += ch;
      const x = ctx.measureText(prefix).width - ctx.measureText(ch).width;
      const glyph = data.glyphs[ch.codePointAt(0)];
      if (glyph === undefined) throw new Error(SVG_NOTES.chars);
      d += Svg.glyphPath(glyph, scale, t.x + shift.x + x, t.y + shift.y);
    }
    return d;
  }

  /**
   * Load what drawing needs: the fonts for text, the icon set for an icon. Resolves to the settings to
   * draw with (see Fonts.prepare). Rejects when something can't be loaded, so no file is made without it.
   */
  async function prepare(s) {
    const out = await Fonts.prepare(s);
    if (out.mode === 'icon') {
      if (!(await Icons.load())) throw new Error('the icon library could not be loaded');
      if (!Icons.get(out.icon)) throw new Error('the icon “' + out.icon + '” isn’t in the library');
    }
    return out;
  }

  /** Build favicon.svg. Colors for dark mode are written in only when the settings ask for them. */
  async function svgText(s) {
    const status = svgStatus(s);
    if (!status.ok) throw new Error(status.reason);
    // The same shape, background, border and position as the PNG files, at 512 px.
    const o = {
      size: SVG_SIZE,
      shape: Svg.shapePath(s.shape, SVG_SIZE, (SVG_SIZE * s.radius) / 100),
      background: s.transparent ? null : { type: s.bgType, color: s.bg, color2: s.bg2, angle: s.angle },
      foreground: s.fg,
      dark: s.dark ? { background: s.darkBg, background2: s.darkBg2, foreground: s.darkFg } : null,
      border: s.border ? { width: Draw.borderPx(SVG_SIZE, s.borderWidth), color: s.borderColor } : null
    };
    if (s.mode === 'icon') {
      const l = Draw.iconLayout(SVG_SIZE, s);
      const shift = Draw.offsetPx(SVG_SIZE, s);
      o.icon = { d: Icons.get(s.icon), x: l.x + shift.x, y: l.y + shift.y, k: l.k, stroke: l.stroke };
    } else if (s.mode === 'image') {
      const l = Draw.imageLayout(SVG_SIZE, s, s.imageSvg.viewBox[2], s.imageSvg.viewBox[3]);
      const shift = Draw.offsetPx(SVG_SIZE, s);
      o.image = {
        svg: s.imageSvg,
        clip: { x: l.clip.x + shift.x, y: l.clip.y + shift.y, size: l.clip.size },
        x: l.x + shift.x, y: l.y + shift.y, w: l.w, h: l.h
      };
    } else {
      o.path = await textPath(s);
    }
    return Svg.icon(o);
  }

  /* ---------- Text outputs ---------- */

  /** The <head> snippet, with paths for the folder in the settings. */
  /**
   * The <head> snippet, with paths for the folder in the settings.
   * With favicon.svg, the ICO is marked 32x32 and the SVG "any": Chrome and Edge then pick the SVG, while
   * listing 16 and 32 px on the ICO makes them use the ICO instead. Browsers without SVG favicons skip the
   * link by its type and use the ICO and PNGs.
   */
  function snippet(s) {
    const base = basePath(s && s.basePath);
    const withSvg = !!s && svgStatus(s).ok;
    return [
      withSvg ? `<link rel="icon" href="${base}favicon.ico" sizes="32x32">` : `<link rel="icon" href="${base}favicon.ico" sizes="16x16 32x32 48x48">`,
      withSvg ? `<link rel="icon" href="${base}favicon.svg" type="image/svg+xml" sizes="any">` : null,
      `<link rel="icon" type="image/png" sizes="32x32" href="${base}favicon-32x32.png">`,
      `<link rel="icon" type="image/png" sizes="16x16" href="${base}favicon-16x16.png">`,
      `<link rel="apple-touch-icon" href="${base}apple-touch-icon.png">`,
      `<link rel="manifest" href="${base}site.webmanifest">`
    ].filter(Boolean).join('\n');
  }

  function manifestText(s) {
    const color = s.transparent ? '#ffffff' : s.bg;
    return JSON.stringify({
      name: s.appName,
      short_name: clip(s.appName, SHORT_NAME_MAX),
      // Relative to the manifest file, so they work at the site root and in any folder.
      // Normal and maskable icons are listed separately: "any maskable" would crop the normal ones.
      icons: [
        { src: 'android-chrome-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: 'maskable-icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ],
      theme_color: color,
      background_color: color,
      display: 'standalone'
    }, null, 2) + '\n';
  }

  /* ---------- Building files ---------- */

  function toBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`the browser could not make a ${canvas.width} px PNG`));
      }, 'image/png');
    });
  }

  /** Build one entry of FILES as a Blob, using the current settings. Images wait for their fonts first. */
  async function build(file, s) {
    if (file.kind === 'manifest') {
      return new Blob([manifestText(s)], { type: 'application/manifest+json' });
    }
    s = await prepare(s);
    if (file.kind === 'svg') {
      return new Blob([await svgText(s)], { type: 'image/svg+xml' });
    }
    if (file.kind === 'ico') {
      const blobs = await Promise.all(file.sizes.map((z) => toBlob(Draw.render(z, s))));
      const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()));
      return new Blob([Ico.make(file.sizes, buffers)], { type: 'image/x-icon' });
    }
    return toBlob(Draw.render(file.size, s, file.variant));
  }

  /** Build every file and pack them into one ZIP Blob. */
  async function buildZip(s) {
    s = await prepare(s);
    const entries = [];
    for (const file of FILES) {
      if (!available(file, s)) continue;
      const blob = await build(file, s);
      entries.push({ name: file.name, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    return Zip.make(entries);
  }

  return {
    FILES, TEXT_MAX, SHORT_NAME_MAX, SVG_NOTES, graphemes, clip, limitEdit, basePath, snippet,
    svgStatus, available, svgText, prepare, build, buildZip
  };
})();
