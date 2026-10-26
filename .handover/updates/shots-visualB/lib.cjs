// Visual B: shared helpers for the screenshots (iPad home-screen size 1180×820 at DPR 2).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = ['a321neo', 'b738', 'b752', 'b763', 'a332', 'a343', 'b772', 'b77w', 'b789', 'a359', 'a35k', 'b744', 'b748', 'a388', 'a346', 'b78x', 'b753', 'b741'];
const COLOURS = ['#c8102e', '#0b1f4d', '#ffffff', '#00843d', '#f5c451', '#5b2c83', '#0072ce', '#e35205', '#1d1d1b', '#7a1f2b', '#2e8b57', '#ff6f61'];

async function open(url, theme, errors) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: false });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${theme}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'log') console.log('PAGE', m.text()); if (m.type() === 'error') errors.push(`${theme} console: ${m.text()}`); });
  return { browser, page };
}

async function start(page, url, theme, opts = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__contrail && window.__contrail.screen === 'title', null, { timeout: 60000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* */ } });
  await page.evaluate(() => window.__contrail.startNewGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 7 }));
  await page.waitForSelector('.shell', { timeout: 20000 });
  await page.evaluate(({ t, hints }) => {
    const s = window.__contrail;
    s.setSettings({ theme: t, autoPause: Object.fromEntries(Object.keys(s.settings.autoPause).map((k) => [k, false])), toasts: false, sound: false, music: false, seenWhatsNew: 'zzz', ...(hints ? {} : { screenHintsSeen: ['map', 'company', 'inbox', 'contracts', 'schedule', 'crewPeople', 'crewBoard', 'crewPlan', 'fleet', 'finance', 'team'] }) });
    s.modal = null; s.paused = true; s.toasts = []; s.emit();
  }, { t: theme, hints: !!opts.hints });
  if (opts.days !== 0) await page.evaluate((d) => window.__contrail.dev.autoplay(d), opts.days ?? 14);
  if (opts.big) {
    await page.evaluate(({ types, colours, n }) => {
      const s = window.__contrail;
      for (const t of types) s.dev.addType(t);
      s.dev.fleet(n);
      Object.values(s.game.fleet).forEach((ac, i) => {
        if (i < 2) return;
        const c = colours[i % colours.length];
        ac.livery = { custom: { primary: c, secondary: colours[(i + 5) % colours.length], tail: 'solid' } };
      });
      s.dev.demoFlights(3);
      s.emit();
    }, { types: TYPES, colours: COLOURS, n: opts.big });
  }
  await calm(page);
}

async function calm(page) {
  await page.evaluate(() => { const s = window.__contrail; s.modal = null; s.paused = true; s.toasts = []; s.decisionDeferred = s.game.decisions.map((d) => d.id).join(','); s.emit(); });
  await sleep(500);
}

async function shot(page, out, name, clip) {
  await sleep(900);
  await page.screenshot({ path: path.join(out, `${name}.png`), ...(clip ? { clip } : {}) });
  console.log('shot', name);
}

module.exports = { open, start, calm, shot, sleep, TYPES, COLOURS };
