/* Page UI: reads the form, keeps previews in sync, wires up downloads, and saves, restores, shares and undoes
   designs. Depends on Svg, Fonts, Icons, Draw, Outputs, Design, Store, Checks, Dialog, Previews. */
(function () {
  'use strict';

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
    maskPad: $('maskPad'), maskPadOut: $('maskPadOut'), masks: $('masks'), safeZone: $('safeZone'),
    dark: $('dark'), darkColors: $('darkColors'), darkFg: $('darkFg'), darkFgLabel: $('darkFgLabel'), darkBg: $('darkBg'),
    heroIcon: $('heroIcon'), tabA: $('tabA'), tabB: $('tabB'), tabTitleA: $('tabTitleA'), tabTitleB: $('tabTitleB'),
    sizes: $('sizes'), files: $('files'), filesNote: $('filesNote'), zip: $('zip'),
    basePath: $('basePath'), snippet: $('snippet'), copySnippet: $('copySnippet'),
    undo: $('undo'), redo: $('redo'), reset: $('reset'), appNote: $('appNote'),
    share: $('share'), shareBox: $('shareBox'), shareUrl: $('shareUrl'), shareNote: $('shareNote'),
    designName: $('designName'), saveDesign: $('saveDesign'), designsNote: $('designsNote'), undoDelete: $('undoDelete'),
    designs: $('designs'), designsEmpty: $('designsEmpty'), exportDesign: $('exportDesign'), importDesign: $('importDesign'),
    importFile: $('importFile'), forgetAll: $('forgetAll'),
    shape: $('shape'), radiusField: $('radiusField'), bgType: $('bgType'), bgLabel: $('bgLabel'), bg2: $('bg2'), bg2Field: $('bg2Field'),
    angle: $('angle'), angleOut: $('angleOut'), angleField: $('angleField'), border: $('border'), borderFields: $('borderFields'),
    borderWidth: $('borderWidth'), borderWidthOut: $('borderWidthOut'), borderColor: $('borderColor'),
    offsetX: $('offsetX'), offsetXOut: $('offsetXOut'), offsetY: $('offsetY'), offsetYOut: $('offsetYOut'), centerOffsets: $('centerOffsets'),
    darkBg2: $('darkBg2'), darkBg2Field: $('darkBg2Field'), darkBgLabel: $('darkBgLabel'),
    checks: $('checks'), modeIcon: $('modeIcon'), iconPanel: $('iconPanel'), iconSearch: $('iconSearch'), iconCount: $('iconCount'),
    iconGrid: $('iconGrid'), iconNote: $('iconNote'), iconColor: $('iconColor'),
    iconStroke: $('iconStroke'), iconStrokeOut: $('iconStrokeOut'), iconScale: $('iconScale'), iconScaleOut: $('iconScaleOut')
  };
  const SECTIONS = Array.from(document.querySelectorAll('.controls details.section'));

  const RANGES = ['textScale', 'pad', 'radius', 'maskPad', 'angle', 'borderWidth', 'offsetX', 'offsetY', 'iconStroke', 'iconScale'];
  const INPUTS = ['text', 'font', 'bold', 'emoji', 'textScale', 'fg', 'fit', 'pad', 'bg', 'transparent', 'radius', 'maskPad', 'safeZone', 'dark', 'darkFg', 'darkBg', 'appName', 'basePath',
    'shape', 'bgType', 'bg2', 'angle', 'darkBg2', 'border', 'borderWidth', 'borderColor', 'offsetX', 'offsetY',
    'iconStroke', 'iconScale'];

  let mode = 'text';
  let currentIcon = Design.DEFAULTS.icon; // the chosen library icon, by name
  let image = null;    // loaded HTMLImageElement for image mode
  let imageUrl = null; // its object URL, released when another image replaces it
  let imageSvg = null; // the sanitized SVG, when the image is one

  const thumbs = [];   // { canvas, size, variant }
  const downloads = []; // { button, busy, note } for every download button

  function readSettings() {
    return {
      mode,
      image,
      imageVector: !!imageSvg,
      imageSvg,
      text: Outputs.clip(el.text.value, Outputs.TEXT_MAX),
      font: el.font.value,
      bold: el.bold.checked,
      emoji: el.emoji.value,
      textScale: Number(el.textScale.value),
      fg: el.fg.value,
      bg: el.bg.value,
      transparent: el.transparent.checked,
      radius: Number(el.radius.value),
      maskPad: Number(el.maskPad.value),
      dark: el.dark.checked,
      darkFg: el.darkFg.value,
      darkBg: el.darkBg.value,
      fit: el.fit.value,
      pad: Number(el.pad.value),
      appName: el.appName.value.trim() || 'My App',
      basePath: el.basePath.value,
      shape: el.shape.value,
      bgType: el.bgType.value,
      bg2: el.bg2.value,
      angle: Number(el.angle.value),
      darkBg2: el.darkBg2.value,
      border: el.border.checked,
      borderWidth: Number(el.borderWidth.value),
      borderColor: el.borderColor.value,
      offsetX: Number(el.offsetX.value),
      offsetY: Number(el.offsetY.value),
      icon: currentIcon,
      iconStroke: Number(el.iconStroke.value),
      iconScale: Number(el.iconScale.value)
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

  /* ---------- Collapsible sections ---------- */
  /** Open or close sections as last time (kept in localStorage), and remember each change. */
  function setUpSections() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem('favicon-maker.sections') || '{}') || {};
    } catch (e) {
      saved = {};
    }
    const save = () => {
      const state = {};
      SECTIONS.forEach((x) => { state[x.id] = x.open; });
      try { localStorage.setItem('favicon-maker.sections', JSON.stringify(state)); } catch (e) { /* not kept */ }
    };
    SECTIONS.forEach((d) => {
      if (typeof saved[d.id] === 'boolean') d.open = saved[d.id];
      d.addEventListener('toggle', save);
    });
    // The toggle event comes a moment later, so also save when the page goes away.
    window.addEventListener('pagehide', save);
  }

  /* ---------- Icon library ---------- */
  const ICON_LIMIT = 150; // icons shown at once; searching finds the rest
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function iconOption(name, selected) {
    const o = document.createElement('div');
    o.className = 'icon-option';
    o.id = 'icon-' + name;
    o.dataset.name = name;
    o.setAttribute('role', 'option');
    o.setAttribute('aria-selected', String(selected));
    o.setAttribute('aria-label', name.replace(/-/g, ' '));
    o.title = name;
    o.tabIndex = -1;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', Icons.get(name));
    svg.appendChild(path);
    o.appendChild(svg);
    return o;
  }

  /** Show the icons matching the search, with the chosen one selected and in the tab order. */
  function renderIconGrid() {
    if (!Icons.loaded()) {
      el.iconCount.textContent = 'Loading icons…';
      return;
    }
    const q = el.iconSearch.value.trim();
    let found = Icons.search(q);
    // Without a search, keep the chosen icon in view at the start.
    if (!q && Icons.get(currentIcon)) found = [currentIcon].concat(found.filter((n) => n !== currentIcon));
    const shown = found.slice(0, ICON_LIMIT);
    el.iconGrid.replaceChildren(...shown.map((n) => iconOption(n, n === currentIcon)));
    const focusable = el.iconGrid.querySelector('[aria-selected="true"]') || el.iconGrid.firstElementChild;
    if (focusable) focusable.tabIndex = 0;
    let text;
    if (!q) text = Icons.count() + ' icons.';
    else if (!found.length) text = 'No icons match “' + q + '”.';
    else text = found.length + (found.length === 1 ? ' icon matches' : ' icons match') + ' “' + q + '”.';
    if (found.length > ICON_LIMIT) text += ' Showing the first ' + ICON_LIMIT + '; search to find others.';
    el.iconCount.textContent = text;
    updateIconNote();
  }

  function updateIconNote() {
    const missing = Icons.loaded() && !Icons.get(currentIcon);
    setStatus(el.iconNote, missing ? 'The icon “' + currentIcon + '” isn’t in the library. Choose another one.' : '', missing);
  }

  function selectIcon(name, focus) {
    if (!Icons.get(name)) return;
    currentIcon = name;
    el.iconGrid.querySelectorAll('.icon-option').forEach((o) => {
      const on = o.dataset.name === name;
      o.setAttribute('aria-selected', String(on));
      o.tabIndex = on ? 0 : -1;
    });
    if (focus) {
      const o = document.getElementById('icon-' + name);
      if (o) o.focus();
    }
    updateIconNote();
    refresh();
    onChange('icon');
  }

  /** Arrow keys move through the grid, Home and End jump, Enter and Space choose. */
  function onIconGridKey(e) {
    const options = Array.from(el.iconGrid.children);
    const current = document.activeElement && document.activeElement.closest('.icon-option');
    if (!options.length || !current) return;
    const i = options.indexOf(current);
    const top = options[0].offsetTop;
    let cols = options.findIndex((o) => o.offsetTop !== top);
    if (cols < 1) cols = options.length;
    let next = i;
    if (e.key === 'ArrowRight') next = i + 1;
    else if (e.key === 'ArrowLeft') next = i - 1;
    else if (e.key === 'ArrowDown') next = i + cols;
    else if (e.key === 'ArrowUp') next = i - cols;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectIcon(current.dataset.name, true);
      return;
    } else {
      return;
    }
    e.preventDefault();
    next = Math.max(0, Math.min(options.length - 1, next));
    options.forEach((o, k) => { o.tabIndex = k === next ? 0 : -1; });
    options[next].focus();
    options[next].scrollIntoView({ block: 'nearest' });
  }

  function showIconLibrary() {
    renderIconGrid();
    Icons.load().then((ok) => {
      if (ok) renderIconGrid();
      else setStatus(el.iconNote, 'The icon library could not be loaded. Reload the page to try again.', true);
    });
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
        thumbs.push({ canvas: lead, size: THUMB_SIZE, variant: file.variant });
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
      const entry = { button: btn, busy: false, note: status, file, reasonShown: false };
      downloads.push(entry);
      btn.addEventListener('click', () => runDownload(entry, file.name, () => Outputs.build(file, readSettings())));

      li.append(lead, meta, btn);
      el.files.appendChild(li);
    });
  }

  /** Enable or disable the Download buttons: busy while building, and off in image mode with no image. */
  function updateDownloads() {
    const needsImage = mode === 'image' && !image;
    const s = readSettings();
    downloads.forEach((d) => {
      const unavailable = !!d.file && !Outputs.available(d.file, s);
      d.button.disabled = needsImage || d.busy || unavailable;
      // A file that can't be made for this design (favicon.svg for emoji, say) says why in its row.
      if (d.file && d.file.kind === 'svg') {
        const reason = unavailable && !needsImage ? Outputs.svgStatus(s).reason : '';
        if (reason) {
          if (d.note.textContent !== reason) setStatus(d.note, reason, false);
          d.reasonShown = true;
        } else if (d.reasonShown) {
          setStatus(d.note, '', false);
          d.reasonShown = false;
        }
      }
    });
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
      updateDownloads();
      updateFontControls();
      updateNotes(raw);
      const seq = ++drawSeq;
      if (raw.mode === 'text' && raw.emoji === 'bundled' && Fonts.emojiState() !== 'ready' && Fonts.emojiState() !== 'unsupported') {
        setStatus(el.emojiNote, EMOJI_LOADING_NOTE, false);
      }
      // Wait for the fonts, so the previews never show a fallback font. Only the latest request draws.
      Outputs.prepare(raw).then((s) => {
        if (seq !== drawSeq) return;
        if (el.fontNote.classList.contains('err')) setStatus(el.fontNote, '', false);
        updateFontControls();
        updateEmojiNote(raw, s);
        draw(s);
      }, (err) => {
        if (seq !== drawSeq) return;
        if (raw.mode === 'icon' && Icons.loaded() && !Icons.get(raw.icon)) updateIconNote();
        else if (raw.mode === 'icon') setStatus(el.iconNote, 'Could not draw the icon: ' + err.message + '.', true);
        else setStatus(el.fontNote, 'Could not load the font: ' + err.message + '. Try another font, or reload the page.', true);
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
    el.maskPadOut.textContent = s.maskPad + '%';
    el.angleOut.textContent = s.angle + '°';
    el.borderWidthOut.textContent = s.borderWidth + '%';
    el.offsetXOut.textContent = (s.offsetX > 0 ? '+' : '') + s.offsetX + '%';
    el.offsetYOut.textContent = (s.offsetY > 0 ? '+' : '') + s.offsetY + '%';
    el.iconStrokeOut.textContent = String(s.iconStroke);
    el.iconScaleOut.textContent = s.iconScale + '%';
    el.iconColor.value = s.fg;
    const gradient = s.bgType !== 'solid';
    el.radiusField.hidden = s.shape !== 'rounded';
    el.bgLabel.textContent = gradient ? 'First color' : 'Background color';
    el.darkBgLabel.textContent = gradient ? 'Dark mode first color' : 'Dark mode background color';
    el.bg2Field.hidden = !gradient;
    el.darkBg2Field.hidden = !gradient;
    el.angleField.hidden = s.bgType !== 'linear';
    el.borderFields.hidden = !s.border;
    el.bgType.disabled = el.bg2.disabled = el.angle.disabled = s.transparent;
    el.centerOffsets.disabled = s.offsetX === 0 && s.offsetY === 0;
    el.darkColors.hidden = !s.dark;
    el.darkFgLabel.hidden = s.mode !== 'text';
    el.bg.disabled = s.transparent;
    el.snippet.querySelector('code').textContent = Outputs.snippet(s);
  }

  /* ---------- Design checks ---------- */
  let checksKey = '';

  /** Advice about the design, near the previews. Only redrawn when it changes, so it is announced once. */
  function updateChecks(s) {
    const t = s.mode === 'text' ? Draw.textLayout(16, s) : null;
    const result = Checks.run(s, { textHeight16: t ? t.height : 0 });
    const key = JSON.stringify(result);
    if (key === checksKey) return;
    checksKey = key;
    const parts = [];
    if (result.skipped === 'image') {
      const p = document.createElement('p');
      p.className = 'check-ok';
      p.textContent = 'Contrast isn’t checked for uploaded images: their colors vary too much to judge from a few pixels.';
      parts.push(p);
    } else if (!result.warnings.length) {
      const p = document.createElement('p');
      p.className = 'check-ok';
      p.textContent = 'Looks good at every size.';
      parts.push(p);
    }
    result.warnings.forEach((w) => {
      const box = document.createElement('div');
      box.className = 'check-warn';
      box.dataset.check = w.id;
      const p = document.createElement('p');
      p.textContent = w.text;
      box.appendChild(p);
      if (w.action) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn ghost small';
        b.textContent = w.action.label;
        b.addEventListener('click', () => {
          el[w.action.field].value = String(w.action.value);
          refresh();
          onChange(null); // one undo step
        });
        box.appendChild(b);
      }
      parts.push(box);
    });
    el.checks.replaceChildren(...parts);
  }

  /** Draw every preview with settings whose fonts are loaded. */
  function draw(s) {
    updateChecks(s);
    Previews.draw(s);
    thumbs.forEach((t) => Draw.icon(t.canvas.getContext('2d'), t.size, s, t.variant));
    Draw.icon(el.heroIcon.getContext('2d'), el.heroIcon.width, s, false);
  }

  function setMode(next) {
    mode = next;
    el.modeText.setAttribute('aria-pressed', String(next === 'text'));
    el.modeIcon.setAttribute('aria-pressed', String(next === 'icon'));
    el.modeImage.setAttribute('aria-pressed', String(next === 'image'));
    el.textPanel.hidden = next !== 'text';
    el.iconPanel.hidden = next !== 'icon';
    el.imagePanel.hidden = next !== 'image';
    if (next === 'icon') showIconLibrary();
    updateDownloads();
    refresh();
  }

  /* ---------- Image loading ---------- */
  function loadFile(file) {
    if (!file) return;
    const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
    if (!file.type.startsWith('image/') && !isSvg) {
      setNote('That file is not an image. Choose a PNG, JPG, SVG or WebP.', true);
      return;
    }
    if (!isSvg) {
      file.arrayBuffer().then((buf) => {
        const rec = { id: Store.newId(), type: file.type, bytes: new Uint8Array(buf), name: file.name };
        return showImage(file, file.name, null, rec);
      }).then((ok) => { if (ok) onChange(null); }, () => setNote('This image could not be read. Try a PNG or JPG.', true));
      return;
    }
    // Clean an SVG before using it anywhere: no scripts, event handlers or outside files.
    file.text().then((text) => {
      let clean;
      try {
        clean = Svg.sanitize(text);
      } catch (e) {
        setNote(e.message + '. Try another file.', true);
        return false;
      }
      const rec = { id: Store.newId(), type: 'image/svg+xml', bytes: new TextEncoder().encode(clean.standalone), name: file.name };
      return showImage(new Blob([clean.standalone], { type: 'image/svg+xml' }), file.name, clean, rec);
    }, () => setNote('This image could not be read. Try a PNG or JPG.', true)).then((ok) => { if (ok) onChange(null); });
  }

  /** Show an image. Resolves true once it is loaded and in use. */
  function showImage(blob, name, svg, record) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        image = img;
        imageUrl = url;
        imageSvg = svg;
        imageRecord = record || null;
        el.dropText.textContent = name;
        setNote((img.naturalWidth || '?') + ' × ' + (img.naturalHeight || '?') + ' px. Choose another image any time.', false);
        updateDownloads();
        refresh();
        resolve(true);
      };
      img.onerror = () => {
        setNote('This image could not be read. Try a PNG or JPG.', true);
        URL.revokeObjectURL(url);
        resolve(false);
      };
      img.src = url;
    });
  }

  /* ---------- Design state: autosave, undo, My designs and share links ---------- */
  const NOTES = {
    storage: "Designs can't be saved in this browser window.",
    incomplete: 'This link seems to be incomplete.',
    shared: 'Opened a shared design.',
    imageTooBig: 'The image is too big for a link. Export the design to share it with the image.',
    noSpace: 'There is no room left to save in this browser. Delete or export some designs.'
  };
  const PAGES_URL = 'https://xitas.github.io/favicon-maker/';
  const DESIGN_INPUTS = INPUTS.filter((k) => k !== 'safeZone'); // the safe zone circle is only a preview aid
  const DEFAULT_DROP_TEXT = el.dropText.textContent;
  const DEFAULT_FILE_NOTE = el.fileNote.textContent;

  let imageRecord = null;  // { id, type, bytes, name } of the current image, kept with the design
  const undoHistory = new Design.History(100, 1000);
  let applying = false;    // true while a saved state is put back, so it isn't recorded again
  let baselineKey = '';    // the design as last saved, opened or shared, to know about unsaved changes
  let savedFrom = null;    // id of the saved design the current one came from
  let linkPending = false; // a share link is in the address bar until the first change
  let designs = [];
  let lastDeleted = null;
  let deletedTimer = 0;
  let saveTimer = 0;
  const storedImages = new Set();

  const currentSettings = () => Design.validate(readSettings());
  const snapshot = () => ({ settings: currentSettings(), image: imageRecord });
  const sameState = (a, b) => a.image === b.image && Design.same(a.settings, b.settings);
  const keyOf = (settings, image) => JSON.stringify(Design.changes(settings)) + '|' + (image ? image.id : '');
  const currentKey = () => keyOf(currentSettings(), imageRecord);
  const isDirty = () => currentKey() !== baselineKey;
  const markSaved = () => { baselineKey = currentKey(); };
  const cleanName = (n) => (typeof n === 'string' ? n.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 80) : '');
  const savableImage = () => (imageRecord && Design.validateImage(imageRecord) ? imageRecord : null);

  function setAppNote(text, isError) {
    setStatus(el.appNote, text, isError);
  }

  /** Put the form back to a design state: settings and image. Not recorded in the undo history. */
  async function applyState(state) {
    applying = true;
    try {
      const s = Design.validate(state.settings);
      // Every setting has a form control with the same id (except the source, set by setMode).
      currentIcon = s.icon;
      Object.keys(Design.DEFAULTS).forEach((k) => {
        if (k === 'mode' || k === 'icon') return;
        const input = el[k];
        if (input.type === 'checkbox') input.checked = s[k];
        else input.value = String(s[k]);
      });
      lastText = s.text;
      lastSelection = [s.text.length, s.text.length];
      enforceTextLimit();
      setStatus(el.textNote, '', false);
      await useImage(state.image || null);
      setMode(s.mode);
    } finally {
      applying = false;
    }
    refresh();
    updateHistoryButtons();
  }

  function clearImage() {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    image = null;
    imageUrl = null;
    imageSvg = null;
    imageRecord = null;
    el.file.value = '';
    el.dropText.textContent = DEFAULT_DROP_TEXT;
    setNote(DEFAULT_FILE_NOTE, false);
  }

  /** Show a stored, linked or imported image. SVGs are cleaned again every time. */
  async function useImage(rec) {
    if (!rec) {
      clearImage();
      return true;
    }
    if (imageRecord && rec.id === imageRecord.id) return true;
    let svg = null;
    let blob;
    if (rec.type === 'image/svg+xml') {
      try {
        svg = Svg.sanitize(new TextDecoder().decode(rec.bytes));
      } catch (e) {
        clearImage();
        setNote(e.message + '. Try another file.', true);
        return false;
      }
      blob = new Blob([svg.standalone], { type: 'image/svg+xml' });
    } else {
      blob = new Blob([rec.bytes], { type: rec.type });
    }
    return showImage(blob, rec.name || 'Image', svg, rec);
  }

  /** Record the current design as a step in the undo history, save it, and drop a used share link. */
  function onChange(group) {
    if (applying) return;
    if (undoHistory.record(snapshot(), group, Date.now(), sameState)) {
      scheduleSave();
      if (linkPending) clearHash();
    }
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    el.undo.disabled = !undoHistory.canUndo();
    el.redo.disabled = !undoHistory.canRedo();
  }

  async function moveHistory(step) {
    const state = step === 'undo' ? undoHistory.undo() : undoHistory.redo();
    if (!state) return;
    await applyState(state);
    scheduleSave();
    if (linkPending) clearHash();
  }

  /** Text fields keep the browser's own undo, so the shortcuts only work outside them. */
  function isTextField(t) {
    if (!t || !t.tagName) return false;
    if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
    return t.tagName === 'INPUT' && /^(text|search|url|email|password|number|tel)$/i.test(t.type);
  }

  function onKeyDown(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const isUndo = k === 'z' && !e.shiftKey;
    const isRedo = (k === 'z' && e.shiftKey) || (k === 'y' && e.ctrlKey && !e.shiftKey);
    if (!isUndo && !isRedo) return;
    if (isTextField(e.target)) return;
    e.preventDefault();
    moveHistory(isUndo ? 'undo' : 'redo');
  }

  async function resetDesign() {
    await applyState({ settings: Design.DEFAULTS, image: null });
    el.designName.value = '';
    savedFrom = null;
    onChange(null);
    setStatus(el.designsNote, 'Reset to the default design. Undo brings yours back.', false);
  }

  /* Autosave */

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCurrent, 400);
  }

  async function storeImage(rec) {
    if (storedImages.has(rec.id)) return;
    await Store.putImage(rec.id, rec);
    storedImages.add(rec.id);
  }

  async function saveCurrent() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    const rec = savableImage();
    if (rec) await storeImage(rec);
    const ok = Store.setJson('current', {
      format: Design.FORMAT, settings: currentSettings(), imageId: rec ? rec.id : null, baseline: baselineKey, from: savedFrom
    });
    if (!ok) setAppNote(NOTES.noSpace, true);
  }

  async function loadStoredImage(id) {
    const raw = await Store.getImage(id);
    const rec = Design.validateImage(raw);
    if (!rec) return null;
    rec.id = id;
    storedImages.add(id);
    return rec;
  }

  /* My designs */

  function cleanEntry(d) {
    if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !d.id) return null;
    let settings;
    try {
      settings = Design.migrate({ format: d.format, settings: d.settings }).settings;
    } catch (e) {
      return null;
    }
    const time = (t) => (Number.isFinite(t) ? t : Date.now());
    return {
      id: d.id.slice(0, 64),
      name: cleanName(d.name) || 'Untitled design',
      created: time(d.created),
      updated: time(d.updated),
      format: Design.FORMAT,
      settings,
      imageId: typeof d.imageId === 'string' ? d.imageId.slice(0, 64) : null,
      thumb: typeof d.thumb === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(d.thumb) ? d.thumb : ''
    };
  }

  function readDesignList() {
    const raw = Store.getJson('designs');
    return Array.isArray(raw) ? raw.map(cleanEntry).filter(Boolean) : [];
  }

  function writeDesignList() {
    if (!Store.setJson('designs', designs)) setStatus(el.designsNote, NOTES.noSpace, true);
  }

  async function makeThumb() {
    try {
      const s = await Fonts.prepare(readSettings());
      return Draw.render(64, s).toDataURL('image/png');
    } catch (e) {
      return '';
    }
  }

  function formatDate(t) {
    try {
      return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) {
      return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
    }
  }

  function renderDesigns() {
    el.designs.replaceChildren();
    designs.forEach((d) => {
      const li = document.createElement('li');
      li.className = 'design';
      li.dataset.id = d.id;
      const img = document.createElement('img');
      img.alt = '';
      img.width = img.height = 64;
      if (d.thumb) img.src = d.thumb;
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = d.name;
      const date = document.createElement('div');
      date.className = 'date';
      date.textContent = formatDate(d.updated);
      const actions = document.createElement('div');
      actions.className = 'actions';
      [['Open', () => openDesign(d)], ['Rename', () => renameDesign(d)], ['Duplicate', () => duplicateDesign(d)], ['Delete', () => deleteDesign(d)]]
        .forEach(([label, fn]) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = label;
          b.setAttribute('aria-label', label + ' ' + d.name);
          b.addEventListener('click', fn);
          actions.appendChild(b);
        });
      li.append(img, name, date, actions);
      el.designs.appendChild(li);
    });
    el.designsEmpty.hidden = designs.length > 0;
  }

  async function saveDesign() {
    const name = cleanName(el.designName.value) || 'Design ' + (designs.length + 1);
    const rec = savableImage();
    if (rec) await storeImage(rec);
    const thumb = await makeThumb();
    const now = Date.now();
    const fields = { settings: currentSettings(), imageId: rec ? rec.id : null, thumb, updated: now, format: Design.FORMAT };
    const existing = savedFrom ? designs.find((d) => d.id === savedFrom && d.name === name) : null;
    if (existing) {
      Object.assign(existing, fields);
    } else {
      const d = Object.assign({ id: Store.newId(), name, created: now }, fields);
      designs.unshift(d);
      savedFrom = d.id;
    }
    writeDesignList();
    el.designName.value = name;
    markSaved();
    await saveCurrent();
    renderDesigns();
    setStatus(el.designsNote, (existing ? 'Updated “' : 'Saved “') + name + '”.', false);
  }

  /** Ask before replacing a design that has unsaved changes. */
  async function okToReplace(title, openLabel) {
    if (!isDirty()) return true;
    return Dialog.confirm({
      title,
      message: 'It replaces the current design, which has changes that aren’t saved in My designs.',
      confirmLabel: openLabel,
      cancelLabel: 'Keep current design'
    });
  }

  async function openDesign(d) {
    if (keyOf(d.settings, d.imageId ? { id: d.imageId } : null) !== currentKey() && !(await okToReplace('Open “' + d.name + '”?', 'Open “' + d.name + '”'))) return;
    const img = d.imageId ? await loadStoredImage(d.imageId) : null;
    await applyState({ settings: d.settings, image: img });
    savedFrom = d.id;
    el.designName.value = d.name;
    markSaved();
    onChange(null);
    await saveCurrent();
    setStatus(el.designsNote, d.imageId && !img ? 'Opened “' + d.name + '”, but its image is no longer saved in this browser.' : 'Opened “' + d.name + '”.', !!(d.imageId && !img));
  }

  async function renameDesign(d) {
    const answer = await Dialog.prompt({ title: 'Rename “' + d.name + '”', label: 'New name', value: d.name, confirmLabel: 'Rename', maxLength: 80 });
    if (answer === null) return;
    const name = cleanName(answer);
    if (!name) return;
    d.name = name;
    d.updated = Date.now();
    if (savedFrom === d.id) el.designName.value = name;
    writeDesignList();
    renderDesigns();
    setStatus(el.designsNote, 'Renamed to “' + name + '”.', false);
  }

  function duplicateDesign(d) {
    const now = Date.now();
    const copy = Object.assign({}, d, { id: Store.newId(), name: (d.name + ' copy').slice(0, 80), created: now, updated: now });
    designs.splice(designs.indexOf(d), 0, copy);
    writeDesignList();
    renderDesigns();
    setStatus(el.designsNote, 'Made a copy of “' + d.name + '”.', false);
  }

  function deleteDesign(d) {
    const index = designs.indexOf(d);
    if (index === -1) return;
    designs.splice(index, 1);
    writeDesignList();
    renderDesigns();
    lastDeleted = { design: d, index };
    setStatus(el.designsNote, 'Deleted “' + d.name + '”.', false);
    el.undoDelete.hidden = false;
    clearTimeout(deletedTimer);
    deletedTimer = setTimeout(() => { el.undoDelete.hidden = true; lastDeleted = null; }, 10000);
  }

  function undoDelete() {
    if (!lastDeleted) return;
    designs.splice(Math.min(lastDeleted.index, designs.length), 0, lastDeleted.design);
    writeDesignList();
    renderDesigns();
    setStatus(el.designsNote, 'Restored “' + lastDeleted.design.name + '”.', false);
    lastDeleted = null;
    el.undoDelete.hidden = true;
    clearTimeout(deletedTimer);
  }

  function exportDesign() {
    const name = cleanName(el.designName.value) || 'Favicon design';
    const text = Design.toExport(name, currentSettings(), savableImage());
    const file = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'favicon-design') + '.json';
    saveBlob(new Blob([text], { type: 'application/json' }), file);
    setStatus(el.designsNote, 'Exported “' + name + '” as ' + file + '.', false);
  }

  async function importDesign(file) {
    if (!file) return;
    let d;
    try {
      d = Design.fromExport(await file.text());
      if (d.image && d.image.type === 'image/svg+xml') Svg.sanitize(new TextDecoder().decode(d.image.bytes));
    } catch (e) {
      setStatus(el.designsNote, (e.message || "This file isn't a favicon design") + '.', true);
      return;
    } finally {
      el.importFile.value = '';
    }
    if (!(await okToReplace('Open the imported design “' + d.name + '”?', 'Open it'))) return;
    const img = d.image ? Object.assign({}, d.image, { id: Store.newId() }) : null;
    await applyState({ settings: d.settings, image: img });
    savedFrom = null;
    el.designName.value = d.name;
    onChange(null);
    await saveDesign();
    setStatus(el.designsNote, 'Imported “' + d.name + '”.', false);
  }

  async function forgetAll() {
    const ok = await Dialog.confirm({
      title: 'Forget all saved data?',
      message: 'This removes every saved design and the autosaved design from this browser. It can’t be undone. Export any design you want to keep first.',
      confirmLabel: 'Forget everything',
      cancelLabel: 'Keep my designs',
      danger: true
    });
    if (!ok) return;
    clearTimeout(saveTimer);
    await Store.forgetAll();
    designs = [];
    storedImages.clear();
    savedFrom = null;
    lastDeleted = null;
    el.undoDelete.hidden = true;
    renderDesigns();
    setStatus(el.designsNote, 'All saved data was removed from this browser.', false);
  }

  /* Share links */

  function clearHash() {
    linkPending = false;
    try {
      window.history.replaceState(null, '', location.pathname + location.search);
    } catch (e) { /* the hash stays; nothing else to do */ }
  }

  async function shareLink() {
    const base = location.protocol === 'file:' ? PAGES_URL : location.href.split('#')[0];
    let result;
    try {
      result = await Design.shareLink(base, currentSettings(), savableImage());
    } catch (e) {
      setStatus(el.shareNote, 'Could not make a link: ' + e.message + '.', true);
      return;
    }
    el.shareBox.hidden = false;
    el.shareUrl.value = result.url;
    let copied = false;
    try {
      await navigator.clipboard.writeText(result.url);
      copied = true;
    } catch (e) {
      el.shareUrl.focus();
      el.shareUrl.select();
    }
    const parts = [copied ? 'Link copied.' : 'Copy the link above.'];
    if (result.imageLeftOut) parts.push(NOTES.imageTooBig);
    setStatus(el.shareNote, parts.join(' '), false);
  }

  /** Open a design from a share link in the address bar. A bad link changes nothing. */
  async function openFromHash() {
    const hash = location.hash;
    if (!Design.isShareHash(hash)) return;
    let d;
    try {
      d = await Design.decodeHash(hash);
    } catch (e) {
      setAppNote(/newer version/.test(e.message) ? e.message + '.' : NOTES.incomplete, true);
      return;
    }
    let img = null;
    if (d.image) {
      img = Object.assign({}, d.image, { id: Store.newId(), name: 'Shared image' });
      if (img.type === 'image/svg+xml') {
        try { Svg.sanitize(new TextDecoder().decode(img.bytes)); } catch (e) { setAppNote(NOTES.incomplete, true); return; }
      }
    }
    if (keyOf(d.settings, null) !== currentKey() && !(await okToReplace('Open the shared design?', 'Open shared design'))) {
      clearHash();
      return;
    }
    await applyState({ settings: d.settings, image: img });
    savedFrom = null;
    el.designName.value = '';
    onChange(null);
    linkPending = true;
    setAppNote(NOTES.shared, false);
  }

  /** Restore the autosaved design and saved designs, then open a share link if there is one. */
  async function restore() {
    const persistent = await Store.init();
    if (!persistent) setAppNote(NOTES.storage, false);
    designs = readDesignList();
    const cur = Store.getJson('current');
    let restored = false;
    if (cur && typeof cur === 'object') {
      try {
        const d = Design.migrate({ format: cur.format, settings: cur.settings });
        const img = typeof cur.imageId === 'string' ? await loadStoredImage(cur.imageId) : null;
        await applyState({ settings: d.settings, image: img });
        baselineKey = typeof cur.baseline === 'string' ? cur.baseline : '';
        savedFrom = typeof cur.from === 'string' ? cur.from : null;
        const from = designs.find((x) => x.id === savedFrom);
        if (from) el.designName.value = from.name;
        restored = true;
      } catch (e) {
        restored = false;
      }
    }
    if (!restored) markSaved();
    undoHistory.reset(snapshot());
    updateHistoryButtons();
    renderDesigns();
    const keep = new Set(designs.map((d) => d.imageId).filter(Boolean));
    if (imageRecord) keep.add(imageRecord.id);
    await Store.collect(keep);
    await openFromHash();
  }


  /* ---------- Events ---------- */
  function bindEvents() {
    el.modeText.addEventListener('click', () => { setMode('text'); onChange(null); });
    el.modeImage.addEventListener('click', () => { setMode('image'); onChange(null); });
    el.modeIcon.addEventListener('click', () => { setMode('icon'); onChange(null); });
    el.iconSearch.addEventListener('input', renderIconGrid);
    el.iconGrid.addEventListener('keydown', onIconGridKey);
    el.iconGrid.addEventListener('click', (e) => {
      const o = e.target.closest('.icon-option');
      if (o) selectIcon(o.dataset.name, true);
    });
    // The icon color is the text color setting.
    el.iconColor.addEventListener('input', () => {
      el.fg.value = el.iconColor.value;
      refresh();
      onChange('fg');
    });

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
    // Each change is a step in the undo history; quick changes to one control (a slider drag) are one step.
    DESIGN_INPUTS.forEach((k) => {
      el[k].addEventListener('input', () => onChange(k));
      el[k].addEventListener('change', () => onChange(k));
    });

    el.undo.addEventListener('click', () => moveHistory('undo'));
    el.redo.addEventListener('click', () => moveHistory('redo'));
    el.reset.addEventListener('click', resetDesign);
    el.centerOffsets.addEventListener('click', () => {
      el.offsetX.value = el.offsetY.value = '0';
      refresh();
      onChange(null);
    });
    document.addEventListener('keydown', onKeyDown);
    el.saveDesign.addEventListener('click', saveDesign);
    el.designName.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveDesign(); });
    el.undoDelete.addEventListener('click', undoDelete);
    el.exportDesign.addEventListener('click', exportDesign);
    el.importDesign.addEventListener('click', () => el.importFile.click());
    el.importFile.addEventListener('change', (e) => importDesign(e.target.files && e.target.files[0]));
    el.forgetAll.addEventListener('click', forgetAll);
    el.share.addEventListener('click', shareLink);
    el.shareUrl.addEventListener('focus', () => el.shareUrl.select());
    window.addEventListener('hashchange', openFromHash);
    // Save at once when the page is hidden or closed, instead of waiting for the delay.
    window.addEventListener('pagehide', () => { if (saveTimer) saveCurrent(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) saveCurrent(); });

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
  setUpSections();
  buildFontMenu();
  Previews.init(refresh);
  buildFileList();
  bindEvents();
  enforceTextLimit();
  setStatus(el.textNote, '', false);
  updateDownloads();
  el.snippet.querySelector('code').textContent = Outputs.snippet(readSettings());
  refresh();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
  // Bring back the saved design. The page says it is ready (for tests and scripts) once that is done.
  restore().catch(() => setAppNote(NOTES.storage, false)).then(() => {
    document.documentElement.dataset.ready = '1';
  });
})();
