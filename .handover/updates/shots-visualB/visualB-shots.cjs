// Visual B screenshots (iPad home-screen size 1180×820 at DPR 2), light and dark.
// usage: node visualB-shots.cjs <url> <outdir> [theme...]
const L = require('./lib.cjs');
const fs = require('fs');
const url = process.argv[2] || 'http://localhost:5471/';
const out = process.argv[3] || __dirname;
const themes = process.argv.slice(4).length ? process.argv.slice(4) : ['dark', 'light'];
fs.mkdirSync(out, { recursive: true });
const errors = [];
const { sleep } = L;

async function zoomAt(page, sel, n) {
  for (let i = 0; i < n; i++) {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) return;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, -400);
    await sleep(400);
  }
}

async function run(T) {
  const { browser, page } = await L.open(url, T, errors);
  const shot = (name, clip) => L.shot(page, out, `${T}-${name}`, clip);

  // 13. Hints: a new player sees the strip; after Got it it folds into '?'.
  await L.start(page, url, T, { hints: true, days: 3 });
  await page.evaluate(() => window.__contrail.navigate('finance'));
  await shot('13a-hint-strip');
  await page.click('[data-hint="finance"] >> text=Got it');
  await page.click('[data-hint-btn="finance"]');
  await shot('13b-hint-folded-open');
  await page.mouse.click(700, 760);
  // Owned card: no empty double divider under the livery row.
  await page.evaluate(() => window.__contrail.navigate('fleet', { view: 'fleet' }));
  await page.click('[data-hint="fleet"] >> text=Got it').catch(() => {});
  await shot('14-fleet-owned-card');
  // 5. Hangar with the starting fleet (2 aircraft).
  await page.click('text=Hangar');
  await shot('05b-hangar-start');
  await page.click('text=Cards');

  // 9, 11, 12 on a normal game a few days in.
  await L.start(page, url, T, { days: 6 });
  await page.evaluate(() => window.__contrail.navigate('schedule'));
  await sleep(400);
  await page.click('text=3 days');
  await shot('09-schedule-labels');
  await page.click('text=7 days');
  const capId = await page.evaluate(() => { const g = window.__contrail.game; const c = Object.values(g.crew).find((x) => x.role === 'CPT'); window.__contrail.navigate('crew', { view: 'people', sel: { kind: 'crew', id: c.id } }); return c.id; });
  await shot('11a-crew-ranks');
  await page.evaluate(() => { const g = window.__contrail.game; const c = Object.values(g.crew).find((x) => x.role === 'PUR'); window.__contrail.navigate('crew', { view: 'people', sel: { kind: 'crew', id: c.id } }); });
  await page.click('.sc-crew .seg >> text=Cabin').catch(() => {});
  await shot('11b-crew-cabin-wings');
  await page.click('.sc-crew .seg >> text=All').catch(() => {});
  // 12. A boarding pass: the next airline ticket within a day.
  await page.evaluate(() => {
    const s = window.__contrail;
    const tk = () => Object.values(s.game.flights).filter((f) => f.kind === 'deadhead' && !f.charter && f.std > s.game.now && f.crewIds.length).sort((a, b) => a.std - b.std)[0];
    for (let i = 0; i < 40 && tk() && tk().std - s.game.now > 1440; i++) { for (const d of [...s.game.decisions]) s.resolveDecision?.(d.id, d.defaultOption); s.dev.advance(Math.min(720, tk().std - s.game.now - 600)); }
  });
  await L.calm(page);
  const has = await page.evaluate(() => {
    const s = window.__contrail; const g = s.game;
    const tk = Object.values(g.flights).filter((f) => f.kind === 'deadhead' && !f.charter && f.std > g.now && f.crewIds.length).sort((a, b) => a.std - b.std)[0];
    if (!tk) return false;
    s.navigate('crew', { view: 'people', sel: { kind: 'crew', id: tk.crewIds[0] } });
    return true;
  });
  if (has) {
    await sleep(500);
    await page.locator('.sc-duty-row', { hasText: 'Deadhead' }).first().click().catch(() => {});
    await sleep(300);
    await page.locator('.sc-cal-detail').scrollIntoViewIfNeeded().catch(() => {});
    await shot('12a-boarding-pass');
    // and on the roster board
    await page.evaluate(() => window.__contrail.navigate('crew', { view: 'board' }));
    await sleep(600);
    const blk = page.locator('.rb-blk.k-deadhead, [data-c][data-i].k-deadhead').first();
    if (await blk.count()) { await blk.click().catch(() => {}); await shot('12b-boarding-pass-board'); }
  }

  // 10. Finance: 11 closed months staged from this month's lines (screenshot only), then the charts.
  await page.evaluate(() => {
    const g = window.__contrail.game;
    const cur = g.finance.current;
    const base = Object.entries(cur.lines);
    let cash = g.company.cash * 0.6;
    for (let i = 11; i >= 1; i--) {
      const k = 0.55 + ((i * 37) % 11) / 10;
      const lines = Object.fromEntries(base.map(([c, v]) => [c, Math.round(v * 4 * k * (v > 0 ? 1.05 : 1))]));
      const rev = Object.values(lines).filter((v) => v > 0).reduce((a, b) => a + b, 0);
      const cost = Object.values(lines).filter((v) => v < 0).reduce((a, b) => a + b, 0);
      const start = cash;
      cash += rev + cost;
      g.finance.history.push({ month: cur.month - i, lines, bh: 300 * k, cashStart: start, cashEnd: cash, closed: true });
    }
    g.finance.history.sort((a, b) => a.month - b.month);
    window.__contrail.navigate('finance');
    window.__contrail.emit();
  });
  await sleep(500);
  await page.locator('.fin-months').scrollIntoViewIfNeeded();
  await shot('10a-finance-charts');
  const box = await page.locator('.fin-months .chart').first().boundingBox();
  if (box) { await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.5); await shot('10b-finance-tooltip'); }

  // 7. Delivery moment.
  await page.evaluate(() => { const s = window.__contrail; s.game.company.cash = 9e7; const id = s.dev.delivery('SEA'); if (id) s.game.fleet[id].name = 'Vasco da Gama'; s.emit(); });
  await sleep(1500);
  await shot('07-delivery-welcome');
  await page.keyboard.press('Escape');

  // 5, 8, map: a busy fleet of 30.
  await L.start(page, url, T, { big: 30 });
  await page.evaluate(() => window.__contrail.navigate('fleet', { view: 'hangar' }));
  await shot('05a-hangar-30');
  await page.mouse.wheel(0, 1600);
  await shot('05c-hangar-30-scrolled');
  await page.evaluate(() => window.__contrail.dev.advance(75));
  await L.calm(page);
  await page.evaluate(() => window.__contrail.navigate('map'));
  await page.click('.ops-next-fold').catch(() => {});
  await page.click('.map-zoom button[aria-label="Reset view"]').catch(() => {});
  await sleep(600);
  await zoomAt(page, '.airports .ap[data-code="LIS"]', 5);
  await page.evaluate(() => window.__contrail.select(undefined));
  await shot('15a-map-labels-thinned');
  // the same with one aircraft selected: its labels stay
  await page.evaluate(() => { const s = window.__contrail; const ac = Object.values(s.game.fleet).find((a) => a.flightId && s.game.flights[a.flightId]?.status === 'enroute' && s.game.flights[a.flightId].from === 'LIS'); if (ac) s.select({ kind: 'aircraft', id: ac.id }); });
  await shot('15b-map-selected-keeps-label');
  // 8. Sky behind the aircraft panel (night now), then day, then the spotter.
  await page.evaluate(() => { const s = window.__contrail; s.dev.advance(600); s.modal = null; s.paused = true; s.decisionDeferred = s.game.decisions.map((d) => d.id).join(','); s.emit(); const ac = Object.values(s.game.fleet)[0]; s.select({ kind: 'aircraft', id: ac.id }); });
  await shot('08a-sky-panel-day', { x: 780, y: 60, width: 400, height: 460 });
  await page.evaluate(() => window.__contrail.select(undefined));
  await page.click('.ops-spot-btn').catch(() => {});
  await sleep(2400);
  await shot('08b-sky-spotter');
  await page.click('.ops-spot .op-close').catch(() => {});
  // airline leg silhouettes
  const cm = await page.locator('.ops-cmf:not(.jet)').count();
  if (cm) {
    await page.click('.map-zoom button[aria-label="Reset view"]').catch(() => {});
    await sleep(500);
    await zoomAt(page, '.ops-cmf:not(.jet)', 5);
    await shot('16-airline-leg-silhouette');
  }
  // diversion card with its mini-map
  await page.evaluate(() => { const s = window.__contrail; s.dev.disruption('diversion'); s.decisionDeferred = null; s.modal = null; s.emit(); });
  await sleep(1200);
  if (await page.locator('.divmap').count()) await shot('17-diversion-map');
  await browser.close();
}

(async () => {
  for (const t of themes) await run(t);
  console.log('ERRORS:', errors.join('\n'));
})();
