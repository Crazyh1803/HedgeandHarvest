const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const C = require('../game.js');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const url = pathToFileURL(path.resolve('index.html')).href;
  try {
    const legacy = C.serialize(C.newMaze({ size: 'small', season: 'autumn', animal: 'cat', seed: 42, name: 'Legacy orchard' }));
    legacy.version = 1; delete legacy.purpose;
    for (const [raw, valid] of [[JSON.stringify(legacy), true], ['{"format":"cornfield-carver","version":99}', false]]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript(value => {
        localStorage.setItem('cornfield-carver:v1', value);
        localStorage.setItem('cornfield-carver:seen', '1');
      }, raw);
      await page.goto(url);
      await page.waitForFunction(() => !!window.__cornfield);
      if (valid) {
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
        const backups = await page.evaluate(() => Object.keys(localStorage).filter(k => /backup/.test(k)).map(k => localStorage.getItem(k)));
        assert.ok(backups.includes(raw), 'an unreadable existing save must survive as a raw backup');
      }
      await context.close();
    }
    console.log('Storage PASS: v1 maze restoration preserves work and migrates purpose; unreadable saves backed up before art fallback.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
