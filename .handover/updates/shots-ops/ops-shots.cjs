// Update 1 Operations screenshots: every new card, the diversion picker and the diverted flight on the map, the
// Safety & audit panel, the Pace setting, in light and dark. iPad home-screen size 1180×820 at DPR 2.
// usage: node ops-shots.cjs <url> <outdir>
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const url = process.argv[2] || 'http://localhost:5402/';
const out = process.argv[3] || './shots';
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function settle(page, ms = 500) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))).catch(() => {});
  await sleep(ms);
}

async function shot(page, name) {
  await settle(page, 600);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('shot', name);
}

async function start(page, theme) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__contrail && window.__contrail.screen === 'title', null, { timeout: 60000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* */ } });
  // A fixed seed: the same company and offers in both themes.
  await page.evaluate(() => window.__contrail.startNewGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 7 }));
  await page.waitForSelector('.shell', { timeout: 20000 });
  await page.evaluate((t) => {
    const s = window.__contrail;
    s.setSettings({ theme: t, autoPause: Object.fromEntries(Object.keys(s.settings.autoPause).map((k) => [k, false])), toasts: false, sound: false, seenWhatsNew: 'zzz', screenHintsSeen: ['map', 'company', 'inbox', 'contracts', 'schedule', 'crew', 'fleet', 'finance', 'team'] });
    s.modal = null; s.paused = true; s.toasts = []; s.emit();
  }, theme);
  await page.evaluate(() => window.__contrail.dev.autoplay(14));
  await page.evaluate(() => { const s = window.__contrail; s.modal = null; s.paused = true; s.toasts = []; s.emit(); });
  await settle(page, 800);
}

/** Opens the newest decision of a kind; returns its id. */
async function openKind(page, kind) {
  const id = await page.evaluate((k) => {
    const s = window.__contrail;
    const d = [...s.game.decisions].reverse().find((x) => x.kind === k);
    if (!d) return null;
    s.openModal({ kind: 'decision', decisionId: d.id });
    return d.id;
  }, kind);
  await settle(page, 700);
  return id;
}

/** Clicks the decision's default option (resolves it through the UI). */
async function pickDefault(page) {
  const opt = page.locator('.decision-opt', { has: page.locator('.badge', { hasText: 'Default' }) }).first();
  if (await opt.count()) await opt.click();
  await page.evaluate(() => { const s = window.__contrail; s.modal = null; s.emit(); });
  await settle(page, 300);
}

/** Advances (clearing cards) until a revenue leg is airborne with 40+ min to go, or one is about to leave. */
async function until(page, what) {
  for (let i = 0; i < 300; i++) {
    const ok = await page.evaluate((w) => {
      const g = window.__contrail.game;
      return Object.values(g.flights).some((f) => f.aircraftId && f.kind === 'revenue' && (w === 'air' ? f.status === 'enroute' && (f.eta ?? f.sta) > g.now + 45 && (f.eta ?? f.sta) - (f.atd ?? f.std) > 80 : w === 'landed' ? f.status === 'done' && f.ata >= g.now - 30 && !g.fleet[f.aircraftId].flightId : f.status === 'scheduled' && f.std + f.delay - g.now <= 40 && f.std + f.delay - g.now > 2 && !!f.dutyId));
    }, what);
    if (ok) return true;
    if (i % 50 === 49) console.log('until', what, i, await page.evaluate(() => { const g = window.__contrail.game; return `${g.now} over=${!!g.gameOver} dec=${g.decisions.map((d) => d.kind).join(',')} sched=${Object.values(g.flights).filter((f) => f.status === 'scheduled' && f.aircraftId).length}`; }));
    await clearDecisions(page);
    await page.evaluate(() => window.__contrail.dev.advance(30));
  }
  return false;
}

async function clearDecisions(page) {
  for (let i = 0; i < 6; i++) {
    const n = await page.evaluate(() => window.__contrail.game.decisions.length);
    if (!n) break;
    await page.evaluate(() => { const s = window.__contrail; s.openModal({ kind: 'decision', decisionId: s.game.decisions[0].id }); });
    await settle(page, 300);
    await pickDefault(page);
  }
}

async function run(theme) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${theme}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${theme} console: ${m.text()}`); });
  await start(page, theme);
  const T = theme;

  // Settings → Gameplay → Pace.
  await page.evaluate(() => window.__contrail.openModal({ kind: 'settings' }));
  await shot(page, `${T}-01-settings-pace`);
  await page.locator('.sc-pace .seg button, .sc-pace button', { hasText: 'Calm' }).first().click().catch(() => {});
  await shot(page, `${T}-02-settings-pace-calm`);
  await page.evaluate(() => { const s = window.__contrail; s.setSettings({ pace: 'normal' }); s.closeModal(); });
  await clearDecisions(page);

  // Diversion (weather): the picker, then the diverted flight on the map, then the onward card at the alternate.
  await until(page, 'air');
  await page.evaluate(() => window.__contrail.dev.disruption('diversion'));
  if (await openKind(page, 'diversion')) {
    await shot(page, `${T}-03-diversion-picker`);
    const dot = page.locator('.divmap .dm-alt').first();
    if (await dot.count()) await dot.click({ force: true }); else await pickDefault(page);
    await page.evaluate(() => { const s = window.__contrail; s.modal = null; s.emit(); });
    const fid = await page.evaluate(() => Object.values(window.__contrail.game.flights).find((f) => f.div && f.status === 'enroute')?.id);
    const acId = await page.evaluate((id) => id && window.__contrail.game.flights[id].aircraftId, fid);
    if (acId) {
      await page.evaluate((id) => window.__contrail.navigate('map', { sel: { kind: 'aircraft', id } }), acId);
      await settle(page, 1800);
      await shot(page, `${T}-04-map-diverted`);
      await page.evaluate(() => window.__contrail.dev.advance(240));
      if (await openKind(page, 'divertOnward')) await shot(page, `${T}-05-diversion-onward`);
      await pickDefault(page);
    }
  } else console.log('no diversion card');
  await clearDecisions(page);

  // Medical emergency, technical diversion.
  for (const [k, kind, name] of [['medical', 'medical', '06-medical'], ['technical', 'diversion', '07-technical-diversion']]) {
    await until(page, 'air');
    await page.evaluate((x) => window.__contrail.dev.disruption(x), k);
    if (await openKind(page, kind)) await shot(page, `${T}-${name}`);
    else console.log('no card', k);
    await pickDefault(page);
    await clearDecisions(page);
  }

  // Gate cards: ATC slot, slow turnaround, curfew, crew sick away, bird strike.
  for (const [k, name] of [['ctot', '08-atc-slot'], ['turnaround', '09-turnaround'], ['curfew', '10-curfew'], ['sickAway', '11-crew-sick-away'], ['birdStrike', '12-bird-strike']]) {
    await until(page, k === 'birdStrike' ? 'landed' : 'gate');
    await page.evaluate((x) => window.__contrail.dev.disruption(x), k);
    if (await openKind(page, k)) await shot(page, `${T}-${name}`);
    else console.log('no card', k);
    await pickDefault(page);
    await clearDecisions(page);
  }

  // Ramp inspection with a Cat 3 finding: its four-line card.
  const rampId = await page.evaluate(() => window.__contrail.dev.ramp(3));
  if (rampId) {
    await page.evaluate((id) => window.__contrail.openModal({ kind: 'problem', subject: { kind: 'rampFinding', ref: { kind: 'ramp', id } } }), rampId);
    await shot(page, `${T}-13-ramp-cat3-card`);
    await page.evaluate(() => window.__contrail.closeModal());
  }
  // The audit: 4-week notice, then held with findings; Company › Safety & audit.
  await page.evaluate(() => window.__contrail.dev.audit('announce'));
  await page.evaluate(() => window.__contrail.dev.audit('now'));
  const fId = await page.evaluate(() => window.__contrail.game.opsx.audit.findings.find((f) => !f.closed)?.id);
  if (fId) {
    await page.evaluate((id) => window.__contrail.openModal({ kind: 'problem', subject: { kind: 'auditFinding', ref: { kind: 'audit', id } } }), fId);
    await shot(page, `${T}-14-audit-finding-card`);
    await page.evaluate(() => window.__contrail.closeModal());
  }
  await page.evaluate(() => window.__contrail.navigate('company', { view: 'overview' }));
  await settle(page, 800);
  await page.locator('.ops-safety').scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, `${T}-15-company-safety`);
  // Suspension: a finding left past its deadline.
  await page.evaluate(() => {
    const s = window.__contrail;
    const f = s.game.opsx.audit.findings.find((x) => !x.closed && !x.started);
    if (f) { f.due = s.game.now - 1440; }
    s.dev.advance(1440);
  });
  await page.evaluate(() => window.__contrail.navigate('company', { view: 'overview' }));
  await settle(page, 800);
  await page.locator('.ops-safety').scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, `${T}-16-company-safety-suspended`);
  await page.evaluate(() => window.__contrail.navigate('company', { view: 'overview' }));
  await settle(page, 500);
  await shot(page, `${T}-17-company-ladder-top`);
  // Inbox with the new entries.
  await page.evaluate(() => window.__contrail.navigate('inbox', {}));
  await shot(page, `${T}-18-inbox`);
  // A toast with its chime note: a card raised while toasts are on.
  await page.evaluate(() => { const s = window.__contrail; s.setSettings({ toasts: true, sound: true }); s.emit(); });
  await page.evaluate(() => window.__contrail.navigate('map', {}));
  await page.evaluate(() => window.__contrail.dev.disruption('ctot') || window.__contrail.dev.disruption('birdStrike'));
  await page.evaluate(() => { const s = window.__contrail; s.dev.advance(1); });
  await sleep(900);
  await shot(page, `${T}-19-toast`);
  await browser.close();
}

(async () => {
  for (const t of ['light', 'dark']) await run(t);
  console.log('ERRORS:', errors.length ? `\n${errors.join('\n')}` : '');
})();
