const L = require('/home/user/wt/notes/.handover/updates/shots-visualB/lib.cjs');
const url = 'http://localhost:5471/';
(async () => {
  const errors = [];
  const T = process.argv[2] || 'dark';
  const { browser, page } = await L.open(url, T, errors);
  await L.start(page, url, T, { big: 8 });
  await page.evaluate(() => window.__contrail.dev.advance(75));
  const r = await page.evaluate(() => { const s = window.__contrail; s.setSettings({ autoPause: { ...s.settings.autoPause, decision: true } }); const ok = s.dev.disruption('diversion'); s.decisionDeferred = null; s.modal = null; s.emit(); return { ok, n: s.game.decisions.length, kinds: s.game.decisions.map((d) => d.kind) }; });
  console.log(JSON.stringify(r));
  await L.sleep(1500);
  console.log('divmap', await page.locator('.divmap').count());
  if (await page.locator('.divmap').count()) await L.shot(page, '/home/user/wt/notes/.handover/updates/shots-visualB', `${T}-17-diversion-map`);
  console.log('ERRORS:', errors.join('\n'));
  await browser.close();
})();
