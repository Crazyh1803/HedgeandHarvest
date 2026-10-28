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
    for (const [raw, valid, failBackup, failCheckpoint] of [[JSON.stringify(legacy), true, false, false], [JSON.stringify(legacy), true, false, true], [unreadable, false, false, false], [unreadable, false, true, false]]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript(({ raw, failBackup, failCheckpoint }) => {
        window.__checkpointFailures = 0;
        localStorage.setItem('cornfield-carver:v1', raw);
        localStorage.setItem('cornfield-carver:seen', '1');
        if (failBackup || failCheckpoint) {
          const native = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if ((failBackup && key === 'cornfield-carver:backup') || (failCheckpoint && key !== 'cornfield-carver:v1' && value === raw)) { window.__checkpointFailures++; throw new DOMException('Quota full', 'QuotaExceededError'); }
            return native.call(this, key, value);
          };
        }
      }, { raw, failBackup, failCheckpoint });
      await page.goto(url);
      await page.waitForFunction(() => !!window.__cornfield);
      assert.equal(await page.evaluate(() => window.__cornfield.state().purpose), 'art');
      assert.ok(await page.evaluate(() => window.__cornfield.core.counts(window.__cornfield.state()).cleared <= 1), 'all loads must start with a planted field');
      await page.waitForTimeout(450);
      assert.equal(await page.evaluate(() => localStorage.getItem('cornfield-carver:v1')), raw, 'startup must not replace the existing saved field');
      if (failCheckpoint) {
        await page.locator('#field').focus(); await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(600);
        assert.ok(await page.evaluate(() => window.__checkpointFailures > 0), 'checkpoint failure injection must actually run');
        assert.equal(await page.evaluate(() => localStorage.getItem('cornfield-carver:v1')), raw, 'failed checkpoint must preserve the older saved work');
        assert.match(await page.locator('#save-status').innerText(), /paused|unavailable/i);
        await context.close(); continue;
      }
      if (valid) {
        await page.locator('#tab-settings').click();
        await page.locator('button[data-season="spring"]').click();
        await page.locator('[data-animal="pig"]').click();
        await page.locator('#tab-play').click();
        await page.locator('#creation-name').fill('Fresh unsaved field');
        await page.waitForTimeout(450);
        assert.equal(await page.evaluate(() => localStorage.getItem('cornfield-carver:v1')), raw, 'preferences and naming a fresh field must not replace the saved carving');
        await page.locator('#btn-resume').click();
        if (await page.locator('#modal-confirm').isVisible()) await page.locator('#confirm-ok').click();
        const restored = await page.evaluate(() => window.__cornfield.core.serialize(window.__cornfield.state()));
        assert.equal(restored.purpose, 'maze');
        assert.equal(restored.version, 2);
        assert.deepEqual(restored.rows, legacy.rows);
        assert.deepEqual(restored.start, legacy.start);
        assert.deepEqual(restored.exit, legacy.exit);
        assert.equal(restored.name, legacy.name);
        await page.locator('#field').focus(); await page.keyboard.press('ArrowDown');
        await page.waitForFunction(() => /Autosaved/.test(document.getElementById('save-status').textContent));
        const carved = await page.evaluate(() => localStorage.getItem('cornfield-carver:v1'));
        assert.notDeepEqual(JSON.parse(carved).rows, legacy.rows, 'make a meaningful carved edit before replacing the field');
        await page.locator('#tab-settings').click(); await page.locator('[data-size="large"]').click();
        await page.locator('#confirm-ok').click();
        await page.locator('button[data-season="winter"]').click(); await page.locator('[data-animal="cow"]').click();
        await page.locator('#tab-play').click(); await page.locator('#creation-name').fill('Fresh field metadata');
        await page.waitForTimeout(600);
        assert.equal(await page.evaluate(() => localStorage.getItem('cornfield-carver:v1')), carved, 'size replacement must release save ownership before changing fresh-field preferences');
        await page.locator('#btn-resume').click();
        if (await page.locator('#modal-confirm').isVisible()) await page.locator('#confirm-ok').click();
        const continued = await page.evaluate(() => window.__cornfield.core.serialize(window.__cornfield.state()));
        assert.deepEqual(continued.rows, JSON.parse(carved).rows, 'Continue must target the most recent carving after a size change');
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
