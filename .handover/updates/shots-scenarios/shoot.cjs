#!/usr/bin/env node
// v0.12 start setups and Scenarios mode: screenshots on iPad (1180×820, home-screen app) and iPhone on its side
// (852×393 with the Dynamic Island insets), light and dark: Title, New Game with the setup cards, the Scenarios list,
// a scenario in play (goals dialog, Company panel, top-bar chip) and a results card.
//   node shoot.cjs [--url http://localhost:5480/] [--themes light,dark] [--devices ipad,iphone]
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL = arg('--url', 'http://localhost:5480/');
const OUT = __dirname;
const THEMES = arg('--themes', 'light,dark').split(',');
const DEVICES = arg('--devices', 'ipad,iphone').split(',');
const UA = {
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};
const VP = { ipad: { width: 1180, height: 820 }, iphone: { width: 852, height: 393 } };
const INS = { ipad: null, iphone: { t: 0, r: 59, b: 21, l: 59 } };
const insetCss = (i) => `:root:root { --safe-t: ${i.t}px !important; --safe-r: ${i.r}px !important; --safe-b: ${i.b}px !important; --safe-l: ${i.l}px !important; --vp-safe-t: ${i.t}px !important; --vp-safe-b: ${i.b}px !important; }`;
const errors = [];

async function settle(page, ms = 500) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))).catch(() => {});
  await sleep(ms);
}
async function shot(page, name) {
  await settle(page, 700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('shot', name);
}
async function prefs(page, theme) {
  await page.evaluate((theme) => {
    const s = window.__contrail;
    s.setSettings({ theme, toasts: false, sound: false, music: false, seenWhatsNew: 'zzz', whatsNewCatchUp: 'v0.9', screenHintsSeen: ['map', 'company', 'inbox', 'contracts', 'schedule', 'crewPeople', 'crewBoard', 'crewPlan', 'fleet', 'finance', 'team'],
      autoPause: Object.fromEntries(Object.keys(s.settings.autoPause).map((k) => [k, false])) });
  }, theme);
}

(async () => {
  const browser = await chromium.launch();
  for (const dev of DEVICES) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: VP[dev], deviceScaleFactor: 2, hasTouch: true, isMobile: dev === 'iphone', userAgent: UA[dev] });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${dev}/${theme}: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`${dev}/${theme} console: ${m.text()}`); });
      if (INS[dev]) await page.addInitScript((css) => { addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }); }, insetCss(INS[dev]));
      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__contrail && window.__contrail.screen === 'title', null, { timeout: 60000 });
      await page.evaluate(() => { try { localStorage.clear(); } catch { /* */ } });
      await prefs(page, theme);
      await page.evaluate(() => window.__contrail.closeModal());
      // A few best results on this device so the list shows stars.
      await page.evaluate(() => window.__contrail.setSettings({ scenarioBest: { summerSurge: { stars: 2, value: 700000, at: 1 }, cupFinal: { stars: 1, value: 9, at: 1 }, aogFirefighter: { stars: 3, value: 5300000, at: 1 } } }));
      const tag = `${theme}-${dev}`;
      await shot(page, `${tag}-title`);
      await page.evaluate(() => window.__contrail.setScreen('newgame'));
      await page.waitForSelector('.ng-setups');
      await page.evaluate(() => { [...document.querySelectorAll('.ng-setup')].find((e) => e.textContent.includes('Mixed fleet')).click(); for (const el of document.querySelectorAll('.ng-body, .ng-panel, .ng-visual')) el.scrollTo(0, 0); });
      await shot(page, `${tag}-newgame-setups`);
      await page.evaluate(() => window.__contrail.setScreen('scenarios'));
      await page.waitForSelector('.sc-list');
      await shot(page, `${tag}-scenarios`);
      // A scenario in play: Ash Cloud, a week in (the closure is on), goals dialog and the Company panel.
      await page.evaluate(() => window.__contrail.startScenario('ashCloud'));
      await page.waitForSelector('.shell', { timeout: 20000 });
      await prefs(page, theme);
      await page.evaluate(() => { const s = window.__contrail; s.dev.autoplay(6); s.modal = null; s.paused = true; s.toasts = []; s.decisionDeferred = s.game.decisions.map((d) => d.id).join(','); s.emit(); });
      await settle(page, 1200);
      await shot(page, `${tag}-play-map`);
      await page.evaluate(() => window.__contrail.openModal({ kind: 'scenario' }));
      await shot(page, `${tag}-play-goals`);
      await page.evaluate(() => { window.__contrail.closeModal(); window.__contrail.navigate('company'); });
      await shot(page, `${tag}-play-company`);
      // A results card: Cup Final Week played to its end.
      await page.evaluate(() => window.__contrail.startScenario('cupFinal'));
      await page.waitForSelector('.shell', { timeout: 20000 });
      await prefs(page, theme);
      await page.evaluate(() => { const s = window.__contrail; s.dev.autoplay(12); s.modal = null; s.toasts = []; s.emit(); });
      await page.waitForSelector('.sc-result', { timeout: 20000 }).catch(() => errors.push(`${tag}: no results card`));
      await shot(page, `${tag}-result`);
      await ctx.close();
    }
  }
  await browser.close();
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'ERRORS: none');
})();
