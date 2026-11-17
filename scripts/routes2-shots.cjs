#!/usr/bin/env node
// v0.24.1 shots: the route actions, their confirms, the map route card, the key bindings (normal, waiting, conflict).
// usage: node scripts/routes2-shots.cjs <url> <outDir> <live.json> <suspended.json> <closing.json>
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const [url, out, liveF, suspF, closeF] = process.argv.slice(2);
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
    s.setSettings({ autoPause: Object.fromEntries(Object.keys(s.settings.autoPause).map((k) => [k, false])), toasts: false, sound: false, music: false });
    s.modal = null; s.paused = true; s.toasts = []; s.emit();
  });
  await sleep(800);
}

const routeId = (page) => page.evaluate(() => Object.values(window.__contrail.game.network.routes).find((r) => r.status !== 'closed')?.id);

async function shot(page, name) {
  await sleep(450);
  const f = path.join(out, `${name}.png`);
  await page.screenshot({ path: f });
  const lint = await page.evaluate(() => {
    const o = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) o.push(`page overflows sideways (${document.documentElement.scrollWidth})`);
    const m = document.querySelector('.modal');
    if (m) { const r = m.getBoundingClientRect(); if (r.bottom > window.innerHeight + 1 || r.top < -1) o.push(`modal off screen ${Math.round(r.top)}..${Math.round(r.bottom)}`); if (r.right > window.innerWidth + 1) o.push('modal too wide'); }
    for (const el of document.querySelectorAll('.modal *, .ops-route-card *')) {
      if (el.children.length || el.classList.contains('help-q')) continue;
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow === 'visible' && el.clientWidth > 0 && !el.closest('.ellipsis')) o.push(`text wider than its box: ${(el.textContent || '').slice(0, 40)}`);
    }
    return o;
  });
  if (lint.length) problems.push(`${name}: ${lint.join('; ')}`);
  console.log('shot', name, lint.length ? lint.join('; ') : '');
}

async function routeShots(page, v) {
  await load(page, liveF);
  const id = await routeId(page);
  await page.evaluate((r) => window.__contrail.openModal({ kind: 'route', routeId: r }), id);
  await shot(page, `${v}-route-page`);
  for (const a of ['suspend', 'windDown', 'close']) {
    await page.evaluate(([r, x]) => window.__contrail.openModal({ kind: 'routeAction', routeId: r, action: x, back: { kind: 'route', routeId: r } }), [id, a]);
    await shot(page, `${v}-confirm-${a}`);
  }
  // Suspend: the refund choice.
  await page.evaluate(([r]) => window.__contrail.openModal({ kind: 'routeAction', routeId: r, action: 'suspend' }), [id]);
  await sleep(200);
  await page.locator('.modal .seg button', { hasText: 'Refund' }).first().click();
  await shot(page, `${v}-confirm-suspend-refund`);
  // Wind down: all booked.
  await page.evaluate(([r]) => window.__contrail.openModal({ kind: 'routeAction', routeId: r, action: 'windDown' }), [id]);
  await sleep(200);
  const allBtn = page.locator('.modal .seg button', { hasText: 'All booked' }).first();
  if (await allBtn.count()) { await allBtn.click(); await shot(page, `${v}-confirm-windDown-all`); }
  await page.evaluate(() => window.__contrail.closeModal());
  // The map: tap the middle of the dashed line.
  await page.evaluate(() => window.__contrail.navigate('map', {}));
  await sleep(1500);
  // A finger beside the line (14 px off; a mouse 5 px), where no aircraft or airport is nearer: the generous hit area.
  const off = v === 'mac' ? 5 : 14;
  let card = 0;
  let pt = null;
  for (const f of [0.45, 0.3, 0.6, 0.2, 0.7, 0.5, 0.35, 0.55]) {
    pt = await page.evaluate((fr) => {
      const p = document.querySelector('.nw-map-routes path');
      if (!p) return null;
      const q = p.getPointAtLength(p.getTotalLength() * fr);
      const sp = new DOMPoint(q.x, q.y).matrixTransform(p.getScreenCTM());
      return { x: sp.x, y: sp.y };
    }, f);
    if (!pt) break;
    await page.evaluate(() => { window.__contrail.select(undefined); });
    await sleep(300);
    if (v === 'mac') { await page.mouse.move(pt.x + off, pt.y); await sleep(200); await page.mouse.click(pt.x + off, pt.y); }
    else await page.touchscreen.tap(pt.x + off, pt.y);
    await sleep(700);
    card = await page.locator('.ops-route-card').count();
    if (card) break;
  }
  if (pt) {
    if (!card) problems.push(`${v}: no route card after a tap ${off}px off the line`);
    await shot(page, `${v}-map-route-card`);
  } else problems.push(`${v}: no route line on the map`);
}

async function stateShots(page, v, file, tag) {
  await load(page, file);
  const id = await routeId(page);
  if (!id) { problems.push(`${v} ${tag}: no route`); return; }
  await page.evaluate((r) => window.__contrail.openModal({ kind: 'route', routeId: r }), id);
  await shot(page, `${v}-route-page-${tag}`);
  await page.evaluate((r) => window.__contrail.openModal({ kind: 'routeAction', routeId: r, action: 'resume' }), id);
  await shot(page, `${v}-confirm-resume-${tag}`);
  await page.evaluate(() => window.__contrail.closeModal());
}

async function keyShots(page, v) {
  await load(page, liveF);
  // The shortcuts sheet: the ? key on a keyboard (the modal on touch).
  await page.evaluate(() => window.__contrail.navigate('map', {}));
  if (v === 'mac') await page.keyboard.press('Shift+Slash'); else await page.evaluate(() => window.__contrail.openModal({ kind: 'keys' }));
  await sleep(400);
  if (!(await page.locator('.kb-modal').count())) problems.push(`${v}: ? did not open the key bindings`);
  await shot(page, `${v}-keys-sheet`);
  if (v === 'iphone') return;
  // Settings › Key bindings.
  await page.evaluate(() => window.__contrail.openModal({ kind: 'settings' }));
  await sleep(300);
  await page.evaluate(() => document.querySelector('.modal .kb')?.scrollIntoView({ block: 'start' }));
  await shot(page, `${v}-settings-keys`);
  // Waiting for a key.
  await page.evaluate(() => window.__contrail.openModal({ kind: 'keys' }));
  await sleep(300);
  const chip = page.locator('.kb-row', { hasText: 'Finance' }).locator('.kb-chip');
  await chip.click();
  await shot(page, `${v}-keys-waiting`);
  // A key another action has: M (the map).
  await page.keyboard.press('m');
  await sleep(200);
  if (!(await page.locator('.kb-clash').count())) problems.push(`${v}: no conflict shown for M`);
  await shot(page, `${v}-keys-conflict`);
  await page.locator('.kb-clash button', { hasText: 'Swap' }).click();
  await sleep(200);
  const swapped = await page.evaluate(() => [window.__contrail.settings.keys['tab.finance'], window.__contrail.settings.keys['tab.map']]);
  if (swapped.join() !== 'm,b') problems.push(`${v}: swap gave ${swapped}`);
  // A refused key.
  await chip.click();
  await page.keyboard.press('Tab');
  await sleep(200);
  await shot(page, `${v}-keys-refused`);
  await page.keyboard.press('Escape');
  await page.locator('.kb-top button', { hasText: 'Reset all' }).click();
  // Esc closes the sheet; the nav tooltip names the key.
  await page.keyboard.press('Escape');
  await sleep(200);
  if (await page.locator('.kb-modal').count()) problems.push(`${v}: Esc did not close the sheet`);
  if (v === 'mac') {
    const t = await page.locator('[data-nav="finance"]').getAttribute('title');
    if (t !== 'Finance (B)') problems.push(`mac: finance tooltip ${t}`);
    await page.keyboard.press('n');
    await sleep(300);
    if ((await page.evaluate(() => window.__contrail.nav.tab)) !== 'network') problems.push('mac: N did not open Network');
    await page.keyboard.press('s');
    await sleep(300);
    if ((await page.evaluate(() => window.__contrail.nav.tab)) !== 'schedule') problems.push('mac: S did not open Schedule');
  }
}

(async () => {
  const browser = await chromium.launch();
  for (const v of Object.keys(VIEWS)) {
    const steps = [(p) => routeShots(p, v), (p) => stateShots(p, v, suspF, 'suspended'), (p) => stateShots(p, v, closeF, 'closing'), (p) => keyShots(p, v)];
    for (const [i, step] of steps.entries()) {
      const ctx = await browser.newContext(VIEWS[v]);
      const page = await ctx.newPage();
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
