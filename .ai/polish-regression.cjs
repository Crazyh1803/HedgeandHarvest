const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { throw new Error('Polish checks require Playwright; set PLAYWRIGHT_MODULE or install Playwright.'); }

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [], supportRequests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => { if (req.url().includes('buymeacoffee.com')) supportRequests.push(req.url()); });
    await page.addInitScript(() => {
      const Native = window.AudioContext; window.__audioCreated = 0;
      window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__audioCreated++; } };
    });
    await page.goto(pathToFileURL(path.resolve('index.html')).href);
    await page.locator('#modal-help button[data-close]').click();
    assert.equal(await page.title(), 'Hedge and Harvest');
    assert.match(await page.locator('h1').innerText(), /Hedge.*Harvest/);
    const icon = await page.locator('link[rel="icon"]').getAttribute('href');
    assert.equal(icon, 'favicon.svg'); assert.match(fs.readFileSync('favicon.svg', 'utf8'), /<svg/);
    assert.equal(await page.locator('#now-playing-bar #music-track').count(), 1);
    assert.equal(await page.locator('#now-playing-bar #now-playing').count(), 1);
    const songs = await page.evaluate(() => window.CornfieldAudio.tracks);
    await page.locator('#music-next').click(); assert.equal(await page.evaluate(() => window.CornfieldAudio.track()), songs[1].id);
    await page.locator('#music-prev').click(); assert.equal(await page.evaluate(() => window.CornfieldAudio.track()), songs[0].id);
    await page.locator('#music-prev').click(); assert.equal(await page.evaluate(() => window.CornfieldAudio.track()), songs[4].id);
    assert.equal(await page.evaluate(() => window.__audioCreated), 0, 'top song controls must not unmute or construct audio');
    await page.locator('#music-track').selectOption(songs[0].id);
    await page.locator('#btn-music').click();
    await page.waitForFunction(() => window.CornfieldAudio.nowPlaying().playing);
    await page.evaluate(() => {
      const A = window.CornfieldAudio; window.__realNowPlaying = A.nowPlaying;
      A.nowPlaying = () => ({ id: A.tracks[2].id, title: A.tracks[2].title, playing: true });
    });
    await page.waitForFunction(() => document.getElementById('music-track').value === window.CornfieldAudio.tracks[2].id);
    assert.match(await page.locator('#now-playing').innerText(), new RegExp(songs[2].title));
    await page.locator('#music-prev').click();
    assert.equal(await page.evaluate(() => window.CornfieldAudio.track()), songs[1].id, 'skip should step from the audible song');
    await page.evaluate(() => { window.CornfieldAudio.nowPlaying = window.__realNowPlaying; });
    await page.waitForFunction(() => window.CornfieldAudio.nowPlaying().id === window.CornfieldAudio.tracks[1].id);
    await page.evaluate(() => { document.getElementById('music-next').click(); document.getElementById('music-next').click(); });
    assert.equal(await page.evaluate(() => window.CornfieldAudio.track()), songs[3].id, 'two rapid skips should advance twice, even before the first queued onset');
    await page.locator('#btn-music').click();
    for (const placement of ['main', 'settings', 'shared', 'loaded', 'completed']) {
      const link = page.locator(`a.support-link[data-placement="${placement}"]`);
      assert.equal(await link.count(), 1, 'one clear optional support link per placement');
      assert.equal(await link.getAttribute('href'), 'https://buymeacoffee.com/AppsbyDan');
      assert.equal(await link.getAttribute('target'), '_blank');
      const rel = await link.getAttribute('rel'); assert.ok(rel.includes('noopener') && rel.includes('noreferrer'));
      assert.ok((await link.innerText()).trim().length > 0);
    }
    assert.equal(await page.locator('a.support-link[data-placement="main"]').isVisible(), true);
    await page.locator('#tab-settings').click();
    assert.equal(await page.locator('a.support-link[data-placement="settings"]').isVisible(), true);
    await page.locator('#tab-play').click(); await page.locator('#btn-export-json').click();
    assert.equal(await page.locator('#modal-share a.support-link').isVisible(), true);
    await page.locator('#modal-share button[data-close]').click();
    assert.equal(await page.locator('#loaded-support').isVisible(), false);
    await page.locator('#btn-import').click(); await page.locator('#import-text').fill('{bad'); await page.locator('#import-load').click();
    assert.equal(await page.locator('#loaded-support').isVisible(), false, 'failed imports must not show a successful-load support note');
    const creation = await page.evaluate(() => {
      const C = window.__cornfield.core, o = C.serialize(C.newMaze({ size: 'small', season: 'summer', animal: 'cat', seed: 42, name: 'One happy hedge' }));
      o.rows = o.rows.map(r => '.'.repeat(r.length)); o.start = [1, 5]; o.exit = [2, 5]; o.tractor = [0, 5]; return JSON.stringify(o);
    });
    await page.locator('#import-text').fill(creation); await page.locator('#import-load').click();
    if (await page.locator('#modal-confirm').isVisible()) await page.locator('#confirm-ok').click();
    assert.equal(await page.locator('#loaded-support').isVisible(), true);
    assert.equal(await page.locator('a.support-link[data-placement="main"]').isVisible(), false, 'a contextual support note should replace the ambient one, not duplicate it');
    await page.locator('#mode-run').click(); await page.locator('#field').focus(); await page.keyboard.press('ArrowRight');
    await page.locator('#win').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#win a.support-link[data-placement="completed"]').isVisible(), true);
    await page.locator('#win-again').click();
    assert.equal(await page.locator('#win').isVisible(), false, 'support must never block continued play');
    const previews = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 720;
      const g = canvas.getContext('2d'); g.fillStyle = '#fff6e4'; g.fillRect(0, 0, canvas.width, canvas.height);
      const rows = [];
      for (const [row, kind] of window.__cornfield.core.ANIMALS.entries()) {
        const frames = [];
        for (let dir = 0; dir < 4; dir++) {
          const url = window.__cornfield.posePreview(kind, Math.PI / 2, 1, dir); frames.push(url);
          const img = new Image(); img.src = url; await img.decode();
          g.drawImage(img, dir * 160, row * 120, 155, 108);
          g.fillStyle = '#443b2a'; g.font = '12px sans-serif'; g.fillText(kind + ' ' + ['right', 'front', 'left', 'back'][dir], dir * 160 + 4, row * 120 + 117);
        }
        rows.push({ kind, distinct: new Set(frames).size });
      }
      return { rows, image: canvas.toDataURL() };
    });
    for (const row of previews.rows) assert.equal(row.distinct, 4, row.kind + ' must have four genuine directional renderings');
    fs.writeFileSync('.ai/previews/directional-animals.png', Buffer.from(previews.image.split(',')[1], 'base64'));
    await page.screenshot({ path: '.ai/previews/hedge-harvest-main.png', fullPage: true });
    assert.deepEqual(supportRequests, [], 'no automatic requests or navigation to the support site');
    assert.deepEqual(errors, []);
    console.log('Polish PASS: rebrand/favicon, audible top song controls, muted/rapid skips, five optional support placements, successful load/win flow and four-direction animal renders.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
