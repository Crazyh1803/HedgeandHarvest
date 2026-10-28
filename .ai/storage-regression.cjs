const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { throw new Error('Browser checks require Playwright. Install it or set PLAYWRIGHT_MODULE to its module directory; see README.md.'); }
const C = require('../game.js');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const url = pathToFileURL(path.resolve('index.html')).href;
  try {
    const legacy = C.serialize(C.newMaze({ size: 'small', season: 'autumn', animal: 'cat', seed: 42, name: 'Legacy orchard' }));
    legacy.version = 1; delete legacy.purpose;
    const unreadable = '{"format":"cornfield-carver","version":99}';
    for (const [raw, valid, failBackup] of [[JSON.stringify(legacy), true, false], [unreadable, false, false], [unreadable, false, true]]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript(({ raw, failBackup }) => {
        localStorage.setItem('cornfield-carver:v1', raw);
        localStorage.setItem('cornfield-carver:seen', '1');
        if (failBackup) {
          const native = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === 'cornfield-carver:backup') throw new DOMException('Quota full', 'QuotaExceededError');
            return native.call(this, key, value);
          };
        }
      }, { raw, failBackup });
      await page.goto(url);
      await page.waitForFunction(() => !!window.__cornfield);
      assert.equal(await page.evaluate(() => window.__cornfield.state().purpose), 'art');
      assert.ok(await page.evaluate(() => window.__cornfield.core.counts(window.__cornfield.state()).cleared <= 1), 'all loads must start with a planted field');
      await page.waitForTimeout(450);
      assert.equal(await page.evaluate(() => localStorage.getItem('cornfield-carver:v1')), raw, 'startup must not replace the existing saved field');
      if (valid) {
        await page.locator('#tab-settings').click();
        await page.locator('button[data-season="spring"]').click();
        await page.locator('[data-animal="pig"]').click();
        await page.locator('#tab-play').click();
        await page.locator('#creation-name').fill('Fresh unsaved field');
        await page.waitForTimeout(450);
        assert.equal(await page.evaluate(() => localStorage.getItem('cornfield-carver:v1')), raw, 'preferences and naming a fresh field must not replace the saved carving');
        await page.locator('#btn-resume').click();
        const restored = await page.evaluate(() => window.__cornfield.core.serialize(window.__cornfield.state()));
        assert.equal(restored.purpose, 'maze');
        assert.equal(restored.version, 2);
        assert.deepEqual(restored.rows, legacy.rows);
        assert.deepEqual(restored.start, legacy.start);
        assert.deepEqual(restored.exit, legacy.exit);
        assert.equal(restored.name, legacy.name);
      } else {
        assert.equal(await page.evaluate(() => window.__cornfield.state().purpose), 'art');
        await page.waitForTimeout(600);
        if (failBackup) {
          await page.locator('#creation-name').fill('New work during storage pressure');
          await page.locator('#field').focus(); await page.keyboard.press('ArrowRight');
          await page.waitForTimeout(600);
          assert.equal(await page.evaluate(() => localStorage.getItem('cornfield-carver:v1')), raw, 'failed backup must block later autosaves from overwriting the original');
          assert.match(await page.locator('#save-status').innerText(), /Autosave paused/);
        } else {
          const backups = await page.evaluate(() => Object.keys(localStorage).filter(k => /backup/.test(k)).map(k => localStorage.getItem(k)));
          assert.ok(backups.includes(raw), 'an unreadable existing save must survive as a raw backup');
        }
      }
      await context.close();
    }
    console.log('Storage PASS: v1 maze restoration preserves work and migrates purpose; unreadable saves backed up before art fallback.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
