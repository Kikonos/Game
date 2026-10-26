// Visual B screenshots, part 2: an airline leg carrying our crew (grey silhouette of its type) and the diversion card's
// mini-map (our aircraft's family-colour silhouette). usage: node visualB-shots-2.cjs <url> <outdir> [theme...]
const L = require('./lib.cjs');
const url = process.argv[2] || 'http://localhost:5471/';
const out = process.argv[3] || __dirname;
const themes = process.argv.slice(4).length ? process.argv.slice(4) : ['dark', 'light'];
const errors = [];
const { sleep } = L;

async function run(T) {
  const { browser, page } = await L.open(url, T, errors);
  await L.start(page, url, T, { days: 6 });
  // an airline leg in the air with our crew on it
  // on to the next airline ticket's departure (+40 min: in the air)
  await page.evaluate(() => {
    const s = window.__contrail;
    const air = () => Object.values(s.game.flights).some((f) => f.kind === 'deadhead' && !f.charter && f.status !== 'cancelled' && f.std + 20 <= s.game.now && f.sta - 30 > s.game.now);
    for (let i = 0; i < 120 && !air(); i++) {
      for (const d of [...s.game.decisions]) s.resolveDecision?.(d.id, d.defaultOption);
      const nx = Object.values(s.game.flights).filter((f) => f.kind === 'deadhead' && !f.charter && f.status !== 'cancelled' && f.std + 20 > s.game.now).sort((a, b) => a.std - b.std)[0];
      s.dev.advance(Math.max(10, Math.min(720, nx ? nx.std + 40 - s.game.now : 720)));
    }
    s.modal = null; s.paused = true; s.decisionDeferred = s.game.decisions.map((d) => d.id).join(','); s.navigate('map'); s.emit();
  });
  await sleep(1500);
  const found = (await page.locator('.ops-cmf:not(.jet)').count()) > 0;
  console.log('airline leg', found);
  if (found) {
    await page.click('.ops-next-fold').catch(() => {});
    for (let i = 0; i < 4; i++) {
      const b = await page.locator('.ops-cmf:not(.jet)').first().boundingBox();
      if (!b) break;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.wheel(0, -400);
      await sleep(450);
    }
    const id = await page.locator('.ops-cmf:not(.jet)').first().getAttribute('data-id');
    await page.evaluate((x) => window.__contrail.select({ kind: 'flight', id: x }), id);
    await L.shot(page, out, `${T}-16-airline-leg-silhouette`);
    await page.evaluate(() => window.__contrail.select(undefined));
  }
  // diversion card
  let ok = false;
  for (let i = 0; i < 80 && !ok; i++) {
    ok = await page.evaluate(() => { const g = window.__contrail.game; return Object.values(g.flights).some((f) => f.aircraftId && f.kind === 'revenue' && f.status === 'enroute' && (f.eta ?? f.sta) > g.now + 45); });
    if (!ok) await page.evaluate(() => { const s = window.__contrail; for (const d of [...s.game.decisions]) s.resolveDecision?.(d.id, d.defaultOption); s.dev.advance(30); s.modal = null; s.emit(); });
  }
  await page.evaluate(() => { const s = window.__contrail; s.setSettings({ autoPause: { ...s.settings.autoPause, decision: true } }); s.dev.disruption('diversion'); s.decisionDeferred = null; s.modal = null; s.emit(); });
  await sleep(1500);
  console.log('divmap', await page.locator('.divmap').count());
  if (await page.locator('.divmap').count()) await L.shot(page, out, `${T}-17-diversion-map`);
  await browser.close();
}

(async () => {
  for (const t of themes) await run(t);
  console.log('ERRORS:', errors.join('\n'));
})();
