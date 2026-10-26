// Visual A screenshots: day/night (light + dark), silhouettes on the map, a weather mark, spotter mode.
// iPad home-screen size 1180×820 at DPR 2. usage: node visualA-shots.cjs <url> <outdir> [theme...]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const url = process.argv[2] || 'http://localhost:5461/';
const out = process.argv[3] || '.';
const themes = process.argv.slice(4).length ? process.argv.slice(4) : ['dark', 'light'];
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const TYPES = ['a321neo', 'b738', 'b752', 'b763', 'a332', 'a343', 'b772', 'b77w', 'b789', 'a359', 'a35k', 'b744', 'b748', 'a388', 'a346', 'b78x', 'b753', 'b741'];
const COLOURS = ['#c8102e', '#0b1f4d', '#ffffff', '#00843d', '#f5c451', '#5b2c83', '#0072ce', '#e35205', '#1d1d1b', '#7a1f2b', '#2e8b57', '#ff6f61'];

async function shot(page, name) {
  await sleep(700);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('shot', name);
}

async function start(page, theme, big) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__contrail && window.__contrail.screen === 'title', null, { timeout: 60000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* */ } });
  await page.evaluate(() => window.__contrail.startNewGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 7 }));
  await page.waitForSelector('.shell', { timeout: 20000 });
  await page.evaluate((t) => {
    const s = window.__contrail;
    s.setSettings({ theme: t, autoPause: Object.fromEntries(Object.keys(s.settings.autoPause).map((k) => [k, false])), toasts: false, sound: false, music: false, seenWhatsNew: 'zzz', screenHintsSeen: ['map', 'company', 'inbox', 'contracts', 'schedule', 'crew', 'fleet', 'finance', 'team'] });
    s.modal = null; s.paused = true; s.toasts = []; s.emit();
  }, theme);
  await page.evaluate(() => window.__contrail.dev.autoplay(14));
  if (big) {
    await page.evaluate(({ types, colours }) => {
      const s = window.__contrail;
      for (const t of types) s.dev.addType(t);
      s.dev.fleet(26);
      Object.values(s.game.fleet).forEach((ac, i) => {
        if (i < 2) return;
        const c = colours[i % colours.length];
        ac.livery = { custom: { primary: c, secondary: colours[(i + 5) % colours.length], tail: 'solid' } };
      });
      s.dev.demoFlights(3);
      s.emit();
    }, { types: TYPES, colours: COLOURS });
  }
  await page.evaluate(() => { const s = window.__contrail; s.modal = null; s.paused = true; s.toasts = []; s.decisionDeferred = s.game.decisions.map((d) => d.id).join(','); s.navigate('map'); s.emit(); });
  await sleep(1200);
}

/** Zooms the map with the + / − buttons (n steps of 1.8×) or Reset. */
async function zoom(page, n) {
  const sel = n > 0 ? '.map-zoom button[aria-label="Zoom in"]' : '.map-zoom button[aria-label="Zoom out"]';
  for (let i = 0; i < Math.abs(n); i++) { await page.click(sel); await sleep(350); }
}

async function run(theme) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${theme}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${theme} console: ${m.text()}`); });
  const T = theme;

  // 1. Day and night: a quiet start, zoomed out, at 17:30 UTC (the terminator over Europe and Africa).
  await start(page, theme, false);
  await page.evaluate(() => window.__contrail.dev.advance(17 * 60 + 30));
  await page.evaluate(() => { const s = window.__contrail; s.modal = null; s.emit(); });
  await page.click('.ops-next-fold').catch(() => {});
  await zoom(page, -3);
  await shot(page, `${T}-01-daynight-world`);
  await zoom(page, 1);
  await shot(page, `${T}-02-daynight-europe`);

  // 2. Weather: an airborne revenue leg's destination closes (the card set aside); its mark on the map.
  for (let i = 0; i < 200; i++) {
    const ok = await page.evaluate(() => { const g = window.__contrail.game; return Object.values(g.flights).some((f) => f.aircraftId && f.kind === 'revenue' && f.status === 'enroute' && (f.eta ?? f.sta) > g.now + 45); });
    if (ok) break;
    await page.evaluate(() => { const s = window.__contrail; for (const d of [...s.game.decisions]) s.resolveDecision?.(d.id, d.defaultOption); s.dev.advance(30); s.modal = null; s.emit(); });
  }
  await page.evaluate(() => { const s = window.__contrail; s.dev.disruption('diversion'); s.modal = null; s.decisionDeferred = s.game.decisions.map((d) => d.id).join(','); s.emit(); });
  const wx = await page.evaluate(() => { const d = window.__contrail.game.decisions.find((x) => x.kind === 'diversion'); return d ? window.__contrail.game.flights[d.data.flightId].to : null; });
  console.log('weather at', wx);
  if (wx) {
    await page.click('.map-zoom button[aria-label="Reset view"]');
    await sleep(500);
    await zoom(page, 1);
    await page.evaluate((c) => window.__contrail.select({ kind: 'airport', id: c }), wx);
    await sleep(900);
    await page.evaluate(() => window.__contrail.select(undefined));
    await sleep(500);
    await shot(page, `${T}-03-weather`);
  }

  // 3. A busy fleet of 26 (18 types) on the move, then close up.
  await start(page, theme, true);
  await page.evaluate(() => window.__contrail.dev.advance(75));
  await page.evaluate(() => { const s = window.__contrail; s.modal = null; s.emit(); });
  await page.click('.ops-next-fold').catch(() => {});
  await sleep(800);
  console.log('airborne', await page.evaluate(() => Object.values(window.__contrail.game.fleet).filter((a) => a.flightId).length));
  await shot(page, `${T}-04-fleet`);
  await zoom(page, 2);
  await shot(page, `${T}-05-fleet-close`);
  await zoom(page, 1);
  await shot(page, `${T}-06-fleet-closer`);

  // 4. Spotter mode (time running at 1×, then paused).
  await page.click('.map-zoom button[aria-label="Reset view"]');
  await sleep(600);
  await page.click('.ops-spot-btn');
  await sleep(2600);
  await shot(page, `${T}-07-spotter`);
  await page.click('.spot-next').catch(() => {});
  await sleep(2600);
  await shot(page, `${T}-08-spotter-next`);
  await page.click('.ops-spot .op-close');
  await sleep(400);

  await browser.close();
}

(async () => {
  for (const t of themes) await run(t);
  console.log('ERRORS:', errors.join('\n'));
})();
