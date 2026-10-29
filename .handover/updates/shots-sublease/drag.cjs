const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const L = require('/home/user/wt/notes/.handover/updates/shots-visualB/lib.cjs');
const URL = 'http://localhost:5480/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEV = {
  ipad: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  mac: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: false },
};
async function prep(browser, dev) {
  const ctx = await browser.newContext(DEV[dev]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await L.start(page, URL, 'dark', { days: 10 });
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

  console.log(dev, 'setup', ok);
  await sleep(800);
  const reg = await page.evaluate(() => window.__contrail.game.fleet[window.__sl.ac].reg);
  await page.locator('.sc-feas-head', { hasText: reg }).click();
  await sleep(500);
  return { ctx, page, reg, errors };
}
const centre = async (page, sel) => page.evaluate((sel) => { const e = typeof sel === 'string' ? document.querySelector(sel) : null; if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
(async () => {
  const browser = await chromium.launch();
  // ---- touch (iPad) ----
  {
    const { ctx, page, reg, errors } = await prep(browser, 'ipad');
    const acId = await page.evaluate(() => window.__sl.ac);
    const other = await page.evaluate((id) => [...document.querySelectorAll('.v91-portal[data-ac]')].map((e) => e.dataset.ac).find((x) => x !== id && window.__contrail.game.fleet[x].reg.startsWith('TEST') || (x !== id && window.__contrail.game.fleet[x].status !== 'leasedOut')), acId);
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    // swipe: scrolls, no lift
    const sel = `.v91-portal[data-ac="${acId}"] .v91-b.movable.clash`;
    let p = await centre(page, sel);
    const sl0 = await page.evaluate((id) => document.querySelector(`.v91-portal[data-ac="${id}"]`).scrollLeft, acId);
    await touch('touchStart', p.x, p.y);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', p.x + i * 15, p.y); await sleep(16); }
    await touch('touchEnd');
    await sleep(400);
    const sl1 = await page.evaluate((id) => document.querySelector(`.v91-portal[data-ac="${id}"]`).scrollLeft, acId);
    console.log('touch swipe scrollLeft', sl0, '->', sl1, 'modal', await page.evaluate(() => window.__contrail.modal?.kind));
    // tap: the chooser
    p = await centre(page, sel);
    await page.touchscreen.tap(p.x, p.y);
    await sleep(400);
    console.log('touch tap chooser', await page.locator('.v12-trip-actions').count());
    // long press + drag onto the other aircraft
    p = await centre(page, sel);
    const where = (id) => page.evaluate((id) => { const e = document.querySelector(`.v91-portal[data-ac="${id}"]`); const r = e.getBoundingClientRect(); const b = document.querySelector('.modal-body').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, vis: r.top >= b.top && r.bottom <= b.bottom, edge: b.bottom - 20 }; }, id);
    let q = await where(other);
    await touch('touchStart', p.x, p.y);
    await sleep(500);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', p.x, p.y + ((q.edge - p.y) * i) / 10); await sleep(20); }
    for (let k = 0; k < 80 && !q.vis; k++) { await sleep(50); q = await where(other); }
    await touch('touchMove', p.x, 400); await sleep(200);
    q = await where(other);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', p.x + ((q.x - p.x) * i) / 10, 400 + ((q.y - 400) * i) / 10); await sleep(20); }
    await sleep(200);
    const hover = await page.evaluate(() => document.querySelector('.v91-portal.drop-ok, .v91-portal.drop-no')?.className);
    await touch('touchEnd');
    await sleep(600);
    console.log('touch drag target visible', q.vis, 'hover', hover, 'modal', await page.evaluate(() => JSON.stringify(window.__contrail.modal)));
    console.log('touch errors', errors.join(' | '));
    await ctx.close();
  }
  // ---- mouse (Mac) ----
  {
    const { ctx, page, errors } = await prep(browser, 'mac');
    const acId = await page.evaluate(() => window.__sl.ac);
    const other = await page.evaluate((id) => [...document.querySelectorAll('.v91-portal[data-ac]')].map((e) => e.dataset.ac).find((x) => x !== id && window.__contrail.game.fleet[x].reg.startsWith('TEST')) ?? [...document.querySelectorAll('.v91-portal[data-ac]')].map((e) => e.dataset.ac).find((x) => x !== id), acId);
    console.log('other', other, await page.evaluate(() => Object.values(window.__contrail.game.fleet).map((a) => a.reg + ':' + a.status).join(',')));
    const sel = `.v91-portal[data-ac="${acId}"] .v91-b.movable.clash`;
    let p = await centre(page, sel);
    await page.mouse.click(p.x, p.y);
    await sleep(400);
    console.log('mouse click chooser', await page.locator('.v12-trip-actions').count());
    p = await centre(page, sel);
    const where = (id) => page.evaluate((id) => { const e = document.querySelector(`.v91-portal[data-ac="${id}"]`); const r = e.getBoundingClientRect(); const b = document.querySelector('.modal-body').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, vis: r.top >= b.top && r.bottom <= b.bottom, edge: b.bottom - 20 }; }, id);
    let q = await where(other);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(p.x, p.y + ((q.edge - p.y) * i) / 10); await sleep(20); }
    console.log('ghost', await page.locator('.v91-ghost').count(), JSON.stringify(q), await page.evaluate(() => window.__contrail.toasts?.map((t) => t.title + ' ' + t.body).join('|')));
    for (let k = 0; k < 80 && !q.vis; k++) { await sleep(50); q = await where(other); }
    await page.mouse.move(p.x, 450); await sleep(200); q = await where(other);
    console.log('after scroll', JSON.stringify(q));
    for (let i = 1; i <= 10; i++) { await page.mouse.move(p.x + ((q.x - p.x) * i) / 10, 450 + ((q.y - 450) * i) / 10); await sleep(20); }
    console.log('at drop', await page.evaluate(({x,y}) => document.elementFromPoint(x, y)?.className, q), await page.locator('.v91-portal.drop-ok, .v91-portal.drop-no').count());
    await page.mouse.up();
    await sleep(600);
    console.log('mouse drag modal', await page.evaluate(() => JSON.stringify(window.__contrail.modal)));
    // The trip move confirm offers sub-lease too.
    console.log('trip move sub-lease section', await page.locator('.tm-sublease').count(), await page.locator('.tm-sublease').textContent().catch(() => ''));
    await page.screenshot({ path: 'mac-tripmove.png' });
    console.log('mouse errors', errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
})();
