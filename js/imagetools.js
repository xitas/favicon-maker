/* Image helpers with no page state: what a paste or drop holds, crop math, trimming empty edges, and
   colors taken from an image. Pure functions on plain values and RGBA pixel buffers. */
const ImageTools = (() => {
  'use strict';

  /* ---------- Paste and drop ---------- */

  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
  const SAVE_FIRST = 'Save the image first, then drop or paste it here.';

  /** True for text that is an SVG document (as copied from an editor or a page's source). */
  function isSvgText(text) {
    const t = String(text || '').replace(/^﻿/, '').trim();
    return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(t) && /<\/svg>\s*$/i.test(t);
  }

  /** True for text that is only a web address (one link, maybe in a list of addresses). */
  function isAddress(text) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l[0] !== '#');
    return lines.length > 0 && lines.every((l) => /^(https?:|data:|blob:|file:|\/\/)\S+$/i.test(l));
  }

  /**
   * What a paste or drop gives us, from its parts: files (with a type), plain text, HTML and a list of
   * addresses. Returns { kind: 'file', file } for an image file, { kind: 'svg', text } for SVG code,
   * { kind: 'address', message } when there is only a link to an image (which we never download),
   * or { kind: 'none' }.
   */
  function classify(parts) {
    const files = (parts.files || []).filter((f) => f && (IMAGE_TYPES.indexOf(f.type) !== -1 || /^image\//.test(f.type || '') || /\.svg$/i.test(f.name || '')));
    if (files.length) return { kind: 'file', file: files[0] };
    const text = parts.text || '';
    if (isSvgText(text)) return { kind: 'svg', text: text.trim() };
    const html = parts.html || '';
    const htmlImage = /<img\b[^>]*\bsrc\s*=/i.test(html);
    if (parts.uriList || isAddress(text) || htmlImage) return { kind: 'address', message: SAVE_FIRST };
    return { kind: 'none' };
  }

  return { IMAGE_TYPES, SAVE_FIRST, isSvgText, isAddress, classify };
})();
