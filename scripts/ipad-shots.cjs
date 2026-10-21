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
 *   --save         an exported save (.blockhours.json) to load for the in-game screens; without it the harness
 *                  starts a new game from the New Game screen (--base, default LIS) and plays --days
 *                  game days (default 40) with __contrail.dev.autoplay so every screen has real data
 *   --standalone   home-screen web app: --safe-t 24px / --safe-b 20px (status bar, home indicator),
 *                  drawn as translucent bands in the shots
 *   --embed        artifact host: :root padded 24px top / 20px bottom, html.embed
 *   --force-touch  set window.__CONTRAIL_FORCE_TOUCH__ (html.touch) in case touch media queries don't match
 *   --pages N      also capture N-1 extra shots per screen, each scrolled one viewport further
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
  const a = { url: 'http://localhost:5173/', out: path.resolve('ipad-shots'), view: 'safari,landscape', screens: 'all', save: null, days: 40, base: 'LIS', standalone: false, embed: false, forceTouch: false, pages: 1, sizes: [] };
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
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${what}`)), ms))]);

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
  const inGame = await page.evaluate(() => !!window.__contrail && window.__contrail.screen === 'game').catch(() => false);
  if (!inGame || !started) {
    if (saveJson) {
      // The autosave slot accepts plain JSON; the title screen then offers Continue.
      await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.evaluate((text) => { localStorage.clear(); localStorage.setItem('contrail-acmi:save:auto', text); }, saveJson);
      await gotoFresh(page);
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
    const days = await page.evaluate((s) => Math.max(0, Math.ceil((s - window.__contrail.game.now) / 1440)) + 2, start);
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
    const id = await pick(page, () => Object.keys(window.__contrail.game.fleet)[0]);
    await nav(page, 'fleet', { sel: { kind: 'aircraft', id } });
    await page.evaluate(() => document.querySelector('.sc-ac-crew')?.scrollIntoView({ block: 'center' }));
    const card = page.locator(`.sc-ac[data-ac="${id}"] .sc-ac-crew`);
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
  'duty-extra': async (page) => {
    const id = await pick(page, () => { const g = window.__contrail.game; const ac = Object.values(g.fleet).find((a) => a.crewExtra); const l = Object.values(g.flights).filter((f) => f.status === 'scheduled' && f.aircraftId === ac?.id && f.dutyId && f.std > g.now + 600).sort((a, b) => a.std - b.std); return l[0]?.id; });
    if (!id) throw new Error('SKIP no rostered flight on an aircraft with extra crew');
    await nav(page, 'schedule');
    await modal(page, { kind: 'duty', id });
    await page.evaluate(() => document.querySelector('.sc-chip-extra, .sc-seat.above')?.scrollIntoView({ block: 'center' }));
    await settle(page, 300);
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
      ? { viewport: size, deviceScaleFactor: 1 }
      : { viewport: size, screen: size, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA_IPAD });
    await ctx.addInitScript(initScript, { css: hostCss(desktop), embed: args.embed && !desktop, forceTouch: args.forceTouch && !desktop });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    let errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e.message).slice(0, 300)}`));
    const report = {};
    const prefix = `${view}${mode && !desktop ? `-${mode}` : ''}`;
    started = false;
    console.log(`\n=== ${prefix} ${size.width}×${size.height}${desktop ? ' (mouse, DPR 1)' : ' (touch, DPR 2)'} ===`);
    let loggedTouch = false;
    for (const screen of screens) {
      errors = [];
      const file = path.join(args.out, `${prefix}-${screen}.png`);
      try {
        if (!PRE_GAME.has(screen)) await withTimeout(ensureGame(page, saveJson, desktop), 60000, 'load game');
        await withTimeout(ACTIONS[screen](page, saveJson, desktop), 45000, screen);
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
        console.log(`- ${screen} [${res.tier}]: ${path.basename(file)}${flags.length ? '' : ' OK'}`);
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
