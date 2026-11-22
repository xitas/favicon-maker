/* Page UI: reads the form, keeps previews in sync and wires up downloads. Depends on Fonts, Draw, Outputs. */
(function () {
  'use strict';

  const PREVIEW_SIZES = [16, 32, 48, 180, 512];
  const THUMB_SIZE = 80;
  const TEXT_LIMIT_NOTE = 'Up to ' + Outputs.TEXT_MAX + ' characters fit in a favicon.';
  const NO_IMAGE_NOTE = 'Choose an image first.';
  const GLYPH_NOTE = "This character isn't in the chosen font, so it may look different on other computers.";
  const GLYPHS_NOTE = "These characters aren't in the chosen font, so they may look different on other computers.";
  const EMOJI_LOADING_NOTE = 'Loading the emoji font…';
  const EMOJI_FALLBACK_NOTE = "This browser can't draw the bundled emoji, so this device's emoji are used instead.";

  /* ---------- Elements and state ---------- */
  const $ = (id) => document.getElementById(id);

  const el = {
    modeText: $('modeText'), modeImage: $('modeImage'),
    textPanel: $('textPanel'), imagePanel: $('imagePanel'),
    text: $('text'), textCount: $('textCount'), textNote: $('textNote'), glyphNote: $('glyphNote'),
    font: $('font'), fontNote: $('fontNote'), bold: $('bold'), emoji: $('emoji'), emojiNote: $('emojiNote'), textScale: $('textScale'), textScaleOut: $('textScaleOut'), fg: $('fg'),
    file: $('file'), drop: $('drop'), dropText: $('dropText'), fileNote: $('fileNote'), fit: $('fit'), pad: $('pad'), padOut: $('padOut'),
    bg: $('bg'), transparent: $('transparent'), radius: $('radius'), radiusOut: $('radiusOut'), appName: $('appName'),
    heroIcon: $('heroIcon'), tabA: $('tabA'), tabB: $('tabB'), tabTitleA: $('tabTitleA'), tabTitleB: $('tabTitleB'),
    sizes: $('sizes'), files: $('files'), filesNote: $('filesNote'), zip: $('zip'),
    basePath: $('basePath'), snippet: $('snippet'), copySnippet: $('copySnippet')
  };

  const RANGES = ['textScale', 'pad', 'radius'];
  const INPUTS = ['text', 'font', 'bold', 'emoji', 'textScale', 'fg', 'fit', 'pad', 'bg', 'transparent', 'radius', 'appName', 'basePath'];

  let mode = 'text';
  let image = null;    // loaded HTMLImageElement for image mode
  let imageUrl = null; // its object URL, released when another image replaces it

  const previews = []; // { canvas, size }
  const thumbs = [];   // { canvas, size, apple }
  const downloads = []; // { button, busy, note } for every download button

  function readSettings() {
    return {
      mode,
      image,
      text: Outputs.clip(el.text.value, Outputs.TEXT_MAX),
      font: el.font.value,
      bold: el.bold.checked,
      emoji: el.emoji.value,
      textScale: Number(el.textScale.value),
      fg: el.fg.value,
      bg: el.bg.value,
      transparent: el.transparent.checked,
      radius: Number(el.radius.value),
      fit: el.fit.value,
      pad: Number(el.pad.value),
      appName: el.appName.value.trim() || 'My App',
      basePath: el.basePath.value
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

  /** Set a status line. Errors are styled by .err; an empty string clears it. */
  function setStatus(node, text, isError) {
    node.textContent = text;
    node.classList.toggle('err', !!isError && !!text);
  }

  function setNote(text, isError) {
    setStatus(el.fileNote, text, isError);
  }

  const failMessage = (name, err) =>
    'Could not create ' + name + (err && err.message ? ': ' + err.message : '') + '. Try again.';

  /* ---------- Text limit ---------- */
  let lastText = el.text.value;
  let lastSelection = [lastText.length, lastText.length];

  /** Keep the text box at TEXT_MAX visible characters without ever splitting one. */
  function enforceTextLimit() {
    const max = Outputs.TEXT_MAX;
    const result = Outputs.limitEdit(lastText, lastSelection[0], lastSelection[1], el.text.value, max);
    const over = result.over;
    if (over) {
      el.text.value = result.value;
      el.text.setSelectionRange(result.caret, result.caret);
    }
    lastText = el.text.value;
    lastSelection = [el.text.selectionEnd, el.text.selectionEnd];
    const count = Outputs.graphemes(lastText).length;
    el.textCount.textContent = count + ' / ' + max;
    if (over) setStatus(el.textNote, TEXT_LIMIT_NOTE, false);
    else if (count < max) setStatus(el.textNote, '', false);
  }

  /* ---------- Font menu ---------- */
  /** One option per bundled font, each shown in its own font where the browser allows it. */
  function buildFontMenu() {
    Fonts.registerPreviews();
    Fonts.keys().forEach((k) => {
      const option = document.createElement('option');
      option.value = k;
      option.textContent = Fonts.label(k);
      option.style.fontFamily = '"' + Fonts.previewFamily(k) + '", var(--font-ui)';
      el.font.appendChild(option);
    });
    el.font.value = Fonts.key('sans');
  }

  /** Show the chosen font's name in that font, and turn Bold off for fonts with one weight. */
  function updateFontControls() {
    const k = Fonts.key(el.font.value);
    el.font.style.fontFamily = '"' + Fonts.previewFamily(k) + '", var(--font-ui)';
    const bold = Fonts.hasBold(k);
    el.bold.disabled = !bold;
    if (!bold) setStatus(el.fontNote, Fonts.info(k).label + ' has one weight, so Bold is off.', false);
    else if (!el.fontNote.classList.contains('err')) setStatus(el.fontNote, '', false);
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

  /** Run a download: busy state while it builds, and a message near the button if it fails. */
  async function runDownload(entry, name, buildBlob) {
    entry.busy = true;
    setStatus(entry.note, '', false);
    updateDownloads();
    try {
      saveBlob(await buildBlob(), name);
    } catch (err) {
      setStatus(entry.note, failMessage(name, err), true);
    } finally {
      entry.busy = false;
      updateDownloads();
    }
  }

  function buildFileList() {
    Outputs.FILES.forEach((file, i) => {
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
      const status = document.createElement('p');
      status.className = 'hint note-line';
      status.id = 'fileStatus' + i;
      status.setAttribute('role', 'status');
      meta.append(name, note, status);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Download';
      btn.setAttribute('aria-label', 'Download ' + file.name);
      btn.setAttribute('aria-describedby', status.id + ' filesNote');
      const entry = { button: btn, busy: false, note: status };
      downloads.push(entry);
      btn.addEventListener('click', () => runDownload(entry, file.name, () => Outputs.build(file, readSettings())));

      li.append(lead, meta, btn);
      el.files.appendChild(li);
    });
  }

  /** Enable or disable the Download buttons: busy while building, and off in image mode with no image. */
  function updateDownloads() {
    const needsImage = mode === 'image' && !image;
    downloads.forEach((d) => { d.button.disabled = needsImage || d.busy; });
    if (needsImage) setStatus(el.filesNote, NO_IMAGE_NOTE, false);
    else if (el.filesNote.textContent === NO_IMAGE_NOTE) setStatus(el.filesNote, '', false);
  }

  /* ---------- Refresh ---------- */
  let queued = false;
  let drawSeq = 0;
  function refresh() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const raw = readSettings();
      updateControls(raw);
      updateFontControls();
      updateNotes(raw);
      const seq = ++drawSeq;
      if (raw.mode === 'text' && raw.emoji === 'bundled' && Fonts.emojiState() !== 'ready' && Fonts.emojiState() !== 'unsupported') {
        setStatus(el.emojiNote, EMOJI_LOADING_NOTE, false);
      }
      // Wait for the fonts, so the previews never show a fallback font. Only the latest request draws.
      Fonts.prepare(raw).then((s) => {
        if (seq !== drawSeq) return;
        if (el.fontNote.classList.contains('err')) setStatus(el.fontNote, '', false);
        updateFontControls();
        updateEmojiNote(raw, s);
        draw(s);
      }, (err) => {
        if (seq !== drawSeq) return;
        setStatus(el.fontNote, 'Could not load the font: ' + err.message + '. Try another font, or reload the page.', true);
      });
    });
  }

  function updateEmojiNote(raw, s) {
    if (raw.mode !== 'text' || raw.emoji !== 'bundled') setStatus(el.emojiNote, '', false);
    else if (s.emoji !== 'bundled') setStatus(el.emojiNote, EMOJI_FALLBACK_NOTE, false);
    else setStatus(el.emojiNote, '', false);
  }

  /** Notes that depend only on the settings, shown right away. */
  function updateNotes(s) {
    const missing = s.mode === 'text' ? Fonts.missing(s.text, s.font) : [];
    const text = missing.length === 0 ? '' : missing.length === 1 ? GLYPH_NOTE : GLYPHS_NOTE;
    if (el.glyphNote.textContent !== text) setStatus(el.glyphNote, text, false);
  }

  /** Controls that follow the settings right away, before the fonts load. */
  function updateControls(s) {
    // Filled part of each slider's track.
    RANGES.forEach((k) => {
      const r = el[k];
      r.style.setProperty('--fill', ((r.value - r.min) / (r.max - r.min)) * 100 + '%');
    });
    el.textScaleOut.textContent = s.textScale + '%';
    el.padOut.textContent = s.pad + '%';
    el.radiusOut.textContent = s.radius + '%';
    el.bg.disabled = s.transparent;
    el.tabTitleA.textContent = el.tabTitleB.textContent = s.appName;
    el.snippet.querySelector('code').textContent = Outputs.snippet(s);
  }

  /** Draw every preview with settings whose fonts are loaded. */
  function draw(s) {
    previews.forEach((p) => Draw.icon(p.canvas.getContext('2d'), p.size, s, false));
    thumbs.forEach((t) => Draw.icon(t.canvas.getContext('2d'), t.size, s, t.apple));
    [el.tabA, el.tabB].forEach((c) => Draw.icon(c.getContext('2d'), 32, s, false));
    Draw.icon(el.heroIcon.getContext('2d'), el.heroIcon.width, s, false);
  }

  function setMode(next) {
    mode = next;
    el.modeText.setAttribute('aria-pressed', String(next === 'text'));
    el.modeImage.setAttribute('aria-pressed', String(next === 'image'));
    el.textPanel.hidden = next !== 'text';
    el.imagePanel.hidden = next !== 'image';
    updateDownloads();
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
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      image = img;
      imageUrl = url;
      el.dropText.textContent = file.name;
      setNote((img.naturalWidth || '?') + ' × ' + (img.naturalHeight || '?') + ' px. Choose another image any time.', false);
      updateDownloads();
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

    // Remember the text and caret before each edit, so an edit past the limit can be undone exactly.
    // While an input method is composing, keep the state from before the composition started.
    const remember = () => {
      lastText = el.text.value;
      lastSelection = [el.text.selectionStart, el.text.selectionEnd];
    };
    el.text.addEventListener('beforeinput', (e) => { if (!e.isComposing) remember(); });
    el.text.addEventListener('compositionstart', remember);
    el.text.addEventListener('input', (e) => { if (!e.isComposing) enforceTextLimit(); });
    el.text.addEventListener('compositionend', enforceTextLimit);

    INPUTS.forEach((k) => {
      el[k].addEventListener('input', refresh);
      el[k].addEventListener('change', refresh);
    });

    el.file.addEventListener('change', (e) => { loadFile(e.target.files && e.target.files[0]); });
    ['dragenter', 'dragover'].forEach((t) => el.drop.addEventListener(t, (e) => { e.preventDefault(); el.drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => el.drop.addEventListener(t, (e) => { e.preventDefault(); el.drop.classList.remove('over'); }));
    el.drop.addEventListener('drop', (e) => { loadFile(e.dataTransfer && e.dataTransfer.files[0]); });

    const zipEntry = { button: el.zip, busy: false, note: el.filesNote };
    downloads.push(zipEntry);
    el.zip.addEventListener('click', async () => {
      const label = el.zip.textContent;
      el.zip.textContent = 'Preparing…';
      el.zip.classList.add('busy');
      await runDownload(zipEntry, 'favicons.zip', () => Outputs.buildZip(readSettings()));
      el.zip.classList.remove('busy');
      el.zip.textContent = label;
    });

    el.copySnippet.addEventListener('click', () => {
      const flash = (text, ms, ok) => {
        el.copySnippet.textContent = text;
        el.copySnippet.classList.toggle('ok', !!ok);
        setTimeout(() => {
          el.copySnippet.textContent = 'Copy';
          el.copySnippet.classList.remove('ok');
        }, ms);
      };
      const fallback = () => {
        const r = document.createRange();
        r.selectNodeContents(el.snippet);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        flash('Press Ctrl/Cmd + C', 2500);
      };
      const text = Outputs.snippet(readSettings());
      el.snippet.querySelector('code').textContent = text;
      try { navigator.clipboard.writeText(text).then(() => flash('Copied', 1500, true), fallback); } catch (e) { fallback(); }
    });
  }

  /* ---------- Start ---------- */
  buildFontMenu();
  buildPreviewList();
  buildFileList();
  bindEvents();
  enforceTextLimit();
  setStatus(el.textNote, '', false);
  updateDownloads();
  el.snippet.querySelector('code').textContent = Outputs.snippet(readSettings());
  refresh();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
})();
