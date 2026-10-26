const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const out = '/home/user/wt/notes/.handover/updates/shots-ops';
(async () => {
  for (const theme of ['light', 'dark']) {
    const b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto('http://localhost:5402/'); await p.waitForFunction(() => window.__contrail && window.__contrail.screen === 'title');
    await p.evaluate(() => localStorage.clear());
    await p.evaluate(() => window.__contrail.startNewGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 7 }));
    await p.waitForSelector('.shell');
    await p.evaluate((t) => { const s = window.__contrail; s.setSettings({ theme: t, autoPause: Object.fromEntries(Object.keys(s.settings.autoPause).map((k) => [k, false])), toasts: false, sound: false, seenWhatsNew: 'zzz' }); s.modal = null; s.emit(); }, theme);
    await p.evaluate(() => window.__contrail.dev.autoplay(20));
    let id = null;
    for (let i = 0; i < 1500 && !id; i++) {
      id = await p.evaluate(() => { const s = window.__contrail; s.dev.disruption('sickAway'); const d = s.game.decisions.find((x) => x.kind === 'sickAway'); if (d) { s.modal = null; s.openModal({ kind: 'decision', decisionId: d.id }); } return d?.id ?? null; });
      if (!id) await p.evaluate(() => { const s = window.__contrail; for (const d of [...s.game.decisions]) s.game.decisions.splice(s.game.decisions.indexOf(d), 1); s.dev.autoplay(1 / 48); s.exact = s.game.now; s.emit(); });
    }
    console.log(theme, id);
    await new Promise((r) => setTimeout(r, 900));
    if (id) await p.screenshot({ path: `${out}/${theme}-11-crew-sick-away.png` });
    await b.close();
  }
})();
