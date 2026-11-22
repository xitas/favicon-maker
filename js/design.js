/* A design as data: checking settings, format versions, undo history, share links and export files.
   Pure: no page state. Everything that comes from a link, a file or storage goes through validate() and
   is treated as untrusted. Depends on Zip (checksum), Fonts (font names), Outputs (text limits). */
const Design = (() => {
  'use strict';

  /** Format version of stored designs, exported files and share links. Bump it with a migration. */
  const FORMAT = 1;

  const DEFAULTS = Object.freeze({
    mode: 'text',
    text: 'F',
    font: 'sans',
    bold: true,
    emoji: 'system',
    textScale: 70,
    fg: '#ffffff',
    bg: '#0b7a75',
    transparent: false,
    radius: 22,
    maskPad: 10,
    dark: false,
    darkFg: '#0b7a75',
    darkBg: '#ffffff',
    fit: 'contain',
    pad: 0,
    appName: 'My App',
    basePath: '/'
  });

  const RANGES = { textScale: [30, 100], radius: [0, 50], maskPad: [0, 30], pad: [0, 30] };
  const CHOICES = { mode: ['text', 'image'], emoji: ['system', 'bundled'], fit: ['contain', 'cover'] };
  const COLORS = ['fg', 'bg', 'darkFg', 'darkBg'];
  const FLAGS = ['bold', 'transparent', 'dark'];
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
  const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
  const APP_NAME_MAX = 45;
  const BASE_PATH_MAX = 200;
  const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

  const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

  /**
   * A complete, safe set of design settings from anything: every known setting is checked against its
   * type and allowed values, and anything missing, invalid or unknown becomes the default.
   */
  function validate(input) {
    const src = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const out = Object.assign({}, DEFAULTS);
    for (const k of Object.keys(CHOICES)) {
      if (own(src, k) && CHOICES[k].indexOf(src[k]) !== -1) out[k] = src[k];
    }
    for (const k of Object.keys(RANGES)) {
      const v = own(src, k) ? src[k] : undefined;
      if (typeof v === 'number' && Number.isInteger(v) && v >= RANGES[k][0] && v <= RANGES[k][1]) out[k] = v;
    }
    for (const k of COLORS) {
      if (own(src, k) && typeof src[k] === 'string' && /^#[0-9a-f]{6}$/i.test(src[k])) out[k] = src[k].toLowerCase();
    }
    for (const k of FLAGS) {
      if (own(src, k) && typeof src[k] === 'boolean') out[k] = src[k];
    }
    if (own(src, 'font') && typeof src.font === 'string' && Fonts.key(src.font) === src.font) out.font = src.font;
    if (own(src, 'text') && typeof src.text === 'string') {
      out.text = Outputs.clip(src.text.replace(CONTROL, '').normalize('NFC'), Outputs.TEXT_MAX);
    }
    if (own(src, 'appName') && typeof src.appName === 'string') {
      const name = Array.from(src.appName.replace(CONTROL, '')).slice(0, APP_NAME_MAX).join('').trim();
      if (name) out.appName = name;
    }
    if (own(src, 'basePath') && typeof src.basePath === 'string' && src.basePath.length <= BASE_PATH_MAX) {
      out.basePath = src.basePath.replace(CONTROL, '');
    }
    return out;
  }

  /** True when settings are the same (both already validated). */
  function same(a, b) {
    return Object.keys(DEFAULTS).every((k) => a[k] === b[k]);
  }

  /** Only the settings that differ from the defaults, for short links. */
  function changes(s) {
    const out = {};
    for (const k of Object.keys(DEFAULTS)) if (s[k] !== DEFAULTS[k]) out[k] = s[k];
    return out;
  }

  /* ---------- Images ---------- */

  /** A safe image record { type, bytes } from untrusted input, or null. SVGs must still be cleaned. */
  function validateImage(image) {
    if (!image || typeof image !== 'object') return null;
    if (IMAGE_TYPES.indexOf(image.type) === -1) return null;
    let bytes = image.bytes;
    if (!(bytes instanceof Uint8Array) && bytes && typeof bytes.byteLength === 'number') bytes = new Uint8Array(bytes);
    if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > IMAGE_MAX_BYTES) return null;
    const name = typeof image.name === 'string' ? image.name.replace(CONTROL, '').slice(0, 120) : '';
    return { type: image.type, bytes, name };
  }

  /* ---------- Bytes and text ---------- */

  function utf8(text) {
    return new TextEncoder().encode(text);
  }

  function fromUtf8(bytes) {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function fromBase64(text) {
    if (typeof text !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 === 1) throw new Error('Bad base64');
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const toBase64Url = (bytes) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  function fromBase64Url(text) {
    if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error('Bad base64url');
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    return fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  }

  const hex8 = (n) => (n >>> 0).toString(16).padStart(8, '0');

  async function transform(bytes, stream) {
    const out = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }

  const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

  /* ---------- Versions ---------- */

  /**
   * Upgrade a stored, exported or linked design to the current format: { format, settings, image? }.
   * Format 0 is a bare settings object with no version. Each later step adds a migration here, e.g.
   * MIGRATIONS[1] = (d) => ({ ...d, format: 2, settings: { ...d.settings, newOption: ... } }).
   * Throws for anything that isn't a design, or a format newer than this page knows.
   */
  const MIGRATIONS = {
    0: (d) => ({ format: 1, settings: d, image: null })
  };

  function migrate(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('Not a design');
    let d = own(doc, 'format') ? doc : { format: 0, bare: doc };
    if (d.format === 0 && own(d, 'bare')) d = MIGRATIONS[0](d.bare);
    if (!Number.isInteger(d.format) || d.format < 0) throw new Error('Not a design');
    if (d.format > FORMAT) throw new Error('This design was made with a newer version of the app');
    while (d.format < FORMAT) d = MIGRATIONS[d.format](d);
    return { format: FORMAT, settings: validate(d.settings), image: d.image || null };
  }

  /* ---------- Undo history ---------- */

  /**
   * Undo and redo over design states. Changes with the same group key within `groupMs` (dragging a
   * slider, typing) become one step. At most `limit` steps are kept; the oldest are dropped.
   */
  class History {
    constructor(limit = 100, groupMs = 1000) {
      this.limit = limit;
      this.groupMs = groupMs;
      this.past = [];
      this.future = [];
      this.present = null;
      this.lastGroup = null;
      this.lastTime = 0;
    }

    /** Start over from a state, with nothing to undo or redo. */
    reset(state) {
      this.past = [];
      this.future = [];
      this.present = state;
      this.lastGroup = null;
    }

    /** Record a new state. Returns false when nothing changed. */
    record(state, group, now, equal) {
      const eq = equal || ((a, b) => JSON.stringify(a) === JSON.stringify(b));
      if (this.present !== null && eq(state, this.present)) return false;
      const merge = group && group === this.lastGroup && now - this.lastTime < this.groupMs && this.past.length > 0;
      if (!merge && this.present !== null) {
        this.past.push(this.present);
        if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
      }
      this.present = state;
      this.future = [];
      this.lastGroup = group || null;
      this.lastTime = now;
      return true;
    }

    canUndo() { return this.past.length > 0; }
    canRedo() { return this.future.length > 0; }

    undo() {
      if (!this.canUndo()) return null;
      this.future.push(this.present);
      this.present = this.past.pop();
      this.lastGroup = null;
      return this.present;
    }

    redo() {
      if (!this.canRedo()) return null;
      this.past.push(this.present);
      this.present = this.future.pop();
      this.lastGroup = null;
      return this.present;
    }
  }

  /* ---------- Share links ---------- */

  /** Longest share link, image included, before the image is left out. */
  const LINK_LIMIT = 8000;
  const PREFIX = 'd' + FORMAT;

  /**
   * The payload: the settings that differ from the defaults as JSON, then a newline and the image bytes.
   * (JSON never holds a raw newline, so the first one splits the two.)
   */
  function packPayload(settings, image) {
    const meta = { f: FORMAT, s: changes(validate(settings)) };
    if (image) meta.t = image.type;
    const json = utf8(JSON.stringify(meta));
    if (!image) return json;
    const out = new Uint8Array(json.length + 1 + image.bytes.length);
    out.set(json, 0);
    out[json.length] = 10;
    out.set(image.bytes, json.length + 1);
    return out;
  }

  function unpackPayload(bytes) {
    const nl = bytes.indexOf(10);
    const meta = JSON.parse(fromUtf8(nl === -1 ? bytes : bytes.subarray(0, nl)));
    if (!meta || typeof meta !== 'object' || !Number.isInteger(meta.f)) throw new Error('Not a design');
    const image = nl === -1 ? null : validateImage({ type: meta.t, bytes: bytes.slice(nl + 1) });
    if (nl !== -1 && !image) throw new Error('Bad image');
    const d = migrate({ format: meta.f, settings: meta.s, image });
    return { settings: d.settings, image: d.image };
  }

  /**
   * The hash part of a share link: "#d1=" + checksum + "." + the payload compressed with deflate-raw in
   * base64url, or "#d1r=" with the payload uncompressed where CompressionStream is missing. The checksum
   * is the CRC-32 of the uncompressed payload, so a damaged or cut-off link is always caught.
   */
  async function encodeHash(settings, image, options) {
    const compress = !(options && options.compress === false) && canCompress();
    const payload = packPayload(settings, image);
    const sum = hex8(Zip.crc32(payload));
    const body = compress ? await transform(payload, new CompressionStream('deflate-raw')) : payload;
    return '#' + PREFIX + (compress ? '' : 'r') + '=' + sum + '.' + toBase64Url(body);
  }

  /**
   * A full share link for a page at `base`. Leaves the image out when the link would be longer than
   * LINK_LIMIT; `imageLeftOut` says so.
   */
  async function shareLink(base, settings, image, options) {
    const page = String(base).replace(/#.*$/, '');
    let url = page + (await encodeHash(settings, image, options));
    let imageLeftOut = false;
    if (image && url.length > LINK_LIMIT) {
      url = page + (await encodeHash(settings, null, options));
      imageLeftOut = true;
    }
    return { url, imageLeftOut };
  }

  /** True when the hash looks like a share link (of any version), so the page should try to open it. */
  function isShareHash(hash) {
    return /^#d\d+r?=/.test(String(hash || ''));
  }

  /**
   * Read a share link's hash. Resolves to { settings, image } (image still to be cleaned if it's an SVG),
   * or throws when the link is damaged, cut off or not a design.
   */
  async function decodeHash(hash) {
    const m = /^#d(\d+)(r?)=([0-9a-f]{8})\.([A-Za-z0-9_-]+)$/.exec(String(hash || ''));
    if (!m) throw new Error('This link seems to be incomplete');
    try {
      let bytes = fromBase64Url(m[4]);
      if (!m[2]) {
        if (!canCompress()) throw new Error('This browser cannot open compressed links');
        bytes = await transform(bytes, new DecompressionStream('deflate-raw'));
      }
      if (hex8(Zip.crc32(bytes)) !== m[3]) throw new Error('Checksum');
      const d = unpackPayload(bytes);
      if (Number(m[1]) > FORMAT) throw new Error('newer');
      return d;
    } catch (e) {
      if (/newer version/.test(e.message)) throw e;
      throw new Error('This link seems to be incomplete');
    }
  }

  /* ---------- Export and import ---------- */

  const APP_ID = 'favicon-maker';

  /** A design as JSON text for a .json file, with the image as base64. */
  function toExport(name, settings, image, now) {
    const doc = {
      app: APP_ID,
      format: FORMAT,
      name: String(name || 'Favicon design'),
      saved: new Date(now || Date.now()).toISOString(),
      settings: validate(settings),
      image: image ? { type: image.type, name: image.name || '', data: toBase64(image.bytes) } : null
    };
    return JSON.stringify(doc, null, 2) + '\n';
  }

  /** Read an exported .json file. Resolves to { name, settings, image }, or throws if it isn't one. */
  function fromExport(text) {
    let doc;
    try {
      doc = JSON.parse(String(text));
    } catch (e) {
      throw new Error("This file isn't a favicon design");
    }
    if (!doc || typeof doc !== 'object' || doc.app !== APP_ID) throw new Error("This file isn't a favicon design");
    let image = null;
    if (doc.image) {
      try {
        image = validateImage({ type: doc.image.type, name: doc.image.name, bytes: fromBase64(doc.image.data) });
      } catch (e) {
        image = null;
      }
      if (!image) throw new Error("This file's image can't be used");
    }
    // A file without a format number is from before versions existed: its settings are format 0.
    const d = doc.format === undefined
      ? migrate(doc.settings && typeof doc.settings === 'object' ? doc.settings : {})
      : migrate({ format: doc.format, settings: doc.settings, image });
    const name = typeof doc.name === 'string' ? doc.name.replace(CONTROL, '').trim().slice(0, 80) : '';
    return { name: name || 'Imported design', settings: d.settings, image };
  }

  return {
    FORMAT, DEFAULTS, LINK_LIMIT, IMAGE_TYPES,
    validate, same, changes, validateImage, migrate, History,
    encodeHash, decodeHash, shareLink, isShareHash, toExport, fromExport,
    toBase64, fromBase64, toBase64Url, fromBase64Url
  };
})();
