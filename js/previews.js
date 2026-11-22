/* The previews: the icon where people will see it, each drawn at its real size, in tabs.
   Sizes and Android shapes, browser tabs, a bookmarks bar, a search result, and iPhone and Android home
   screens. Everything around the icon is a plain gray placeholder, not any real product's interface.
   Only the visible tab is drawn. Depends on Svg, Draw, Outputs. */
const Previews = (() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const UI_KEY = 'favicon-maker.previews';
  const PREVIEW_SIZES = [16, 32, 48, 180, 512];
  const MASK_SHAPES = [['circle', 'Circle'], ['squircle', 'Squircle'], ['rounded', 'Rounded square'], ['teardrop', 'Teardrop']];
  const MASK_PREVIEW = 96;
  const TABS = ['sizes', 'browser', 'home', 'zoom'];

  const ui = { tab: 'sizes', wall: 'light', androidShape: 'circle', zoomGrid: false };
  let redraw = () => {};
  const sizes = []; // { canvas, size }
  const masks = []; // { canvas, shape, item }

  function loadUi() {
    try {
      const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {};
      if (TABS.indexOf(saved.tab) !== -1 && $('ptab-' + saved.tab)) ui.tab = saved.tab;
      if (['light', 'dark', 'color'].indexOf(saved.wall) !== -1) ui.wall = saved.wall;
      if (MASK_SHAPES.some((m) => m[0] === saved.androidShape)) ui.androidShape = saved.androidShape;
      ui.zoomGrid = saved.zoomGrid === true;
    } catch (e) { /* defaults */ }
  }

  function saveUi() {
    try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* not kept */ }
  }

  /** Size a canvas for `css` CSS pixels, at the screen's pixel density. Returns its width in pixels. */
  function fit(canvas, css) {
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const n = Math.round(css * dpr);
    if (canvas.width !== n) canvas.width = canvas.height = n;
    canvas.style.width = canvas.style.height = css + 'px';
    return n;
  }

  /* ---------- Tabs ---------- */

  function tabButtons() {
    return Array.from(document.querySelectorAll('.ptabs [role="tab"]'));
  }

  function showTab(name, focus) {
    ui.tab = name;
    tabButtons().forEach((b) => {
      const on = b.id === 'ptab-' + name;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      $(b.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) b.focus();
    });
    saveUi();
    redraw();
  }

  /** Arrow keys move between tabs and show them; Home and End jump to the ends. */
  function onTabKey(e) {
    const tabs = tabButtons();
    const i = tabs.indexOf(document.activeElement);
    if (i === -1) return;
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    showTab(tabs[next].id.slice(5), true);
  }

  /** A radio group of buttons: arrow keys move and choose, as with native radio buttons. */
  function radioKeys(group, choose) {
    group.addEventListener('keydown', (e) => {
      const items = Array.from(group.querySelectorAll('[role="radio"]'));
      const i = items.indexOf(document.activeElement);
      if (i === -1) return;
      let next = i;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % items.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = items.length - 1;
      else if (e.key === ' ' || e.key === 'Enter') next = i;
      else return;
      e.preventDefault();
      choose(items[next]);
      items[next].focus();
    });
  }

  function setChecked(items, chosen) {
    items.forEach((x) => {
      const on = x === chosen;
      x.setAttribute('aria-checked', String(on));
      x.tabIndex = on ? 0 : -1;
    });
  }

  /* ---------- Sizes and Android shapes ---------- */

  function buildSizes() {
    const list = $('sizes');
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
      list.appendChild(li);
      sizes.push({ canvas, size });
    });
  }

  function chooseAndroidShape(item) {
    ui.androidShape = item.dataset.shape;
    setChecked(masks.map((m) => m.item), item);
    saveUi();
    redraw();
  }

  function buildMasks() {
    const list = $('masks');
    MASK_SHAPES.forEach(([shape, name]) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'radio');
      li.dataset.shape = shape;
      li.className = 'mask-option';
      li.setAttribute('aria-label', name);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = MASK_PREVIEW;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Maskable icon cut to a ' + name.toLowerCase());
      canvas.dataset.shape = shape;
      const cap = document.createElement('span');
      cap.className = 'cap';
      cap.textContent = name;
      li.append(canvas, cap);
      li.addEventListener('click', () => chooseAndroidShape(li));
      list.appendChild(li);
      masks.push({ canvas, shape, item: li });
    });
    setChecked(masks.map((m) => m.item), masks.find((m) => m.shape === ui.androidShape).item);
    radioKeys(list, chooseAndroidShape);
  }

  /** The maskable icon cut to a shape, with the safe zone circle on top when asked. */
  function drawMask(canvas, shape, s, overlay) {
    const ctx = canvas.getContext('2d');
    const n = canvas.width;
    Draw.icon(ctx, n, s, 'maskable');
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    Draw.maskShape(ctx, n, shape);
    ctx.fill();
    ctx.restore();
    if (overlay) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(n / 2, n / 2, n * Draw.SAFE_ZONE_RADIUS, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawSizes(s) {
    sizes.forEach((p) => Draw.icon(p.canvas.getContext('2d'), p.size, s, false));
    const overlay = $('safeZone').checked;
    masks.forEach((m) => drawMask(m.canvas, m.shape, s, overlay));
  }

  /* ---------- Browser ---------- */

  /** The settings as a dark browser shows favicon.svg: its dark mode colors when it has them. */
  function darkSettings(s) {
    return s.dark ? Object.assign({}, s, { fg: s.darkFg, bg: s.darkBg, bg2: s.darkBg2 }) : s;
  }

  /** "example.com › folder › sub", from the folder setting, for the search result. */
  function siteAddress(s) {
    const base = Outputs.basePath(s.basePath);
    const m = /^https?:\/\/([^/]+)(\/.*)$/i.exec(base);
    const host = m ? m[1] : 'example.com';
    const path = (m ? m[2] : base).split('/').filter(Boolean).map((p) => {
      try { return decodeURIComponent(p); } catch (e) { return p; }
    });
    return [host].concat(path).join(' › ');
  }

  function drawBrowser(s) {
    const light = $('tabA');
    Draw.icon(light.getContext('2d'), fit(light, 16), s, false);
    const dark = $('tabB');
    Draw.icon(dark.getContext('2d'), fit(dark, 16), darkSettings(s), false);
    $('darkTabNote').textContent = s.dark ? 'The dark tab shows the dark mode colors of favicon.svg.' : '';
    const bm = $('bmIcon');
    Draw.icon(bm.getContext('2d'), fit(bm, 16), s, false);
    const serp = $('serpIcon');
    Draw.icon(serp.getContext('2d'), fit(serp, 18), s, false);
    $('serpName').textContent = s.appName;
    $('serpUrl').textContent = siteAddress(s);
  }

  /* ---------- Home screens ---------- */

  function chooseWall(button) {
    ui.wall = button.dataset.wall;
    setChecked(Array.from(document.querySelectorAll('.wall-choice [role="radio"]')), button);
    saveUi();
    applyWall();
  }

  function applyWall() {
    $('iosScreen').dataset.wall = ui.wall;
    $('androidScreen').dataset.wall = ui.wall;
  }

  function drawHome(s) {
    // iPhone: the Apple touch icon, with the system's rounded corners (a smooth squircle).
    const ios = $('iosIcon');
    const n = fit(ios, 60);
    const ctx = ios.getContext('2d');
    Draw.icon(ctx, n, s, 'apple');
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fill(new Path2D(Svg.shapePath('squircle', n)));
    ctx.restore();
    // Android: the maskable icon, cut to the shape chosen under Sizes.
    const android = $('androidIcon');
    fit(android, 48);
    drawMask(android, ui.androidShape, s, false);
    const name = MASK_SHAPES.find((m) => m[0] === ui.androidShape)[1].toLowerCase();
    $('androidCaption').textContent = 'Android: the maskable icon, cut to a ' + name;
    $('iosLabel').textContent = $('androidLabel').textContent = s.appName;
  }

  /* ---------- Pixel zoom ---------- */

  const ZOOM = 8;

  /**
   * The 16 and 32 px icons, exactly as in the files, 8 times larger with sharp pixel edges, and a grid
   * between the pixels when asked.
   */
  function drawZoom(s) {
    const grid = $('zoomGrid').checked;
    [16, 32].forEach((n) => {
      const canvas = $('zoom' + n);
      const w = fit(canvas, n * ZOOM);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, w);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(Draw.render(n, s), 0, 0, w, w);
      if (grid) {
        // One device pixel wide, between the pixels, gray so it shows on light and dark designs.
        const step = w / n;
        ctx.fillStyle = 'rgba(128, 128, 128, 0.55)';
        for (let i = 1; i < n; i++) {
          const p = Math.round(i * step);
          ctx.fillRect(p, 0, 1, w);
          ctx.fillRect(0, p, w, 1);
        }
      }
    });
  }

  /* ---------- Start and draw ---------- */

  /** Build the previews. `onRedraw` is called when a choice here needs the icons drawn again. */
  function init(onRedraw) {
    redraw = onRedraw;
    loadUi();
    buildSizes();
    buildMasks();
    const tablist = document.querySelector('.ptabs');
    tablist.addEventListener('keydown', onTabKey);
    tabButtons().forEach((b) => b.addEventListener('click', () => showTab(b.id.slice(5), false)));
    const walls = document.querySelector('.wall-choice');
    walls.querySelectorAll('[role="radio"]').forEach((b) => b.addEventListener('click', () => chooseWall(b)));
    radioKeys(walls, chooseWall);
    setChecked(Array.from(walls.querySelectorAll('[role="radio"]')), walls.querySelector('[data-wall="' + ui.wall + '"]'));
    applyWall();
    $('zoomGrid').checked = !!ui.zoomGrid;
    $('zoomGrid').addEventListener('change', () => {
      ui.zoomGrid = $('zoomGrid').checked;
      saveUi();
      redraw();
    });
    showTab(ui.tab, false);
  }

  /** Draw the visible tab with settings whose fonts are loaded. */
  function draw(s) {
    $('tabTitleA').textContent = $('tabTitleB').textContent = $('bmLabel').textContent = s.appName;
    if (ui.tab === 'sizes') drawSizes(s);
    else if (ui.tab === 'browser') drawBrowser(s);
    else if (ui.tab === 'home') drawHome(s);
    else if (ui.tab === 'zoom') drawZoom(s);
  }

  return { init, draw, siteAddress, activeTab: () => ui.tab, androidShape: () => ui.androidShape };
})();
