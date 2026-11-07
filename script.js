(function () {
  'use strict';

  /* ---------- Settings ---------- */
  const $ = (id) => document.getElementById(id);

  const FONTS = {
    sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    display: 'Impact, "Arial Black", "Helvetica Neue", sans-serif'
  };

  const el = {
    modeText: $('modeText'), modeImage: $('modeImage'),
    textPanel: $('textPanel'), imagePanel: $('imagePanel'),
    text: $('text'), font: $('font'), bold: $('bold'), textScale: $('textScale'), textScaleOut: $('textScaleOut'), fg: $('fg'),
    file: $('file'), drop: $('drop'), dropText: $('dropText'), fileNote: $('fileNote'), fit: $('fit'), pad: $('pad'), padOut: $('padOut'),
    bg: $('bg'), transparent: $('transparent'), radius: $('radius'), radiusOut: $('radiusOut'), appName: $('appName'),
    tabA: $('tabA'), tabB: $('tabB'), tabTitleA: $('tabTitleA'), tabTitleB: $('tabTitleB'),
    sizes: $('sizes'), files: $('files'), zip: $('zip'), snippet: $('snippet'), copySnippet: $('copySnippet')
  };

  let mode = 'text';
  let image = null; // loaded HTMLImageElement for image mode

  function readSettings() {
    return {
      mode,
      text: Array.from(el.text.value).slice(0, 3).join(''),
      font: el.font.value,
      bold: el.bold.checked,
      textScale: Number(el.textScale.value),
      fg: el.fg.value,
      bg: el.bg.value,
      transparent: el.transparent.checked,
      radius: Number(el.radius.value),
      fit: el.fit.value,
      pad: Number(el.pad.value),
      appName: el.appName.value.trim() || 'My App'
    };
  }

  /* ---------- Drawing ---------- */
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

  /* `apple` draws a full-bleed opaque square, because iOS adds its own rounded corners. */
  function drawIcon(ctx, size, s, apple) {
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

  function render(size, apple) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    drawIcon(canvas.getContext('2d'), size, readSettings(), !!apple);
    return canvas;
  }

  /* ---------- Output files ---------- */
  const OUTPUTS = [
    { name: 'favicon.ico', kind: 'ico', sizes: [16, 32, 48], note: 'Legacy browsers. Holds 16, 32 and 48 px.', dims: '16, 32, 48' },
    { name: 'favicon-16x16.png', kind: 'png', size: 16, note: 'Browser tab', dims: '16 × 16' },
    { name: 'favicon-32x32.png', kind: 'png', size: 32, note: 'Browser tab on high-DPI screens', dims: '32 × 32' },
    { name: 'apple-touch-icon.png', kind: 'png', size: 180, apple: true, note: 'iPhone and iPad home screen (square, no transparency)', dims: '180 × 180' },
    { name: 'android-chrome-192x192.png', kind: 'png', size: 192, note: 'Android home screen', dims: '192 × 192' },
    { name: 'android-chrome-512x512.png', kind: 'png', size: 512, note: 'Android splash screen and installs', dims: '512 × 512' },
    { name: 'site.webmanifest', kind: 'manifest', note: 'Web app manifest that points to the Android icons', dims: 'JSON' }
  ];

  const PREVIEW_SIZES = [16, 32, 48, 180, 512];

  const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

  function manifestText() {
    const s = readSettings();
    return JSON.stringify({
      name: s.appName,
      short_name: s.appName.slice(0, 12),
      icons: [
        { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' }
      ],
      theme_color: s.transparent ? '#ffffff' : s.bg,
      background_color: s.transparent ? '#ffffff' : s.bg,
      display: 'standalone'
    }, null, 2) + '\n';
  }

  /* ICO file that stores PNG images (supported by all current browsers). */
  function makeIco(sizes, buffers) {
    const n = sizes.length;
    let offset = 6 + 16 * n;
    const total = offset + buffers.reduce((sum, b) => sum + b.byteLength, 0);
    const out = new ArrayBuffer(total);
    const dv = new DataView(out);
    const bytes = new Uint8Array(out);
    dv.setUint16(0, 0, true);
    dv.setUint16(2, 1, true);
    dv.setUint16(4, n, true);
    sizes.forEach((size, i) => {
      const p = 6 + 16 * i;
      dv.setUint8(p, size >= 256 ? 0 : size);
      dv.setUint8(p + 1, size >= 256 ? 0 : size);
      dv.setUint8(p + 2, 0);
      dv.setUint8(p + 3, 0);
      dv.setUint16(p + 4, 1, true);
      dv.setUint16(p + 6, 32, true);
      dv.setUint32(p + 8, buffers[i].byteLength, true);
      dv.setUint32(p + 12, offset, true);
      bytes.set(new Uint8Array(buffers[i]), offset);
      offset += buffers[i].byteLength;
    });
    return out;
  }

  async function buildFile(o) {
    if (o.kind === 'manifest') return new Blob([manifestText()], { type: 'application/manifest+json' });
    if (o.kind === 'ico') {
      const blobs = await Promise.all(o.sizes.map((z) => toBlob(render(z))));
      const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()));
      return new Blob([makeIco(o.sizes, buffers)], { type: 'image/x-icon' });
    }
    return toBlob(render(o.size, o.apple));
  }

  /* ---------- ZIP (stored, no compression) ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeZip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    let offset = 0;

    files.forEach((f) => {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true);
      lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true);
      lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true);
      ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);

      offset += 30 + name.length + size;
    });

    const centralSize = central.reduce((sum, p) => sum + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- Page build ---------- */
  const previews = []; // { canvas, size }
  const thumbs = [];   // { canvas, size, apple }

  function buildPreviewList() {
    PREVIEW_SIZES.forEach((size) => {
      const li = document.createElement('li');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.style.width = Math.min(size, 128) + 'px';
      canvas.style.height = Math.min(size, 128) + 'px';
      canvas.setAttribute('aria-label', size + ' pixel preview');
      const cap = document.createElement('span');
      cap.className = 'cap';
      cap.textContent = size + ' px' + (size > 128 ? ' (scaled)' : '');
      li.append(canvas, cap);
      el.sizes.appendChild(li);
      previews.push({ canvas, size });
    });
  }

  function buildFileList() {
    OUTPUTS.forEach((o) => {
      const li = document.createElement('li');

      let lead;
      if (o.kind === 'manifest') {
        lead = document.createElement('div');
        lead.className = 'doc';
        lead.textContent = 'JSON';
      } else {
        lead = document.createElement('canvas');
        lead.width = lead.height = 80;
        thumbs.push({ canvas: lead, size: 80, apple: !!o.apple });
        lead.setAttribute('aria-hidden', 'true');
      }

      const meta = document.createElement('div');
      meta.className = 'meta';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = o.name;
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = o.dims + ' · ' + o.note;
      meta.append(name, note);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Download';
      btn.setAttribute('aria-label', 'Download ' + o.name);
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try { saveBlob(await buildFile(o), o.name); } finally { btn.disabled = false; }
      });

      li.append(lead, meta, btn);
      el.files.appendChild(li);
    });
  }

  const SNIPPET = [
    '<link rel="icon" href="/favicon.ico" sizes="48x48">',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">'
  ].join('\n');

  /* ---------- Refresh ---------- */
  let queued = false;
  function refresh() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const s = readSettings();

      previews.forEach((p) => drawIcon(p.canvas.getContext('2d'), p.size, s, false));
      thumbs.forEach((t) => drawIcon(t.canvas.getContext('2d'), t.size, s, t.apple));
      [el.tabA, el.tabB].forEach((c) => drawIcon(c.getContext('2d'), 32, s, false));
      el.tabTitleA.textContent = el.tabTitleB.textContent = s.appName;

      el.textScaleOut.textContent = s.textScale + '%';
      el.padOut.textContent = s.pad + '%';
      el.radiusOut.textContent = s.radius + '%';
      el.bg.disabled = s.transparent;
    });
  }

  function setMode(next) {
    mode = next;
    el.modeText.setAttribute('aria-pressed', String(next === 'text'));
    el.modeImage.setAttribute('aria-pressed', String(next === 'image'));
    el.textPanel.hidden = next !== 'text';
    el.imagePanel.hidden = next !== 'image';
    refresh();
  }

  /* ---------- Image loading ---------- */
  function loadFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      el.fileNote.textContent = 'That file is not an image. Choose a PNG, JPG, SVG or WebP.';
      el.fileNote.className = 'hint err';
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      image = img;
      el.dropText.textContent = file.name;
      el.fileNote.textContent = (img.naturalWidth || '?') + ' × ' + (img.naturalHeight || '?') + ' px. Choose another image any time.';
      el.fileNote.className = 'hint';
      refresh();
    };
    img.onerror = () => {
      el.fileNote.textContent = 'This image could not be read. Try a PNG or JPG.';
      el.fileNote.className = 'hint err';
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  /* ---------- Events ---------- */
  el.modeText.addEventListener('click', () => setMode('text'));
  el.modeImage.addEventListener('click', () => setMode('image'));

  ['text', 'font', 'bold', 'textScale', 'fg', 'fit', 'pad', 'bg', 'transparent', 'radius', 'appName'].forEach((k) => {
    el[k].addEventListener('input', refresh);
    el[k].addEventListener('change', refresh);
  });

  el.file.addEventListener('change', (e) => { loadFile(e.target.files && e.target.files[0]); });
  ['dragenter', 'dragover'].forEach((t) => el.drop.addEventListener(t, (e) => { e.preventDefault(); el.drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => el.drop.addEventListener(t, (e) => { e.preventDefault(); el.drop.classList.remove('over'); }));
  el.drop.addEventListener('drop', (e) => { loadFile(e.dataTransfer && e.dataTransfer.files[0]); });

  el.zip.addEventListener('click', async () => {
    el.zip.disabled = true;
    const label = el.zip.textContent;
    el.zip.textContent = 'Preparing…';
    try {
      const files = [];
      for (const o of OUTPUTS) {
        const blob = await buildFile(o);
        files.push({ name: o.name, data: new Uint8Array(await blob.arrayBuffer()) });
      }
      saveBlob(makeZip(files), 'favicons.zip');
    } finally {
      el.zip.disabled = false;
      el.zip.textContent = label;
    }
  });

  el.copySnippet.addEventListener('click', () => {
    const done = () => {
      el.copySnippet.textContent = 'Copied';
      setTimeout(() => { el.copySnippet.textContent = 'Copy'; }, 1500);
    };
    const fallback = () => {
      const r = document.createRange();
      r.selectNodeContents(el.snippet);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      el.copySnippet.textContent = 'Press Ctrl/Cmd + C';
      setTimeout(() => { el.copySnippet.textContent = 'Copy'; }, 2500);
    };
    try { navigator.clipboard.writeText(SNIPPET).then(done, fallback); } catch (e) { fallback(); }
  });

  /* ---------- Start ---------- */
  buildPreviewList();
  buildFileList();
  el.snippet.querySelector('code').textContent = SNIPPET;
  refresh();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
})();
