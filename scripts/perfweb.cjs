// Performance probe in Chromium (v0.25 round 2): Continue time and frames at 4x around game midnight.
//   npx vite preview --port 4317 &  then  node scripts/perfweb.cjs http://localhost:4317/ <save.json> [secs=40] [ipad|mac]
// The save goes into the autosave slot as the game stores it (lz16). Prints Continue -> shell (3 runs, a fresh page each),
// then plays at 4x and lists every frame over 40 ms with the game minute of day it ended on (0-2 = just past midnight).
const fs = require('fs');
const { chromium } = require('playwright');
const LZ = require('lz-string');
const [url, file, secs = '40', view = 'ipad'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWS = {
  mac: { viewport: { width: 1440, height: 900 } },
  ipad: { viewport: { width: 1180, height: 788 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
(async () => {
  const value = 'lz1:' + LZ.compressToUTF16(fs.readFileSync(file, 'utf8'));
  const b = await chromium.launch();
  const ctx = await b.newContext(VIEWS[view]);
  const errs = [];
  let page;
  const cont = [];
  for (let run = 0; run < 3; run++) {
    if (page) await page.close();
    page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.evaluate((v) => { localStorage.clear(); localStorage.setItem('contrail-acmi:save:auto', v); }, value);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__contrail && window.__contrail.screen === 'title', null, { timeout: 90000 });
    await sleep(800);
    await page.evaluate(() => window.__contrail.closeModal());
    await sleep(200);
    const t0 = Date.now();
    await page.getByRole('button', { name: /Continue/ }).first().click();
    await page.waitForSelector('.shell', { timeout: 60000 });
    cont.push(Date.now() - t0);
  }
  console.log(`continue -> shell ms: ${cont.join(', ')}`);
  await page.evaluate(() => {
    const s = window.__contrail;
    s.setSettings({ autoPause: Object.fromEntries(Object.keys(s.settings.autoPause).map((k) => [k, false])), toasts: false, sound: false, music: false, globeSpin: false });
    s.modal = null; s.toasts = []; s.emit();
  });
  await sleep(1500);
  const res = await page.evaluate(async (secs) => {
    const s = window.__contrail;
    const slow = [];
    let last = performance.now();
    const dts = [];
    const iv = setInterval(() => { if (s.modal) { s.closeModal(); } if (s.paused) s.setSpeed(4); }, 250);
    s.setSpeed(4);
    await new Promise((res) => {
      const end = last + secs * 1000;
      const f = (t) => { const d = t - last; dts.push(d); if (d > 40) slow.push(`${Math.round(d)}@${s.game.now % 1440}`); last = t; if (t < end) requestAnimationFrame(f); else res(); };
      requestAnimationFrame(f);
    });
    clearInterval(iv);
    s.togglePause();
    dts.sort((a, b) => a - b);
    const q = (p) => dts[Math.floor(p * (dts.length - 1))].toFixed(0);
    return { fps: (dts.length / secs).toFixed(1), p50: q(0.5), p99: q(0.99), max: q(1), slow: slow.join(' ') };
  }, Number(secs));
  console.log(JSON.stringify(res));
  console.log('errors', errs.slice(0, 5));
  await b.close();
})();
