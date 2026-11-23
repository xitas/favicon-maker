'use strict';
/* The template gallery and Surprise me. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, openApp, settled, targets } = require('../helpers/browser');

/** The design in the form: every setting has a control with its id; the source is the pressed button. */
const current = (page) => page.evaluate(() => {
  const s = {};
  for (const k of Object.keys(Design.DEFAULTS)) {
    if (k === 'mode' || k === 'icon') continue;
    const e = document.getElementById(k);
    s[k] = e.type === 'checkbox' ? e.checked : e.value;
  }
  s.mode = ['text', 'icon', 'image'].find((m) => document.getElementById('mode' + m[0].toUpperCase() + m.slice(1)).getAttribute('aria-pressed') === 'true');
  return s;
});

async function answerDialog(page, accept) {
  await page.waitForSelector('#dialog[open]');
  const said = await page.evaluate(() => document.getElementById('dialogTitle').textContent);
  if (accept) await page.click('#dialogOk'); else await page.keyboard.press('Escape');
  await page.waitForSelector('#dialog:not([open])', { state: 'attached' });
  return said;
}

async function openGallery(page) {
  await page.click('#secTemplates > summary');
  await page.waitForFunction(() => {
    const all = document.querySelectorAll('#templates canvas');
    return all.length > 0 && document.querySelectorAll('#templates canvas[data-drawn="1"]').length === all.length;
  }, null, { timeout: 30000 });
}

/** How many pixels of a thumbnail have ink. */
const inked = (page, id) => page.evaluate((id) => {
  const c = document.querySelector(`#templates [data-template="${id}"] canvas`);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
}, id);

const checksText = (page) => page.locator('#checks').textContent();

for (const target of targets()) {
  describe(`templates and Surprise me from ${target.label}`, () => {
    let browser;
    let url;
    before(async () => { url = await target.start(); browser = await launch('chromium'); });
    after(async () => { await browser.close(); await target.stop(); });

    test('the gallery shows every template as a live thumbnail with the person’s own text', async () => {
      const { context, page, errors, externalRequests } = await openApp(browser, url);
      try {
        // Closed at first, so its fonts aren't downloaded until it's opened.
        assert.equal(await page.locator('#secTemplates').getAttribute('open'), null);
        assert.equal(await page.locator('#templates canvas[data-drawn]').count(), 0);
        await openGallery(page);
        const ids = await page.evaluate(() => Templates.LIST.map((t) => t.id));
        assert.equal(await page.locator('#templates button.template').count(), ids.length);
        for (const id of ids) assert.ok((await inked(page, id)) > 200, `${id} is drawn`);
        // Buttons are named by their visible text.
        assert.equal(await page.getByRole('button', { name: 'Slab stamp' }).count(), 1);

        // Typing changes the text templates' thumbnails, and not the icon ones.
        const before = await page.evaluate(() => ['slab-stamp', 'leaf'].map((id) => document.querySelector(`[data-template="${id}"] canvas`).toDataURL()));
        await page.fill('#text', 'WW');
        await settled(page);
        await openGallery(page);
        const afterTyping = await page.evaluate(() => ['slab-stamp', 'leaf'].map((id) => document.querySelector(`[data-template="${id}"] canvas`).toDataURL()));
        assert.notEqual(afterTyping[0], before[0], 'the text template shows the new text');
        assert.equal(afterTyping[1], before[1], 'the icon template stays');
        assert.deepEqual(errors, []);
        assert.deepEqual(externalRequests, []);
      } finally {
        await context.close();
      }
    });

    test('every template passes every design check in the page, small text included', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        // Text templates keep the person's text, so check the sample and the default letter too. (Two wide
        // letters, such as "Ab" in Montserrat, hit the width limit at 16 px in any design, and the check is
        // right to say so: that's the person's text, not the template.)
        const results = await page.evaluate(async () => {
          const out = {};
          for (const t of Templates.LIST) {
            for (const text of [null, 'F']) {
              const s = await Outputs.prepare(Templates.design(t, text && { mode: 'text', text }));
              const layout = s.mode === 'text' ? Draw.textLayout(16, s) : null;
              out[t.id + ' with ' + JSON.stringify(s.mode === 'text' ? s.text : s.icon)] = Checks.run(s, { textHeight16: layout ? layout.height : undefined }).warnings.map((w) => w.id);
            }
          }
          return out;
        });
        for (const [id, warnings] of Object.entries(results)) assert.deepEqual(warnings, [], id);
      } finally {
        await context.close();
      }
    });

    test('applying a template is one undo step, and keeps the text', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        await openGallery(page);
        const start = await current(page);
        // Nothing unsaved on a fresh page, so it applies without asking.
        await page.getByRole('button', { name: 'Slab stamp' }).click();
        await page.waitForFunction(() => document.getElementById('font').value === 'slab');
        await settled(page);
        const applied = await current(page);
        assert.equal(applied.text, start.text, 'the text stays');
        assert.equal(applied.fg, '#6b2a1a');
        assert.equal(applied.border, true);
        assert.match(await page.locator('#templateNote').textContent(), /Applied the “Slab stamp” template\. Undo brings your design back\./);
        assert.match(await checksText(page), /Looks good at every size/);

        await page.click('#undo');
        await settled(page);
        assert.deepEqual(await current(page), start, 'one undo brings the whole design back');
        await page.click('#redo');
        await settled(page);
        assert.deepEqual(await current(page), applied);

        // An icon template, by keyboard. The template's design isn't saved, so this time it asks first.
        await page.getByRole('button', { name: 'Green leaf' }).focus();
        await page.keyboard.press('Enter');
        assert.equal(await answerDialog(page, true), 'Use the “Green leaf” template?');
        await page.waitForFunction(() => document.getElementById('modeIcon').getAttribute('aria-pressed') === 'true');
        await settled(page);
        assert.equal((await current(page)).mode, 'icon');
        assert.equal((await current(page)).iconStroke, '2.25');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('a template asks first when there are unsaved changes', async () => {
      const { context, page } = await openApp(browser, url);
      try {
        await openGallery(page);
        await page.fill('#text', 'Q');
        await page.evaluate(() => {
          const r = document.getElementById('radius');
          r.value = '3';
          r.dispatchEvent(new Event('input', { bubbles: true }));
          r.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await settled(page);
        const mine = await current(page);

        page.getByRole('button', { name: 'Bold poster' }).click();
        assert.equal(await answerDialog(page, false), 'Use the “Bold poster” template?');
        await settled(page);
        assert.deepEqual(await current(page), mine, 'declined: nothing changes');

        page.getByRole('button', { name: 'Bold poster' }).click();
        await answerDialog(page, true);
        await page.waitForFunction(() => document.getElementById('font').value === 'display');
        await settled(page);
        const poster = await current(page);
        assert.equal(poster.text, 'Q', 'the person’s text stays');
        assert.equal(poster.radius, '22', 'the rest is the template');
        await page.click('#undo');
        await settled(page);
        assert.deepEqual(await current(page), mine);
      } finally {
        await context.close();
      }
    });

    test('Surprise me: always readable, never asks, and undoable', async () => {
      const { context, page, errors } = await openApp(browser, url);
      try {
        await page.fill('#text', 'Hi');
        await settled(page);
        const states = [await current(page)];
        for (let i = 0; i < 12; i++) {
          await page.click('#surprise');
          await settled(page);
          const s = await current(page);
          assert.equal(await page.locator('#dialog[open]').count(), 0, 'no question asked');
          assert.equal(s.text, 'Hi');
          assert.doesNotMatch(await checksText(page), /contrast|hard to see/i, `surprise ${i}: ${JSON.stringify([s.fg, s.bg, s.bg2, s.bgType])}`);
          const passes = await page.evaluate((s) => {
            const bgs = s.bgType === 'solid' ? [s.bg] : [s.bg, s.bg2];
            return Checks.worstContrast(s.fg, bgs).ratio >= Checks.MIN_CONTRAST;
          }, s);
          assert.ok(passes, `surprise ${i} passes the contrast check`);
          states.push(s);
        }
        assert.match(await page.locator('#templateNote').textContent(), /Undo brings the last one back/);
        assert.ok(new Set(states.map((s) => s.bg)).size > 8, 'different looks');
        // Each one is its own undo step.
        for (let i = states.length - 2; i >= states.length - 4; i--) {
          await page.click('#undo');
          await settled(page);
          assert.deepEqual(await current(page), states[i], `undo back to step ${i}`);
        }

        // In Icon mode it picks another icon; the mode stays.
        await page.click('#modeIcon');
        await settled(page);
        await page.click('#surprise');
        await settled(page);
        assert.equal((await current(page)).mode, 'icon');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}
