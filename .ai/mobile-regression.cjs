const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { throw new Error('Mobile checks require Playwright; set PLAYWRIGHT_MODULE or install Playwright.'); }

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage(), cdp = await context.newCDPSession(page), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve('index.html')).href);
    await page.locator('#modal-help button[data-close]').click();
    const actor = () => page.evaluate(() => {
      const s = window.__cornfield.state(); return { x: s.purpose === 'maze' ? s.run.x : s.tractor.x, y: s.purpose === 'maze' ? s.run.y : s.tractor.y };
    });
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
    async function press(direction, duration = 35, cancel = false) {
      const control = page.locator('.dpad-btn.' + direction);
      await control.scrollIntoViewIfNeeded();
      const r = await control.boundingBox(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      await touch('touchStart', x, y); await page.waitForTimeout(duration);
      await touch(cancel ? 'touchCancel' : 'touchEnd', x, y);
    }
    async function fourDirections() {
      for (const [name, dx, dy] of [['down', 0, 1], ['up', 0, -1], ['right', 1, 0], ['left', -1, 0]]) {
        const before = await actor(); await press(name); const after = await actor();
        assert.deepEqual(after, { x: before.x + dx, y: before.y + dy }, `${name} must move directly ${name} in screen space`);
        await page.waitForTimeout(250); assert.deepEqual(await actor(), after, 'touch release must stop movement');
      }
    }
    await fourDirections();
    await press('right', 350, true); const canceled = await actor();
    await page.waitForTimeout(300); assert.deepEqual(await actor(), canceled, 'touchCancel must release the held direction');
    const prevented = await page.locator('.dpad-btn.right').evaluate(el => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); el.dispatchEvent(event); return event.defaultPrevented;
    });
    assert.equal(prevented, true, 'long-press context menu must not interrupt D-pad control');
    await page.locator('#btn-view').click();
    await fourDirections();
    const creation = await page.evaluate(() => {
      const c = window.__cornfield.core, o = c.serialize(c.newMaze({ size: 'medium', season: 'summer', animal: 'dog', seed: 42, name: 'Mobile compass' }));
      o.rows = o.rows.map(row => '.'.repeat(row.length)); o.start = [5, 8]; o.exit = [20, 14]; o.tractor = [0, 8]; return JSON.stringify(o);
    });
    await page.locator('#btn-import').click(); await page.locator('#import-text').fill(creation); await page.locator('#import-load').click();
    if (await page.locator('#modal-confirm').isVisible()) await page.locator('#confirm-ok').click();
    await page.locator('#mode-run').click();
    await fourDirections();
    const beforeDrag = await actor();
    await page.locator('#field').scrollIntoViewIfNeeded();
    const drag = await page.evaluate(() => {
      const v = window.__cornfield.view(), a = window.__cornfield.state().run, r = document.getElementById('field').getBoundingClientRect();
      return { x: r.left + v.gridX + (a.x + 0.5) * v.t, y: r.top + v.gridY + (a.y + 0.5) * v.t, dy: v.t * 1.5 };
    });
    await touch('touchStart', drag.x, drag.y); await touch('touchMove', drag.x, drag.y + drag.dy); await touch('touchEnd', drag.x, drag.y + drag.dy);
    const afterDrag = await actor();
    assert.equal(afterDrag.x, beforeDrag.x); assert.ok(afterDrag.y > beforeDrag.y, 'dragging down on the field should walk down, never reverse');
    for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 667 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport); await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const r = await page.locator('.dpad-btn.down').boundingBox();
      assert.ok(r.width >= 44 && r.height >= 44, 'touch controls must keep usable hit targets');
      if (viewport.height > viewport.width) assert.ok(r.y + r.height <= viewport.height, `D-pad should fit the initial portrait viewport ${viewport.width}x${viewport.height}`);
      await page.screenshot({ path: `.ai/previews/mobile-touch-${viewport.width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => scrollTo(0, 0));
    await touch('touchStart', 4, 700); await touch('touchMove', 4, 400); await touch('touchEnd', 4, 400);
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => scrollY > 0), 'page scrolling outside the canvas must remain available');
    assert.deepEqual(errors, []);
    console.log('Mobile PASS: native touch directions, holds/releases/cancel, close-up, runner, downward drag, portrait reachability, landscape and outside-canvas scrolling.');
  } finally { await context.close(); await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
