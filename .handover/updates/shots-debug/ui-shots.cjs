// Debug round (26 Oct 2026): every tab and the main dialogs on the player's Blue Airlines save, light and dark, at
// iPad A16 landscape home-screen size (1180×820 CSS px at DPR 2 = 2360×1640). Console errors / React warnings logged.
// usage: node ui-shots.cjs <url> <outdir> [theme=light,dark] [save.json]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const url = process.argv[2] || 'http://localhost:5410/';
const out = process.argv[3] || path.join(__dirname, 'ui');
const themes = (process.argv[4] || 'light,dark').split(',');
const saveFile = process.argv[5] || path.join(__dirname, 'save', 'blue.json');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];

async function settle(page, ms = 400) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))).catch(() => {});
  await sleep(ms);
}
let current = '';
async function shot(page, name) {
  current = name;
  await settle(page, 500);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  // Text clipped or overflowing its box (visible elements only): reported, not fatal.
  const clipped = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      if (bad.length > 12) break;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || !el.childNodes.length) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      const ox = el.scrollWidth - el.clientWidth;
      if (ox > 2 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} "${el.textContent.trim().slice(0, 40)}" +${ox}px`);
      if (r.right > innerWidth + 1 && cs.position !== 'fixed') bad.push(`off-screen right: ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} "${el.textContent.trim().slice(0, 30)}"`);
    }
    return bad;
  });
  if (clipped.length) logs.push(`[clip ${name}] ${clipped.join(' | ')}`);
  console.log('shot', name);
}

const S = (page, fn, arg) => page.evaluate(fn, arg);

async function boot(page, theme) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__contrail && window.__contrail.screen === 'title', null, { timeout: 60000 });
  await S(page, (t) => {
    const s = window.__contrail;
    s.setSettings({ theme: t, sound: false, seenWhatsNew: 'zzz' });
  }, theme);
  await settle(page, 800);
}

async function quiet(page) {
  await S(page, () => {
    const s = window.__contrail;
    s.modal = null; s.modalBelow = null; s.paused = true; s.toasts = []; s.emit();
  });
  await settle(page, 300);
}

async function importSave(page) {
  await S(page, () => window.__contrail.openModal({ kind: 'saves', mode: 'load' }));
  await settle(page, 300);
  const input = page.locator('input[type=file]').first();
  await input.setInputFiles(saveFile);
  // On the title screen the import replaces nothing: no confirm. While a game runs, confirm.
  await page.waitForFunction(() => window.__contrail.screen === 'game', null, { timeout: 30000 });
  await S(page, () => {
    const s = window.__contrail;
    s.setSettings({ toasts: false, screenHintsSeen: ['map', 'company', 'inbox', 'contracts', 'schedule', 'crew', 'fleet', 'finance', 'team'] });
  });
  await quiet(page);
}

/** Answers every open decision with its default through the card (as a player would). */
async function clearDecisions(page) {
  for (let i = 0; i < 12; i++) {
    const id = await S(page, () => { const g = window.__contrail.game; return g.decisions.length ? g.decisions[0].id : null; });
    if (!id) return;
    await S(page, (d) => window.__contrail.openModal({ kind: 'decision', decisionId: d }), id);
    await settle(page, 300);
    const opt = page.locator('.decision-opt', { has: page.locator('.badge', { hasText: 'Default' }) }).first();
    if (await opt.count()) await opt.click();
    else await S(page, () => { const s = window.__contrail; s.game.decisions.shift(); s.emit(); });
    await quiet(page);
  }
}

async function tabs(page, tag) {
  for (const tab of ['map', 'contracts', 'schedule', 'crew', 'fleet', 'finance', 'company', 'inbox']) {
    await S(page, (t) => window.__contrail.navigate(t), tab);
    await shot(page, `${tag}-tab-${tab}`);
  }
}

async function modal(page, name, spec) {
  await S(page, (m) => { const s = window.__contrail; s.openModal(m); }, spec);
  await shot(page, name);
  await quiet(page);
}

async function run(theme) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, colorScheme: theme === 'dark' ? 'dark' : 'light', hasTouch: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${theme} ${current}] console.${m.type()}: ${m.text().slice(0, 400)}`); });
  page.on('pageerror', (e) => logs.push(`[${theme} ${current}] pageerror: ${e.message}`));
  const T = theme[0];
  await boot(page, theme);
  await shot(page, `${T}-title`);
  await S(page, () => window.__contrail.setScreen('newgame'));
  await shot(page, `${T}-newgame`);
  await S(page, () => window.__contrail.setScreen('title'));
  await importSave(page);
  await tabs(page, `${T}-blue`);
  // Dialogs on the player's game.
  const ids = await S(page, () => {
    const g = window.__contrail.game;
    const f = Object.values(g.flights).find((x) => x.status === 'scheduled' && x.kind === 'revenue' && x.aircraftId && x.std > g.now + 600);
    const offer = Object.values(g.offers).find((o) => o.status === 'open');
    const mkt = g.market.aircraft[0];
    const ac = Object.values(g.fleet)[0];
    const crew = Object.values(g.crew)[0];
    return { flight: f && f.id, duty: f && f.dutyId, offer: offer && offer.id, mkt: mkt && mkt.id, ac: ac.id, crew: crew.id, client: Object.keys(g.clients)[0] };
  });
  await modal(page, `${T}-m-settings`, { kind: 'settings' });
  await modal(page, `${T}-m-menu`, { kind: 'menu' });
  if (ids.offer) await modal(page, `${T}-m-offer`, { kind: 'offer', offerId: ids.offer });
  if (ids.flight) await modal(page, `${T}-m-sheet`, { kind: 'sheet', refs: [{ kind: 'flight', id: ids.flight }] });
  if (ids.duty) await modal(page, `${T}-m-duty`, { kind: 'duty', id: ids.duty });
  if (ids.flight) await modal(page, `${T}-m-crewcontrol`, { kind: 'crewControl', flightId: ids.flight });
  const mkt = ids.mkt || (await S(page, () => { const d = window.__contrail.dev; return d.marketOffer ? d.marketOffer('a321neo') : null; }));
  await quiet(page);
  if (mkt) await modal(page, `${T}-m-acquire`, { kind: 'acquire', offerId: mkt });
  await modal(page, `${T}-m-livery`, { kind: 'livery', target: { aircraftId: ids.ac } });
  await modal(page, `${T}-m-hire`, { kind: 'hire' });
  await modal(page, `${T}-m-client`, { kind: 'client', clientId: ids.client });
  await modal(page, `${T}-m-glossary`, { kind: 'glossary' });
  await modal(page, `${T}-m-whatsnew`, { kind: 'whatsNew', all: true });
  // Phone call (urgent offer) and its card.
  const call = await S(page, () => window.__contrail.dev.call());
  if (call) await modal(page, `${T}-m-phonecall`, { kind: 'offerCall', offerId: call });
  // Disruption cards: diversion picker, curfew, medical, a problem card.
  for (const k of ['diversion', 'curfew', 'medical', 'sickAway']) {
    const ok = await S(page, (kind) => window.__contrail.dev.disruption(kind), k);
    if (!ok) { logs.push(`[${theme}] dev.disruption(${k}) found no leg`); continue; }
    const id = await S(page, () => { const g = window.__contrail.game; const d = g.decisions[g.decisions.length - 1]; return d && d.id; });
    if (id) await modal(page, `${T}-m-card-${k}`, { kind: 'decision', decisionId: id });
  }
  await clearDecisions(page);
  const prob = await S(page, () => {
    const g = window.__contrail.game;
    const f = Object.values(g.flights).find((x) => x.crewAlert);
    return f ? { kind: 'crewShort', ref: { kind: 'flight', id: f.id } } : { kind: 'cashLow', ref: { kind: 'company', id: 'cash' } };
  });
  await modal(page, `${T}-m-problem`, { kind: 'problem', subject: prob });
  // Safety & audit panel lives on the Company tab; ramp check + audit now.
  await S(page, () => { window.__contrail.dev.ramp(3); window.__contrail.dev.audit('now'); });
  await quiet(page);
  await S(page, () => window.__contrail.navigate('company'));
  await shot(page, `${T}-blue-company-audit`);
  // Long names, then a big fleet.
  await S(page, () => {
    const s = window.__contrail;
    s.update((g) => {
      g.company.name = 'Transcontinental Humanitarian & Executive Charter Airways International';
      const ac = Object.values(g.fleet)[0];
      ac.name = 'Spirit of Saint-Barthélemy-d’Anjou the Magnificent';
    });
  });
  await S(page, () => window.__contrail.navigate('fleet'));
  await shot(page, `${T}-long-fleet`);
  await S(page, () => window.__contrail.navigate('company'));
  await shot(page, `${T}-long-company`);
  await S(page, () => window.__contrail.dev.fleet(22));
  await S(page, () => window.__contrail.dev.demoFlights(3));
  await quiet(page);
  for (const tab of ['schedule', 'fleet', 'map', 'crew']) {
    await S(page, (t) => window.__contrail.navigate(t), tab);
    await shot(page, `${T}-big-${tab}`);
  }
  // Empty states: a brand-new game, nothing signed.
  await S(page, () => window.__contrail.startNewGame({ name: 'Empty Air', code: 'EA', livery: { primary: '#0e70c0', secondary: '#ffffff', tail: 'solid' }, base: 'LIS', seed: 11 }));
  await page.waitForSelector('.shell', { timeout: 20000 });
  await quiet(page);
  await tabs(page, `${T}-new`);
  await browser.close();
}

(async () => {
  for (const t of themes) await run(t);
  fs.writeFileSync(path.join(out, 'console.txt'), logs.join('\n'));
  console.log(`\nLOGS (${logs.length}):\n${logs.slice(0, 80).join('\n')}`);
})();
