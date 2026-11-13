/* Page UI: reads the form, keeps previews in sync and wires up downloads. Depends on Draw, Outputs. */
(function () {
  'use strict';

  const PREVIEW_SIZES = [16, 32, 48, 180, 512];
  const THUMB_SIZE = 80;

  /* ---------- Elements and state ---------- */
  const $ = (id) => document.getElementById(id);

  const el = {
    modeText: $('modeText'), modeImage: $('modeImage'),
    textPanel: $('textPanel'), imagePanel: $('imagePanel'),
    text: $('text'), font: $('font'), bold: $('bold'), textScale: $('textScale'), textScaleOut: $('textScaleOut'), fg: $('fg'),
    file: $('file'), drop: $('drop'), dropText: $('dropText'), fileNote: $('fileNote'), fit: $('fit'), pad: $('pad'), padOut: $('padOut'),
    bg: $('bg'), transparent: $('transparent'), radius: $('radius'), radiusOut: $('radiusOut'), appName: $('appName'),
    tabA: $('tabA'), tabB: $('tabB'), tabTitleA: $('tabTitleA'), tabTitleB: $('tabTitleB'),
    sizes: $('sizes'), files: $('files'), zip: $('zip'), snippet: $('snippet'), copySnippet: $('copySnippet')
  };

  const INPUTS = ['text', 'font', 'bold', 'textScale', 'fg', 'fit', 'pad', 'bg', 'transparent', 'radius', 'appName'];

  let mode = 'text';
  let image = null; // loaded HTMLImageElement for image mode

  const previews = []; // { canvas, size }
  const thumbs = [];   // { canvas, size, apple }

  function readSettings() {
    return {
      mode,
      image,
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

  /* ---------- Helpers ---------- */
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

  function setNote(text, isError) {
    el.fileNote.textContent = text;
    el.fileNote.className = isError ? 'hint err' : 'hint';
  }

  /* ---------- Page build ---------- */
  function buildPreviewList() {
    PREVIEW_SIZES.forEach((size) => {
      const li = document.createElement('li');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.style.width = canvas.style.height = Math.min(size, 128) + 'px';
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
    Outputs.FILES.forEach((file) => {
      const li = document.createElement('li');

      let lead;
      if (file.kind === 'manifest') {
        lead = document.createElement('div');
        lead.className = 'doc';
        lead.textContent = 'JSON';
      } else {
        lead = document.createElement('canvas');
        lead.width = lead.height = THUMB_SIZE;
        lead.setAttribute('aria-hidden', 'true');
        thumbs.push({ canvas: lead, size: THUMB_SIZE, apple: !!file.apple });
      }

      const meta = document.createElement('div');
      meta.className = 'meta';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = file.name;
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = file.dims + ' · ' + file.note;
      meta.append(name, note);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Download';
      btn.setAttribute('aria-label', 'Download ' + file.name);
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try { saveBlob(await Outputs.build(file, readSettings()), file.name); } finally { btn.disabled = false; }
      });

      li.append(lead, meta, btn);
      el.files.appendChild(li);
    });
  }

  /* ---------- Refresh ---------- */
  let queued = false;
  function refresh() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const s = readSettings();

      previews.forEach((p) => Draw.icon(p.canvas.getContext('2d'), p.size, s, false));
      thumbs.forEach((t) => Draw.icon(t.canvas.getContext('2d'), t.size, s, t.apple));
      [el.tabA, el.tabB].forEach((c) => Draw.icon(c.getContext('2d'), 32, s, false));
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
      setNote('That file is not an image. Choose a PNG, JPG, SVG or WebP.', true);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      image = img;
      el.dropText.textContent = file.name;
      setNote((img.naturalWidth || '?') + ' × ' + (img.naturalHeight || '?') + ' px. Choose another image any time.', false);
      refresh();
    };
    img.onerror = () => {
      setNote('This image could not be read. Try a PNG or JPG.', true);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  /* ---------- Events ---------- */
  function bindEvents() {
    el.modeText.addEventListener('click', () => setMode('text'));
    el.modeImage.addEventListener('click', () => setMode('image'));

    INPUTS.forEach((k) => {
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
        saveBlob(await Outputs.buildZip(readSettings()), 'favicons.zip');
      } finally {
        el.zip.disabled = false;
        el.zip.textContent = label;
      }
    });

    el.copySnippet.addEventListener('click', () => {
      const flash = (text, ms) => {
        el.copySnippet.textContent = text;
        setTimeout(() => { el.copySnippet.textContent = 'Copy'; }, ms);
      };
      const fallback = () => {
        const r = document.createRange();
        r.selectNodeContents(el.snippet);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        flash('Press Ctrl/Cmd + C', 2500);
      };
      try { navigator.clipboard.writeText(Outputs.SNIPPET).then(() => flash('Copied', 1500), fallback); } catch (e) { fallback(); }
    });
  }

  /* ---------- Start ---------- */
  buildPreviewList();
  buildFileList();
  el.snippet.querySelector('code').textContent = Outputs.SNIPPET;
  bindEvents();
  refresh();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
})();
