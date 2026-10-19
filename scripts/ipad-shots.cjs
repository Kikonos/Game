#!/usr/bin/env node
/*
 * iPad screenshot + layout-lint harness (iPad A16 11" emulation, Chromium via Playwright).
 *
 * Usage:
 *   node scripts/ipad-shots.cjs --url http://localhost:5201/ --out /tmp/shots \
 *     [--view landscape,portrait | all] [--screens hq,map,routes | all] \
 *     [--standalone] [--embed] [--force-touch] [--save path/to/save.json] [--pages N]
 *
 *   --url          base URL of a running dev/preview server (default http://localhost:5173/)
 *   --out          output directory for PNGs + report-<view>.json (default ./ipad-shots)
 *   --view         comma list or all (default landscape,portrait):
 *                    landscape 1180×820   home-screen app / full screen, landscape
 *                    portrait   820×1180  home-screen app / full screen, portrait
 *                    safari    1180×750   Safari with toolbars, landscape
 *                    split      590×820   Split View half
 *                    slide      390×820   Slide Over
 *                    desktop   1440×900   mouse, no touch, DPR 1
 *                  iPad views use DPR 2, touch, isMobile and an iPadOS Safari UA.
 *   --size WxH     add a touch view of any size, named WxH (e.g. 700x600 for a small artifact viewer)
 *   --screens      comma list (default all) of:
 *                    loading,title,newgame-region,newgame-hub,newgame-brand,newgame-launch,
 *                    hq,map,routes,route-planner,route-detail,fleet,fleet-detail,cabin,
 *                    market-new,market-used,market-lease,order-modal,finance,intel,expansion,
 *                    brand,goals,inbox,menu,settings,saves,decision,year-review,more-sheet
 *                  (more-sheet needs the compact tier: split or slide)
 *   --standalone   home-screen web app: --safe-t 24px / --safe-b 20px (status bar, home indicator),
 *                  drawn as translucent bands in the shots
 *   --embed        artifact host: :root padded 24px top / 20px bottom, html.embed (--safe-t/b = 0,
 *                  --vp-safe-t/b = the insets)
 *   --force-touch  set window.__CONTRAIL_FORCE_TOUCH__ (html.touch) in case touch media queries
 *                  don't match (they do in Chromium touch emulation; the report says so)
 *   --save         uncompressed save JSON for in-game screens
 *                  (default /tmp/claude-0/-home-user-Game/a5d5d912-4f57-50de-a5cc-db854aad1b29/scratchpad/late.json)
 *   --pages N      also capture N-1 extra shots per screen, each scrolled one viewport further
 *                  (the open dialog body, else .main)
 *
 * Per screen it writes <out>/<view>[-standalone|-embed]-<screen>.png and prints: horizontal page
 * overflow, elements beyond the viewport (<= 10 selectors), console/page errors, visible
 * buttons/links/inputs smaller than 40×40 (count + <= 10 selectors; not for desktop), text under 12px (count),
 * and with --standalone/--embed controls whose centre sits under the status bar/home indicator.
 * Needs Playwright's Chromium: require('/opt/node22/lib/node_modules/playwright') (override with PW=...).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const ALL = [
  'loading', 'title', 'newgame-region', 'newgame-hub', 'newgame-brand', 'newgame-launch',
  'hq', 'map', 'routes', 'route-planner', 'route-detail', 'fleet', 'fleet-detail', 'cabin',
  'market-new', 'market-used', 'market-lease', 'order-modal', 'finance', 'intel', 'expansion',
  'brand', 'goals', 'inbox', 'menu', 'settings', 'saves', 'decision', 'year-review', 'more-sheet',
];
const PRE_GAME = new Set(['loading', 'title', 'newgame-region', 'newgame-hub', 'newgame-brand', 'newgame-launch']);
const VIEWS = {
  landscape: { width: 1180, height: 820 },
  portrait: { width: 820, height: 1180 },
  safari: { width: 1180, height: 750 },
  split: { width: 590, height: 820 },
  slide: { width: 390, height: 820 },
  desktop: { width: 1440, height: 900 },
};
const DEFAULT_SAVE = '/tmp/claude-0/-home-user-Game/a5d5d912-4f57-50de-a5cc-db854aad1b29/scratchpad/late.json';
const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
/** iPad home-screen app insets (black-translucent status bar, home indicator). */
const INSET = { t: 24, b: 20 };
const MIN_TARGET = 40;
const MIN_TEXT = 12;

function parseArgs(argv) {
  const a = { url: 'http://localhost:5173/', out: path.resolve('ipad-shots'), view: 'landscape,portrait', screens: 'all', save: DEFAULT_SAVE, standalone: false, embed: false, forceTouch: false, pages: 1, sizes: [] };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--url') a.url = next();
    else if (k === '--out') a.out = path.resolve(next());
    else if (k === '--view' || k === '--views') a.view = next();
    else if (k === '--screens') a.screens = next();
    else if (k === '--save') a.save = next();
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
  return out;
}

async function settle(page, ms = 450) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))).catch(() => {});
  await sleep(ms);
}

async function press(page, locator, desktop) {
  if (desktop) await locator.click(); else await locator.tap();
}

async function gotoFresh(page, { withSave }) {
  await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (withSave !== undefined) {
    await page.evaluate((s) => { try { if (s) localStorage.setItem('contrail:save:auto', s); else localStorage.removeItem('contrail:save:auto'); } catch { /* ignore */ } }, withSave);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await page.waitForFunction(() => window.__contrail && window.__contrail.screen === 'title', null, { timeout: 30000 });
  await settle(page, 700);
}

async function ensureGame(page, saveJson, desktop) {
  const inGame = await page.evaluate(() => !!window.__contrail && window.__contrail.screen === 'game').catch(() => false);
  if (!inGame) {
    if (!saveJson) throw new Error('no save available for in-game screens');
    await gotoFresh(page, { withSave: saveJson });
    const cont = page.getByRole('button', { name: /Continue/ }).first();
    await cont.waitFor({ timeout: 15000 });
    await press(page, cont, desktop);
    await page.waitForSelector('.shell', { timeout: 20000 });
    await settle(page, 900);
  }
  await page.evaluate(() => {
    const s = window.__contrail;
    s.modal = null;
    s.game.yearReview = null;
    s.game.decisions = [];
    s.levelUp = null;
    s.paused = true;
    s.toasts = [];
    s.emit();
  });
  // Close the More sheet if a previous screen left it open.
  await page.evaluate(() => document.querySelector('.more-sheet .close')?.click());
  await settle(page, 150);
}

async function nav(page, tab, extra) {
  await page.evaluate(([t, x]) => { const s = window.__contrail; s.navigate('hq'); s.navigate(t, x || {}); }, [tab, extra]);
  await settle(page, tab === 'map' ? 1400 : 600);
}

async function modal(page, spec) {
  await page.evaluate((m) => window.__contrail.openModal(m), spec);
  await settle(page, 700);
}

async function newGameStep(page, saveJson, step, desktop) {
  await gotoFresh(page, { withSave: saveJson || null });
  await press(page, page.getByRole('button', { name: /New Airline/ }).first(), desktop);
  await page.waitForSelector('.newgame', { timeout: 10000 });
  await settle(page, 800);
  for (let i = 0; i < step; i++) {
    await press(page, page.locator('.ng-foot .btn-primary'), desktop);
    await settle(page, 700);
  }
}

const ACTIONS = {
  loading: async (page) => {
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.loading', { timeout: 15000 });
    await sleep(900);
  },
  title: async (page, save) => { await gotoFresh(page, { withSave: save || null }); },
  'newgame-region': (page, save, d) => newGameStep(page, save, 0, d),
  'newgame-hub': (page, save, d) => newGameStep(page, save, 1, d),
  'newgame-brand': (page, save, d) => newGameStep(page, save, 2, d),
  'newgame-launch': (page, save, d) => newGameStep(page, save, 3, d),
  hq: (page) => nav(page, 'hq'),
  map: (page) => nav(page, 'map'),
  routes: (page) => nav(page, 'routes'),
  'route-planner': async (page) => { await nav(page, 'routes'); await modal(page, { kind: 'planner' }); },
  'route-detail': async (page) => {
    const id = await page.evaluate(() => { const g = window.__contrail.game; return [...g.routes].sort((a, b) => (b.lastWeek?.profit ?? 0) - (a.lastWeek?.profit ?? 0))[0]?.id ?? g.routes[0]?.id; });
    await nav(page, 'routes', { routeId: id });
  },
  fleet: (page) => nav(page, 'fleet'),
  'fleet-detail': async (page) => {
    const id = await page.evaluate(() => { const g = window.__contrail.game; return (g.fleet.find((a) => a.assignments.length) ?? g.fleet[0])?.id; });
    await nav(page, 'fleet', { aircraftId: id });
  },
  cabin: async (page) => {
    const id = await page.evaluate(() => { const g = window.__contrail.game; return (g.fleet.find((a) => a.status === 'active') ?? g.fleet[0])?.id; });
    await nav(page, 'fleet');
    await modal(page, { kind: 'cabin', aircraftId: id });
  },
  'market-new': (page) => nav(page, 'market', { marketTab: 'new' }),
  'market-used': (page) => nav(page, 'market', { marketTab: 'used' }),
  'market-lease': (page) => nav(page, 'market', { marketTab: 'lease' }),
  'order-modal': async (page) => {
    const typeId = await page.evaluate(() => window.__contrail.game.fleet[0]?.typeId ?? 'a320neo');
    await nav(page, 'market', { marketTab: 'new' });
    await modal(page, { kind: 'order', typeId });
  },
  finance: (page) => nav(page, 'finance'),
  intel: (page) => nav(page, 'intel'),
  expansion: (page) => nav(page, 'expansion'),
  brand: (page) => nav(page, 'brand'),
  goals: (page) => nav(page, 'goals'),
  inbox: (page) => nav(page, 'inbox'),
  menu: (page) => modal(page, { kind: 'menu' }),
  settings: (page) => modal(page, { kind: 'settings' }),
  saves: (page) => modal(page, { kind: 'saves', mode: 'save' }),
  'more-sheet': async (page, _save, desktop) => {
    await nav(page, 'hq');
    const more = page.locator('[data-nav="more"]:visible').first();
    if (!(await more.count())) throw new Error('SKIP compact tier only (use --view split or slide)');
    await press(page, more, desktop);
    await settle(page, 700);
  },
  decision: async (page) => {
    await nav(page, 'hq');
    await page.evaluate(() => {
      const s = window.__contrail;
      s.game.decisions = [{
        id: 'dec-harness', eventId: 'harness', day: s.game.day, title: 'Cabin crew union threatens strike', data: {},
        body: 'The cabin crew union demands a 6% pay rise after record profits. Without a deal they will walk out for a week across your network.',
        options: [
          { id: 'a', label: 'Accept the 6% raise', desc: 'Crew costs +6% permanently. Morale and service improve.' },
          { id: 'b', label: 'Offer 3% and a bonus', desc: 'One-off $2.4M bonus. 60% chance they accept.' },
          { id: 'c', label: 'Refuse', desc: 'Risk a week of cancellations and a reputation hit.' },
        ],
      }];
      s.emit();
    });
    await settle(page, 700);
  },
  'year-review': async (page) => {
    await nav(page, 'hq');
    await page.evaluate(() => {
      const s = window.__contrail;
      s.game.yearReview = { year: 2029, pax: 18_400_000, revenue: 4_120_000_000, profit: 312_000_000, fleet: s.game.fleet.length, routes: s.game.routes.length, reputation: 71, rank: 4, bestRoute: 'LHR–JFK' };
      s.emit();
    });
    await settle(page, 700);
  },
};

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
  const saveJson = fs.existsSync(args.save) ? fs.readFileSync(args.save, 'utf8') : null;
  if (!saveJson) console.warn(`! save not found at ${args.save}: in-game screens will fail`);
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
