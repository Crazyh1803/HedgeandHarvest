const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { throw new Error('Browser checks require Playwright; set PLAYWRIGHT_MODULE or install Playwright. See README.md.'); }
require('node:fs').mkdirSync('.ai/previews', { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      const Native = window.AudioContext;
      window.__audioCreated = 0;
      window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__audioCreated++; } };
    });
    await page.goto(pathToFileURL(path.resolve('index.html')).href);
    await page.locator('#modal-help button[data-close]').click();
    await page.locator('#tab-settings').click();
    await page.locator('#motion-mode').selectOption('full');
    const choices = await page.locator('#music-track option').evaluateAll(options => options.map(o => ({ value: o.value, label: o.textContent })));
    assert.equal(choices.length, 5); assert.match(choices[0].label, /Cornfield Bounce/i);
    assert.equal(await page.locator('#music-rotate').isChecked(), true);
    await page.locator('#music-track').selectOption(choices[3].value);
    await page.locator('#music-rotate').uncheck();
    assert.equal(await page.evaluate(() => window.__audioCreated), 0, 'muted track selection must not construct an audio context');
    assert.equal(await page.locator('#btn-music').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => localStorage.getItem('cornfield-carver:v1')), null, 'music and motion preferences must not autosave the fresh field');
    await page.locator('#tab-play').click();
    await page.waitForTimeout(300);
    const view = await page.evaluate(() => window.__cornfield.view());
    const cornBefore = await page.locator('#field').evaluate(c => c.toDataURL());
    const mapBefore = await page.locator('#minimap').evaluate(c => c.toDataURL());
    await page.waitForTimeout(650);
    assert.notEqual(await page.locator('#field').evaluate(c => c.toDataURL()), cornBefore, 'happy corn must visibly sway');
    assert.equal(await page.locator('#minimap').evaluate(c => c.toDataURL()), mapBefore, 'sway must not animate or move the minimap');
    assert.deepEqual(await page.evaluate(() => window.__cornfield.view()), view, 'sway must not rock the camera');
    assert.equal(await page.evaluate(() => window.__cornfield.cornMotion().active), true);
    await page.locator('#tab-settings').click(); await page.locator('#motion-mode').selectOption('reduced');
    await page.waitForTimeout(300);
    const frozen = await page.locator('#field').evaluate(c => c.toDataURL());
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#field').evaluate(c => c.toDataURL()), frozen, 'reduced motion must freeze the corn');
    assert.equal(await page.evaluate(() => window.__cornfield.cornMotion().active), false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#motion-mode').selectOption('full');
    assert.equal(await page.evaluate(() => window.__cornfield.view().reduceMotion), false, 'Full must override the device preference');
    await page.locator('#motion-mode').selectOption('device');
    assert.equal(await page.evaluate(() => window.__cornfield.view().reduceMotion), true, 'Device must honor the live media preference');
    const posePixels = await page.evaluate(async () => {
      const contact = document.createElement('canvas'); contact.width = 360; contact.height = 720;
      const out = contact.getContext('2d'); out.fillStyle = '#fff6e4'; out.fillRect(0, 0, contact.width, contact.height);
      const results = [];
      for (const [row, kind] of window.__cornfield.core.ANIMALS.entries()) {
        const frames = [];
        for (const [col, phase] of [0, Math.PI / 2, 3 * Math.PI / 2].entries()) {
          const img = new Image(); img.src = window.__cornfield.posePreview(kind, phase, col ? 1 : 0); await img.decode();
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
          const g = c.getContext('2d'); g.drawImage(img, 0, 0);
          frames.push({ data: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height });
          out.drawImage(img, col * 120, row * 120, 120, 105);
        }
        let lower = 0;
        const [a, b] = [frames[1], frames[2]];
        for (let y = Math.floor(a.h * 0.62); y < a.h; y++) for (let x = 0; x < a.w; x++) {
          const i = (y * a.w + x) * 4;
          if ([0, 1, 2, 3].some(k => a.data[i + k] !== b.data[i + k])) lower++;
        }
        results.push({ kind, lower });
        out.fillStyle = '#443b2a'; out.font = '14px sans-serif'; out.fillText(kind, 8, row * 120 + 116);
      }
      return { results, contact: contact.toDataURL() };
    });
    for (const result of posePixels.results) assert.ok(result.lower >= 20, `${result.kind}: opposite strides must change visible lower-leg pixels, not just gait counters`);
    require('node:fs').writeFileSync('.ai/previews/running-poses.png', Buffer.from(posePixels.contact.split(',')[1], 'base64'));
    await page.reload(); await page.locator('#tab-settings').click();
    assert.equal(await page.locator('#music-track').inputValue(), choices[3].value);
    assert.equal(await page.locator('#music-rotate').isChecked(), false);
    assert.equal(await page.evaluate(() => window.__audioCreated), 0);
    await page.screenshot({ path: '.ai/previews/music-motion-settings.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('Lively PASS: five-track settings persist while muted, actual six-animal leg pixels differ, corn sways with fixed camera/map, reduced motion and Full override work.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
