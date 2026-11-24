'use strict';
/*
 * The page's theme: System (following the system setting, live), Light or Dark, from the menu at the top.
 * Only the interface changes; icons and files show the design. The choice is a page preference, kept apart
 * from designs, share links and undo history. Text contrast meets WCAG AA in both themes.
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, openApp, settled, download, targets, FILE_URL } = require('../helpers/browser');
const { makePng } = require('../helpers/formats');

const WHITE = 'rgb(255, 255, 255)';
const BLACK = 'rgb(0, 0, 0)';
const KEY = 'favicon-maker.theme';

/** Open the app with a saved theme choice (or none), and a system color scheme. */
async function openWith(browser, url, choice, colorScheme, options = {}) {
  const context = await browser.newContext({ colorScheme, serviceWorkers: 'block', acceptDownloads: true, ...options });
  await context.addInitScript(([key, choice]) => {
    if (choice && !sessionStorage.getItem('__seeded')) {
      try { localStorage.setItem(key, choice); } catch (e) { /* none */ }
      sessionStorage.setItem('__seeded', '1');
    }
    // What the very first frame shows, before anything is painted.
    requestAnimationFrame(() => {
      const root = document.documentElement;
      window.__firstFrame = {
        theme: root.getAttribute('data-theme'),
        bg: getComputedStyle(document.body || root).backgroundColor
      };
    });
  }, [KEY, choice]);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    // (Playwright's own note about the blocked service worker isn't the page's.)
    if ((m.type() === 'error' || m.type() === 'warning') && !/blocked by Playwright/.test(m.text())) errors.push(m.type() + ': ' + m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await settled(page);
  return { context, page, errors };
}

const state = (page) => page.evaluate(() => {
  const root = document.documentElement;
  return {
    theme: root.getAttribute('data-theme'),
    choice: root.getAttribute('data-theme-choice'),
    bg: getComputedStyle(document.body).backgroundColor,
    fg: getComputedStyle(document.body).color,
    scheme: getComputedStyle(root).colorScheme,
    bar: Array.from(document.querySelectorAll('meta[name="theme-color"]'), (m) => m.content),
    label: document.getElementById('themeButton').getAttribute('aria-label')
  };
});

/** Wait for the short fade between themes to end, so colors are final. */
const settledTheme = (page) => page.waitForFunction(() => !document.documentElement.classList.contains('theme-switching') &&
  document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState === 'finished'));

async function chooseByMouse(page, label) {
  await page.click('#themeButton');
  await page.getByRole('menuitemradio', { name: label }).click();
  await settledTheme(page);
}

/**
 * Every visible piece of text whose contrast with what's behind it is below WCAG AA: 4.5:1, or 3:1 for
 * large text (24 px, or 18.66 px bold). Disabled controls are exempt, as WCAG allows.
 */
const contrastFailures = (page) => page.evaluate(() => {
  const parse = (c) => {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c) || /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(c);
    if (!m) return null;
    const k = c.startsWith('color(') ? 255 : 1;
    return [m[1] * k, m[2] * k, m[3] * k, m[4] === undefined ? 1 : Number(m[4])];
  };
  const over = (top, bottom) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1);
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  /**
   * The solid color behind an element: its own background and its ancestors', composited. A pressed
   * segmented button sits on the group's sliding pill, which is the group's ::before.
   */
  const backdrop = (el) => {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const pill = n === el && n.matches('.seg button[aria-pressed="true"]') ? parse(getComputedStyle(n.parentElement, '::before').backgroundColor) : null;
      if (pill && pill[3] > 0) layers.push(pill);
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0) layers.push(c);
      if (c && c[3] >= 1) break;
    }
    let color = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) color = over(layers[i], color);
    return color;
  };
  const opacity = (el) => {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  const failures = [];
  const candidates = Array.from(document.querySelectorAll('body *')).filter((el) => {
    if (el.closest('canvas, svg, [aria-hidden="true"], .sr-only, [hidden]')) return false;
    if (el.matches(':disabled') || el.closest(':disabled')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const st = getComputedStyle(el);
    if (st.visibility !== 'visible') return false;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return el.type !== 'range' && el.type !== 'color' && el.type !== 'checkbox' && el.type !== 'file' && (el.value || el.tagName === 'SELECT');
    return Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
  });
  for (const el of candidates) {
    const st = getComputedStyle(el);
    const bg = backdrop(el);
    let fg = parse(st.color);
    if (!fg) continue;
    fg = over([fg[0], fg[1], fg[2], fg[3] * opacity(el)], bg);
    const size = parseFloat(st.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(st.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(fg, bg);
    if (r < need - 0.01) {
      const text = (el.value || el.textContent || '').trim().slice(0, 40);
      failures.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${text}" ${r.toFixed(2)} < ${need}`);
    }
  }
  return failures;
});

for (const target of targets()) {
  describe(`theme from ${target.label}`, () => {
    let browser;
    let url;
    before(async () => { url = await target.start(); browser = await launch('chromium'); });
    after(async () => { await browser.close(); await target.stop(); });

    test('System is the default and follows the system setting, live', async () => {
      const { context, page, errors } = await openWith(browser, url, null, 'light');
      try {
        let s = await state(page);
        assert.deepEqual([s.choice, s.theme, s.bg, s.scheme, s.label], ['system', 'light', WHITE, 'light', 'Theme: System']);
        assert.deepEqual(s.bar, ['#ffffff', '#000000'], 'each theme-color keeps its own, for the browser to pick');
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
        s = await state(page);
        assert.deepEqual([s.theme, s.bg, s.fg, s.scheme], ['dark', BLACK, 'rgb(245, 245, 245)', 'dark']);
        await page.emulateMedia({ colorScheme: 'light' });
        await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('Light and Dark apply whatever the system says, and are kept after a reload', async () => {
      const { context, page, errors } = await openWith(browser, url, null, 'dark');
      try {
        await chooseByMouse(page, 'Light');
        let s = await state(page);
        assert.deepEqual([s.choice, s.theme, s.bg, s.scheme, s.label], ['light', 'light', WHITE, 'light', 'Theme: Light']);
        assert.deepEqual(s.bar, ['#ffffff', '#ffffff'], 'the browser bar matches the chosen theme');
        assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY), 'light');
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.waitForTimeout(100);
        assert.equal((await state(page)).theme, 'light', 'a chosen theme ignores the system');

        await chooseByMouse(page, 'Dark');
        await page.emulateMedia({ colorScheme: 'light' });
        s = await state(page);
        assert.deepEqual([s.theme, s.bg, s.scheme, s.label], ['dark', BLACK, 'dark', 'Theme: Dark']);
        assert.deepEqual(s.bar, ['#000000', '#000000']);

        // Kept: after a reload over http. From file://, in a new tab of the same browser instead: under heavy
        // load, Chromium sometimes starts a reloaded file:// page with empty localStorage (every key gone, the
        // page removing none of them; a plain page shows it too, never over http), which isn't the app.
        if (/^http/.test(url)) {
          await page.reload();
          await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
        } else {
          const again = await context.newPage();
          await again.goto(url);
          await again.waitForFunction(() => document.documentElement.dataset.ready === '1');
          s = await state(again);
          assert.deepEqual([s.choice, s.theme, s.bg, s.label], ['dark', 'dark', BLACK, 'Theme: Dark'], 'kept in a new tab');
          await again.close();
        }
        s = await state(page);
        assert.deepEqual([s.choice, s.theme, s.bg, s.label], ['dark', 'dark', BLACK, 'Theme: Dark'], 'kept');

        // Back to System: the saved choice goes, and the system decides again.
        await chooseByMouse(page, 'System');
        assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY), null);
        assert.equal((await state(page)).theme, 'light');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('no flash of the wrong theme: the first frame is already in the chosen theme', async () => {
      for (const [choice, scheme, theme, bg] of [['dark', 'light', 'dark', BLACK], ['light', 'dark', 'light', WHITE], [null, 'dark', 'dark', BLACK]]) {
        const { context, page } = await openWith(browser, url, choice, scheme);
        try {
          await page.reload(); // the first load seeded the choice; this one starts with it saved
          await page.waitForFunction(() => window.__firstFrame);
          assert.deepEqual(await page.evaluate(() => window.__firstFrame), { theme, bg }, `${choice || 'system'} on a ${scheme} system`);
        } finally {
          await context.close();
        }
      }
    });

    test('keyboard and screen reader: a menu button with three checkable choices', async () => {
      const { context, page, errors } = await openWith(browser, url, null, 'light');
      try {
        const button = page.locator('#themeButton');
        assert.equal(await button.getAttribute('aria-haspopup'), 'menu');
        assert.equal(await button.getAttribute('aria-expanded'), 'false');
        assert.equal(await page.getByRole('button', { name: 'Theme: System' }).count(), 1);

        await button.focus();
        await page.keyboard.press('Enter');
        assert.equal(await button.getAttribute('aria-expanded'), 'true');
        assert.equal(await page.getByRole('menu', { name: 'Theme' }).isVisible(), true);
        assert.equal(await page.evaluate(() => document.activeElement.dataset.choice), 'system', 'focus on the checked choice');
        assert.equal(await page.getByRole('menuitemradio', { name: 'System', checked: true }).count(), 1);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.choice), 'dark');
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.choice), 'system', 'wraps around');
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        assert.equal(await button.getAttribute('aria-expanded'), 'false');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'themeButton', 'focus goes back to the button');
        assert.equal((await state(page)).theme, 'dark');
        assert.equal(await button.getAttribute('aria-label'), 'Theme: Dark');

        // Escape closes without changing anything; a letter jumps to its choice; Space chooses.
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.choice), 'dark');
        await page.keyboard.press('Escape');
        assert.equal(await button.getAttribute('aria-expanded'), 'false');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'themeButton');
        assert.equal((await state(page)).theme, 'dark');
        await page.keyboard.press('Space');
        await page.keyboard.press('l');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.choice), 'light');
        await page.keyboard.press('Space');
        assert.equal((await state(page)).choice, 'light');
        // Tab leaves the menu and closes it; a click outside closes it too.
        await page.keyboard.press('Enter');
        await page.keyboard.press('Tab');
        assert.equal(await button.getAttribute('aria-expanded'), 'false');
        await page.click('#themeButton');
        await page.mouse.click(5, 400);
        assert.equal(await button.getAttribute('aria-expanded'), 'false');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('the theme is not part of designs, share links, undo, exports or Forget all saved data', async () => {
      const { context, page, errors } = await openWith(browser, url, null, 'light');
      try {
        await chooseByMouse(page, 'Dark');
        await page.waitForTimeout(600);
        assert.equal(await page.locator('#undo').isDisabled(), true, 'not an undo step');
        const saved = await page.evaluate(() => Object.keys(localStorage).filter((k) => k !== 'favicon-maker.theme').map((k) => localStorage.getItem(k)).join('\n'));
        assert.doesNotMatch(saved, /theme|"dark"\s*:\s*"?(light|dark|system)/i);
        await page.click('#share');
        await page.waitForFunction(() => /#d\d/.test(document.getElementById('shareUrl').value));
        const link = await page.inputValue('#shareUrl');
        const decoded = await page.evaluate((h) => Design.decodeHash(h).then((r) => JSON.stringify(r)), link.slice(link.indexOf('#')));
        assert.doesNotMatch(decoded, /theme/i);
        const exported = (await download(page, '#exportDesign')).data.toString('utf8');
        assert.doesNotMatch(exported, /theme/i);

        // Forget all saved data keeps the theme: it's a page preference, not saved data.
        await page.click('#forgetAll');
        await page.waitForSelector('#dialog[open]');
        await page.click('#dialogOk');
        await page.waitForSelector('#dialog:not([open])', { state: 'attached' });
        assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY), 'dark');
        assert.equal((await state(page)).theme, 'dark');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('icons and files show the design in every theme; the mock tabs keep their colors', async () => {
      const results = {};
      for (const choice of ['light', 'dark']) {
        const { context, page } = await openWith(browser, url, choice, 'light');
        try {
          const png = (await download(page, 'button[aria-label="Download favicon-32x32.png"]')).data.toString('base64');
          const preview = await page.evaluate(() => document.querySelector('#sizes canvas[aria-label="512 pixel preview"]').toDataURL());
          await page.click('#ptab-browser');
          await settled(page);
          const tabs = await page.evaluate(() => ['#tabA', '#tabB'].map((s) => getComputedStyle(document.querySelector(s).closest('.btab')).backgroundColor));
          results[choice] = { png, preview, tabs };
        } finally {
          await context.close();
        }
      }
      assert.equal(results.dark.png, results.light.png, 'the downloaded PNG is the same');
      assert.equal(results.dark.preview, results.light.preview, 'the preview is the same');
      assert.deepEqual(results.dark.tabs, results.light.tabs, 'the light and dark mock tabs stay light and dark');
      assert.notEqual(results.light.tabs[0], results.light.tabs[1]);
    });

    test('switching fades briefly, and not at all with reduced motion', async () => {
      for (const reducedMotion of ['no-preference', 'reduce']) {
        const { context, page } = await openWith(browser, url, null, 'light', { reducedMotion });
        try {
          await page.click('#themeButton');
          const duration = await page.evaluate(() => {
            document.querySelector('[role="menuitemradio"][data-choice="dark"]').click();
            return getComputedStyle(document.body).transitionDuration;
          });
          assert.equal(duration.split(',')[0].trim(), reducedMotion === 'reduce' ? '0s' : '0.2s', reducedMotion);
          await page.waitForFunction(() => !document.documentElement.classList.contains('theme-switching'));
        } finally {
          await context.close();
        }
      }
    });
  });
}

describe('text contrast meets WCAG AA in both themes', () => {
  let browser;
  before(async () => { browser = await launch('chromium'); });
  after(async () => { await browser.close(); });

  for (const choice of ['light', 'dark']) {
    test(`${choice}: the page, a dialog, the template gallery, the icon grid and the crop view`, async () => {
      const { context, page, errors } = await openWith(browser, FILE_URL, choice, choice === 'light' ? 'dark' : 'light');
      try {
        // Checked once every animation (panels fading in, the theme fade) has finished.
        const check = async (where) => {
          await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
          assert.deepEqual(await contrastFailures(page), [], where);
        };
        // Open every section, so all of their text is checked.
        await page.evaluate(() => document.querySelectorAll('.controls details.section:not([hidden])').forEach((d) => { d.open = true; }));
        await page.waitForFunction(() => document.querySelectorAll('#templates canvas[data-drawn]').length === document.querySelectorAll('#templates canvas').length, null, { timeout: 30000 });
        await settled(page);
        await check('the page and the template gallery');
        await page.click('#themeButton');
        await check('the theme menu');
        await page.keyboard.press('Escape');

        await page.click('#forgetAll');
        await page.waitForSelector('#dialog[open]');
        await check('a confirm dialog');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#dialog:not([open])', { state: 'attached' });

        await page.click('#modeIcon');
        await page.waitForFunction(() => document.querySelectorAll('#iconGrid [role="option"]').length > 10);
        await settled(page);
        await check('the icon grid');

        await page.click('#modeImage');
        await page.setInputFiles('#file', { name: 'logo.png', mimeType: 'image/png', buffer: makePng(120, 80, (x) => (x < 60 ? [200, 30, 30, 255] : [255, 255, 255, 255])) });
        await page.waitForFunction(() => !document.getElementById('cropBox').hidden);
        await settled(page);
        await check('the crop view and suggested colors');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});
