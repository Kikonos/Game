#!/usr/bin/env node
/*
 * BLOCK HOURS iPad screenshot + layout-lint harness (iPad A16 11" emulation, Chromium via Playwright).
 *
 * Usage:
 *   node scripts/ipad-shots.cjs --url http://localhost:5173/ --out /tmp/shots \
 *     [--view safari,landscape | all] [--screens newgame,map,contracts | all] \
 *     [--standalone] [--embed] [--force-touch] [--save path/to/save.json] [--days N] [--base LIS] [--pages N]
 *
 *   --url          base URL of a running dev/preview server (default http://localhost:5173/)
 *   --out          output directory for PNGs + report-<view>.json (default ./ipad-shots)
 *   --view         comma list or all (default safari,landscape):
 *                    safari    1180×750   Safari with toolbars, landscape (the main target)
 *                    landscape 1180×820   home-screen app / full screen, landscape
 *                    portrait   820×1180  portrait (not a v0.5 target; must not break)
 *                    split      590×820   Split View half (compact tier)
 *                    desktop   1440×900   mouse, no touch, DPR 1
 *                  iPad views use DPR 2, touch, isMobile and an iPadOS Safari UA.
 *   --size WxH     add a touch view of any size, named WxH
 *   --screens      comma list (default all), in this order: New Game → Ops Map → every tab → modals:
 *                    loading,title,newgame,map,map-aircraft,map-airport,map-offer,contracts,contracts-active,
 *                    contracts-missed,offer-modal,schedule,schedule-28d,block-sheet,duty-modal,crew,hire,
 *                    fleet,check-modal,finance,company,inbox,decision,subcharter,menu,settings,saves,
 *                  v0.5.1 liveries (run last: they sign a paint contract and play days forward):
 *                    newgame-livery,livery-company,livery-aircraft,offer-paint,offer-paint-optional,
 *                    schedule-paint,paint-sheet,map-painted,fleet-painted
 *                  v0.7 fleet & ladder (run last: they post market offers, grant Widebody operations, sign an A330 at
 *                  Santiago and book a VIP refit):
 *                    convert-confirm,fleet-market,acquire-modal,company-ladder,approval-modal,ladder-step,acquire-widebody,
 *                    fleet-delivering,schedule-delivering,refit-modal,fleet-refit,schedule-refit,lease-modal,market-toggles,inbox-market
 *                  v0.7.1 crew control + plain language (run last: they empty the pilot seats of the next flight):
 *                    crew-control,crew-control-jet,problem-modal,inbox-problems,glossary,duty-gauges,schedule-why,term-popover,hint,
 *                    fleet-short,settings-glossary
 *                  v0.7.2 crew rules & fleet (run last: they post a market offer, empty pilot seats, add an A330-300 with crew
 *                  rest seats, agree a sale and book a C-check at a hub):
 *                    topbar-strip,topbar-strip-warnings,hire-multitype,refit-earliest,refit-booked,refit-rest-seats,flight-sheet-rest-seats,sell,
 *                    return-early,which-one,check-hub,whats-new-072
 *                  v0.7.3 in-flight rest & EASA (run last: they add an A330-200 with curtained business seats and an
 *                  augmented LIS long-haul, a short-cruise A330, a captain on home standby):
 *                    fleet-rest,market-rest-filter,flight-sheet-rest,flight-sheet-rest-tooshort,duty-why,offer-rest-lines,
 *                    refit-crew-rest,check-c-restfit,roster-board-aug,crew-control-standby,whats-new-073
 *                  v0.9 Experience (run last: they build a DUB tour roster, unlock and hire heads, grant achievements, post
 *                  slip / jumbo offers and a crew-out-of-hours flight):
 *                    roster-board-standby,roster-board-month-summary,roster-offbreak-confirm,crew-person-month,crew-control-standby-kinds,
 *                    crewplan-sets-why,company-team-locked,head-unlocked-card,company-team,company-achievements,achievement-toast,offer-analyst,
 *                    offer-slip,offer-jumbo,crew-control-out-of-hours,crew-control-discretion-greyed,inbox-crew-hours,opsstrip-hours,
 *                    settings-sound,settings-test-sounds,screen-hint-contracts,whats-new-catchup,fleet-longest-day-popover,crewplan-verdict
 *   --save         an exported save (.blockhours.json) to load for the in-game screens; without it the harness
 *                  starts a new game from the New Game screen (--base, default LIS) and plays --days
 *                  game days (default 40) with __contrail.dev.autoplay so every screen has real data
 *   --standalone   home-screen web app: --safe-t 24px / --safe-b 20px (status bar, home indicator),
 *                  drawn as translucent bands in the shots
 *   --embed        artifact host: :root padded 24px top / 20px bottom, html.embed
 *   --force-touch  set window.__CONTRAIL_FORCE_TOUCH__ (html.touch) in case touch media queries don't match
 *   --pages N      also capture N-1 extra shots per screen, each scrolled one viewport further
 *   --theme T      light or dark: the device colour scheme (a fresh install follows it); names the shots <theme>-…
 *
 * Per screen it writes <out>/<view>[-standalone|-embed]-<screen>.png and prints: horizontal page
 * overflow, elements beyond the viewport, console/page errors, visible tap targets smaller than 44×44
 * (not for desktop), HTML text under 12px, dialogs taller than the viewport, and with --standalone/--embed
 * controls whose centre sits under the status bar/home indicator.
 * Needs Playwright's Chromium: require('/opt/node22/lib/node_modules/playwright') (override with PW=...).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const ALL = [
  'loading', 'title', 'newgame', 'map', 'map-aircraft', 'map-airport', 'map-offer', 'contracts', 'contracts-active',
  'contracts-missed', 'offer-modal', 'schedule', 'schedule-28d', 'block-sheet', 'duty-modal', 'crew', 'hire',
  'fleet', 'check-modal', 'finance', 'company', 'inbox', 'decision', 'subcharter', 'menu', 'settings', 'saves',
  'newgame-livery', 'livery-company', 'livery-aircraft', 'offer-paint', 'offer-paint-optional', 'schedule-paint', 'paint-sheet', 'map-painted', 'fleet-painted',
  'crew-board', 'crew-board-month', 'board-drag', 'board-popover', 'crew-select', 'convert-modal', 'classes-modal', 'crew-converting', 'board-converting',
  'crew-morale', 'crew-notice', 'train-modal', 'company-policies', 'fleet-extra', 'offer-extra', 'contracts-extra', 'duty-extra',
  'convert-confirm', 'fleet-market', 'acquire-modal', 'company-ladder', 'approval-modal', 'ladder-step', 'acquire-widebody', 'fleet-delivering',
  'schedule-delivering', 'refit-modal', 'fleet-refit', 'schedule-refit', 'lease-modal', 'market-toggles', 'inbox-market',
  'crew-control', 'crew-control-jet', 'problem-modal', 'inbox-problems', 'glossary', 'duty-gauges', 'schedule-why', 'term-popover', 'hint', 'fleet-short', 'settings-glossary',
  'topbar-strip', 'topbar-strip-warnings', 'hire-multitype', 'refit-earliest', 'refit-booked', 'flight-sheet-rest-seats', 'refit-rest-seats', 'sell', 'return-early',
  'which-one', 'check-hub', 'whats-new-072',
  'fleet-rest', 'market-rest-filter', 'flight-sheet-rest', 'flight-sheet-rest-tooshort', 'duty-why', 'offer-rest-lines',
  'refit-crew-rest', 'check-c-restfit', 'roster-board-aug', 'crew-control-standby', 'whats-new-073',
  'company-clients', 'company-client-unhappy', 'company-rivals', 'contracts-head-standing-outlook', 'offer-trusted-first-refusal',
  'offer-rivals-bidding', 'offer-hajj', 'offer-deportation-moral', 'offer-mixed-crew', 'outlook-modal', 'subcharter-3-quotes',
  'inbox-world-event', 'world-event-modal', 'client-modal', 'schedule-programme-continues', 'roster-board-client-crew', 'duty-client-seats',
  'offer-dry-lease', 'schedule-dry-lease', 'fleet-dry-lease', 'whats-new-08',
  'roster-board-standby', 'roster-board-month-summary', 'roster-offbreak-confirm', 'crew-person-month', 'crew-control-standby-kinds', 'crewplan-sets-why',
  'company-team-locked', 'head-unlocked-card', 'company-team', 'company-achievements', 'achievement-toast', 'offer-analyst', 'offer-slip', 'offer-jumbo',
  'crew-control-out-of-hours', 'crew-control-discretion-greyed', 'inbox-crew-hours', 'opsstrip-hours', 'settings-sound', 'settings-test-sounds',
  'screen-hint-contracts', 'whats-new-catchup', 'fleet-longest-day-popover', 'crewplan-verdict',
  // v0.10.2 the phone call and the new approval rules
  'offer-call', 'approval-etops',
];
const PRE_GAME = new Set(['loading', 'title', 'newgame', 'newgame-livery']);
const VIEWS = {
  safari: { width: 1180, height: 750 },
  landscape: { width: 1180, height: 820 },
  portrait: { width: 820, height: 1180 },
  split: { width: 590, height: 820 },
  desktop: { width: 1440, height: 900 },
};
const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
/** iPad home-screen app insets (black-translucent status bar, home indicator). */
const INSET = { t: 24, b: 20 };
const MIN_TARGET = 44;
const MIN_TEXT = 12;

function parseArgs(argv) {
  const a = { url: 'http://localhost:5173/', out: path.resolve('ipad-shots'), view: 'safari,landscape', screens: 'all', save: null, days: 40, base: 'LIS', standalone: false, embed: false, forceTouch: false, pages: 1, sizes: [], theme: null };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--url') a.url = next();
    else if (k === '--out') a.out = path.resolve(next());
    else if (k === '--view' || k === '--views') a.view = next();
    else if (k === '--screens') a.screens = next();
    else if (k === '--save') a.save = next();
    else if (k === '--days') a.days = Math.max(0, Number(next()) || 0);
    else if (k === '--base') a.base = next().toUpperCase();
    else if (k === '--standalone') a.standalone = true;
    else if (k === '--embed') a.embed = true;
    else if (k === '--force-touch') a.forceTouch = true;
    else if (k === '--pages') a.pages = Math.max(1, Number(next()) || 1);
    else if (k === '--size') a.sizes.push(next());
    else if (k === '--theme') a.theme = next() === 'light' ? 'light' : 'dark';
    else if (k === '-h' || k === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(0); }
    else { console.error(`Unknown flag ${k}`); process.exit(2); }
  }
  if (a.standalone && a.embed) { console.error('--standalone and --embed are exclusive'); process.exit(2); }
  return a;
}

const args = parseArgs(process.argv);
const wanted = args.screens === 'all' ? ALL : args.screens.split(',').map((s) => s.trim()).filter(Boolean);
const unknown = wanted.filter((s) => !ALL.includes(s));
if (unknown.length) { console.error(`Unknown screens: ${unknown.join(', ')}`); process.exit(2); }
const screens = ALL.filter((s) => wanted.includes(s));
for (const sz of args.sizes) {
  const m = /^(\d+)x(\d+)$/.exec(sz);
  if (!m) { console.error(`Bad --size ${sz} (use WxH)`); process.exit(2); }
  VIEWS[sz] = { width: Number(m[1]), height: Number(m[2]) };
}
const views = args.sizes.length && !process.argv.includes('--view') ? [...args.sizes]
  : args.view === 'all' ? Object.keys(VIEWS) : [...args.view.split(',').map((s) => s.trim()).filter(Boolean), ...args.sizes];
const badViews = views.filter((v) => !VIEWS[v]);
if (badViews.length) { console.error(`Unknown views: ${badViews.join(', ')} (use ${Object.keys(VIEWS).join('|')}|all)`); process.exit(2); }
fs.mkdirSync(args.out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The guard timer is cleared once the promise settles: a pending long timer (the 40-day autoplay's) kept node alive
// for minutes after "Done." (the loop had nothing else to wait for but still waited for it).
const withTimeout = (p, ms, what) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timeout: ${what}`)), ms); })]).finally(() => clearTimeout(t)); };

/** CSS + overlay simulating the home-screen app or the artifact host (never for desktop). */
function hostCss(desktop) {
  if (desktop || (!args.standalone && !args.embed)) return '';
  const flow = args.embed ? { t: 0, b: 0 } : INSET;
  return `:root:root {
  --safe-t: ${flow.t}px !important; --safe-b: ${flow.b}px !important;
  --vp-safe-t: ${INSET.t}px !important; --vp-safe-b: ${INSET.b}px !important;
  ${args.embed ? `padding-top: ${INSET.t}px !important; padding-bottom: ${INSET.b}px !important;` : ''}
}
#__ipad_status, #__ipad_home { position: fixed; left: 0; right: 0; z-index: 2147483647; pointer-events: none; }
#__ipad_status { top: 0; height: ${INSET.t}px; background: rgba(255, 64, 160, 0.16); color: #fff; font: 600 12px/24px -apple-system, system-ui, sans-serif; padding: 0 22px; display: flex; justify-content: space-between; }
#__ipad_home { bottom: 0; height: ${INSET.b}px; background: rgba(255, 64, 160, 0.16); }
#__ipad_home::after { content: ''; position: absolute; left: 50%; bottom: 7px; width: 300px; margin-left: -150px; height: 5px; border-radius: 3px; background: rgba(255, 255, 255, 0.85); }`;
}

function initScript({ css, embed, forceTouch }) {
  if (forceTouch) window.__CONTRAIL_FORCE_TOUCH__ = true;
  const add = () => {
    if (!document.head || document.getElementById('__ipad_insets')) return;
    if (embed) document.documentElement.classList.add('embed');
    if (!css) return;
    const s = document.createElement('style');
    s.id = '__ipad_insets';
    s.textContent = css;
    document.head.appendChild(s);
    const bar = document.createElement('div');
    bar.id = '__ipad_status';
    bar.innerHTML = '<span>9:41 Mon 19 Oct</span><span>100%</span>';
    const home = document.createElement('div');
    home.id = '__ipad_home';
    document.documentElement.appendChild(bar);
    document.documentElement.appendChild(home);
  };
  document.addEventListener('DOMContentLoaded', add);
  if (document.readyState !== 'loading') add();
}

// Runs in the page: layout lint for the current state.
function lint({ inset, minTarget, minText }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out = {
    vw, vh, scrollWidth: document.documentElement.scrollWidth,
    touch: `(hover: none)=${matchMedia('(hover: none)').matches} (pointer: coarse)=${matchMedia('(pointer: coarse)').matches} html.touch=${document.documentElement.classList.contains('touch')}`,
    tier: document.querySelector('.shell')?.className.replace(/\bshell\b/, '').trim() || '-',
  };
  const skip = (el) => !!el.closest('#__ipad_status, #__ipad_home');
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const sel = (el) => {
    const parts = [];
    let e = el;
    for (let d = 0; e && e.nodeType === 1 && d < 3; d++, e = e.parentElement) {
      let p = e.tagName.toLowerCase();
      if (e.id && e.id !== 'root') p += `#${e.id}`;
      const cls = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
      if (cls.length) p += `.${cls.join('.')}`;
      parts.unshift(p);
      if (e.id) break;
    }
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return parts.join(' > ') + (label ? ` "${label}"` : '');
  };
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== 'visible') return true;
    }
    return false;
  };
  // On top at its centre (which must be on screen): not covered, not scrolled out of its container.
  const hit = (el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= vw || y >= vh) return false;
    const t = document.elementFromPoint(x, y);
    return !!t && (t === el || el.contains(t));
  };
  const all = [...document.body.querySelectorAll('*')].filter((el) => !skip(el));
  // Elements sticking out horizontally that no ancestor clips (outermost only).
  const beyond = [];
  for (const el of all) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || (r.right <= vw + 1 && r.left >= -1)) continue;
    if (!visible(el) || clipped(el)) continue;
    if (beyond.some((b) => b.contains(el))) continue;
    beyond.push(el);
  }
  out.beyondCount = beyond.length;
  out.beyond = beyond.slice(0, 10).map((el) => { const r = el.getBoundingClientRect(); return `${sel(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`; });
  // Interactive elements that are visible and on top at their centre.
  const ctrls = all.filter((el) => el.matches('button, a[href], [role="button"], [role="tab"], select, input:not([type="hidden"]), textarea, summary') && visible(el) && hit(el));
  const small = ctrls.filter((el) => {
    const r = el.getBoundingClientRect();
    if (el.matches('input[type="range"]')) return r.height < minTarget;
    return r.width < minTarget || r.height < minTarget;
  });
  out.tapTargets = ctrls.length;
  out.smallTargets = small.length;
  out.smallTargetSamples = small.slice(0, 10).map((el) => { const r = el.getBoundingClientRect(); return `${sel(el)} ${Math.round(r.width)}×${Math.round(r.height)}`; });
  if (inset) {
    const under = ctrls.filter((el) => {
      const r = el.getBoundingClientRect();
      const cy = r.top + r.height / 2;
      return cy < inset.t || cy > vh - inset.b;
    });
    out.underInsets = under.slice(0, 10).map(sel);
  }
  // HTML text under the minimum size (SVG labels excluded).
  let smallText = 0;
  const smallTextSamples = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || el.closest('svg') || skip(el)) continue;
    seen.add(el);
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    if (!hit(el)) continue; // covered (e.g. by a dialog)
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < minText) {
      smallText++;
      if (smallTextSamples.length < 6) smallTextSamples.push(`${sel(el)} ${fs}px`);
    }
  }
  out.smallText = smallText;
  out.smallTextSamples = smallTextSamples;
  const dlg = document.querySelector('.modal');
  if (dlg) {
    const r = dlg.getBoundingClientRect();
    out.dialog = { h: Math.round(r.height), out: r.top < -1 || r.bottom > vh + 1 };
  }
  return out;
}

async function settle(page, ms = 450) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))).catch(() => {});
  await sleep(ms);
}

async function press(page, locator, desktop) {
  if (desktop) await locator.click(); else await locator.tap();
}

async function gotoFresh(page) {
  await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__contrail && window.__contrail.screen === 'title', null, { timeout: 60000 });
  await settle(page, 700);
}

/** Calm, deterministic shots: no auto-pause stops, no toasts, clock paused, no modal. */
async function quiet(page) {
  await page.evaluate(() => {
    const s = window.__contrail;
    s.setSettings({ autoPause: Object.fromEntries(Object.keys(s.settings.autoPause).map((k) => [k, false])), toasts: false, sound: false });
    s.modal = null;
    s.paused = true;
    s.toasts = [];
    s.emit();
  });
}

async function newGame(page, desktop) {
  await gotoFresh(page);
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } window.__contrail.setScreen('newgame'); });
  await page.waitForSelector('.newgame', { timeout: 10000 });
  const base = page.locator('.ng-base', { hasText: args.base }).first();
  if (await base.count()) await press(page, base, desktop);
  await settle(page, 500);
}

let started = false;
async function ensureGame(page, saveJson, desktop) {
  // A suspended company (long harness runs) starts over, so later screens show a live game.
  const inGame = await page.evaluate(() => !!window.__contrail && window.__contrail.screen === 'game' && !window.__contrail.game?.gameOver).catch(() => false);
  if (!inGame || !started) {
    if (saveJson) {
      // The autosave slot accepts plain JSON; the title screen then offers Continue.
      await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.evaluate((text) => { localStorage.clear(); localStorage.setItem('contrail-acmi:save:auto', text); }, saveJson);
      await gotoFresh(page);
      // The "What's new" pop-up (once per version) would cover Continue after a cleared localStorage.
      await page.evaluate(() => window.__contrail.closeModal());
      await settle(page, 300);
      await press(page, page.getByRole('button', { name: /Continue/ }).first(), desktop);
    } else {
      await newGame(page, desktop);
      await press(page, page.locator('.ng-foot .btn-primary'), desktop);
    }
    await page.waitForSelector('.shell', { timeout: 20000 });
    await quiet(page);
    if (!saveJson && args.days) await page.evaluate((d) => window.__contrail.dev.autoplay(d), args.days);
    started = true;
    await settle(page, 900);
  }
  await quiet(page);
}

async function nav(page, tab, extra) {
  await page.evaluate(([t, x]) => window.__contrail.navigate(t, x || {}), [tab, extra]);
  await settle(page, tab === 'map' ? 1400 : 600);
}

async function modal(page, spec) {
  await page.evaluate((m) => window.__contrail.openModal(m), spec);
  await settle(page, 700);
}

/** First id matching a predicate over a game collection (runs in the page). */
const pick = (page, fn) => page.evaluate(fn);

const ACTIONS = {
  loading: async (page) => {
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.loading', { timeout: 15000 });
    await sleep(900);
  },
  title: async (page) => { await gotoFresh(page); started = false; },
  newgame: async (page, _save, d) => { await newGame(page, d); started = false; },
  map: (page) => nav(page, 'map'),
  'map-aircraft': async (page) => {
    const id = await pick(page, () => { const g = window.__contrail.game; return (Object.values(g.fleet).find((a) => a.status === 'flying') ?? Object.values(g.fleet)[0])?.id; });
    await nav(page, 'map', { sel: { kind: 'aircraft', id } });
  },
  'map-airport': (page) => page.evaluate(() => window.__contrail.game.company.homeBase).then((id) => nav(page, 'map', { sel: { kind: 'airport', id } })),
  'map-offer': async (page) => {
    const id = await pick(page, () => Object.values(window.__contrail.game.offers).find((o) => o.status === 'open')?.id);
    if (!id) throw new Error('SKIP no open offer');
    await nav(page, 'map', { sel: { kind: 'offer', id } });
  },
  contracts: (page) => nav(page, 'contracts', { view: 'market' }),
  'contracts-active': (page) => nav(page, 'contracts', { view: 'active' }),
  'contracts-missed': (page) => nav(page, 'contracts', { view: 'missed' }),
  'offer-modal': async (page) => {
    const id = await pick(page, () => Object.values(window.__contrail.game.offers).find((o) => o.status === 'open')?.id);
    if (!id) throw new Error('SKIP no open offer');
    await nav(page, 'contracts', { view: 'market' });
    await modal(page, { kind: 'offer', offerId: id });
  },
  schedule: (page) => nav(page, 'schedule'),
  'schedule-28d': async (page, _s, d) => {
    await nav(page, 'schedule');
    await press(page, page.locator('.sc-schedule .seg button', { hasText: '28 days' }), d);
    await settle(page, 500);
    await press(page, page.locator('.sc-schedule .seg button', { hasText: '7 days' }), d).catch(() => {});
    await press(page, page.locator('.sc-schedule .seg button', { hasText: '28 days' }), d);
    await settle(page, 400);
  },
  'block-sheet': async (page) => {
    const id = await pick(page, () => { const g = window.__contrail.game; const l = Object.values(g.flights).filter((f) => f.status === 'scheduled' && f.aircraftId && f.dutyId && f.std > g.now + 600).sort((a, b) => a.std - b.std); return (l.find((f) => f.crewIds.length) ?? l[0])?.id; });
    if (!id) throw new Error('SKIP no rostered flight');
    await nav(page, 'schedule');
    await modal(page, { kind: 'sheet', refs: [{ kind: 'flight', id }] });
  },
  'duty-modal': async (page) => {
    const id = await pick(page, () => { const g = window.__contrail.game; const l = Object.values(g.flights).filter((f) => f.status === 'scheduled' && f.aircraftId && f.dutyId && f.std > g.now + 600).sort((a, b) => a.std - b.std); return (l.find((f) => f.crewIds.length) ?? l[0])?.id; });
    if (!id) throw new Error('SKIP no rostered flight');
    await nav(page, 'schedule');
    await modal(page, { kind: 'duty', id });
  },
  crew: (page) => nav(page, 'crew'),
  hire: async (page) => { await nav(page, 'crew'); await modal(page, { kind: 'hire' }); },
  fleet: (page) => nav(page, 'fleet'),
  'check-modal': async (page) => {
    const id = await pick(page, () => Object.keys(window.__contrail.game.fleet)[0]);
    await nav(page, 'fleet');
    await modal(page, { kind: 'check', aircraftId: id, checkKind: 'A' });
  },
  finance: (page) => nav(page, 'finance'),
  company: (page) => nav(page, 'company'),
  inbox: (page) => nav(page, 'inbox'),
  decision: async (page) => {
    await nav(page, 'inbox');
    const id = await page.evaluate(() => { const s = window.__contrail; return s.game.decisions[0]?.id ?? s.dev.decision(); });
    await modal(page, { kind: 'decision', decisionId: id });
  },
  subcharter: async (page) => {
    const id = await pick(page, () => Object.values(window.__contrail.game.contracts).find((c) => c.status === 'active' || c.status === 'signed')?.id);
    if (!id) throw new Error('SKIP no active contract');
    await nav(page, 'contracts', { view: 'active' });
    await modal(page, { kind: 'subcharter', contractId: id });
  },
  menu: (page) => modal(page, { kind: 'menu' }),
  settings: (page) => modal(page, { kind: 'settings' }),
  saves: (page) => modal(page, { kind: 'saves', mode: 'save' }),
};

/** v0.5.1: a booked client paint-in (signs a forced paint offer once); returns the maintenance id. */
async function ensurePaintBooked(page) {
  const find = () => page.evaluate(() => Object.values(window.__contrail.game.maintenance).find((m) => m.kind === 'paint' && (m.status === 'planned' || m.status === 'inWork') && m.paint && m.paint.phase === 'in')?.id);
  let id = await find();
  if (!id) {
    await page.evaluate(() => window.__contrail.dev.paintJob('full', 60));
    id = await find();
  }
  if (!id) throw new Error('SKIP no aircraft free for a paint job');
  await quiet(page);
  return id;
}

/** v0.5.1: an aircraft flying in client colours (plays days forward until a paint-in ends); returns its id. */
async function ensurePainted(page) {
  const find = () => page.evaluate(() => Object.values(window.__contrail.game.fleet).find((a) => a.paintedFor)?.id);
  let id = await find();
  if (!id) await ensurePaintBooked(page);
  for (let i = 0; !id && i < 16; i++) {
    await page.evaluate(() => window.__contrail.dev.autoplay(4));
    id = await find();
  }
  if (!id) throw new Error('SKIP no aircraft in client colours yet');
  await quiet(page);
  return id;
}

Object.assign(ACTIONS, {
  'newgame-livery': async (page, _s, d) => {
    await newGame(page, d);
    started = false;
    await press(page, page.getByRole('button', { name: /Customise livery/ }), d);
    await settle(page, 600);
  },
  'livery-company': async (page) => { await nav(page, 'company'); await modal(page, { kind: 'livery', target: 'company' }); },
  'livery-aircraft': async (page, _s, d) => {
    const id = await pick(page, () => { const g = window.__contrail.game; return Object.values(g.fleet).find((a) => !a.paintedFor && !Object.values(g.maintenance).some((m) => m.aircraftId === a.id && m.kind === 'paint' && (m.status === 'planned' || m.status === 'inWork')))?.id; });
    if (!id) throw new Error('SKIP every aircraft is in client paint');
    await nav(page, 'fleet');
    await modal(page, { kind: 'livery', target: { aircraftId: id } });
    await press(page, page.locator('.lv-refbar button', { hasText: 'Custom' }), d);
    await settle(page, 400);
  },
  'offer-paint': async (page) => {
    await nav(page, 'contracts', { view: 'market' });
    await page.evaluate(() => window.__contrail.dev.paintOffer('full', true));
    await settle(page, 700);
  },
  'offer-paint-optional': async (page, _s, d) => {
    await nav(page, 'contracts', { view: 'market' });
    await page.evaluate(() => window.__contrail.dev.paintOffer('decals', false));
    await settle(page, 500);
    await press(page, page.locator('.sc-paint-toggle .toggle'), d);
    await settle(page, 500);
  },
  'schedule-paint': async (page) => {
    const id = await ensurePaintBooked(page);
    const m = await page.evaluate((x) => window.__contrail.game.maintenance[x], id);
    await nav(page, 'schedule', { sel: { kind: 'aircraft', id: m.aircraftId }, view: String(m.start - 24 * 60) });
  },
  'paint-sheet': async (page) => {
    const id = await ensurePaintBooked(page);
    await nav(page, 'schedule');
    await modal(page, { kind: 'sheet', refs: [{ kind: 'maint', id }] });
  },
  'map-painted': async (page) => {
    const id = await ensurePainted(page);
    await nav(page, 'map', { sel: { kind: 'aircraft', id } });
  },
  'fleet-painted': async (page) => {
    const id = await ensurePainted(page);
    await nav(page, 'fleet', { sel: { kind: 'aircraft', id } });
  },
});

// ---------- v0.6 crew ----------

async function board(page, zoom = 'Week') {
  await nav(page, 'crew', { view: 'board' });
  await page.locator('.rb-tools .seg button', { hasText: zoom }).first().click();
  await settle(page, 400);
}

/** A movable duty block on the board and a row below it to drag to (centre points). */
async function dragPoints(page) {
  return page.evaluate(() => {
    const blks = [...document.querySelectorAll('.rb-blk[data-mv]')].filter((b) => { const r = b.getBoundingClientRect(); return r.width >= 14 && r.left > 200 && r.right < window.innerWidth - 20 && r.top > 120 && r.bottom < window.innerHeight - 100; });
    const b = blks[0];
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const rows = [...document.querySelectorAll('.rb-row')].filter((x) => x.getAttribute('data-row') !== b.getAttribute('data-c'));
    const same = rows.filter((x) => { const y = x.getBoundingClientRect(); return y.top > r.bottom && y.bottom < window.innerHeight - 90; });
    const t = (same[1] ?? same[0])?.getBoundingClientRect();
    if (!t) return null;
    return { x: r.left + Math.min(r.width / 2, 20), y: r.top + r.height / 2, tx: r.left + Math.min(r.width / 2, 20) + 30, ty: t.top + t.height / 2 };
  });
}

/** CDP long-press drag: press, hold 550 ms, move in steps; `end` drops (touchEnd) or leaves it held. */
async function touchDrag(page, p, end) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(p.x, p.y) });
  await sleep(550);
  const n = 12;
  for (let i = 1; i <= n; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(p.x + ((p.tx - p.x) * i) / n, p.y + ((p.ty - p.y) * i) / n) });
    await sleep(30);
  }
  await sleep(250);
  if (end) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return cdp;
}

/** Crew ids for a conversion: up to 12 pilots and 21 cabin crew rated on the first fleet type, none on notice. */
const convertIds = (page) => page.evaluate(() => {
  const g = window.__contrail.game;
  const crew = Object.values(g.crew).filter((c) => !c.notice && c.status !== 'joining' && c.status !== 'training');
  const pil = crew.filter((c) => ['CPT', 'FO', 'CRP'].includes(c.role)).slice(0, 12);
  const cab = crew.filter((c) => !['CPT', 'FO', 'CRP'].includes(c.role)).slice(0, 21);
  return [...pil, ...cab].map((c) => c.id);
});

async function ensureConversion(page, desktop) {
  const has = await page.evaluate(() => Object.values(window.__contrail.game.classes || {}).some((k) => k.status === 'planned' || k.status === 'running'));
  if (has) return;
  const ids = await convertIds(page);
  await modal(page, { kind: 'convert', crewIds: ids, family: 'A330/340' });
  await press(page, page.locator('.modal-foot .btn-primary'), desktop);
  await settle(page, 500);
  // v0.7: red warnings turn Book into a two-step confirm.
  const anyway = page.getByRole('button', { name: /Book anyway/ });
  if (await anyway.count()) { await press(page, anyway.first(), desktop); await settle(page, 500); }
  await quiet(page);
}

Object.assign(ACTIONS, {
  'crew-board': (page) => board(page),
  'crew-board-month': (page) => board(page, 'Month'),
  'board-drag': async (page) => {
    await board(page);
    const p = await dragPoints(page);
    if (!p) throw new Error('SKIP no movable duty on the board');
    const cdp = await touchDrag(page, p, false);
    await settle(page, 200);
    // Shot taken while held; the drop happens in the next screen's setup.
    page.__heldDrag = cdp;
  },
  'board-popover': async (page, _s, d) => {
    if (page.__heldDrag) { await page.__heldDrag.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {}); page.__heldDrag = null; await settle(page, 300); await quiet(page); }
    await board(page);
    const off = page.locator('.rb-blk.k-off, .rb-blk.k-training, .rb-blk.k-joining').first();
    if (!(await off.count())) throw new Error('SKIP no status block');
    await press(page, off, d);
    await settle(page, 300);
  },
  'crew-select': async (page, _s, d) => {
    await nav(page, 'crew', { view: 'people' });
    await press(page, page.locator('.sc-head-tools .btn', { hasText: 'Select' }), d);
    await settle(page, 300);
    for (let i = 0; i < 4; i++) await press(page, page.locator('.sc-crew-row').nth(i), d);
    await settle(page, 300);
  },
  'convert-modal': async (page) => {
    const ids = await convertIds(page);
    await nav(page, 'crew', { view: 'people' });
    await modal(page, { kind: 'convert', crewIds: ids, family: 'A330/340' });
  },
  'classes-modal': async (page, _s, d) => {
    await nav(page, 'crew', { view: 'people' });
    await ensureConversion(page, d);
    await modal(page, { kind: 'classes' });
  },
  'crew-converting': async (page, _s, d) => {
    await ensureConversion(page, d);
    // Play into the first class so the strip and the list show 'Conversion A330'.
    const start = await page.evaluate(() => Math.min(...Object.values(window.__contrail.game.classes).filter((k) => k.status !== 'cancelled').map((k) => k.start)));
    if (!Number.isFinite(start)) throw new Error('SKIP no conversion class booked');
    const days = await page.evaluate((s) => Math.min(60, Math.max(0, Math.ceil((s - window.__contrail.game.now) / 1440)) + 2), start);
    await page.evaluate((n) => window.__contrail.dev.autoplay(n), days);
    await quiet(page);
    const id = await page.evaluate(() => Object.values(window.__contrail.game.classes).find((k) => k.status === 'running')?.crewIds[0]);
    await nav(page, 'crew', { view: 'people', sel: id ? { kind: 'crew', id } : undefined });
  },
  'board-converting': (page) => board(page, 'Month'),
  'crew-morale': async (page, _s, d) => {
    await nav(page, 'crew', { view: 'people' });
    await press(page, page.locator('.sc-morale-chip'), d);
    await settle(page, 300);
  },
  'crew-notice': async (page) => {
    const id = await page.evaluate(() => window.__contrail.dev.resign(Object.values(window.__contrail.game.crew).find((c) => c.role === 'FO' && !c.notice && c.status !== 'training')?.id));
    await quiet(page);
    await nav(page, 'crew', { view: 'people', sel: id ? { kind: 'crew', id } : undefined });
  },
  'train-modal': async (page) => {
    const id = await pick(page, () => Object.values(window.__contrail.game.crew).find((c) => c.role === 'FO' && !c.notice)?.id);
    await nav(page, 'crew', { view: 'people' });
    await modal(page, { kind: 'train', crewId: id });
  },
  'company-policies': async (page) => {
    await nav(page, 'company');
    await page.evaluate(() => document.querySelector('.sc-policy-sum')?.scrollIntoView({ block: 'center' }));
    await settle(page, 300);
  },
  'fleet-extra': async (page, _s, d) => {
    // v0.8: a leased-out aircraft has no crew block (no crew from us).
    const id = await pick(page, () => { const f = Object.values(window.__contrail.game.fleet); return (f.find((a) => a.status !== 'leasedOut' && a.status !== 'delivering') ?? f[0]).id; });
    await nav(page, 'fleet', { sel: { kind: 'aircraft', id } });
    await page.evaluate(() => document.querySelector('.sc-ac-crew')?.scrollIntoView({ block: 'center' }));
    const card = page.locator(`.sc-ac[data-ac="${id}"] .sc-ac-crew`);
    // Both A320s dry-leased out (seen at 1180×750, day 49): no crew block anywhere, nothing to press.
    if (!(await card.count())) throw new Error('SKIP every aircraft is leased out or delivering: no crew block');
    const x = await page.evaluate((a) => window.__contrail.game.fleet[a].crewExtra, id);
    if (!x || x.cabin < 2) {
      await press(page, card.locator('button[aria-label="Increase"]'), d);
      await settle(page, 200);
      await press(page, card.locator('button[aria-label="Increase"]'), d);
      await settle(page, 200);
      await press(page, card.locator('.toggle'), d);
    }
    await quiet(page);
    await settle(page, 400);
  },
  'offer-extra': async (page, _s, d) => {
    await nav(page, 'contracts', { view: 'market' });
    let ok = false;
    for (let i = 0; i < 80 && !ok; i++) {
      ok = await page.evaluate((a) => { const s = window.__contrail; const id = s.dev.offer(a); return !!id && !!s.game.offers[id]?.requirements.extraCabinPaid; }, ['vip', 'seasonBase', 'adhoc', 'capacityLease'][i % 4]);
    }
    if (!ok) throw new Error('SKIP no offer with paid extra crew');
    await settle(page, 600);
    await page.evaluate(() => document.querySelector('.sc-extra-card')?.scrollIntoView({ block: 'center' }));
    const t = page.locator('.sc-extra-paid .toggle');
    if (!(await t.getAttribute('aria-pressed').then((v) => v === 'true'))) await press(page, t, d);
    await settle(page, 400);
  },
  'contracts-extra': (page) => nav(page, 'contracts', { view: 'active' }),
  // ---------- v0.7 fleet & ladder ----------
  'convert-confirm': async (page, _s, d) => {
    const ids = await convertIds(page);
    await nav(page, 'crew', { view: 'people' });
    await modal(page, { kind: 'convert', crewIds: ids, family: 'A330/340' });
    const b = page.locator('.modal-foot .btn-primary');
    if (!/Review/.test(await b.textContent())) throw new Error('SKIP no red warning for this selection');
    // v0.9 round 3: Review is disabled when the course costs more than the cash: pressing it only timed out.
    if (await b.isDisabled()) throw new Error('SKIP Review disabled (not enough cash for the course)');
    await press(page, b, d);
    await settle(page, 400);
  },
  'fleet-market': async (page) => {
    await page.evaluate(() => {
      const s = window.__contrail;
      const g = s.game;
      if (!g.market.aircraft.some((o) => o.site === 'SCL' && o.expires > g.now)) s.dev.marketOffer('a332', { site: 'SCL' });
      s.dev.marketOffer('a321neo', { newBuild: true });
      s.dev.marketOffer('a320ceo', { kind: 'buy' });
    });
    await quiet(page);
    await nav(page, 'fleet', { view: 'market' });
  },
  'acquire-modal': async (page) => {
    const id = await pick(page, () => { const g = window.__contrail.game; return g.market.aircraft.find((o) => o.kind === 'buy' && o.expires > g.now)?.id; });
    if (!id) throw new Error('SKIP no offer to buy');
    await nav(page, 'fleet', { view: 'market' });
    await modal(page, { kind: 'acquire', offerId: id });
  },
  'company-ladder': (page) => nav(page, 'company', { view: 'ladder' }),
  'approval-modal': async (page) => { await nav(page, 'company'); await modal(page, { kind: 'approval', id: 'widebody' }); },
  'ladder-step': async (page) => {
    await nav(page, 'company');
    await page.evaluate(() => { const s = window.__contrail; s.game.company.cash += 8e6; s.dev.grant('widebody'); s.toasts = []; s.emit(); });
    await settle(page, 700);
  },
  'acquire-widebody': async (page) => {
    const id = await pick(page, () => { const g = window.__contrail.game; return g.market.aircraft.find((o) => o.typeId === 'a332' && o.expires > g.now)?.id; });
    if (!id) throw new Error('SKIP no A330 offer');
    await nav(page, 'fleet', { view: 'market' });
    await modal(page, { kind: 'acquire', offerId: id });
  },
  'fleet-delivering': async (page, _s, d) => {
    // Signs the A330 offer through the dialog (the harness closes dialogs between screens).
    const offer = await pick(page, () => { const g = window.__contrail.game; return g.market.aircraft.find((o) => o.typeId === 'a332' && o.expires > g.now)?.id; });
    if (offer) {
      await modal(page, { kind: 'acquire', offerId: offer });
      await press(page, page.locator('.modal-foot .btn-primary'), d);
      await settle(page, 500);
    }
    const id = await pick(page, () => Object.values(window.__contrail.game.fleet).find((a) => a.delivery && !a.delivery.arrived)?.id);
    if (!id) throw new Error('SKIP nothing delivering');
    await quiet(page);
    await nav(page, 'fleet', { sel: { kind: 'aircraft', id } });
  },
  'schedule-delivering': async (page) => {
    const id = await pick(page, () => Object.values(window.__contrail.game.fleet).find((a) => a.delivery && !a.delivery.arrived)?.id);
    if (!id) throw new Error('SKIP nothing delivering');
    await nav(page, 'schedule', { sel: { kind: 'aircraft', id } });
  },
  'refit-modal': async (page) => {
    const id = await pick(page, () => Object.values(window.__contrail.game.fleet).find((a) => a.status !== 'delivering' && a.status !== 'leasedOut' && a.cabin.layout !== 'vip')?.id);
    if (!id) throw new Error('SKIP no aircraft to refit');
    await nav(page, 'fleet', { sel: { kind: 'aircraft', id } });
    await modal(page, { kind: 'refit', aircraftId: id, layout: 'vip' });
  },
  'fleet-refit': async (page, _s, d) => {
    const ac = await pick(page, () => Object.values(window.__contrail.game.fleet).find((a) => a.status !== 'delivering' && a.status !== 'leasedOut' && a.cabin.layout !== 'vip')?.id);
    if (ac) {
      await modal(page, { kind: 'refit', aircraftId: ac, layout: 'vip' });
      await press(page, page.locator('.modal-foot .btn-primary'), d);
      await settle(page, 500);
    }
    const id = await pick(page, () => Object.values(window.__contrail.game.maintenance).find((m) => m.kind === 'refit' && m.status === 'planned')?.aircraftId);
    if (!id) throw new Error('SKIP no refit booked');
    await quiet(page);
    await nav(page, 'fleet', { sel: { kind: 'aircraft', id } });
  },
  'schedule-refit': async (page) => {
    const m = await pick(page, () => { const m = Object.values(window.__contrail.game.maintenance).find((x) => x.kind === 'refit' && x.status === 'planned'); return m && { id: m.aircraftId, t: m.start }; });
    if (!m) throw new Error('SKIP no refit booked');
    await nav(page, 'schedule', { sel: { kind: 'aircraft', id: m.id }, view: String(m.t) });
  },
  'lease-modal': async (page) => {
    const id = await pick(page, () => Object.values(window.__contrail.game.fleet).find((a) => a.ownership.kind === 'dryLeaseIn')?.id);
    if (!id) throw new Error('SKIP no leased aircraft');
    await nav(page, 'fleet', { sel: { kind: 'aircraft', id } });
    await modal(page, { kind: 'lease', aircraftId: id });
  },
  // v0.7.2 F2: the market alert toggles moved from Settings to Fleet → Market.
  'market-toggles': (page) => nav(page, 'fleet', { view: 'market' }),
  'inbox-market': async (page, _s, d) => {
    await nav(page, 'inbox');
    const tab = page.getByRole('tab', { name: /^Market/ });
    if (await tab.count()) await press(page, tab.first(), d);
    await settle(page, 400);
  },
  'duty-extra': async (page) => {
    const id = await pick(page, () => { const g = window.__contrail.game; const ac = Object.values(g.fleet).find((a) => a.crewExtra); const l = Object.values(g.flights).filter((f) => f.status === 'scheduled' && f.aircraftId === ac?.id && f.dutyId && f.std > g.now + 600).sort((a, b) => a.std - b.std); return l[0]?.id; });
    if (!id) throw new Error('SKIP no rostered flight on an aircraft with extra crew');
    await nav(page, 'schedule');
    await modal(page, { kind: 'duty', id });
    await page.evaluate(() => document.querySelector('.sc-chip-extra, .sc-seat.above')?.scrollIntoView({ block: 'center' }));
    await settle(page, 300);
  },
});

// ---------- v0.7.1 crew control + plain language ----------

/** A flight the crew-shortage ladder has marked (empties the next flight's pilot seats once); returns its id. */
async function ensureShortage(page) {
  const find = () => page.evaluate(() => { const g = window.__contrail.game; return Object.values(g.flights).filter((f) => f.crewAlert && f.status === 'scheduled' && f.aircraftId && f.crewIds.length === 0).sort((a, b) => a.std - b.std)[0]?.id; });
  let id = await find();
  for (const h of [10, 24, 48]) {
    if (id) break;
    id = await page.evaluate((hours) => window.__contrail.dev.crewShortage(hours) || undefined, h);
  }
  if (!id) throw new Error('SKIP no flight to make crew-short');
  await quiet(page);
  return id;
}

Object.assign(ACTIONS, {
  'crew-control': async (page) => {
    const id = await ensureShortage(page);
    await nav(page, 'schedule');
    await modal(page, { kind: 'crewControl', flightId: id });
  },
  'crew-control-jet': async (page) => {
    const id = await ensureShortage(page);
    await nav(page, 'schedule');
    await modal(page, { kind: 'crewControl', flightId: id, fix: 'jet' });
    await page.evaluate(() => document.querySelector('.cc-row.open')?.scrollIntoView({ block: 'start' }));
    await settle(page, 300);
  },
  'problem-modal': async (page) => {
    const id = await ensureShortage(page);
    await nav(page, 'schedule');
    await modal(page, { kind: 'problem', subject: { kind: 'crewShort', ref: { kind: 'flight', id } } });
  },
  'inbox-problems': async (page, _s, d) => {
    await ensureShortage(page);
    await nav(page, 'inbox');
    const tab = page.getByRole('tab', { name: /^Problems only/ });
    if (await tab.count()) await press(page, tab.first(), d);
    await settle(page, 300);
    const ex = page.locator('.sc-explain').first();
    if (await ex.count()) await press(page, ex, d);
    await settle(page, 500);
  },
  glossary: (page) => modal(page, { kind: 'glossary', term: 'fdp' }),
  'duty-gauges': async (page) => {
    const id = await ensureShortage(page);
    await nav(page, 'schedule');
    await modal(page, { kind: 'duty', id });
  },
  'schedule-why': async (page) => {
    const id = await ensureShortage(page);
    const f = await page.evaluate((x) => { const f = window.__contrail.game.flights[x]; return { ac: f.aircraftId, t: f.std }; }, id);
    await nav(page, 'schedule', { sel: { kind: 'aircraft', id: f.ac }, view: String(f.t - 6 * 60) });
    await modal(page, { kind: 'sheet', refs: [{ kind: 'flight', id }] });
  },
  'term-popover': async (page, _s, d) => {
    // The duty modal always carries one term (FDP in its header); the card's own terms depend on the cause.
    const id = await ensureShortage(page);
    await nav(page, 'schedule');
    await modal(page, { kind: 'duty', id });
    const t = page.locator('.modal .term').first();
    if (!(await t.count())) throw new Error('SKIP no glossary term on the card');
    await press(page, t, d);
    await settle(page, 300);
  },
  hint: async (page) => {
    const id = await ensureShortage(page);
    await nav(page, 'schedule');
    await modal(page, { kind: 'problem', subject: { kind: 'crewShort', ref: { kind: 'flight', id } }, hint: true });
  },
  'fleet-short': async (page) => {
    const id = await ensureShortage(page);
    const ac = await page.evaluate((x) => window.__contrail.game.flights[x].aircraftId, id);
    await nav(page, 'fleet', { sel: { kind: 'aircraft', id: ac } });
  },
  'settings-glossary': async (page) => {
    await modal(page, { kind: 'settings' });
    await page.evaluate(() => [...document.querySelectorAll('.set-head')].find((e) => /Plain/.test(e.textContent))?.scrollIntoView({ block: 'start' }));
    await settle(page, 300);
  },
});

// ---------- v0.7.2 crew rules & fleet ----------

Object.assign(ACTIONS, {
  'topbar-strip': (page) => nav(page, 'map'),
  'topbar-strip-warnings': async (page) => {
    await page.evaluate(() => { const s = window.__contrail; s.dev.marketOffer(); s.closeModal(); });
    await ensureShortage(page);
    await quiet(page);
    await nav(page, 'map');
  },
  'hire-multitype': async (page, _s, d) => {
    await nav(page, 'crew');
    await modal(page, { kind: 'hire', role: 'CC' });
    for (const t of ['A330', '777']) {
      const b = page.locator('.hm-tick', { hasText: t }).first();
      if (await b.count()) await press(page, b, d);
    }
    await settle(page, 300);
  },
  'refit-earliest': async (page) => {
    // An aircraft with no planned or running refit (fleet-refit books one on the first), so the earliest slots show.
    const id = await pick(page, () => {
      const g = window.__contrail.game;
      const booked = new Set(Object.values(g.maintenance).filter((m) => m.kind === 'refit' && (m.status === 'planned' || m.status === 'inWork')).map((m) => m.aircraftId));
      const free = Object.values(g.fleet).filter((a) => a.status !== 'delivering' && !a.returning && !a.sale && !booked.has(a.id));
      return (free.find((a) => a.at === g.company.homeBase) ?? free[0])?.id;
    });
    if (!id) throw new Error('SKIP no aircraft without a refit');
    await nav(page, 'fleet', { sel: { kind: 'aircraft', id } });
    await modal(page, { kind: 'refit', aircraftId: id });
  },
  'refit-booked': async (page) => {
    const id = await pick(page, () => Object.values(window.__contrail.game.maintenance).find((m) => m.kind === 'refit' && m.status === 'planned')?.aircraftId);
    if (!id) throw new Error('SKIP no refit booked (run fleet-refit first)');
    await nav(page, 'fleet', { sel: { kind: 'aircraft', id } });
    await modal(page, { kind: 'refit', aircraftId: id });
  },
  'flight-sheet-rest-seats': async (page) => {
    const id = await page.evaluate(() => window.__contrail.dev.restSeats());
    if (!id) throw new Error('SKIP no rest-seats flight');
    await settle(page, 600);
  },
  'refit-rest-seats': async (page) => {
    const ac = await pick(page, () => { const g = window.__contrail.game; return Object.values(g.fleet).find((a) => a.typeId.startsWith('a33') && a.rest && a.rest.fc?.cls !== 1)?.id; });
    if (!ac) throw new Error('SKIP no widebody without bunks');
    await nav(page, 'fleet', { sel: { kind: 'aircraft', id: ac } });
    await modal(page, { kind: 'refit', aircraftId: ac, rest: true });
  },
  sell: async (page) => {
    const id = await page.evaluate(() => window.__contrail.dev.saleReady());
    if (!id) throw new Error('SKIP no owned aircraft');
    await settle(page, 600);
  },
  'return-early': async (page) => {
    const id = await pick(page, () => Object.values(window.__contrail.game.fleet).find((a) => a.ownership.kind === 'dryLeaseIn' && !a.returning)?.id);
    if (!id) throw new Error('SKIP no leased aircraft');
    await nav(page, 'fleet', { sel: { kind: 'aircraft', id } });
    await modal(page, { kind: 'lease', aircraftId: id, tab: 'early' });
  },
  'which-one': async (page, _s, d) => {
    await nav(page, 'fleet');
    const b = page.getByRole('button', { name: /Which one/ });
    if (!(await b.count())) throw new Error('SKIP one aircraft only');
    await press(page, b.first(), d);
    await settle(page, 500);
  },
  'check-hub': async (page) => {
    const id = await pick(page, () => Object.values(window.__contrail.game.fleet).find((a) => a.status !== 'delivering' && !a.sale)?.id);
    if (!id) throw new Error('SKIP no aircraft');
    await nav(page, 'fleet', { sel: { kind: 'aircraft', id } });
    await modal(page, { kind: 'check', aircraftId: id, checkKind: 'C' });
  },
  'whats-new-072': (page) => modal(page, { kind: 'whatsNew' }),
});

// ---------- v0.7.3 in-flight rest & EASA ----------

/** The A330 with business-seat rest and its augmented long-haul (dev.restPlan, built once); closes the sheet it opens. */
async function ensureRestPlan(page) {
  const r = await page.evaluate(() => {
    const s = window.__contrail;
    let id = s.__restFlight && s.game.flights[s.__restFlight] ? s.__restFlight : '';
    if (!id) { id = s.dev.restPlan(); s.__restFlight = id; }
    s.closeModal();
    const f = id ? s.game.flights[id] : null;
    return f ? { flightId: id, aircraftId: f.aircraftId, dutyId: f.dutyId } : null;
  });
  if (!r) throw new Error('SKIP dev.restPlan built nothing');
  await settle(page, 400);
  return r;
}

Object.assign(ACTIONS, {
  'fleet-rest': async (page) => {
    const r = await ensureRestPlan(page);
    await nav(page, 'fleet', { sel: { kind: 'aircraft', id: r.aircraftId } });
  },
  'market-rest-filter': async (page, _s, d) => {
    await page.evaluate(() => { const s = window.__contrail; s.dev.marketOffer('a332'); s.dev.marketOffer('b77w'); s.dev.marketOffer('a333'); s.closeModal(); });
    await nav(page, 'fleet', { view: 'market' });
    await press(page, page.locator('.mk-filter').first(), d);
    await settle(page, 400);
  },
  'flight-sheet-rest': async (page) => {
    const r = await ensureRestPlan(page);
    await modal(page, { kind: 'sheet', refs: [{ kind: 'flight', id: r.flightId }] });
  },
  'flight-sheet-rest-tooshort': async (page) => {
    const id = await page.evaluate(() => window.__contrail.dev.shortCruise());
    if (!id) throw new Error('SKIP dev.shortCruise built nothing');
    await settle(page, 700);
  },
  'duty-why': async (page, _s, d) => {
    const r = await ensureRestPlan(page);
    await modal(page, { kind: 'duty', id: r.dutyId ?? r.flightId });
    const why = page.locator('.dm-why-btn').first();
    if (await why.count()) await press(page, why, d);
    const rest = page.locator('.dm-rest-toggle').first();
    if (await rest.count()) await press(page, rest, d);
    await settle(page, 400);
  },
  'offer-rest-lines': async (page, _s, d) => {
    await ensureRestPlan(page);
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      await page.evaluate((k) => { const s = window.__contrail; s.closeModal(); s.dev.offer(['troopRotation', 'hajj', 'repatriation', 'unRotation', 'sports', 'capacityLease', 'humanitarian', 'tourSeries'][k % 8]); }, i);
      await settle(page, 300);
      found = (await page.locator('.sc-offer-modal .of-rest').count()) > 0;
    }
    // No long-haul job came up: show any offer with the A330's rest check line expanded.
    if (!found) {
      const ac = (await ensureRestPlan(page)).aircraftId;
      await page.evaluate(() => { const s = window.__contrail; s.dev.offer('troopRotation'); });
      await settle(page, 500);
      const reg = await page.evaluate((id) => window.__contrail.game.fleet[id]?.reg, ac);
      const row = page.locator('.sc-feas-head', { hasText: reg }).first();
      if (await row.count()) { await press(page, row, d); await settle(page, 400); }
    }
  },
  'refit-crew-rest': async (page) => {
    const r = await ensureRestPlan(page);
    await nav(page, 'fleet', { sel: { kind: 'aircraft', id: r.aircraftId } });
    await modal(page, { kind: 'refit', aircraftId: r.aircraftId, section: 'rest' });
  },
  'check-c-restfit': async (page) => {
    const r = await ensureRestPlan(page);
    await nav(page, 'fleet', { sel: { kind: 'aircraft', id: r.aircraftId } });
    await modal(page, { kind: 'check', aircraftId: r.aircraftId, checkKind: 'C', restFit: 'fcrc' });
  },
  'roster-board-aug': async (page) => {
    await ensureRestPlan(page);
    await board(page);
    const sel = page.locator('select[aria-label="Type"]');
    if (await sel.count()) { await sel.selectOption('A330/340').catch(() => {}); await settle(page, 600); }
  },
  'crew-control-standby': async (page, _s, d) => {
    const id = await page.evaluate(() => window.__contrail.dev.standby());
    if (!id) throw new Error('SKIP dev.standby built nothing');
    await settle(page, 700);
    const row = page.locator('[data-fix="callIn"] .cc-row-head').first();
    if (await row.count()) { await press(page, row, d); await settle(page, 400); }
  },
  'whats-new-073': (page) => modal(page, { kind: 'whatsNew' }),
});

// ---------- v0.8 World ----------

/** Opens a dev offer (dev.hajj, dev.dryLease…) on the Contracts market; SKIP when the engine built none. */
async function devOffer(page, name) {
  const id = await page.evaluate((n) => { const s = window.__contrail; s.closeModal(); return s.dev[n](); }, name);
  if (!id) throw new Error(`SKIP dev.${name} built nothing`);
  await settle(page, 700);
  return id;
}

/** A signed mixed-crew contract: dev.mixedCrew, else a season base given 'all but the purser' signed through the offer
 *  dialog (shots only); returns one of its duty ids. */
async function ensureMixed(page, d) {
  let id = await page.evaluate(() => {
    const s = window.__contrail; s.closeModal();
    if (s.__mixed && s.game.duties[s.__mixed]) return s.__mixed;
    const id = s.dev.mixedCrew(); s.closeModal();
    return (s.__mixed = id);
  });
  for (let i = 0; !id && i < 14; i++) {
    const oid = await page.evaluate((k) => {
      const s = window.__contrail; s.closeModal();
      const id = s.dev.offer(['seasonBase', 'aogCover'][k % 2]);
      const o = id && s.game.offers[id];
      if (!o || o.product.kind !== 'wet') return '';
      o.requirements.clientCabin = { n: 3, of: 4, leads: false };
      s.closeModal(); s.openModal({ kind: 'offer', offerId: id });
      return id;
    }, i);
    if (!oid) continue;
    await settle(page, 500);
    const btn = page.locator('.sc-offer-foot .btn-primary');
    if (!(await btn.isEnabled().catch(() => false))) continue;
    await press(page, btn, d);
    await settle(page, 600);
    id = await page.evaluate((x) => {
      const s = window.__contrail; s.closeModal();
      const g = s.game;
      const k = Object.values(g.contracts).find((c) => c.offerId === x);
      const ds = k ? Object.values(g.pairings).filter((q) => q.contractId === k.id).flatMap((q) => q.dutyIds) : [];
      const rev = ds.find((id) => g.duties[id]?.flightIds.some((f) => g.flights[f]?.kind === 'revenue'));
      return (s.__mixed = rev ?? ds[0] ?? '');
    }, oid);
  }
  if (!id) throw new Error('SKIP no mixed-crew contract could be signed');
  await settle(page, 400);
  return id;
}

/** The Schedule scrolled to t (minutes) at a zoom. */
async function scheduleAt(page, d, t, sel, zoom) {
  await nav(page, 'schedule', { sel: sel ? { kind: 'aircraft', id: sel } : undefined, view: String(t) });
  if (zoom) await press(page, page.locator('.sc-schedule .seg button', { hasText: zoom }), d).catch(() => {});
  await settle(page, 500);
}

Object.assign(ACTIONS, {
  'company-clients': async (page) => {
    await page.evaluate(() => { const s = window.__contrail; s.closeModal(); s.dev.level(undefined, 'trusted'); });
    await settle(page, 600);
  },
  'company-client-unhappy': async (page) => {
    await page.evaluate(() => {
      const s = window.__contrail; s.closeModal();
      const c = Object.values(s.game.clients).find((x) => x.kind !== 'airline' && !x.rivalId) ?? Object.values(s.game.clients)[1];
      s.dev.level(c.id, 'unhappy');
    });
    await settle(page, 600);
  },
  'company-rivals': (page) => nav(page, 'company', { view: 'rivals' }),
  'contracts-head-standing-outlook': (page) => nav(page, 'contracts', { view: 'market' }),
  'offer-trusted-first-refusal': async (page) => {
    const id = await page.evaluate(() => {
      const s = window.__contrail; s.closeModal();
      const o = Object.values(s.game.offers).find((x) => x.status === 'open');
      if (!o) return '';
      s.dev.level(o.clientId, 'trusted');
      o.firstRefusal = true; o.levelPct = 0.08;
      return o.id;
    });
    if (!id) throw new Error('SKIP no open offer');
    await nav(page, 'contracts', { view: 'market' });
    await modal(page, { kind: 'offer', offerId: id });
  },
  'offer-rivals-bidding': (page) => devOffer(page, 'rivalBid'),
  'offer-hajj': (page) => devOffer(page, 'hajj'),
  'offer-deportation-moral': (page) => devOffer(page, 'deportation'),
  'offer-mixed-crew': async (page) => {
    const id = await page.evaluate(() => {
      const s = window.__contrail; s.closeModal();
      for (let i = 0; i < 40; i++) {
        const oid = s.dev.offer(['seasonBase', 'aogCover', 'capacityLease'][i % 3]);
        s.closeModal();
        const o = oid && s.game.offers[oid];
        if (o && o.requirements.clientCabin) return oid;
      }
      // None rolled: give the first wet offer the 'all but the purser' split (shots only).
      const o = Object.values(s.game.offers).find((x) => x.status === 'open' && x.product.kind === 'wet');
      if (!o) return '';
      o.requirements.clientCabin = { n: 3, of: 4, leads: false };
      return o.id;
    });
    if (!id) throw new Error('SKIP no wet offer');
    await nav(page, 'contracts', { view: 'market' });
    await modal(page, { kind: 'offer', offerId: id });
  },
  'outlook-modal': async (page) => { await nav(page, 'contracts', { view: 'market' }); await modal(page, { kind: 'outlook' }); },
  'subcharter-3-quotes': async (page) => {
    const r = await pick(page, () => { const g = window.__contrail.game; const f = Object.values(g.flights).filter((x) => x.status === 'scheduled' && x.contractId && x.kind === 'revenue' && x.std > g.now + 12 * 60).sort((a, b) => a.std - b.std)[0]; return f ? { c: f.contractId, f: f.id } : null; });
    if (!r) throw new Error('SKIP no flight to hand over');
    await nav(page, 'contracts', { view: 'active' });
    await modal(page, { kind: 'subcharter', contractId: r.c, flightId: r.f });
  },
  'inbox-world-event': async (page) => {
    await page.evaluate(() => { const s = window.__contrail; s.dev.world('war'); s.closeModal(); });
    await nav(page, 'inbox');
  },
  'world-event-modal': async (page) => {
    const id = await page.evaluate(() => { const s = window.__contrail; const e = (s.game.world?.events ?? []).filter((x) => !x.done).at(-1); return e?.id ?? s.dev.world('coup'); });
    if (!id) throw new Error('SKIP no world event');
    await modal(page, { kind: 'worldEvent', eventId: id });
  },
  'client-modal': async (page) => {
    const id = await pick(page, () => Object.values(window.__contrail.game.clients).find((c) => (c.jobs ?? 0) > 0 || c.level === 'trusted')?.id);
    if (!id) throw new Error('SKIP no client');
    await modal(page, { kind: 'client', clientId: id });
  },
  'schedule-programme-continues': async (page, _s, d) => {
    const r = await page.evaluate(() => {
      const s = window.__contrail; s.closeModal();
      const k = Object.values(s.game.contracts).find((c) => c.pattern.kind === 'base' && (c.status === 'active' || c.status === 'signed') && c.generatedUntil < c.pattern.to);
      return k ? { t: k.generatedUntil - 2 * 1440, ac: k.aircraftIds[0] } : null;
    });
    if (!r) throw new Error('SKIP no base programme still being generated');
    await scheduleAt(page, d, r.t, r.ac, '7 days');
  },
  'offer-dry-lease': async (page) => {
    const id = await devOffer(page, 'dryLease');
    await page.evaluate((x) => { window.__contrail.__dryOffer = x; }, id);
  },
  'schedule-dry-lease': async (page, _s, d) => {
    // Sign the dry lease shown above (the offer dialog's Accept), then the Gantt with its lease block.
    let open = await page.evaluate(() => { const s = window.__contrail; const id = s.__dryOffer; return !!id && s.game.offers[id]?.status === 'open'; });
    if (!open) {
      const id = await devOffer(page, 'dryLease');
      await page.evaluate((x) => { window.__contrail.__dryOffer = x; }, id);
      open = true;
    } else await page.evaluate(() => { const s = window.__contrail; s.openModal({ kind: 'offer', offerId: s.__dryOffer }); });
    await settle(page, 600);
    const btn = page.locator('.sc-offer-foot .btn-primary');
    if (!(await btn.isEnabled().catch(() => false))) throw new Error('SKIP dry lease cannot be signed');
    await press(page, btn, d);
    await settle(page, 600);
    const r = await page.evaluate(() => { const s = window.__contrail; s.closeModal(); const k = Object.values(s.game.contracts).find((c) => c.dry); return k ? { ac: k.aircraftIds[0], t: k.start - 4 * 1440 } : null; });
    if (!r) throw new Error('SKIP no dry lease signed');
    await scheduleAt(page, d, r.t, r.ac, '28 days');
  },
  'fleet-dry-lease': async (page) => {
    const ac = await pick(page, () => Object.values(window.__contrail.game.contracts).find((c) => c.dry)?.aircraftIds[0] ?? '');
    if (!ac) throw new Error('SKIP no dry lease');
    await nav(page, 'fleet', { sel: { kind: 'aircraft', id: ac } });
  },
  'roster-board-client-crew': async (page, _s, d) => {
    await ensureMixed(page, d);
    await board(page);
    await page.evaluate(() => { const el = document.querySelector('.rb-scroll'); if (el) el.scrollTop = el.scrollHeight; });
    await settle(page, 600);
  },
  'duty-client-seats': async (page, _s, d) => {
    const id = await ensureMixed(page, d);
    await modal(page, { kind: 'duty', id });
  },
  'whats-new-08': (page) => modal(page, { kind: 'whatsNew' }),
});

// ---------- v0.9 Experience ----------
/** The DUB tour crew from dev.roster() (built once per run). */
async function ensureRoster(page) {
  return page.evaluate(() => { const s = window.__contrail; if (!s.__dub) s.__dub = s.dev.roster(); return s.__dub; });
}
/** A flight in crew out of hours (dev.crewHours), once per run. */
async function ensureHours(page) {
  const id = await page.evaluate(() => { const s = window.__contrail; const f = s.__ooh && s.game.flights[s.__ooh]; if (!f || f.status !== 'scheduled') s.__ooh = s.dev.crewHours(); return s.__ooh; });
  if (!id) throw new Error('SKIP dev.crewHours built nothing');
  await quiet(page);
  return id;
}
async function hireHead(page, id) {
  // Unlock (dev), then hire the middle candidate through the celebration card.
  await page.evaluate((h) => { const s = window.__contrail; s.dev.head(h); s.modal = null; s.openModal({ kind: 'headUnlocked', id: h }); }, id);
  await settle(page, 400);
  const btn = page.locator('.v9-cand .btn-primary').nth(1);
  if (await btn.count()) await btn.click();
  await settle(page, 400);
  await quiet(page);
}

Object.assign(ACTIONS, {
  'roster-board-standby': async (page) => {
    await ensureRoster(page);
    await quiet(page);
    await board(page);
  },
  'roster-board-month-summary': async (page) => { await ensureRoster(page); await quiet(page); await board(page, 'Month'); },
  'roster-offbreak-confirm': async (page) => {
    await ensureRoster(page);
    await quiet(page);
    const id = await page.evaluate(() => window.__contrail.dev.offBreak());
    if (!id) throw new Error('SKIP no move breaks a published day off');
    await settle(page, 600);
  },
  'crew-person-month': async (page) => {
    const id = await ensureRoster(page);
    await quiet(page);
    await nav(page, 'crew', { view: 'people', sel: { kind: 'crew', id } });
  },
  'crew-control-standby-kinds': async (page, _s, d) => {
    const id = await page.evaluate(() => window.__contrail.dev.crewShortage(10));
    if (!id) throw new Error('SKIP no crew shortage');
    await page.evaluate((f) => { const s = window.__contrail; s.modal = null; s.openModal({ kind: 'crewControl', flightId: f, fix: 'callIn' }); }, id);
    await settle(page, 700);
  },
  'crewplan-sets-why': (page) => nav(page, 'crew', { view: 'plan' }),
  'crewplan-verdict': async (page) => { await nav(page, 'crew', { view: 'plan' }); await page.evaluate(() => { const el = document.querySelector('.cp-verdict'); el?.scrollIntoView({ block: 'center' }); }); await settle(page, 300); },
  'company-team-locked': (page) => nav(page, 'company', { view: 'team', sel: { kind: 'head', id: 'watch' } }),
  'head-unlocked-card': async (page) => {
    await page.evaluate(() => { const s = window.__contrail; s.dev.head('crewDesk'); });
    await settle(page, 700);
    const open = await page.evaluate(() => window.__contrail.modal?.kind);
    if (open !== 'headUnlocked') await page.evaluate(() => window.__contrail.openModal({ kind: 'headUnlocked', id: 'crewDesk' }));
    await settle(page, 500);
  },
  'company-team': async (page) => {
    await quiet(page);
    await hireHead(page, 'opsControl');
    await nav(page, 'company', { view: 'team', sel: { kind: 'head', id: 'opsControl' } });
  },
  'company-achievements': async (page) => {
    await page.evaluate(() => { const s = window.__contrail; for (const a of ['clockwork', 'bunkTime', 'partner']) s.dev.achievement(a); });
    await quiet(page);
    await nav(page, 'company', { view: 'achievements' });
  },
  'achievement-toast': async (page) => {
    await nav(page, 'company', { view: 'achievements' });
    await page.evaluate(() => { const s = window.__contrail; s.setSettings({ toasts: true }); s.dev.achievement('noOverdue'); });
    await settle(page, 600);
  },
  'offer-analyst': async (page) => {
    await quiet(page);
    await hireHead(page, 'analyst');
    const id = await pick(page, () => Object.values(window.__contrail.game.offers).find((o) => o.status === 'open')?.id);
    if (!id) throw new Error('SKIP no open offer');
    await nav(page, 'contracts', { view: 'market' });
    await modal(page, { kind: 'offer', offerId: id });
  },
  'offer-slip': async (page) => {
    const id = await page.evaluate(() => window.__contrail.dev.slip('MAD-SIN'));
    if (!id) throw new Error('SKIP no slip offer');
    await settle(page, 700);
    const head = page.locator('.sc-feas-head').first();
    if (await head.count()) { await head.click(); await settle(page, 300); }
  },
  'offer-jumbo': async (page) => {
    const id = await page.evaluate(() => window.__contrail.dev.jumbo());
    if (!id) throw new Error('SKIP no jumbo offer');
    await settle(page, 700);
  },
  'crew-control-out-of-hours': async (page) => {
    const id = await ensureHours(page);
    await modal(page, { kind: 'crewControl', flightId: id });
  },
  'crew-control-discretion-greyed': async (page) => {
    const id = await ensureHours(page);
    await modal(page, { kind: 'crewControl', flightId: id, fix: 'discretion' });
    await page.evaluate(() => document.querySelector('[data-fix="discretion"]')?.scrollIntoView({ block: 'center' }));
    await settle(page, 300);
  },
  'inbox-crew-hours': async (page) => { await ensureHours(page); await nav(page, 'inbox'); },
  'opsstrip-hours': async (page) => { await ensureHours(page); await nav(page, 'map'); },
  'settings-sound': async (page) => {
    await modal(page, { kind: 'settings' });
    await page.evaluate(() => { const h = [...document.querySelectorAll('.set-head')].find((x) => x.textContent.trim() === 'Sound'); h?.scrollIntoView({ block: 'start' }); });
    await settle(page, 300);
  },
  'offer-call': async (page) => {
    await nav(page, 'map');
    const id = await page.evaluate(() => window.__contrail.dev.call());
    if (!id) throw new Error('SKIP no AOG cover offer');
    await settle(page, 900);
  },
  'approval-etops': async (page) => { await nav(page, 'company'); await modal(page, { kind: 'approval', id: 'etops120' }); },
  'settings-test-sounds': async (page, _s, d) => {
    await modal(page, { kind: 'settings' });
    const btn = page.locator('.set-row', { hasText: 'Test sounds' }).locator('button');
    await press(page, btn, d);
    await settle(page, 300);
    await page.evaluate(() => document.querySelector('.v9-tests')?.scrollIntoView({ block: 'start' }));
    await settle(page, 300);
  },
  'screen-hint-contracts': async (page) => {
    await page.evaluate(() => window.__contrail.setSettings({ screenHintsSeen: [] }));
    await nav(page, 'contracts', { view: 'market' });
  },
  'whats-new-catchup': async (page) => {
    await page.evaluate(() => window.__contrail.setSettings({ seenWhatsNew: 'v0.8', whatsNewCatchUp: '' }));
    await modal(page, { kind: 'whatsNew' });
  },
  'fleet-longest-day-popover': async (page, _s, d) => {
    await nav(page, 'fleet');
    const t = page.locator('.term', { hasText: 'Longest day' }).first();
    if (!(await t.count())) throw new Error('SKIP no Longest day term');
    await press(page, t, d);
    await settle(page, 400);
  },
});

async function scrollNext(page) {
  return page.evaluate(() => {
    const cands = [document.querySelector('.modal-body'), document.querySelector('.main'), document.querySelector('.ng-panel'), document.scrollingElement];
    const el = cands.find((e) => e && e.scrollHeight > e.clientHeight + 4);
    if (!el) return false;
    const before = el.scrollTop;
    el.scrollTop = before + el.clientHeight * 0.85;
    return el.scrollTop > before;
  });
}

async function run() {
  const saveJson = args.save ? fs.readFileSync(args.save, 'utf8') : null;
  const browser = await chromium.launch();
  let failures = 0;
  const mode = args.standalone ? 'standalone' : args.embed ? 'embed' : '';
  for (const view of views) {
    const desktop = view === 'desktop';
    const size = VIEWS[view];
    const ctx = await browser.newContext(desktop
      ? { viewport: size, deviceScaleFactor: 1, ...(args.theme ? { colorScheme: args.theme } : {}) }
      : { viewport: size, screen: size, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA_IPAD, ...(args.theme ? { colorScheme: args.theme } : {}) });
    await ctx.addInitScript(initScript, { css: hostCss(desktop), embed: args.embed && !desktop, forceTouch: args.forceTouch && !desktop });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    let errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e.message).slice(0, 300)}`));
    const report = {};
    const prefix = `${args.theme ? `${args.theme}-` : ''}${view}${mode && !desktop ? `-${mode}` : ''}`;
    started = false;
    console.log(`\n=== ${prefix} ${size.width}×${size.height}${desktop ? ' (mouse, DPR 1)' : ' (touch, DPR 2)'} ===`);
    let loggedTouch = false;
    for (const screen of screens) {
      errors = [];
      const file = path.join(args.out, `${prefix}-${screen}.png`);
      try {
        if (!PRE_GAME.has(screen)) await withTimeout(ensureGame(page, saveJson, desktop), 60000, 'load game');
        // v0.9: dev.roster() plays 20 days with a DUB tour (slow under load).
        await withTimeout(ACTIONS[screen](page, saveJson, desktop), /^roster-|crew-person-month/.test(screen) ? 180000 : 45000, screen);
        await page.screenshot({ path: file, timeout: 15000 });
        const inset = !desktop && mode ? INSET : null;
        const res = await page.evaluate(lint, { inset, minTarget: MIN_TARGET, minText: MIN_TEXT });
        if (!loggedTouch) { console.log(`  touch: ${res.touch}`); loggedTouch = true; }
        for (let p = 2; p <= args.pages; p++) {
          if (!(await scrollNext(page))) break;
          await settle(page, 250);
          await page.screenshot({ path: file.replace(/\.png$/, `-${p}.png`), timeout: 15000 });
        }
        res.errors = errors.slice(0, 10);
        report[screen] = res;
        const flags = [];
        if (res.scrollWidth > res.vw) flags.push(`H-OVERFLOW scrollWidth ${res.scrollWidth} > ${res.vw}`);
        if (res.beyondCount) flags.push(`${res.beyondCount} beyond viewport: ${res.beyond.join(' | ')}`);
        if (res.underInsets?.length) flags.push(`under status bar/home indicator: ${res.underInsets.join(' | ')}`);
        if (res.errors.length) flags.push(`errors: ${res.errors.join(' | ')}`);
        if (res.smallTargets && !desktop) flags.push(`${res.smallTargets}/${res.tapTargets} targets <${MIN_TARGET}px: ${res.smallTargetSamples.join(' | ')}`);
        if (res.smallText) flags.push(`${res.smallText} text <${MIN_TEXT}px: ${res.smallTextSamples.join(' | ')}`);
        if (res.dialog?.out) flags.push(`dialog ${res.dialog.h}px does not fit the ${res.vh}px viewport`);
        const day = await page.evaluate(() => { const g = window.__contrail?.game; return g ? `day ${Math.floor((g.now - g.started) / 1440)}${g.gameOver ? ' GAME OVER' : ''}` : '-'; }).catch(() => '-');
        console.log(`- ${screen} [${res.tier}] (${day}): ${path.basename(file)}${flags.length ? '' : ' OK'}`);
        for (const f of flags) console.log(`    ${f}`);
      } catch (e) {
        if (String(e.message).startsWith('SKIP')) { console.log(`- ${screen}: skipped (${String(e.message).slice(5)})`); continue; }
        failures++;
        report[screen] = { failed: String(e.message || e), errors };
        console.log(`- ${screen}: FAILED ${String(e.message || e).split('\n')[0]}`);
        await page.screenshot({ path: file, timeout: 10000 }).catch(() => {});
      }
    }
    fs.writeFileSync(path.join(args.out, `report-${prefix}.json`), JSON.stringify(report, null, 2));
    await ctx.close();
  }
  await browser.close();
  console.log(`\nDone. ${failures} failed. Output: ${args.out}`);
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
