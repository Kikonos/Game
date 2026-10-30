#!/usr/bin/env node
/*
 * BLOCK HOURS device layout check (v0.12 devices): every screen at every device size, light and dark.
 *
 * usage: node device-check.cjs [--url http://localhost:5471/] [--out <dir>] [--profiles iphone,mac,windows]
 *          [--themes dark,light] [--viewports name,…] [--screens name,…] [--shots main|all|none] [--days 20]
 *
 * Profiles (one browser context each, Chromium via Playwright):
 *   iphone   iPhone UA, touch, isMobile; safe-area insets simulated by overriding the --safe-* tokens
 *            (Dynamic Island + rounded corners 59 px left/right, home indicator 21 px) and drawn as pink bands
 *   mac      Mac UA, mouse, navigator.platform MacIntel
 *   windows  Windows Edge UA, mouse, classic (non-overlay) scrollbars
 *
 * Per screen it flags: horizontal page overflow, elements beyond the viewport sideways, controls or text under the
 * simulated safe areas, text under 11 px, tap targets under 44 px (touch profiles), dialogs taller than the window
 * and page errors. Writes <out>/report-<profiles>-<themes>.json and prints a summary; with --shots main it saves
 * every screen at iphone15pro-app, mac-1440x900 and win-1920x1080 to <out>/<theme>-<viewport>-<screen>.png
 * (--shots all: every viewport).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
};
const PLATFORM = { iphone: 'iPhone', mac: 'MacIntel', windows: 'Win32' };

/** name → [profile, width, height, insets {t,r,b,l}] */
const VIEWPORTS = {
  'iphone15pro-app': ['iphone', 852, 393, { t: 0, r: 59, b: 21, l: 59 }],
  'iphone15pro-safari': ['iphone', 852, 350, { t: 0, r: 59, b: 0, l: 59 }],
  'iphone13-app': ['iphone', 844, 390, { t: 0, r: 47, b: 21, l: 47 }],
  'iphoneX-app': ['iphone', 812, 375, { t: 0, r: 44, b: 21, l: 44 }],
  'iphone15promax-app': ['iphone', 932, 430, { t: 0, r: 59, b: 21, l: 59 }],
  'iphone-portrait': ['iphone', 393, 852, { t: 59, r: 0, b: 34, l: 0 }],
  'mac-1280x800': ['mac', 1280, 800],
  'mac-1280x720': ['mac', 1280, 720],
  'mac-1440x900': ['mac', 1440, 900],
  'mac-1512x982': ['mac', 1512, 982],
  'mac-1728x1117': ['mac', 1728, 1117],
  'mac-2560x1440': ['mac', 2560, 1440],
  'mac-narrow-900x700': ['mac', 900, 700],
  'mac-narrow-640x720': ['mac', 640, 720],
  'win-1366x768': ['windows', 1366, 768],
  'win-1366x657': ['windows', 1366, 657],
  'win-1536x864': ['windows', 1536, 864],
  'win-1920x1080': ['windows', 1920, 1080],
  'win-1707x960': ['windows', 1707, 960],
  'win-narrow-1000x650': ['windows', 1000, 650],
};
const SHOT_VIEWPORTS = new Set(['iphone15pro-app', 'mac-1440x900', 'win-1920x1080']);

const PRE = ['title', 'newgame'];
const SCREENS = [
  'title', 'newgame',
  'map', 'map-aircraft', 'map-spotter',
  'contracts', 'contracts-active', 'contracts-missed', 'contracts-clients', 'offer-modal',
  'schedule', 'block-sheet',
  'crew', 'crew-board', 'crew-plan', 'hire',
  'fleet', 'fleet-hangar-top', 'fleet-hangar-side', 'fleet-market', 'acquire-modal',
  'finance', 'company', 'inbox', 'settings', 'whats-new', 'menu',
  'offer-call', 'problem-modal', 'delivered',
  // v0.12 Scenarios mode (last: they replace the game with a scenario one).
  'scenarios', 'scenario-play', 'scenario-goals', 'scenario-company', 'scenario-result',
];

function parseArgs(argv) {
  const a = { url: 'http://localhost:5471/', out: __dirname, profiles: 'iphone,mac,windows', themes: 'dark,light', viewports: null, screens: null, shots: 'main', days: 20 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--url') a.url = v();
    else if (k === '--out') a.out = path.resolve(v());
    else if (k === '--profiles') a.profiles = v();
    else if (k === '--themes') a.themes = v();
    else if (k === '--viewports') a.viewports = v();
    else if (k === '--screens') a.screens = v();
    else if (k === '--shots') a.shots = v();
    else if (k === '--days') a.days = Number(v());
    else if (k === '-h' || k === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(0); }
    else { console.error(`Unknown flag ${k}`); process.exit(2); }
  }
  return a;
}
const args = parseArgs(process.argv);
const profiles = args.profiles.split(',');
const themes = args.themes.split(',');
const wantVp = args.viewports ? new Set(args.viewports.split(',')) : null;
const wantScreens = args.screens ? args.screens.split(',') : SCREENS;
for (const s of wantScreens) if (!SCREENS.includes(s)) { console.error(`Unknown screen ${s}`); process.exit(2); }
fs.mkdirSync(args.out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- in-page helpers ----------

function insetCss(ins) {
  return `:root:root {
  --safe-t: calc(${ins.t}px + var(--top-gap, 0px)) !important; --safe-r: ${ins.r}px !important; --safe-b: ${ins.b}px !important; --safe-l: ${ins.l}px !important;
  --vp-safe-t: ${ins.t}px !important; --vp-safe-b: ${ins.b}px !important;
}
#__dv_l, #__dv_r, #__dv_b, #__dv_t { position: fixed; z-index: 2147483647; pointer-events: none; background: rgba(255, 64, 160, 0.18); }
#__dv_l { left: 0; top: 0; bottom: 0; width: ${ins.l}px; }
#__dv_r { right: 0; top: 0; bottom: 0; width: ${ins.r}px; }
#__dv_b { left: 0; right: 0; bottom: 0; height: ${ins.b}px; }
#__dv_t { left: 0; right: 0; top: 0; height: ${ins.t}px; }
#__dv_island { position: fixed; z-index: 2147483647; pointer-events: none; background: #000; border-radius: 20px; }
#__dv_home { position: fixed; z-index: 2147483647; pointer-events: none; left: 50%; width: 220px; margin-left: -110px; bottom: 8px; height: 5px; border-radius: 3px; background: rgba(128, 128, 128, 0.85); }`;
}

/** Puts (or removes) the simulated insets and the Dynamic Island / home indicator drawing. */
async function setInsets(page, ins) {
  await page.evaluate(({ css, ins }) => {
    for (const id of ['__dv_css', '__dv_l', '__dv_r', '__dv_b', '__dv_t', '__dv_island', '__dv_home']) document.getElementById(id)?.remove();
    if (!css) return;
    const s = document.createElement('style');
    s.id = '__dv_css';
    s.textContent = css;
    document.head.appendChild(s);
    for (const id of ['__dv_l', '__dv_r', '__dv_b', '__dv_t']) { const d = document.createElement('div'); d.id = id; document.documentElement.appendChild(d); }
    const isl = document.createElement('div');
    isl.id = '__dv_island';
    // Landscape: the island sits in the left inset, vertically centred; portrait: top centre.
    if (ins.l) Object.assign(isl.style, { left: '11px', top: 'calc(50% - 63px)', width: '37px', height: '126px' });
    else Object.assign(isl.style, { top: '11px', left: 'calc(50% - 63px)', width: '126px', height: '37px' });
    document.documentElement.appendChild(isl);
    if (ins.b) { const h = document.createElement('div'); h.id = '__dv_home'; document.documentElement.appendChild(h); }
  }, { css: ins ? insetCss(ins) : '', ins: ins || {} });
}

// Runs in the page.
function lint({ ins, touch }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out = { vw, vh, scrollWidth: document.documentElement.scrollWidth, overflowX: document.documentElement.scrollWidth > vw + 1 };
  const skip = (el) => !!el.closest('[id^="__dv_"]');
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
      const cls = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
      if (cls.length) p += `.${cls.join('.')}`;
      parts.unshift(p);
    }
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    return parts.join(' > ') + (label ? ` "${label}"` : '');
  };
  const clippedX = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') return true;
    return false;
  };
  const hit = (el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= vw || y >= vh) return false;
    const t = document.elementFromPoint(x, y);
    return !!t && (t === el || el.contains(t) || t.closest('[id^="__dv_"]'));
  };
  const all = [...document.body.querySelectorAll('*')].filter((el) => !skip(el));
  const beyond = [];
  for (const el of all) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || (r.right <= vw + 1 && r.left >= -1)) continue;
    if (!visible(el) || clippedX(el)) continue;
    if (beyond.some((b) => b.contains(el))) continue;
    beyond.push(el);
  }
  out.beyond = beyond.slice(0, 8).map((el) => { const r = el.getBoundingClientRect(); return `${sel(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`; });
  const ctrls = all.filter((el) => el.matches('button, a[href], [role="button"], [role="tab"], select, input:not([type="hidden"]), textarea, summary') && visible(el) && hit(el));
  if (touch) {
    const small = ctrls.filter((el) => {
      const r = el.getBoundingClientRect();
      if (el.matches('input[type="range"]')) return r.height < 40;
      return r.width < 44 - 0.5 || r.height < 44 - 0.5;
    });
    const sizes = new Map();
    for (const el of small) {
      const r = el.getBoundingClientRect();
      const k = `${sel(el).replace(/ ".*$/, '')} ${Math.round(r.width)}×${Math.round(r.height)}`;
      sizes.set(k, (sizes.get(k) || 0) + 1);
    }
    out.smallTargets = small.length;
    out.smallTargetKinds = [...sizes].slice(0, 12).map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ''}`);
  }
  // Under the safe areas: controls, and text, overlapping an inset by more than 3 px.
  if (ins && (ins.l || ins.r || ins.b || ins.t)) {
    // Content a scroller can still move clear of the inset is fine (lists scroll under the home indicator on iOS).
    const room = (el, axis) => {
      let best = 0;
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (axis === 'y' && /auto|scroll/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) best = Math.max(best, p.scrollHeight - p.clientHeight - p.scrollTop);
        if (axis === 'x' && /auto|scroll/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) best = Math.max(best, p.scrollWidth - p.clientWidth - p.scrollLeft);
      }
      return best;
    };
    const under = (r, el) => {
      if (ins.l && r.left < ins.l - 3) return true;
      if (ins.t && r.top < ins.t - 3) return true;
      if (ins.r && r.right > vw - ins.r + 3 && (!el || room(el, 'x') < r.right - (vw - ins.r))) return true;
      if (ins.b && r.bottom > vh - ins.b + 3 && (!el || room(el, 'y') < r.bottom - (vh - ins.b))) return true;
      return false;
    };
    const u = [];
    for (const el of ctrls) { const r = el.getBoundingClientRect(); if (r.bottom > 0 && r.top < vh && under(r, el)) u.push(`${sel(el)} [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}]`); }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || seen.has(el) || skip(el) || el.closest('svg')) continue;
      seen.add(el);
      if (!visible(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width === 0 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      // Clipped by a scroller: only the part inside it counts.
      let c = r;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          const pr = p.getBoundingClientRect();
          c = { left: Math.max(c.left, pr.left), right: Math.min(c.right, pr.right), top: Math.max(c.top, pr.top), bottom: Math.min(c.bottom, pr.bottom) };
        }
      }
      if (c.right <= c.left || c.bottom <= c.top) continue;
      if (!hit(el)) continue;
      if (under(c, el)) u.push(`text ${sel(el)} [${Math.round(c.left)},${Math.round(c.top)}..${Math.round(c.right)},${Math.round(c.bottom)}]`);
    }
    out.underSafe = u.slice(0, 10);
    out.underSafeCount = u.length;
  }
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
    if (!hit(el)) continue;
    // Visual size: the font size times the page zoom (Settings › Size).
    const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const fs = parseFloat(getComputedStyle(el).fontSize) * z;
    if (fs < 11 - 0.01) {
      smallText++;
      if (smallTextSamples.length < 6) smallTextSamples.push(`${sel(el)} ${Math.round(fs * 10) / 10}px`);
    }
  }
  out.smallText = smallText;
  out.smallTextSamples = smallTextSamples;
  const dlg = document.querySelector('.modal, .v12-welcome-card');
  if (dlg) {
    const r = dlg.getBoundingClientRect();
    out.dialog = { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), out: r.top < -1 || r.bottom > vh + 1 };
    const foot = dlg.querySelector('.modal-foot');
    if (foot) { const f = foot.getBoundingClientRect(); out.dialog.footVisible = f.bottom <= vh + 1 && f.top >= 0; }
  }
  out.tier = document.querySelector('.shell')?.className.replace(/\bshell\b/, '').trim() || '-';
  out.device = `${document.documentElement.dataset.device}/${document.documentElement.dataset.input}${document.documentElement.classList.contains('touch') ? '+touch' : ''}`;
  return out;
}

// ---------- game set-up and screens ----------

async function settle(page, ms = 350) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))).catch(() => {});
  await sleep(ms);
}

async function calm(page) {
  await page.evaluate(() => {
    const s = window.__contrail;
    s.modal = null; s.paused = true; s.toasts = [];
    if (s.game) s.decisionDeferred = s.game.decisions.map((d) => d.id).join(',');
    s.emit();
  });
}

const HINTS = ['map', 'company', 'inbox', 'contracts', 'schedule', 'crewPeople', 'crewBoard', 'crewPlan', 'fleet', 'finance', 'team'];

async function toTitle(page, theme) {
  await page.goto(args.url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__contrail && window.__contrail.screen === 'title', null, { timeout: 60000 });
  await page.evaluate(({ theme, hints }) => {
    try { localStorage.clear(); } catch { /* */ }
    const s = window.__contrail;
    s.setSettings({ theme, toasts: false, sound: false, music: false, seenWhatsNew: 'zzz', whatsNewCatchUp: 'v0.9', screenHintsSeen: hints });
    s.closeModal();
  }, { theme, hints: HINTS });
  await settle(page, 600);
}

let state = {};
async function startGame(page, theme) {
  await page.evaluate(() => window.__contrail.startNewGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 7 }));
  await page.waitForSelector('.shell', { timeout: 20000 });
  await page.evaluate(({ theme, hints }) => {
    const s = window.__contrail;
    s.setSettings({ theme, autoPause: Object.fromEntries(Object.keys(s.settings.autoPause).map((k) => [k, false])), toasts: false, sound: false, music: false, seenWhatsNew: 'zzz', screenHintsSeen: hints });
  }, { theme, hints: HINTS });
  await calm(page);
  if (args.days) await page.evaluate((d) => window.__contrail.dev.autoplay(d), args.days);
  state = await page.evaluate(() => {
    const s = window.__contrail;
    const g = s.game;
    s.dev.addType('b763');
    s.dev.demoFlights(3);
    let offerId = Object.values(g.offers).find((o) => o.status === 'open')?.id;
    for (let i = 0; i < 4 && !offerId; i++) offerId = s.dev.offer() || undefined;
    if (!Object.values(g.offers).some((o) => o.status === 'open' && o.id !== offerId)) s.dev.offer();
    s.dev.marketOffer('a332', { site: 'SCL' });
    s.dev.marketOffer('a320ceo', { kind: 'buy' });
    const buyId = g.market.aircraft.find((o) => o.kind === 'buy' && o.expires > g.now)?.id;
    const callId = s.dev.call();
    let shortId = null;
    for (const h of [10, 20, 40, 72, 120]) { shortId = s.dev.crewShortage(h) || null; if (shortId) break; }
    s.modal = null;
    return { offerId, buyId, callId, shortId };
  });
  await calm(page);
  await settle(page, 600);
}

const nav = async (page, tab, extra) => { await page.evaluate(([t, x]) => window.__contrail.navigate(t, x || {}), [tab, extra]); await settle(page, tab === 'map' ? 900 : 450); };
const modal = async (page, spec) => { await page.evaluate((m) => window.__contrail.openModal(m), spec); await settle(page, 550); };
const click = async (page, selector) => { const l = page.locator(selector).first(); if (await l.count()) { await l.click({ timeout: 3000 }).catch(() => {}); await settle(page, 400); return true; } return false; };

async function scenario(page, id, days) {
  await page.evaluate(({ id, days }) => {
    const s = window.__contrail;
    s.startScenario(id);
    s.setSettings({ autoPause: Object.fromEntries(Object.keys(s.settings.autoPause).map((k) => [k, false])) });
    if (days) s.dev.autoplay(days);
    s.modal = null; s.paused = true; s.toasts = []; if (s.game && !s.game.gameOver) s.decisionDeferred = s.game.decisions.map((d) => d.id).join(','); s.emit();
  }, { id, days });
  await settle(page, 900);
}

const ACTIONS = {
  scenarios: async (page) => { await page.evaluate(() => { const s = window.__contrail; s.closeModal(); s.setScreen('scenarios'); }); await page.waitForSelector('.sc-list', { timeout: 10000 }).catch(() => {}); await settle(page, 600); },
  'scenario-play': async (page) => { await scenario(page, 'ashCloud', 6); await nav(page, 'map'); },
  'scenario-goals': async (page) => { await nav(page, 'map'); await modal(page, { kind: 'scenario' }); },
  'scenario-company': (page) => nav(page, 'company'),
  'scenario-result': async (page) => { await scenario(page, 'cupFinal', 12); await page.waitForSelector('.sc-result', { timeout: 15000 }).catch(() => {}); await settle(page, 600); },
  title: async (page) => { await page.evaluate(() => { const s = window.__contrail; s.closeModal(); s.setScreen('title'); }); await settle(page, 700); await page.evaluate(() => window.__contrail.closeModal()); await settle(page, 200); },
  newgame: async (page) => { await page.evaluate(() => window.__contrail.setScreen('newgame')); await page.waitForSelector('.newgame', { timeout: 10000 }).catch(() => {}); await settle(page, 600); },
  map: (page) => nav(page, 'map'),
  'map-aircraft': async (page) => {
    const id = await page.evaluate(() => { const g = window.__contrail.game; return (Object.values(g.fleet).find((a) => a.status === 'flying') ?? Object.values(g.fleet)[0])?.id; });
    await nav(page, 'map', { sel: { kind: 'aircraft', id } });
  },
  'map-spotter': async (page) => { await nav(page, 'map'); await click(page, '.ops-spot-btn'); await settle(page, 1200); },
  contracts: (page) => nav(page, 'contracts', { view: 'market' }),
  'contracts-active': (page) => nav(page, 'contracts', { view: 'active' }),
  'contracts-missed': (page) => nav(page, 'contracts', { view: 'missed' }),
  'contracts-clients': (page) => nav(page, 'contracts', { view: 'clients' }),
  'offer-modal': async (page) => { if (!state.offerId) throw new Error('SKIP no offer'); await nav(page, 'contracts', { view: 'market' }); await modal(page, { kind: 'offer', offerId: state.offerId }); },
  schedule: (page) => nav(page, 'schedule'),
  'block-sheet': async (page) => {
    const id = await page.evaluate(() => { const g = window.__contrail.game; const l = Object.values(g.flights).filter((f) => f.status === 'scheduled' && f.aircraftId && f.std > g.now).sort((a, b) => a.std - b.std); return (l.find((f) => f.crewIds.length) ?? l[0])?.id; });
    if (!id) throw new Error('SKIP no flight');
    await nav(page, 'schedule');
    await modal(page, { kind: 'sheet', refs: [{ kind: 'flight', id }] });
  },
  crew: (page) => nav(page, 'crew', { view: 'people' }),
  'crew-board': async (page) => { await nav(page, 'crew', { view: 'board' }); await settle(page, 600); },
  'crew-plan': (page) => nav(page, 'crew', { view: 'plan' }),
  hire: async (page) => { await nav(page, 'crew', { view: 'people' }); await modal(page, { kind: 'hire' }); },
  fleet: async (page) => { await nav(page, 'fleet', { view: 'fleet' }); },
  'fleet-hangar-top': async (page) => { await nav(page, 'fleet', { view: 'hangar' }); await click(page, '.hg-head .seg button:has-text("From above")'); },
  'fleet-hangar-side': async (page) => { await nav(page, 'fleet', { view: 'hangar' }); await click(page, '.hg-head .seg button:has-text("Side")'); },
  'fleet-market': (page) => nav(page, 'fleet', { view: 'market' }),
  'acquire-modal': async (page) => { if (!state.buyId) throw new Error('SKIP no buy offer'); await nav(page, 'fleet', { view: 'market' }); await modal(page, { kind: 'acquire', offerId: state.buyId }); },
  finance: (page) => nav(page, 'finance'),
  company: (page) => nav(page, 'company'),
  inbox: (page) => nav(page, 'inbox'),
  settings: async (page) => { await nav(page, 'map'); await modal(page, { kind: 'settings' }); },
  'whats-new': async (page) => { await nav(page, 'map'); await modal(page, { kind: 'whatsNew', all: true }); },
  menu: async (page) => { await nav(page, 'map'); await modal(page, { kind: 'menu' }); },
  'offer-call': async (page) => { if (!state.callId) throw new Error('SKIP no call'); await nav(page, 'map'); await modal(page, { kind: 'offerCall', offerId: state.callId }); },
  'problem-modal': async (page) => { if (!state.shortId) throw new Error('SKIP no short flight'); await nav(page, 'schedule'); await modal(page, { kind: 'problem', subject: { kind: 'crewShort', ref: { kind: 'flight', id: state.shortId } } }); },
  delivered: async (page) => {
    const id = await page.evaluate(() => Object.values(window.__contrail.game.fleet).at(-1)?.id);
    await nav(page, 'map');
    await modal(page, { kind: 'delivered', aircraftId: id });
    await settle(page, 600);
  },
};

// ---------- run ----------

function issues(r) {
  const n = [];
  if (r.error) n.push(`ERROR ${r.error}`);
  if (r.overflowX) n.push(`overflow-x ${r.scrollWidth}>${r.vw}`);
  if (r.beyond?.length) n.push(`beyond: ${r.beyond.join(' | ')}`);
  if (r.underSafeCount) n.push(`under safe area ×${r.underSafeCount}: ${r.underSafe.join(' | ')}`);
  if (r.smallText) n.push(`text<11px ×${r.smallText}: ${r.smallTextSamples.join(' | ')}`);
  if (r.smallTargets) n.push(`targets<44 ×${r.smallTargets}: ${r.smallTargetKinds.join(' | ')}`);
  if (r.dialog?.out) n.push(`dialog outside the window ${r.dialog.top}..${r.dialog.bottom}`);
  if (r.dialog && r.dialog.footVisible === false) n.push('dialog footer not visible');
  if (r.pageErrors?.length) n.push(`page errors: ${r.pageErrors.join(' | ')}`);
  return n;
}

/** Viewports that get a context of their own (portrait after landscape: a mobile browser keeps a zoomed-out scale). */
const FRESH = new Set(['iphone-portrait']);

async function runProfile(browser, profile, theme, report) {
  const all = Object.entries(VIEWPORTS).filter(([name, v]) => v[0] === profile && (!wantVp || wantVp.has(name)));
  const groups = [];
  for (const e of all) {
    if (!groups.length || FRESH.has(e[0]) || FRESH.has(groups.at(-1).at(-1)[0])) groups.push([e]);
    else groups.at(-1).push(e);
  }
  for (const g of groups) await runGroup(browser, profile, theme, report, g);
}

async function runGroup(browser, profile, theme, report, vps) {
  const touch = profile === 'iphone';
  const ctx = await browser.newContext({
    viewport: { width: vps[0][1][1], height: vps[0][1][2] }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch, userAgent: UA[profile],
  });
  await ctx.addInitScript((pf) => { try { Object.defineProperty(Navigator.prototype, 'platform', { get: () => pf }); } catch { /* */ } }, PLATFORM[profile]);
  const page = await ctx.newPage();
  let pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|workbox|service worker/i.test(m.text())) pageErrors.push(`console: ${m.text()}`); });

  await toTitle(page, theme);
  const game = wantScreens.filter((s) => !PRE.includes(s));
  const pre = wantScreens.filter((s) => PRE.includes(s));
  const run = async (vpName, vp, screen) => {
    pageErrors = [];
    let r;
    try {
      await ACTIONS[screen](page);
      r = await page.evaluate(lint, { ins: vp[3] || null, touch });
    } catch (e) {
      r = { error: String(e.message || e).split('\n')[0] };
    }
    r.pageErrors = pageErrors.slice(0, 4);
    const key = `${theme}/${vpName}/${screen}`;
    report[key] = r;
    const n = issues(r);
    console.log(`${n.length ? '✗' : '✓'} ${key}${r.device ? ` [${r.device} ${r.tier}]` : ''}${n.length ? `\n    ${n.join('\n    ')}` : ''}`);
    if (!r.error && (args.shots === 'all' || (args.shots === 'main' && SHOT_VIEWPORTS.has(vpName)))) {
      await page.screenshot({ path: path.join(args.out, `${theme}-${vpName}-${screen}.png`) });
    }
  };
  const resize = async (vp) => {
    await page.setViewportSize({ width: vp[1], height: vp[2] });
    await setInsets(page, vp[3] && (vp[3].l || vp[3].r || vp[3].b || vp[3].t) ? vp[3] : null);
    await settle(page, 300);
  };
  // One game per context; the title and new-game screens are visited over it (setScreen keeps the game).
  await resize(vps[0][1]);
  await startGame(page, theme);
  for (const [name, vp] of vps) {
    // v0.12 the scenario screens replace the game: a fresh normal game for the next viewport.
    if (await page.evaluate(() => !!window.__contrail.game?.scen)) await startGame(page, theme);
    await resize(vp);
    for (const s of pre) await run(name, vp, s);
    await page.evaluate(() => window.__contrail.setScreen('game'));
    await settle(page, 300);
    for (const s of game) {
      await calm(page);
      await run(name, vp, s);
    }
    await calm(page);
  }
  await ctx.close();
}

(async () => {
  const report = {};
  for (const profile of profiles) {
    // Windows: classic scrollbars that take room (Playwright hides scrollbars by default).
    const browser = await chromium.launch(profile === 'windows' ? { ignoreDefaultArgs: ['--hide-scrollbars'] } : {});
    for (const theme of themes) await runProfile(browser, profile, theme, report);
    await browser.close();
  }
  const file = path.join(args.out, `report-${profiles.join('+')}-${themes.join('+')}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 1));
  const bad = Object.entries(report).filter(([, r]) => issues(r).length);
  console.log(`\n${Object.keys(report).length} checks, ${bad.length} with findings. Report: ${file}`);
})();
