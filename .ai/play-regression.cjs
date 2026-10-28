const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { throw new Error('Browser checks require Playwright; set PLAYWRIGHT_MODULE or install Playwright. See README.md.'); }
require('node:fs').mkdirSync('.ai/previews', { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve('index.html')).href);
    await page.locator('#modal-help button[data-close]').click();
    assert.equal(await page.locator('#tab-play').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#size-group').isVisible(), false);
    const unchanged = () => page.evaluate(() => {
      const s = window.__cornfield.state(); return { grid: Array.from(s.grid), tractor: { ...s.tractor }, purpose: s.purpose };
    });
    const before = await unchanged();
    const viewBefore = await page.evaluate(() => window.__cornfield.view());
    await page.locator('#tab-play').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#tab-settings').getAttribute('aria-selected'), 'true');
    for (const id of ['size-group', 'season-group', 'animal-group']) assert.equal(await page.locator('#' + id).isVisible(), true);
    assert.deepEqual(await unchanged(), before, 'tab keyboard input must not move the actor or alter art');
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#tab-play').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('End');
    assert.equal(await page.locator('#tab-settings').getAttribute('aria-selected'), 'true');
    await page.locator('#tab-play').click();
    assert.deepEqual(await page.evaluate(() => window.__cornfield.view()), viewBefore, 'tab switches must not change the camera');
    await page.locator('#btn-view').click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#minimap').isVisible(), true);
    const mapBefore = await page.evaluate(() => ({ pixels: document.getElementById('minimap').toDataURL(), info: window.__cornfield.minimap() }));
    await page.locator('#tab-settings').click();
    assert.equal(await page.locator('#minimap').isVisible(), true, 'minimap must remain visible while settings are open');
    await page.locator('#tab-play').click();
    await page.locator('#field').focus();
    await page.keyboard.down('ArrowRight'); await page.waitForTimeout(900); await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(500);
    assert.notEqual(await page.locator('#minimap').evaluate(c => c.toDataURL()), mapBefore.pixels, 'minimap must update after carving and movement');
    await page.screenshot({ path: '.ai/previews/closeup-minimap.png', fullPage: true });
    const creation = await page.evaluate(() => {
      const c = window.__cornfield.core, o = c.serialize(c.newMaze({ size: 'medium', season: 'summer', animal: 'dog', seed: 14, name: 'Running meadow' }));
      o.rows = o.rows.map(row => '.'.repeat(row.length));
      o.start = [1, 8]; o.exit = [23, 8]; o.tractor = [0, 8];
      o.rows[7] = '.#' + '.'.repeat(o.width - 2);
      return JSON.stringify(o);
    });
    await page.locator('#btn-import').click(); await page.locator('#import-text').fill(creation); await page.locator('#import-load').click();
    if (await page.locator('#modal-confirm').isVisible()) await page.locator('#confirm-ok').click();
    await page.locator('#mode-run').click();
    for (const animal of ['dog', 'cat', 'cow', 'horse', 'pig', 'chicken']) {
      await page.locator('#tab-settings').click(); await page.locator(`[data-animal="${animal}"]`).click(); await page.locator('#tab-play').click();
      await page.locator('#btn-reset').click(); await page.locator('#field').focus();
      await page.keyboard.press('ArrowUp');
      assert.equal(await page.evaluate(() => window.__cornfield.animation().moving), false, 'blocked input cannot start a gait');
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(90);
      const first = await page.evaluate(() => window.__cornfield.animation());
      await page.waitForTimeout(160);
      const second = await page.evaluate(() => window.__cornfield.animation());
      assert.ok(first.moving || second.moving, `${animal} should animate during movement`);
      assert.notEqual(first.phase, second.phase, `${animal} stride should advance with distance`);
      await page.locator('#field').screenshot({ path: `.ai/previews/run-${animal}.png` });
      await page.keyboard.up('ArrowRight'); await page.waitForTimeout(1100);
      const stopped = await page.evaluate(() => window.__cornfield.animation());
      assert.equal(stopped.moving, false); assert.equal(stopped.amount, 0, `${animal} should settle to a static pose`);
    }
    await page.locator('#tab-settings').click();
    await page.screenshot({ path: '.ai/previews/settings-tab.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#minimap').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: '.ai/previews/settings-mobile.png', fullPage: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await page.locator('#tab-play').click(); await page.locator('#mode-run').click();
    await page.locator('#field').focus(); await page.keyboard.down('ArrowRight'); await page.waitForTimeout(250); await page.keyboard.up('ArrowRight');
    assert.equal(await page.evaluate(() => window.__cornfield.animation().amount), 0, 'reduced motion must keep the gait neutral');
    assert.deepEqual(errors, []);
    console.log('Play PASS: accessible settings tabs, input isolation, close-up minimap, six movement-driven gaits, static idle/blocked poses, responsive layout and reduced motion.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
