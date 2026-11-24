/* A design as data: checking settings, format versions, undo history, share links and export files.
   Pure: no page state. Everything that comes from a link, a file or storage goes through validate() and
   is treated as untrusted. Depends on Zip (checksum), Fonts (font names), Icons (icon names), Outputs (text limits). */
const Design = (() => {
  'use strict';

  /** Format version of stored designs, exported files and share links. Bump it with a migration. */
  const FORMAT = 3;

  /** The settings of format 1, with their defaults then. Old share links only hold changes from these. */
  const V1_DEFAULTS = Object.freeze({
    mode: 'text', text: 'F', font: 'sans', bold: true, emoji: 'system', textScale: 70, fg: '#ffffff', bg: '#0b7a75',
    transparent: false, radius: 22, maskPad: 10, dark: false, darkFg: '#0b7a75', darkBg: '#ffffff', fit: 'contain',
    pad: 0, appName: 'My App', basePath: '/'
  });

  /** Settings added in format 2, with the values that keep a format 1 design looking the same. */
  const V2_ADDED = Object.freeze({
    shape: 'rounded', bgType: 'solid', bg2: '#073f3c', angle: 135, darkBg2: '#d9d9d9',
    border: false, borderWidth: 4, borderColor: '#ffffff', offsetX: 0, offsetY: 0,
    icon: 'star', iconStroke: 2, iconScale: 70
  });

  /** The settings of format 2 and their defaults then: format 1's plus what format 2 added. */
  const V2_DEFAULTS = Object.freeze(Object.assign({}, V1_DEFAULTS, V2_ADDED));

  /** Settings added in format 3 (cropping uploaded images), with the values that change nothing. */
  const V3_ADDED = Object.freeze({ cropZoom: 100, cropX: 0, cropY: 0 });

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
    basePath: '/',
    shape: 'rounded',
    bgType: 'solid',
    bg2: '#073f3c',
    angle: 135,
    darkBg2: '#d9d9d9',
    border: false,
    borderWidth: 4,
    borderColor: '#ffffff',
    offsetX: 0,
    offsetY: 0,
    icon: 'star',
    iconStroke: 2,
    iconScale: 70,
    cropZoom: 100,
    cropX: 0,
    cropY: 0
  });

  const RANGES = {
    textScale: [30, 100], radius: [0, 50], maskPad: [0, 30], pad: [0, 30],
    angle: [0, 360], borderWidth: [1, 15], offsetX: [-20, 20], offsetY: [-20, 20], iconScale: [30, 100], cropZoom: [100, 800]
  };
  const CHOICES = {
    mode: ['text', 'image', 'icon'], emoji: ['system', 'bundled'], fit: ['contain', 'cover'],
    shape: ['rounded', 'circle', 'squircle', 'square'], bgType: ['solid', 'linear', 'radial']
  };
  const COLORS = ['fg', 'bg', 'bg2', 'darkFg', 'darkBg', 'darkBg2', 'borderColor'];
  const FLAGS = ['bold', 'transparent', 'dark', 'border'];
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
    // An icon is stored by name only; whether the set has it is checked when it is drawn.
    if (own(src, 'icon') && Icons.validName(src.icon)) out.icon = src.icon;
    const stroke = own(src, 'iconStroke') ? src.iconStroke : undefined;
    if (typeof stroke === 'number' && stroke >= 0.5 && stroke <= 3 && Number.isInteger(stroke * 4)) out.iconStroke = stroke;
    // Crop position: percent of the frame, to one decimal (the crop math limits it further).
    for (const k of ['cropX', 'cropY']) {
      const v = own(src, k) ? src[k] : undefined;
      if (typeof v === 'number' && v >= -1000 && v <= 1000 && Math.abs(v * 10 - Math.round(v * 10)) < 1e-9) out[k] = v;
    }
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
    0: (d) => ({ format: 1, settings: d, image: null }),
    // Format 2 added shapes, gradients, a border and position offsets. Format 1 settings that are missing
    // (links only kept changes from the defaults) get the format 1 defaults, and the new ones get values
    // that look exactly as before. Only known keys are copied, so nothing else comes along.
    1: (d) => {
      const src = d.settings !== null && typeof d.settings === 'object' && !Array.isArray(d.settings) ? d.settings : {};
      const settings = {};
      for (const k of Object.keys(V1_DEFAULTS)) settings[k] = own(src, k) ? src[k] : V1_DEFAULTS[k];
      for (const k of Object.keys(V2_ADDED)) settings[k] = V2_ADDED[k];
      return { format: 2, settings, image: d.image || null };
    },
    // Format 3 added cropping. Missing format 2 settings get the format 2 defaults (again, links only kept
    // changes), and the crop starts where it changes nothing.
    2: (d) => {
      const src = d.settings !== null && typeof d.settings === 'object' && !Array.isArray(d.settings) ? d.settings : {};
      const settings = {};
      for (const k of Object.keys(V2_DEFAULTS)) settings[k] = own(src, k) ? src[k] : V2_DEFAULTS[k];
      for (const k of Object.keys(V3_ADDED)) settings[k] = V3_ADDED[k];
      return { format: 3, settings, image: d.image || null };
    }
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

    /**
     * Undo a change that couldn't be made (a font that isn't available offline), putting `state` (the
     * design as it was) back as the latest state, with nothing to redo. When the step before is that
     * state, it's a plain step back; when the change was merged into a step (quick changes to one control),
     * that step becomes `state`.
     */
    revert(state, equal) {
      const eq = equal || ((a, b) => JSON.stringify(a) === JSON.stringify(b));
      if (this.past.length && eq(this.past[this.past.length - 1], state)) this.present = this.past.pop();
      else this.present = state;
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
    FORMAT, DEFAULTS, V1_DEFAULTS, V2_DEFAULTS, LINK_LIMIT, IMAGE_TYPES, RANGES, CHOICES,
    validate, same, changes, validateImage, migrate, History,
    encodeHash, decodeHash, shareLink, isShareHash, toExport, fromExport,
    toBase64, fromBase64, toBase64Url, fromBase64Url
  };
})();
