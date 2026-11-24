/* The page's own theme: System (the default, following the system setting live), Light or Dark. Only the
   interface changes: the icon previews and every file show the user's design whatever the theme.
   The choice is kept in localStorage on its own key, apart from designs, share links and undo history.
   The inline script in index.html's <head> applies it before the page draws (no flash of the wrong
   theme); this file keeps it up to date and runs the theme menu. */
const Theme = (() => {
  'use strict';

  const KEY = 'favicon-maker.theme';
  const CHOICES = ['system', 'light', 'dark'];
  const LABELS = { system: 'System', light: 'Light', dark: 'Dark' };
  const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  /** The saved choice, or 'system' when there is none (or storage isn't available). */
  function read() {
    try {
      const v = localStorage.getItem(KEY);
      return CHOICES.indexOf(v) !== -1 ? v : 'system';
    } catch (e) {
      return 'system';
    }
  }

  function save(choice) {
    try {
      if (choice === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch (e) { /* not kept: the choice lasts until the page closes */ }
  }

  /** 'light' or 'dark' for a choice, given whether the system is dark. */
  function resolve(choice, systemDark) {
    return choice === 'dark' || (choice === 'system' && systemDark) ? 'dark' : 'light';
  }

  /**
   * Apply a choice: data-theme (light or dark) and data-theme-choice on <html>, and the browser bar's color.
   * The two theme-color tags each keep their own color in data-color; System gives each its own (the
   * browser picks by its media query), Light or Dark gives both the chosen one.
   */
  function apply(choice) {
    const root = document.documentElement;
    const active = resolve(choice, !!(query && query.matches));
    root.setAttribute('data-theme', active);
    root.setAttribute('data-theme-choice', choice);
    const metas = Array.from(document.querySelectorAll('meta[name="theme-color"][data-color]'));
    const colorOf = (scheme) => {
      const m = metas.find((x) => x.dataset.scheme === scheme);
      return m ? m.dataset.color : null;
    };
    metas.forEach((m) => { m.content = choice === 'system' ? m.dataset.color : colorOf(active) || m.dataset.color; });
    return active;
  }

  /* ---------- The theme menu ---------- */

  let current = 'system';
  let button = null;
  let menu = null;

  function items() {
    return Array.from(menu.querySelectorAll('[role="menuitemradio"]'));
  }

  function show() {
    button.setAttribute('aria-label', 'Theme: ' + LABELS[current]);
    button.dataset.choice = current;
    items().forEach((item) => item.setAttribute('aria-checked', String(item.dataset.choice === current)));
  }

  /** Change the theme: a short cross-fade, unless reduced motion is asked for (see style.css). */
  function choose(choice) {
    current = CHOICES.indexOf(choice) !== -1 ? choice : 'system';
    save(current);
    const root = document.documentElement;
    root.classList.add('theme-switching');
    apply(current);
    show();
    clearTimeout(choose.timer);
    choose.timer = setTimeout(() => root.classList.remove('theme-switching'), 300);
  }

  function open(focusLast) {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const list = items();
    const checked = list.find((i) => i.getAttribute('aria-checked') === 'true');
    (focusLast ? list[list.length - 1] : checked || list[0]).focus();
  }

  function close(refocus) {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (refocus) button.focus();
  }

  function onButtonKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open(e.key === 'ArrowUp');
    }
  }

  function onMenuKey(e) {
    const list = items();
    const i = list.indexOf(document.activeElement);
    const go = (n) => { e.preventDefault(); list[(n + list.length) % list.length].focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') close(false);
    else if (e.key.length === 1) {
      // Type-ahead: S, L or D.
      const j = list.findIndex((item) => item.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase()));
      if (j !== -1) go(j);
    }
  }

  function init(btn, mnu) {
    button = btn;
    menu = mnu;
    current = read();
    apply(current);
    show();
    button.addEventListener('click', () => (menu.hidden ? open(false) : close(true)));
    button.addEventListener('keydown', onButtonKey);
    menu.addEventListener('keydown', onMenuKey);
    items().forEach((item) => item.addEventListener('click', () => {
      choose(item.dataset.choice);
      close(true);
    }));
    document.addEventListener('pointerdown', (e) => {
      if (!menu.hidden && !menu.contains(e.target) && !button.contains(e.target)) close(false);
    });
    menu.addEventListener('focusout', (e) => {
      if (!menu.hidden && e.relatedTarget && !menu.contains(e.relatedTarget) && e.relatedTarget !== button) close(false);
    });
    // System follows the system setting live.
    if (query) {
      const follow = () => { if (current === 'system') apply('system'); };
      if (query.addEventListener) query.addEventListener('change', follow);
      else if (query.addListener) query.addListener(follow);
    }
    // Another tab changed the theme.
    window.addEventListener('storage', (e) => {
      if (e.key === KEY || e.key === null) {
        current = read();
        apply(current);
        show();
      }
    });
  }

  return { KEY, CHOICES, LABELS, read, save, resolve, apply, choose, init, current: () => current };
})();
