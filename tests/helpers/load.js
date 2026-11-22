'use strict';
/*
 * Loads the browser scripts from js/ into a node:vm context, in the same order
 * as index.html, without changing them. Each script declares one top-level
 * `const` (Zip, Ico, Shrink, Svg, Fonts, Icons, Draw, Outputs, Design, Store). Top-level `const` bindings are shared by
 * every script run in the same context, just like plain <script> tags on a page.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

/** Same order as the <script> tags in index.html (app.js needs a real page, so it is left out). */
const SCRIPTS = ['js/lib/zip.js', 'js/lib/ico.js', 'js/lib/shrink.js', 'js/lib/svg.js', 'js/fonts.js', 'js/icons.js', 'js/draw.js', 'js/outputs.js', 'js/design.js', 'js/store.js', 'js/checks.js'];

/**
 * @param {object} [options]
 * @param {Date} [options.now]  freeze `new Date()` inside the scripts at this moment
 * @param {boolean} [options.withoutCompression]  no CompressionStream, like an older browser
 * @param {boolean} [options.withoutSegmenter]  remove Intl.Segmenter, like a browser that doesn't have it
 * @returns {{ Zip: any, Ico: any, Shrink: any, Svg: any, Fonts: any, Draw: any, Outputs: any, context: object }}
 */
function loadScripts(options = {}) {
  const context = vm.createContext({
    Blob, TextEncoder, TextDecoder, URL, console, btoa, atob, Response,
    CompressionStream: options.withoutCompression ? undefined : CompressionStream,
    DecompressionStream: options.withoutCompression ? undefined : DecompressionStream
  });

  if (options.withoutSegmenter) {
    vm.runInContext('delete Intl.Segmenter;', context);
  }

  if (options.now) {
    context.__FIXED_NOW__ = options.now.getTime();
    vm.runInContext(`
      (() => {
        const RealDate = Date;
        const fixed = __FIXED_NOW__;
        class FixedDate extends RealDate {
          constructor(...args) { super(...(args.length ? args : [fixed])); }
          static now() { return fixed; }
        }
        globalThis.Date = FixedDate;
      })();
    `, context);
  }

  for (const rel of SCRIPTS) {
    const file = path.join(ROOT, rel);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }

  const exported = vm.runInContext('({ Zip, Ico, Shrink, Svg, Fonts, Icons, Draw, Outputs, Design, Store, Checks })', context);
  return { ...exported, context };
}

/** Bytes from a Blob, ArrayBuffer or typed array, as a Node Buffer (works across vm realms). */
async function toBuffer(value) {
  if (value && typeof value.arrayBuffer === 'function') value = await value.arrayBuffer();
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return Buffer.from(value);
}

module.exports = { ROOT, SCRIPTS, loadScripts, toBuffer };
