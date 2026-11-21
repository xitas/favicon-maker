/* The files the generator produces, and how to build each one, plus the pure text and path helpers they use.
   Depends on Draw, Ico, Zip. */
const Outputs = (() => {
  'use strict';

  /** Most visible characters that still read at 16 px. */
  const TEXT_MAX = 3;
  /** Most visible characters in the manifest short_name. */
  const SHORT_NAME_MAX = 12;

  const FILES = [
    { name: 'favicon.ico', kind: 'ico', sizes: [16, 32, 48], note: 'Legacy browsers. Holds 16, 32 and 48 px.', dims: '16, 32, 48' },
    { name: 'favicon-16x16.png', kind: 'png', size: 16, note: 'Browser tab', dims: '16 × 16' },
    { name: 'favicon-32x32.png', kind: 'png', size: 32, note: 'Browser tab on high-DPI screens', dims: '32 × 32' },
    { name: 'apple-touch-icon.png', kind: 'png', size: 180, apple: true, note: 'iPhone and iPad home screen (square, no transparency)', dims: '180 × 180' },
    { name: 'android-chrome-192x192.png', kind: 'png', size: 192, note: 'Android home screen', dims: '192 × 192' },
    { name: 'android-chrome-512x512.png', kind: 'png', size: 512, note: 'Android splash screen and installs', dims: '512 × 512' },
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

  /* ---------- Text outputs ---------- */

  /** The <head> snippet, with paths for the folder in the settings. */
  function snippet(s) {
    const base = basePath(s && s.basePath);
    return [
      `<link rel="icon" href="${base}favicon.ico" sizes="16x16 32x32 48x48">`,
      `<link rel="icon" type="image/png" sizes="32x32" href="${base}favicon-32x32.png">`,
      `<link rel="icon" type="image/png" sizes="16x16" href="${base}favicon-16x16.png">`,
      `<link rel="apple-touch-icon" href="${base}apple-touch-icon.png">`,
      `<link rel="manifest" href="${base}site.webmanifest">`
    ].join('\n');
  }

  function manifestText(s) {
    const color = s.transparent ? '#ffffff' : s.bg;
    return JSON.stringify({
      name: s.appName,
      short_name: clip(s.appName, SHORT_NAME_MAX),
      // Relative to the manifest file, so they work at the site root and in any folder.
      icons: [
        { src: 'android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: 'android-chrome-512x512.png', sizes: '512x512', type: 'image/png' }
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

  /** Build one entry of FILES as a Blob, using the current settings. */
  async function build(file, s) {
    if (file.kind === 'manifest') {
      return new Blob([manifestText(s)], { type: 'application/manifest+json' });
    }
    if (file.kind === 'ico') {
      const blobs = await Promise.all(file.sizes.map((z) => toBlob(Draw.render(z, s))));
      const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()));
      return new Blob([Ico.make(file.sizes, buffers)], { type: 'image/x-icon' });
    }
    return toBlob(Draw.render(file.size, s, file.apple));
  }

  /** Build every file and pack them into one ZIP Blob. */
  async function buildZip(s) {
    const entries = [];
    for (const file of FILES) {
      const blob = await build(file, s);
      entries.push({ name: file.name, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    return Zip.make(entries);
  }

  return { FILES, TEXT_MAX, SHORT_NAME_MAX, graphemes, clip, limitEdit, basePath, snippet, build, buildZip };
})();
