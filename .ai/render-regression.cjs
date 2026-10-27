const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
require('node:fs').mkdirSync('.ai/previews', { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.__canvasResets = 0;
      for (const key of ['width', 'height']) {
        const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, key);
        Object.defineProperty(HTMLCanvasElement.prototype, key, {
          ...d, set(value) { if (this.id === 'field') window.__canvasResets++; d.set.call(this, value); }
        });
      }
    });
    await page.goto(pathToFileURL(path.resolve('index.html')).href);
    await page.locator('#modal-help button[data-close]').click();
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => window.__cornfield.state().purpose), 'art');
    const sample = () => page.evaluate(() => ({
      pixels: document.getElementById('field').toDataURL(),
      width: document.getElementById('field').width, height: document.getElementById('field').height,
      resets: window.__canvasResets, view: window.__cornfield.view()
    }));
    const before = await sample();
    await page.waitForTimeout(5000);
    const after = await sample();
    assert.deepEqual(after, before, 'idle art must keep pixels, camera and backing store stable');
    const resize = await page.evaluate(() => {
      const before = window.__canvasResets;
      window.dispatchEvent(new Event('resize'));
      const c = document.getElementById('field');
      return { resets: window.__canvasResets - before, alpha: c.getContext('2d').getImageData(10, 10, 1, 1).data[3] };
    });
    assert.equal(resize.resets, 0, 'same-size resize must not clear the canvas');
    assert.equal(resize.alpha, 255, 'canvas must remain opaque immediately after resize');
    await page.locator('#field').focus();
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(1200);
    await page.keyboard.up('ArrowRight');
    assert.deepEqual((await sample()).view, before.view, 'overview must not follow a moving tractor');
    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 600 }, { width: 1440, height: 960 }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(250);
      assert.match(await page.locator('#btn-view').innerText(), /Whole field|Overview/i);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const a = await sample();
      await page.waitForTimeout(300);
      assert.deepEqual((await sample()).view, a.view, 'resize must settle without camera drift');
      await page.screenshot({ path: `.ai/previews/art-${viewport.width}.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log('Render PASS: art default, identical idle pixels, no idle backing-store clears, no same-size resize flash, fixed overview while driving, stable responsive views.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
