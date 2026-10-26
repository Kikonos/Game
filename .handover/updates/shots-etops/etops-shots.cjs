// ETOPS ferries screenshots: a northern-way delivery ferry on the map, the Fleet card's ETOPS line, and the Lease
// dialog for an impossible crossing (four-line card). iPad 1180×820 at DPR 2. usage: node etops-shots.cjs <url> <outdir>
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const url = process.argv[2] || 'http://localhost:5463/';
const out = process.argv[3] || '.';
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function shot(page, name) {
  await sleep(800);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('shot', name);
}

async function start(page, theme) {
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
}

const clear = (page) => page.evaluate(() => { const s = window.__contrail; s.ladderQueue = []; s.modal = null; s.paused = true; s.toasts = []; s.decisionDeferred = s.game.decisions.map((d) => d.id).join(','); s.emit(); });

async function zoom(page, n) {
  const sel = n > 0 ? '.map-zoom button[aria-label="Zoom in"]' : '.map-zoom button[aria-label="Zoom out"]';
  for (let i = 0; i < Math.abs(n); i++) { await page.click(sel); await sleep(350); }
}

(async () => {
  const theme = process.argv[4] || 'dark';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await start(page, theme);

  // 1. A delivery from Montréal (no ETOPS approval): handed over, then on its first leg to Kangerlussuaq.
  const acId = await page.evaluate(() => { const s = window.__contrail; s.dev.addType('a320ceo'); return s.dev.delivery('YUL'); });
  console.log('delivery', acId);
  const legs = await page.evaluate((id) => { const g = window.__contrail.game; return g.fleet[id].delivery.ferryIds.map((f) => `${g.flights[f].from}-${g.flights[f].to}`); }, acId);
  console.log('legs', legs.join(' '));
  for (let i = 0; i < 300; i++) {
    const st = await page.evaluate((id) => { const g = window.__contrail.game; const f = g.flights[g.fleet[id].delivery.ferryIds[0]]; return f ? f.status : 'gone'; }, acId);
    if (st === 'enroute') break;
    await page.evaluate(() => { const s = window.__contrail; for (const d of [...s.game.decisions]) s.resolveDecision?.(d.id, d.defaultOption); s.dev.advance(30); });
  }
  await page.evaluate(() => window.__contrail.dev.advance(60));
  await clear(page);
  await page.evaluate(() => window.__contrail.navigate('map'));
  await sleep(1200);
  await page.click('.ops-next-fold').catch(() => {});
  await zoom(page, -1);
  await clear(page);
  await page.evaluate((id) => window.__contrail.select({ kind: 'aircraft', id }), acId);
  await sleep(1500);
  await clear(page);
  await shot(page, `${theme}-01-map-northern-ferry`);
  await page.evaluate(() => window.__contrail.select(undefined));
  await sleep(600);
  await shot(page, `${theme}-02-map-northern-ferry-route`);

  // 2. Fleet card: the ETOPS line.
  await page.evaluate((id) => { const s = window.__contrail; s.navigate('fleet', { sel: { kind: 'aircraft', id } }); }, acId);
  await sleep(1200);
  await clear(page);
  await page.evaluate(() => { const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^ETOPS$/.test(e.textContent || '')); el?.scrollIntoView({ block: 'center' }); });
  await shot(page, `${theme}-03-fleet-etops-line`);

  // 3. Schedule: the ferry's hops.
  await page.evaluate(() => window.__contrail.navigate('schedule'));
  await sleep(1200);
  await clear(page);
  await shot(page, `${theme}-04-schedule`);

  // 4. An A320 for lease at Honolulu: no legal ferry home (the four-line card in the Lease dialog).
  const off = await page.evaluate(() => window.__contrail.dev.marketOffer('a320ceo', { site: 'HNL' }));
  await clear(page);
  await page.evaluate(() => window.__contrail.navigate('fleet', { view: 'market' }));
  await sleep(1000);
  await page.evaluate((id) => { const s = window.__contrail; s.ladderQueue = []; s.openModal({ kind: 'acquire', offerId: id }); }, off);
  await sleep(1200);
  await shot(page, `${theme}-05-lease-no-legal-ferry`);
  await page.click('.aq-noferry .pc-do .btn-primary').catch(() => {});
  await sleep(600);
  await page.evaluate(() => { document.querySelector('.aq-noferry')?.scrollIntoView({ block: 'end' }); });
  await shot(page, `${theme}-06-lease-handover-this-side`);

  await browser.close();
  console.log('ERRORS:', errors.join('\n'));
})();
