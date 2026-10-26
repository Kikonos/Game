// Visual A: quick map shot (baseline / dev checks). usage: node base.cjs <url> <out.png> [theme] [fleetN]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const url = process.argv[2] || 'http://localhost:5461/';
const out = process.argv[3] || 'base.png';
const theme = process.argv[4] || 'dark';
const fleetN = +(process.argv[5] || 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('ERR', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
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
  if (fleetN) await page.evaluate((n) => { window.__contrail.dev.fleet(n); window.__contrail.dev.demoFlights(3); }, fleetN);
  const adv = +(process.argv[6] || 0);
  if (adv) await page.evaluate((m) => window.__contrail.dev.advance(m), adv);
  await page.evaluate(() => { const s = window.__contrail; s.modal = null; s.paused = true; s.toasts = []; s.navigate('map'); s.emit(); });
  await sleep(2500);
  await page.screenshot({ path: out });
  console.log('shot', out, await page.evaluate(() => Object.keys(window.__contrail.game.fleet).length));
  await browser.close();
})();
