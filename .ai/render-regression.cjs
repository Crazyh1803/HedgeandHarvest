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
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.__canvasResets = 0;
      for (const key of ['width', 'height']) {
        const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, key);
        Object.defineProperty(HTMLCanvasElement.prototype, key, { ...d, set(value) {
          if (this.id === 'field') window.__canvasResets++;
          d.set.call(this, value);
          if (this.id === 'field' && window.__watchResize) queueMicrotask(() => {
            const g = this.getContext('2d');
            const points = [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]];
            if (points.every(([x, y]) => g.getImageData(Math.floor(x * this.width), Math.floor(y * this.height), 1, 1).data[3] === 0)) window.__blankResizes++;
          });
        } });
      }
    });
    await page.goto(pathToFileURL(path.resolve('index.html')).href);
    await page.locator('#modal-help button[data-close]').click();
    await page.waitForTimeout(1000);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => { window.__watchResize = true; window.__blankResizes = 0; });
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
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.match(await page.locator('#btn-view').innerText(), /Whole field|Overview/i);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const a = await sample();
      assert.ok(a.view.layerW <= a.view.cw && a.view.layerH <= a.view.ch, 'overview must fit the complete tray');
      assert.ok(a.view.ox >= 0 && a.view.oy >= 0, 'overview tray must stay inside the canvas');
      await page.waitForTimeout(300);
      assert.deepEqual((await sample()).view, a.view, 'resize must settle without camera drift');
      assert.equal(await page.evaluate(() => window.__blankResizes), 0, 'real resize callback must redraw before yielding');
      await page.screenshot({ path: `.ai/previews/art-${viewport.width}.png`, fullPage: true });
    }
    await page.locator('#btn-view').click();
    assert.match(await page.locator('#btn-view').innerText(), /Close-up/i);
    await page.waitForTimeout(500);
    await page.locator('#field').screenshot({ path: '.ai/previews/corn-detail.png' });
    await page.locator('#btn-view').click();
    assert.match(await page.locator('#btn-view').innerText(), /Whole field|Overview/i);
    assert.deepEqual(errors, []);
    console.log('Render PASS: art default, identical idle pixels, no idle backing-store clears, no same-size resize flash, fixed overview while driving, stable responsive views.');
  } finally { await browser.close(); }
})().catch(e => { console.error('Render checks failed (Edge required by default; set BROWSER_CHANNEL for another installed browser).', e); process.exitCode = 1; });
