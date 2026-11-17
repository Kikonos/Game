#!/usr/bin/env node
// v0.24.1 shots: route lines tapped on the 3D globe (route card), and dates with their year (wind-down, contract, Inbox,
// Schedule, Finance, a suspended route's slot lapse).
// usage: node scripts/r3ui-shots.cjs <url> <outDir> <live.json> <suspended.json> [views=mac,ipad,iphone]
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const [url, out, liveF, suspF, viewsArg] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const UA_IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const VIEWS = {
  mac: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  ipad: { viewport: { width: 1180, height: 788 }, screen: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA_IPAD },
  iphone: { viewport: { width: 852, height: 393 }, screen: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA_IPHONE },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];

async function load(page, file) {
  const text = fs.readFileSync(file, 'utf8');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => { localStorage.clear(); localStorage.setItem('contrail-acmi:save:auto', t); }, text);
  for (let i = 0; ; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__contrail && window.__contrail.screen === 'title', null, { timeout: 60000 });
      break;
    } catch (e) { if (i >= 2) throw e; }
  }
  await sleep(600);
  await page.evaluate(() => window.__contrail.closeModal());
  await sleep(200);
  await page.getByRole('button', { name: /Continue/ }).first().click();
  await page.waitForSelector('.shell', { timeout: 30000 });
  await page.evaluate(() => {
    const s = window.__contrail;
    s.setSettings({ autoPause: Object.fromEntries(Object.keys(s.settings.autoPause).map((k) => [k, false])), toasts: false, sound: false, music: false, globe: true, globeSpin: false });
    s.modal = null; s.paused = true; s.toasts = []; s.emit();
  });
  await sleep(800);
}

/** Turns the globe and waits until it is there (software WebGL draws slowly under load). */
async function aim(page, lon, lat, dist) {
  await page.evaluate(([a, b, c]) => window.__bhGlobe.aim(a, b, c), [lon, lat, dist]);
  await page.waitForFunction(([a, b]) => { const o = window.__bhGlobe.orbit(); return Math.abs(o.lon - a) < 0.01 && Math.abs(o.lat - b) < 0.01; }, [lon, lat], { timeout: 20000 });
  await sleep(800);
}

const routeId = (page) => page.evaluate(() => Object.values(window.__contrail.game.network.routes).find((r) => r.status !== 'closed')?.id);

async function shot(page, name, sel = '.modal *, .ops-route-card *') {
  if (!page.__touch) await page.mouse.move(2, 2).catch(() => {});
  await sleep(450);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  const lint = await page.evaluate((s) => {
    const o = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) o.push(`page overflows sideways (${document.documentElement.scrollWidth})`);
    const m = document.querySelector('.modal');
    if (m) { const r = m.getBoundingClientRect(); if (r.bottom > window.innerHeight + 1 || r.top < -1) o.push(`modal off screen ${Math.round(r.top)}..${Math.round(r.bottom)}`); if (r.right > window.innerWidth + 1) o.push('modal too wide'); }
    for (const el of document.querySelectorAll(s)) {
      if (el.children.length || el.classList.contains('help-q')) continue;
      const st = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 2 && st.overflow === 'visible' && el.clientWidth > 0 && st.display !== 'inline' && !el.closest('.ellipsis')) o.push(`text wider than its box: ${(el.textContent || '').slice(0, 40)} <${el.tagName.toLowerCase()}.${el.className}>`);
      // Cut off with an ellipsis: a date losing its year.
      if (el.scrollWidth > el.clientWidth + 1 && st.textOverflow === 'ellipsis' && /\d{1,2} [A-Z][a-z]{2}/.test(el.textContent || '')) o.push(`date cut off: ${(el.textContent || '').slice(0, 50)}`);
    }
    return [...new Set(o)].slice(0, 8);
  }, sel);
  if (lint.length) problems.push(`${name}: ${lint.join('; ')}`);
  console.log('shot', name, lint.length ? lint.join('; ') : '');
}

/** The globe: aim at the route's middle, tap beside the line (finger 14 px off, mouse 5), the card opens. */
async function globeShots(page, v) {
  await load(page, liveF);
  await page.evaluate(() => { window.__contrail.select(undefined); window.__contrail.navigate('map', {}); });
  await sleep(800);
  await page.locator('[aria-label="3D globe"]').first().click();
  await page.waitForSelector('.globe-canvas', { timeout: 30000 });
  await sleep(2500);
  const r = await page.evaluate(() => {
    const g = window.__contrail.game;
    const rt = Object.values(g.network.routes).find((x) => x.status !== 'closed');
    return rt ? rt.marketId : null;
  });
  if (!r) { problems.push(`${v}: no route on the globe save`); return; }
  const mid = await page.evaluate(() => {
    const ls = window.__bhGlobe.routes ? window.__bhGlobe.routes() : [];
    return ls.length;
  });
  if (!mid) problems.push(`${v}: the globe has no route lines`);
  // Turn the globe so the line runs through the middle of the screen (MLA 14.5E 35.9N, MAN 2.3W 53.4N).
  await aim(page, 6, 44, 1.9);
  const pt = await page.evaluate(() => {
    const ls = window.__bhGlobe.routes();
    const st = document.querySelector('.globe-stage');
    const box = st.getBoundingClientRect();
    // Settings › Size zooms the page: the globe's points are in its own css px.
    const k = box.width / (st.offsetWidth || box.width);
    for (const l of ls) {
      const pts = l.pts.filter(Boolean);
      if (pts.length < 4) continue;
      // A point about a third along, away from the airports (they win over the line).
      const i = Math.floor(pts.length * 0.4);
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1] ?? pts[i - 1];
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      return { x: box.left + x0 * k, y: box.top + y0 * k, nx: -(y1 - y0) / len, ny: (x1 - x0) / len };
    }
    return null;
  });
  if (!pt) { problems.push(`${v}: route line not on screen`); await shot(page, `${v}-globe-no-line`); return; }
  const off = v === 'mac' ? 5 : 14;
  const at = { x: pt.x + pt.nx * off, y: pt.y + pt.ny * off };
  if (v === 'mac') {
    await page.mouse.move(at.x, at.y);
    await sleep(250);
    const hov = await page.evaluate(() => document.querySelector('.globe-stage').classList.contains('hovering') && getComputedStyle(document.querySelector('.globe-stage')).cursor);
    if (hov !== 'pointer') problems.push(`mac: no pointer cursor over the globe's route line (${hov})`);
    await page.mouse.click(at.x, at.y);
  } else await page.touchscreen.tap(at.x, at.y);
  await sleep(900);
  if (!(await page.locator('.ops-route-card').count())) problems.push(`${v}: no route card after a tap ${off}px off the globe's line`);
  await shot(page, `${v}-globe-route-card`);
  // A tap on empty sea closes it.
  const box = await page.evaluate(() => { const r = document.querySelector('.globe-stage').getBoundingClientRect(); return { x: r.left + r.width * 0.12, y: r.top + r.height * 0.68 }; });
  if (v === 'mac') await page.mouse.click(box.x, box.y); else await page.touchscreen.tap(box.x, box.y);
  await sleep(500);
  if (await page.locator('.ops-route-card').count()) problems.push(`${v}: route card still open after a tap on empty space`);
  // The back of the globe: turned away, the line cannot be hit (no screen points).
  await aim(page, -174, -44, 1.9);
  const back = await page.evaluate(() => window.__bhGlobe.routes().every((l) => l.pts.every((p) => p === null)));
  if (!back) problems.push(`${v}: route line hittable on the back of the globe`);
  // Back to the flat map for the next contexts (the setting is per device).
  await page.locator('[aria-label="Flat map"]').first().click().catch(() => {});
}

async function dateShots(page, v) {
  await load(page, liveF);
  const id = await routeId(page);
  await page.evaluate((r) => window.__contrail.openModal({ kind: 'route', routeId: r }), id);
  await sleep(500);
  await page.evaluate(([r]) => window.__contrail.openModal({ kind: 'routeAction', routeId: r, action: 'windDown', back: { kind: 'route', routeId: r } }), [id]);
  await page.waitForSelector('.modal .seg', { timeout: 10000 }).catch(() => problems.push(`${v}: wind-down confirm did not open`));
  await shot(page, `${v}-winddown-confirm`);
  const allBtn = page.locator('.modal .seg button', { hasText: 'All booked' }).first();
  if (await allBtn.count()) { await allBtn.click(); await shot(page, `${v}-winddown-all`); }
  await page.evaluate(([r]) => window.__contrail.openModal({ kind: 'routeAction', routeId: r, action: 'suspend' }), [id]);
  await shot(page, `${v}-suspend-confirm`);
  // A contract sheet (the longest-running active one).
  const cid = await page.evaluate(() => {
    const g = window.__contrail.game;
    const cs = Object.values(g.contracts ?? {}).filter((c) => (c.status === 'active' || c.status === 'signed') && !c.routeId && !/^Scheduled/.test(c.title));
    cs.sort((a, b) => (b.end - b.start) - (a.end - a.start));
    return cs[0]?.id ?? Object.keys(g.contracts ?? {})[0];
  });
  if (cid) { await page.evaluate((c) => window.__contrail.openModal({ kind: 'contract', contractId: c }), cid); await shot(page, `${v}-contract-sheet`); }
  else problems.push(`${v}: no contract`);
  await page.evaluate(() => window.__contrail.closeModal());
  for (const [tab, name] of [['contracts', 'contracts'], ['inbox', 'inbox'], ['schedule', 'schedule'], ['finance', 'finance'], ['network', 'network']]) {
    await page.evaluate((t) => window.__contrail.navigate(t, {}), tab);
    await sleep(900);
    await shot(page, `${v}-${name}`, '.screen *, .shell main *');
  }
  // Active contracts (their dates), the fleet, the crew roster.
  await page.evaluate(() => window.__contrail.navigate('contracts', { view: 'active' }));
  await sleep(900);
  await shot(page, `${v}-contracts-active`, '.screen *');
  for (const tab of ['fleet', 'crew']) {
    await page.evaluate((t) => window.__contrail.navigate(t, {}), tab);
    await sleep(900);
    await shot(page, `${v}-${tab}`, '.screen *');
  }
  // Schedule at its widest zoom (dates on the axis).
  const z = page.getByRole('button', { name: /^28 days$/ }).first();
  if (await z.count()) { await page.evaluate(() => window.__contrail.navigate('schedule', {})); await z.click().catch(() => {}); await sleep(600); await shot(page, `${v}-schedule-wide`, '.screen *'); }
}

async function suspShots(page, v) {
  await load(page, suspF);
  const id = await routeId(page);
  await page.evaluate((r) => window.__contrail.openModal({ kind: 'route', routeId: r }), id);
  await shot(page, `${v}-route-suspended`);
  await page.evaluate((r) => window.__contrail.openModal({ kind: 'routeAction', routeId: r, action: 'resume' }), id);
  await shot(page, `${v}-resume-confirm`);
  await page.evaluate(() => window.__contrail.closeModal());
}

(async () => {
  const browser = await chromium.launch();
  const views = (viewsArg || 'mac,ipad,iphone').split(',');
  for (const v of views) {
    const steps = [(p) => globeShots(p, v), (p) => dateShots(p, v), (p) => suspShots(p, v)];
    for (const [i, step] of steps.entries()) {
      const ctx = await browser.newContext(VIEWS[v]);
      const page = await ctx.newPage();
      page.__touch = v !== 'mac';
      page.on('pageerror', (e) => problems.push(`${v} page error: ${e.message}`));
      try {
        await step(page);
      } catch (e) {
        problems.push(`${v} step ${i}: ${e.message.split('\n')[0]}`);
        await page.screenshot({ path: path.join(out, `${v}-error-${i}.png`) }).catch(() => {});
      }
      await ctx.close();
    }
  }
  await browser.close();
  console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no problems');
})();
