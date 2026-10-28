const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { clickControl } = require('./browser-controls.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 2, reducedMotion: 'reduce', acceptDownloads: true });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(pathToFileURL(path.resolve('index.html')).href);
      await page.locator('#modal-help button[data-close]').click();
      await page.locator('#tab-settings').click();
      const sizes = await page.locator('#size-group [data-size]').evaluateAll(els => els.map(el => el.dataset.size));
      assert.equal(sizes.length, 6);
      for (const size of sizes.slice(3)) {
        await page.locator('#size-group [data-size="' + size + '"]').click();
        await page.waitForFunction(s => window.__cornfield.state().size === s, size);
        await page.waitForTimeout(200);
        const fit = await page.evaluate(() => window.__cornfield.view());
        assert.ok(fit.layerW <= fit.cw + 1 && fit.layerH <= fit.ch + 1, 'entire ' + size + ' tray must fit ' + viewport.width);
        assert.ok(fit.ox >= -1 && fit.oy >= -1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      await page.locator('#tab-play').click();
      await page.locator('#btn-view').click();
      await page.waitForTimeout(300);
      const close = await page.evaluate(() => window.__cornfield.view());
      assert.equal(close.close, true);
      await page.locator('#field').focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(250);
      assert.ok(await page.evaluate(() => window.__cornfield.state().tractor.x > 0), 'large close-up still accepts movement');
      const mm = await page.evaluate(() => window.__cornfield.minimap());
      assert.equal(mm.field.w, 207); assert.equal(mm.field.h, 105);
      assert.ok(mm.visible.w < mm.field.w, 'minimap shows close-up footprint');
      const download = page.waitForEvent('download');
      await clickControl(page, '#btn-png');
      const png = await download;
      assert.equal(await png.failure(), null);
      const file = await png.path(); assert.ok(file);
      const bytes = await require('node:fs/promises').readFile(file);
      assert.ok(bytes.length > 1000);
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Large fields PASS: six presets, full-field fit, close-up movement, minimap and PNG export on desktop/mobile.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
