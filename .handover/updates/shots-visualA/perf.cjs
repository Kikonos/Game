// Visual A frame-time check: a 26-aircraft game (18 types) on the Map at 4×, 12 s per scenario, in Chromium
// (1180×820, DPR 2). Measures every animation frame's interval in the page (rAF), the live map loop's own cost
// (__contrailMap: aircraft, paths, night, lights) and long tasks. usage: node perf.cjs <url> [cpuThrottle]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const url = process.argv[2] || 'http://localhost:5461/';
const throttle = +(process.argv[3] || 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = ['a321neo', 'b738', 'b752', 'b763', 'a332', 'a343', 'b772', 'b77w', 'b789', 'a359', 'a35k', 'b744', 'b748', 'a388', 'a346', 'b78x', 'b753', 'b741'];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = new Map();
  page.on('pageerror', (e) => errs.set(e.message, (errs.get(e.message) ?? 0) + 1));
  page.on('console', (m) => { if (m.type() === 'error') errs.set(m.text().slice(0, 300), (errs.get(m.text().slice(0, 300)) ?? 0) + 1); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__contrail && window.__contrail.screen === 'title', null, { timeout: 60000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* */ } });
  await page.evaluate(() => window.__contrail.startNewGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 7 }));
  await page.waitForSelector('.shell', { timeout: 20000 });
  await page.evaluate((types) => {
    const s = window.__contrail;
    s.setSettings({ theme: 'dark', autoPause: Object.fromEntries(Object.keys(s.settings.autoPause).map((k) => [k, false])), toasts: false, sound: false, music: false, seenWhatsNew: 'zzz', screenHintsSeen: ['map', 'company', 'inbox', 'contracts', 'schedule', 'crew', 'fleet', 'finance', 'team'] });
    s.dev.autoplay(14);
    for (const t of types) s.dev.addType(t);
    s.dev.fleet(26);
    s.dev.demoFlights(4);
    s.dev.advance(75);
    s.modal = null; s.toasts = []; s.navigate('map'); s.emit();
    // Measuring the map only: no cards or calls over it (a dialog freezes the map loop by design).
    s.openModal = () => {};
    setInterval(() => { if (s.modal) { s.modal = null; s.emit(); } }, 200);
  }, TYPES);
  await sleep(1500);
  if (process.env.CSS) await page.addStyleTag({ content: process.env.CSS });
  if (process.env.ONLY1) process.env.ONE = '1';
  if (throttle > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
  await page.evaluate(() => {
    window.__lt = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch { /* */ }
  });
  // Perf rig only (a throwaway game): every aircraft flies a long leg from its airport right now (the arrival event is
  // made stale so they keep flying for the window), so 26 aircraft move at a real 4× pace the whole time.
  const launch = () => process.env.MODE === 'engine' ? Promise.resolve() : page.evaluate(() => {
    const s = window.__contrail;
    const g = s.game;
    g.now = Math.floor(s.exact);
    const far = ['JFK', 'GRU', 'DXB', 'NRT', 'JNB', 'SIN', 'ORD', 'LAX', 'BOM', 'EZE', 'YYZ', 'MIA', 'DEL', 'HKG', 'SYD', 'BKK'];
    Object.values(g.fleet).forEach((ac, i) => {
      if (ac.flightId && g.flights[ac.flightId]) { g.flights[ac.flightId].ev++; }
      const from = ac.at;
      const id = `perf${i}-${g.now}`;
      const proto = Object.values(g.flights).find((f) => f.aircraftId) ?? {};
      g.flights[id] = { ...structuredClone(proto), dutyId: null, contractId: null, id, no: `PRF${i}`, aircraftId: ac.id, kind: 'ferry', from, to: far[i % far.length], std: g.now - 20 - i * 9, sta: g.now + 700 + i * 13, block: 720 + i * 22, delay: 0, status: 'enroute', atd: g.now - 20 - i * 9, eta: g.now + 700 + i * 13, ev: 99 };
      ac.flightId = id;
    });
    s.emit();
  });
  const measure = async (name, secs) => {
    await launch();
    await sleep(2000);
    if (process.env.TRACE) {
      await browser.startTracing(page, { path: 'trace.json', categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'cc', 'blink'] });
      await sleep(6000);
      await browser.stopTracing();
      const ev = JSON.parse(require('fs').readFileSync('trace.json', 'utf8')).traceEvents;
      const sum = new Map();
      const threads = new Map();
      for (const e of ev) if (e.ph === 'M' && e.name === 'thread_name') threads.set(`${e.pid}:${e.tid}`, e.args.name);
      for (const e of ev) {
        if (e.ph !== 'X' || !e.dur) continue;
        const th = threads.get(`${e.pid}:${e.tid}`) ?? '?';
        if (!/CrRendererMain|Compositor|CompositorTileWorker|VizCompositor|CrGpuMain/.test(th)) continue;
        const k = `${th} ${e.name}`;
        sum.set(k, (sum.get(k) ?? 0) + e.dur / 1000);
      }
      console.log([...sum].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${v.toFixed(0)} ms ${k}`).join('\n'));
    }
    if (process.env.PROF) {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
      await sleep(6000);
      const { profile } = await cdp.send('Profiler.stop');
      const self = new Map();
      const dt = profile.timeDeltas;
      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const cnt = new Map();
      for (const sId of profile.samples) cnt.set(sId, (cnt.get(sId) ?? 0) + 1);
      for (const [id, c] of cnt) { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + c); }
      const tot = profile.samples.length;
      console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, c]) => `${(100 * c / tot).toFixed(1)}% ${k}`).join('\n'));
    }
    await page.evaluate(() => { window.__contrailMap.reset(); window.__lt.length = 0; });
    const r = await page.evaluate((ms) => new Promise((res) => {
      const iv = []; let last = 0; const t0 = performance.now();
      const step = (now) => { if (last) iv.push(now - last); last = now; if (now - t0 < ms) requestAnimationFrame(step); else res(iv); };
      requestAnimationFrame(step);
    }), secs * 1000);
    if (process.env.SHOT) await page.screenshot({ path: `perf-${name.replace(/\W+/g, '_')}.png` });
    const st = await page.evaluate(() => ({ ...window.__contrailMap, lt: window.__lt.slice(), air: Object.values(window.__contrail.game.fleet).filter((a) => a.flightId).length, n: Object.keys(window.__contrail.game.fleet).length, now: window.__contrail.game.now }));
    const s = [...r].sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
    const mean = (r.reduce((a, b) => a + b, 0) / r.length).toFixed(1);
    console.log(`${name}: ${st.n} aircraft (${st.air} airborne) | ${r.length} frames, ${(r.length / secs).toFixed(0)} fps | frame interval mean ${mean} ms, p95 ${q(0.95)}, p99 ${q(0.99)}, max ${s[s.length - 1].toFixed(1)} | over 33 ms: ${r.filter((x) => x > 33.4).length} | live loop avg ${st.avgMs.toFixed(2)} ms, max ${st.maxMs.toFixed(1)} ms | long tasks ${st.lt.length} (max ${st.lt.length ? Math.max(...st.lt).toFixed(0) : 0} ms)`);
  };
  // MODE engine: the real game at 4× (the engine and React included). MODE view: the engine paused and only the map's
  // clock driven at the 4× pace (96 game minutes per second), so the map's own drawing cost is measured alone.
  const MODE = process.env.MODE || 'view';
  if (MODE === 'engine') await page.evaluate(() => { const s = window.__contrail; s.setSpeed(4); s.emit(); });
  else await page.evaluate(() => {
    const s = window.__contrail;
    s.paused = true; s.emit();
    let last = performance.now();
    const step = (now) => { s.exact += (now - last) * (1440 / 15000); last = now; requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
  await sleep(500);
  await measure(`4x map (throttle ${throttle}x)`, 12);
  if (process.env.ONE) { await browser.close(); return; }
  // Zoomed in two steps.
  for (let i = 0; i < 2; i++) { await page.click('.map-zoom button[aria-label="Zoom in"]'); await sleep(400); }
  await measure(`4x map zoomed (throttle ${throttle}x)`, 12);
  // Spotter following at 4×.
  await page.click('.map-zoom button[aria-label="Reset view"]').catch(() => {});
  await sleep(500);
  await page.click('.ops-spot-btn', { timeout: 2000 }).catch(() => console.log('(no spotter)'));
  await sleep(1500);
  await measure(`4x spotter (throttle ${throttle}x)`, 12);
  await browser.close();
})();
