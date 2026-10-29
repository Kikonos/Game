// Sub-lease screenshots: portal with flights + clash marks, the sub-lease quote, the offer after sub-leasing.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const L = require('/home/user/wt/notes/.handover/updates/shots-visualB/lib.cjs');
const URL = process.env.URL || 'http://localhost:5480/';
const OUT = process.env.OUT || __dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEV = {
  ipad: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, isMobile: false,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  iphone: { viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  mac: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, hasTouch: false },
};
(async () => {
  const devs = (process.env.DEVS || 'ipad').split(',');
  const themes = (process.env.THEMES || 'dark').split(',');
  const errors = [];
  const browser = await chromium.launch();
  for (const dev of devs) for (const theme of themes) {
    const ctx = await browser.newContext(DEV[dev]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${dev}/${theme}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${dev}/${theme} console: ${m.text()}`); });
    await L.start(page, URL, theme, { days: 10 });
    const ok = await page.evaluate(async () => {
      const s = window.__contrail;
      const g = s.game;
      const C = await import('/src/engine/contracts/index.ts');
      const T = await import('/src/engine/contracts/testkit.ts');
      const E = await import('/src/engine/core/entities.ts');
      const DAY = 1440;
      let start = 0, a = null, ac = null;
      s.dev.addType('a320ceo');
      for (let k = 6; k < 40 && !ac; k++) {
        start = Math.ceil((g.now + k * DAY) / DAY) * DAY + 7 * 60;
        const legs = [];
        for (let i = 0; i < 5; i++) legs.push(['LIS', 'FAO', start + i * DAY], ['FAO', 'LIS', start + i * DAY + 3 * 60], ['LIS', 'OPO', start + i * DAY + 7 * 60], ['OPO', 'LIS', start + i * DAY + 9 * 60]);
        if (a) delete g.offers[a.id];
        a = T.legsOffer(g, legs, 150);
        a.title = 'Algarve shuttle';
        ac = Object.values(g.fleet).find((x) => C.feasibility(g, a.id, x.id).level !== 'no');
      }
      if (!ac) return 'no aircraft ' + Object.values(g.fleet).map((x) => x.reg + ': ' + C.feasibility(g, a.id, x.id).checks.filter((k) => k.level === 'no').map((k) => k.label).join('; ')).join(' | ');
      const r = C.acceptOffer(g, a.id, [ac.id]);
      if (!r.ok) return 'accept ' + r.error;
      const o = T.legsOffer(g, [['LIS', 'PMI', start + DAY + 2 * 60], ['PMI', 'LIS', start + DAY + 6 * 60], ['LIS', 'PMI', start + 2 * DAY + 2 * 60], ['PMI', 'LIS', start + 2 * DAY + 6 * 60]], 150);
      o.title = 'Football away days Lisbon–Palma';
      o.expires = g.now + 2 * DAY;
      window.__sl = { ac: ac.id, offer: o.id };
      s.settings.screenHintsSeen = [...(s.settings.screenHintsSeen || []), 'offer'];
      s.openModal({ kind: 'offer', offerId: o.id });
      s.emit();
      return 'ok';
    });
    console.log(dev, theme, ok);
    await sleep(800);
    const tag = `${theme}-${dev}`;
    // Open the owned (busy) aircraft.
    const reg = await page.evaluate(() => window.__contrail.game.fleet[window.__sl.ac].reg);
    const head = page.locator('.sc-feas-head', { hasText: reg });
    await head.click();
    await sleep(500);
    const row = page.locator('.sc-feas', { hasText: reg }).first();
    await row.scrollIntoViewIfNeeded();
    await page.evaluate((reg) => { const el = [...document.querySelectorAll('.sc-feas')].find((e) => e.textContent.includes(reg)); el?.scrollIntoView({ block: 'start' }); }, reg);
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, `${tag}-1-portal-flights-clash.png`) });
    // Tap the first clashing trip: move or sub-lease.
    const clashRow = page.locator('.v12-clash-row').first();
    if (await clashRow.count()) {
      await clashRow.click();
      await sleep(500);
      await page.evaluate(() => document.querySelector('.v12-trip-actions')?.scrollIntoView({ block: 'center' }));
      await sleep(400);
      await page.screenshot({ path: path.join(OUT, `${tag}-2-trip-actions.png`) });
      const lint = await page.evaluate(() => {
        const small = [...document.querySelectorAll('.v12-trip-actions button, .v12-clash-row, .v12-clash-head button, .pc-do button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width && (r.height < 44 || r.width < 44); }).map((b) => `${b.textContent.trim().slice(0, 20)} ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`);
        const over = [...document.querySelectorAll('.modal *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1) && !e.closest('.v91-portal'); }).length;
        return { scrollW: document.documentElement.scrollWidth, vw: innerWidth, small, over };
      });
      console.log(dev, theme, 'lint', JSON.stringify(lint));
      // The trip move confirm, with its sub-lease line; Cancel comes back to the offer.
      const mv = page.locator('.v12-trip-actions .v12-ta-row button:not([disabled])').first();
      if (await mv.count() && !(await mv.textContent()).includes('Sub-lease')) {
        await mv.click();
        await sleep(900);
        if (dev === 'iphone') { await page.evaluate(() => document.querySelector('.tm-sublease')?.scrollIntoView({ block: 'end' })); await sleep(400); }
        await page.screenshot({ path: path.join(OUT, `${tag}-2b-trip-move-or-sublease.png`) });
        await page.locator('.modal-foot .btn, .modal .btn', { hasText: 'Cancel' }).first().click();
        await sleep(700);
        await page.evaluate((reg) => { const el = [...document.querySelectorAll('.sc-feas')].find((e) => e.textContent.includes(reg)); el?.scrollIntoView({ block: 'start' }); }, reg);
        await sleep(300);
      }
      // Sub-lease all clashing trips from WHAT YOU CAN DO / the list.
      const btn = page.locator('.v12-clash-head .v12-sublease');
      if (await btn.count()) await btn.click(); else await page.locator('.v12-trip-actions .v12-sublease').click();
      await sleep(700);
      if (dev === 'iphone') { await page.evaluate(() => document.querySelector('.v8-quotes')?.scrollIntoView({ block: 'start' })); await sleep(400); }
      await page.screenshot({ path: path.join(OUT, `${tag}-3-sublease-quote.png`) });
      await page.locator('.modal .btn-primary', { hasText: 'Sub-lease for' }).click();
      await sleep(900);
      await page.evaluate((reg) => { const el = [...document.querySelectorAll('.sc-feas')].find((e) => e.textContent.includes(reg)); el?.scrollIntoView({ block: 'start' }); }, reg);
      await sleep(500);
      await page.screenshot({ path: path.join(OUT, `${tag}-4-offer-after-sublease.png`) });
      const state = await page.evaluate((reg) => [...document.querySelectorAll('.sc-feas')].find((e) => e.textContent.includes(reg))?.className, reg);
      console.log('after', state);
    } else console.log('no clash rows');
    await ctx.close();
  }
  await browser.close();
  console.log('ERRORS:', errors.join('\n'));
})();
