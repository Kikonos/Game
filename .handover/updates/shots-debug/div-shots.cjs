// The diversion picker (and the long-name fleet card) on the Blue Airlines save, light and dark.
const { chromium } = require('playwright');
const path = require('path');
const url = process.argv[2] || 'http://localhost:5410/';
const out = path.join(__dirname, 'ui2');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];
(async () => {
  for (const theme of ['light', 'dark']) {
    const browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, colorScheme: theme, hasTouch: true })).newPage();
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${theme} ${m.text().slice(0, 300)}`); });
    page.on('pageerror', (e) => logs.push(`${theme} pageerror ${e.message}`));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__contrail && window.__contrail.screen === 'title', null, { timeout: 60000 });
    await page.evaluate((t) => window.__contrail.setSettings({ theme: t, sound: false, seenWhatsNew: 'zzz', toasts: false }), theme);
    await page.evaluate(() => window.__contrail.openModal({ kind: 'saves', mode: 'load' }));
    await sleep(300);
    await page.locator('input[type=file]').first().setInputFiles(path.join(__dirname, 'save', 'blue.json'));
    await page.waitForFunction(() => window.__contrail.screen === 'game', null, { timeout: 30000 });
    // Until a revenue leg is airborne with time to go.
    for (let i = 0; i < 200; i++) {
      const ok = await page.evaluate(() => { const g = window.__contrail.game; return Object.values(g.flights).some((f) => f.kind === 'revenue' && f.status === 'enroute' && (f.eta ?? f.sta) > g.now + 60); });
      if (ok) break;
      await page.evaluate(() => { const s = window.__contrail; s.game.decisions.length = 0; s.dev.advance(20); });
    }
    const ok = await page.evaluate(() => window.__contrail.dev.disruption('diversion'));
    const id = await page.evaluate(() => { const g = window.__contrail.game; const d = g.decisions.find((x) => x.kind === 'diversion'); return d && d.id; });
    console.log(theme, 'diversion', ok, id);
    if (id) {
      await page.evaluate((d) => { const s = window.__contrail; s.modal = null; s.openModal({ kind: 'decision', decisionId: d }); }, id);
      await sleep(900);
      await page.screenshot({ path: path.join(out, `${theme[0]}-m-card-diversion.png`) });
      await page.mouse.wheel(0, 900);
      await sleep(500);
      await page.screenshot({ path: path.join(out, `${theme[0]}-m-card-diversion-2.png`) });
    }
    await page.evaluate(() => { const s = window.__contrail; s.game.decisions.length = 0; s.modal = null; s.update((g) => { Object.values(g.fleet)[0].name = 'Spirit of Saint-Barthélemy-d’Anjou the Magnificent'; }); s.navigate('fleet'); s.emit(); });
    await sleep(900);
    await page.screenshot({ path: path.join(out, `${theme[0]}-long-fleet-2.png`) });
    await browser.close();
  }
  console.log('LOGS', logs.length, logs.slice(0, 10).join('\n'));
})();
