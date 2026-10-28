const { clickControl } = require('./browser-controls.cjs');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { throw new Error('Browser checks require Playwright. Install it or set PLAYWRIGHT_MODULE to its module directory; see README.md.'); }
require('node:fs').mkdirSync('.ai/previews', { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      const Native = window.AudioContext;
      window.__audioContexts = [];
      window.AudioContext = class extends Native {
        constructor(...args) { super(...args); window.__audioContexts.push(this); }
      };
    });
    await page.goto(pathToFileURL(path.resolve('index.html')).href);
    await page.locator('#modal-help [data-close][data-autofocus]').click();
    assert.equal(await page.locator('#btn-music').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#btn-sfx').getAttribute('aria-pressed'), 'false');
    await page.locator('#btn-music').click();
    await page.waitForFunction(() => window.__audioContexts[0]?.state === 'running');
    await page.locator('#btn-sfx').click();
    await page.locator('#btn-music').click();
    assert.equal(await page.locator('#btn-sfx').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#btn-music').getAttribute('aria-pressed'), 'false');
    await page.locator('#btn-sfx').click();
    await page.waitForFunction(() => window.__audioContexts[0]?.state === 'suspended');
    assert.equal(await page.evaluate(() => window.__cornfield.state().purpose), 'art');
    await page.locator('#field').focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    const artGrid = await page.evaluate(() => Array.from(window.__cornfield.state().grid));
    await clickControl(page, '#btn-maze');
    assert.deepEqual(await page.evaluate(() => Array.from(window.__cornfield.state().grid)), artGrid);
    assert.equal(await page.locator('#mode-run').isEnabled(), false);
    await clickControl(page, '#btn-place-start');
    await page.locator('#field').focus();
    await page.keyboard.press('Enter');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await clickControl(page, '#btn-place-exit');
    const expectedExit = await page.evaluate(() => ({ x: window.__cornfield.state().tractor.x, y: window.__cornfield.state().tractor.y }));
    const target = await page.evaluate(() => {
      const v = window.__cornfield.view(), t = window.__cornfield.state().tractor;
      return { x: v.gridX + (t.x + 0.5) * v.t, y: v.gridY + (t.y + 0.5) * v.t };
    });
    await page.locator('#field').click({ position: target });
    assert.equal(await page.locator('#mode-run').isEnabled(), true);
    const gates = await page.evaluate(() => {
      const s = window.__cornfield.state(); return { start: s.start, exit: s.exit, grid: Array.from(s.grid) };
    });
    assert.equal(gates.exit.x - gates.start.x, 3);
    assert.deepEqual(gates.exit, expectedExit, 'pointer gate must land on the intended field cell');
    await clickControl(page, '#btn-maze');
    await clickControl(page, '#btn-maze');
    assert.deepEqual(await page.evaluate(() => {
      const s = window.__cornfield.state(); return { start: s.start, exit: s.exit, grid: Array.from(s.grid) };
    }), gates);
    await clickControl(page, '#btn-generate');
    if (await page.locator('#modal-confirm').isVisible()) await page.locator('#confirm-ok').click();
    await page.locator('#tab-settings').click();
    await page.locator('button[data-season="autumn"]').click();
    await page.locator('[data-animal="pig"]').click();
    await page.locator('#tab-play').click();
    await page.locator('#creation-name').fill('Autumn ramble');
    await clickControl(page, '#btn-export-json');
    const json = await page.locator('#share-text').inputValue();
    assert.equal(JSON.parse(json).animal, 'pig');
    assert.equal(JSON.parse(json).season, 'autumn');
    const jsonDownload = page.waitForEvent('download');
    await page.locator('#share-download').click();
    assert.match((await jsonDownload).suggestedFilename(), /\.json$/);
    await page.locator('#modal-share button[data-close]').click();
    const pngDownload = page.waitForEvent('download');
    await clickControl(page, '#btn-png');
    const png = await pngDownload;
    assert.match(png.suggestedFilename(), /\.png$/);
    await png.saveAs(path.resolve('.ai/previews/export.png'));
    await clickControl(page, '#btn-import');
    await page.locator('#import-text').fill('{bad');
    await page.locator('#import-load').click();
    assert.match(await page.locator('#import-error').innerText(), /valid JSON/);
    await page.locator('#import-text').fill(json);
    await page.locator('#import-load').click();
    if (await page.locator('#modal-confirm').isVisible()) await page.locator('#confirm-ok').click();
    assert.equal(await page.locator('#creation-name').inputValue(), 'Autumn ramble');
    await clickControl(page, '#mode-run');
    const route = await page.evaluate(() => {
      const { core, state } = window.__cornfield;
      const s = state();
      return [[s.start.x, s.start.y], ...core.findPath(s, s.start.x, s.start.y)];
    });
    for (let i = 1; i < route.length; i++) {
      const dx = route[i][0] - route[i - 1][0], dy = route[i][1] - route[i - 1][1];
      await page.keyboard.press(dx > 0 ? 'ArrowRight' : dx < 0 ? 'ArrowLeft' : dy > 0 ? 'ArrowDown' : 'ArrowUp');
    }
    await page.locator('#win').waitFor({ state: 'visible' });
    await page.locator('#win-again').click();
    await page.screenshot({ path: '.ai/previews/desktop.png', fullPage: true });
    await page.reload();
    assert.equal(await page.evaluate(() => window.__cornfield.state().purpose), 'art');
    assert.ok(await page.evaluate(() => window.__cornfield.core.counts(window.__cornfield.state()).cleared <= 1), 'reload should open a fully planted art field');
    await page.locator('#btn-resume').click();
    assert.equal(await page.locator('#creation-name').inputValue(), 'Autumn ramble');
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.locator('.dpad-btn.right').click();
      await page.screenshot({ path: `.ai/previews/mobile-${width}.png`, fullPage: true });
    }
    const oneStep = await page.evaluate(() => {
      const o = window.__cornfield.core.serialize(window.__cornfield.state());
      o.start = [0, 1]; o.exit = [1, 1]; o.tractor = [0, 1];
      o.rows[1] = '..' + '#'.repeat(o.width - 2);
      return JSON.stringify(o);
    });
    await clickControl(page, '#btn-import');
    await page.locator('#import-text').fill(oneStep);
    await page.locator('#import-load').click();
    if (await page.locator('#modal-confirm').isVisible()) await page.locator('#confirm-ok').click();
    await clickControl(page, '#mode-run');
    await page.keyboard.press('ArrowRight');
    await page.locator('#win').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#win-time').innerText(), '0:00');
    assert.deepEqual(errors, []);
    console.log('Browser PASS: rendering, independent audio toggles/context lifecycle, settings, JSON roundtrip/rejection/download, PNG, keyboard maze victory, autosave, touch controls, responsive widths; no page errors.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });


