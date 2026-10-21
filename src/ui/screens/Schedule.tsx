// Schedule (B5): per-aircraft Gantt. Rows of 56 px with a sticky left column, UTC axis with day lines,
// zoom presets 3 d / 7 d / 28 d (and pinch), native momentum scroll, only blocks in the visible window
// (±12 h, snapped to 6 h so scrolling rarely re-renders), a today line moved by rAF, and tap-to-nearest-block.
// DESIGN.md §6.3.

import { CalendarRange, Crosshair } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flightsRev } from '../../engine/core/entities';
import { typeOf } from '../../engine/core/perf';
import { DAY, localOffset } from '../../engine/core/time';
import type { Aircraft, GameState } from '../../engine/core/types';
import { TailBadge } from '../components/Logo';
import { ColourLegend } from '../components/ColourLegend';
import { Empty, Seg } from '../components/ui';
import { FLIGHT_TYPE_HINT, liveryOf } from '../../engine/ops';
import { liveMinute, store, useGame } from '../store';
import { Dot, ScreenHead, useRenderCount } from './common';
import { contractColor } from './palette';
import {
  axisTicks, chooseHits, idleAt, pickBlocks, ppmOf, rowBlocks, timelineSpan, visibleWindow, type GanttBlock, type ZoomDays,
} from './scheduleLogic';

const ZOOMS: ZoomDays[] = [3, 7, 28];
const STATUS_TONE: Record<Aircraft['status'], 'good' | 'warn' | 'bad' | 'info' | 'off'> = {
  available: 'good', flying: 'info', maintenance: 'warn', aog: 'bad', delivering: 'off', stored: 'off', leasedOut: 'off',
};
const STATUS_LABEL: Record<Aircraft['status'], string> = {
  available: 'on ground', flying: 'flying', maintenance: 'in check', aog: 'AOG', delivering: 'delivering', stored: 'stored', leasedOut: 'leased out',
};

const loadZoom = (): ZoomDays => {
  try {
    const z = Number(localStorage.getItem('bh.ganttZoom'));
    return (ZOOMS as number[]).includes(z) ? (z as ZoomDays) : 7;
  } catch {
    return 7;
  }
};

function Block({ b, from, ppm, win0 }: { b: GanttBlock; from: number; ppm: number; win0: number }) {
  const x = (b.start - from) * ppm;
  const w = Math.max(b.kind === 'idle' ? 0 : 3, (b.end - b.start) * ppm);
  const k = b.color !== null ? contractColor(b.color) : undefined;
  // The short label only when it fits whole (12 px padding + ≈ 9 px per bold capital): never 'L…'.
  const text = w >= 64 ? b.label : b.short && w >= 12 + (b.short.length === 1 ? 7.5 : 9 * b.short.length) ? b.short : '';
  // Ferry legs carry the FERRY tag in front of the full label (the short label already is 'FERRY').
  const tag = b.ftype === 'ferry' && w >= 120 && text === b.label;
  // v0.7.1 §3.12: a flight the crew-shortage ladder marked carries CREW SHORT in front of its label when it fits.
  const short = !!b.alert && w >= 150 && text === b.label;
  // Long idle gaps that start off-screen: keep the label near the visible left edge (window start + 18 h).
  const shift = b.kind === 'idle' ? Math.min(Math.max(0, (win0 + 18 * 60 - b.start) * ppm), Math.max(0, w - 90)) : 0;
  return (
    <div
      className={`gb gb-${b.kind}${b.ftype && b.ftype !== 'operating' ? ` ${b.ftype}` : ''}${b.paint ? ' gb-paint' : ''}${b.done ? ' done' : ''}${b.crew ? ` crew-${b.crew}` : ''}${b.alert ? ' crew-short' : ''}`}
      style={{ transform: `translateX(${x.toFixed(1)}px)`, width: w, ['--kc' as string]: k, ['--pc' as string]: b.paint }}
    >
      {text && <span style={shift ? { marginLeft: shift } : undefined}>{tag && <b className="gb-tag">FERRY</b>}{short && <b className="gb-tag cs">CREW SHORT</b>}{text}</span>}
    </div>
  );
}

function Row({ g, ac, from, until, win, zoom, ppm, sel }: { g: GameState; ac: Aircraft; from: number; until: number; win: [number, number]; zoom: ZoomDays; ppm: number; sel: boolean }) {
  const blocks = rowBlocks(g, ac.id, win[0], win[1], { pills: zoom === 28, until });
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = from + (e.clientX - r.left) / ppm;
    const picked = chooseHits(pickBlocks(blocks, t, ppm));
    if (picked.length) {
      store.openModal({ kind: 'sheet', refs: picked.flatMap((b) => b.refs) });
      return;
    }
    const idle = idleAt(blocks, t);
    if (idle) store.openModal({ kind: 'sheet', refs: [], idle: { aircraftId: ac.id, from: idle.start, to: idle.end, at: idle.at ?? ac.at } });
  };
  return (
    <div className={`gantt-row ${sel ? 'sel' : ''}`} data-ac={ac.id} onClick={onClick}>
      {blocks.map((b) => <Block key={b.key} b={b} from={from} ppm={ppm} win0={win[0]} />)}
    </div>
  );
}

/** Today line: positioned every frame from liveMinute(), no React renders. */
function TodayLine({ from, ppm }: { from: number; ppm: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      const x = Math.round((liveMinute() - from) * ppm * 2) / 2;
      if (x !== last && ref.current) {
        ref.current.style.transform = `translateX(${x}px)`;
        last = x;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [from, ppm]);
  return <div ref={ref} className="gantt-now" aria-hidden />;
}

const LEGEND_MAX = 6;

/** The fin the aircraft wears now (client colours during a painted contract). */
function AcBadge({ g, ac }: { g: GameState; ac: Aircraft }) {
  const lv = liveryOf(g, ac);
  return <TailBadge primary={lv.livery.primary} secondary={lv.livery.secondary} code={lv.code} livery={lv.livery} size={20} />;
}

/** Contracts with flights in the visible window (by first flight), so every block colour on screen has a key. */
function Legend({ g, win }: { g: GameState; win: [number, number] }) {
  const first = new Map<string, number>();
  for (const f of Object.values(g.flights)) {
    if (!f.contractId || !f.aircraftId || f.std >= win[1] || f.sta <= win[0]) continue;
    first.set(f.contractId, Math.min(first.get(f.contractId) ?? Infinity, f.std));
  }
  const list = [...first.keys()].map((id) => g.contracts[id]).filter((c) => !!c).sort((a, b) => first.get(a.id)! - first.get(b.id)!);
  const more = list.length - LEGEND_MAX;
  // the legend swatch takes the colour of the first paint block on screen (blocks hatch in the client colour)
  const pm = Object.values(g.maintenance).filter((m) => m.kind === 'paint' && m.status !== 'cancelled' && m.start < win[1] && m.end > win[0]).sort((a, b) => a.start - b.start)[0];
  const paint = pm && ((pm.paint?.phase === 'in' ? (pm.paint && g.contracts[pm.paint.contractId]?.paint?.livery.primary) : g.company.livery.primary) ?? '#8a96b3');
  return (
    <div className="gantt-legend small muted">
      <span className="gl-item" title={`${FLIGHT_TYPE_HINT.operating}: solid, in the contract colour`}><span className="gl-sw gl-op" />Operating</span>
      <span className="gl-item" title={FLIGHT_TYPE_HINT.positioning}><span className="gl-sw gl-ft positioning" />Positioning</span>
      <span className="gl-item" title={FLIGHT_TYPE_HINT.ferry}><span className="gl-sw gl-ft ferry" />Ferry</span>
      <span className="gl-sep" aria-hidden />
      {list.slice(0, more > 0 ? LEGEND_MAX - 1 : LEGEND_MAX).map((c) => (
        <span key={c.id} className="gl-item ellipsis" style={{ ['--kc' as string]: contractColor(c.color) }}><span className="sc-kdot" />{c.title}</span>
      ))}
      {more > 0 && <span className="gl-item" title={list.slice(LEGEND_MAX - 1).map((c) => c.title).join(' · ')}>+{more + 1} more</span>}

      <span className="gl-item"><span className="gl-sw gl-maint" />maintenance</span>
      {paint && <span className="gl-item"><span className="gl-sw gl-paint" style={{ ['--pc' as string]: paint }} />paint shop</span>}
      <span className="gl-item"><span className="gl-sw gl-idle" />idle 12 h+</span>
      <span className="gl-item"><span className="gl-sw gl-crew" />crew problem</span>
    </div>
  );
}

export function ScheduleScreen() {
  useRenderCount('schedule');
  const g = useGame();
  const [zoom, setZoomState] = useState<ZoomDays>(loadZoom);
  const scroller = useRef<HTMLDivElement>(null);
  // The preset is what fits the visible width: "7 days" shows a week on any screen.
  const [viewW, setViewW] = useState(0);
  const ppm = viewW > 0 ? viewW / (zoom * DAY) : ppmOf(zoom);
  const ppmRef = useRef(ppm);
  ppmRef.current = ppm;
  const rev = flightsRev(g);
  const day = Math.floor(g.now / DAY);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const [from, to] = useMemo(() => timelineSpan(g), [g, rev, day]);
  const width = Math.ceil((to - from) * ppm);
  const [win, setWin] = useState<[number, number]>(() => [g.now - 2 * DAY, g.now + 9 * DAY]);
  const pending = useRef<number | null>(null);
  /** Where `pending` lands in the view (0.5 = centre). */
  const pendingFrac = useRef(0.5);
  const sel = store.nav.sel?.kind === 'aircraft' ? store.nav.sel.id : null;
  const fleet = Object.values(g.fleet).filter((a) => a.status !== 'leasedOut' || sel === a.id);

  const syncWin = () => {
    const el = scroller.current;
    if (!el) return;
    const w = visibleWindow(el.scrollLeft, el.clientWidth, from, ppm);
    setWin((cur) => (cur[0] === w[0] && cur[1] === w[1] ? cur : w));
  };

  const scrollTo = (t: number, frac = 0.1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, (t - from) * ppm - el.clientWidth * frac);
    syncWin();
  };

  // Measure the view (before paint); a resize keeps the time at the centre.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setViewW(el.clientWidth);
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      setViewW((cur) => {
        if (cur === w || !w) return cur;
        if (cur > 0 && pending.current === null) {
          pending.current = from + (el.scrollLeft + el.clientWidth / 2) / ppmRef.current;
          pendingFrac.current = 0.5;
        }
        return w;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // First layout once measured: today (or the deep-linked time in nav.view) near the left edge; the selected aircraft's row into view.
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (placed.current || viewW <= 0) return;
    placed.current = true;
    pending.current = null;
    const at = Number(store.nav.view);
    scrollTo(Number.isFinite(at) && at > 0 ? at : g.now);
    if (sel) document.querySelector(`.gantt-row[data-ac="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewW]);

  // Zoom keeps 'now' near the left edge when it was on screen, otherwise the time at the centre.
  const setZoom = (z: ZoomDays) => {
    const el = scroller.current;
    if (el && z !== zoom) {
      const t0 = from + el.scrollLeft / ppm;
      const t1 = t0 + el.clientWidth / ppm;
      const nowSeen = g.now >= t0 && g.now <= t1;
      pending.current = nowSeen ? g.now : (t0 + t1) / 2;
      pendingFrac.current = nowSeen ? 0.1 : 0.5;
    }
    setZoomState(z);
    try {
      localStorage.setItem('bh.ganttZoom', String(z));
    } catch {
      // private mode
    }
  };
  useLayoutEffect(() => {
    if (pending.current === null) return;
    scrollTo(pending.current, pendingFrac.current);
    pending.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ppm]);

  // Pinch (two fingers) and ctrl/⌘ + wheel step through the zoom presets.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let d0 = 0;
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const step = (dir: 1 | -1) => {
      const i = ZOOMS.indexOf(zoom) + dir;
      if (i >= 0 && i < ZOOMS.length) setZoom(ZOOMS[i]);
    };
    const start = (e: TouchEvent) => {
      d0 = e.touches.length === 2 ? dist(e) : 0;
    };
    const move = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !d0) return;
      const r = dist(e) / d0;
      if (r > 1.35) {
        step(-1);
        d0 = 0;
      } else if (r < 0.7) {
        step(1);
        d0 = 0;
      }
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      step(e.deltaY < 0 ? -1 : 1);
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('wheel', wheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, from, ppm]);

  const base = g.company.homeBase;
  const off = localOffset(base, g.now) / 60;
  const offLabel = off === 0 ? 'UTC' : `UTC${off > 0 ? '+' : '−'}${Math.abs(off)}`;

  if (!fleet.length) {
    return (
      <div className="screen sc-schedule">
        <ScreenHead title="Schedule" />
        <Empty icon={<CalendarRange />} title="No aircraft yet">Lease an aircraft from the Fleet tab; its flights and checks appear here.</Empty>
      </div>
    );
  }

  const ticks = axisTicks(win[0], win[1], zoom);
  return (
    <div className="screen sc-schedule">
      <ScreenHead title="Schedule" sub={<>Times in UTC · {base} local is {offLabel} · tap a row for details · pinch to zoom</>}>
        <button className="btn" onClick={() => scrollTo(g.now)}><Crosshair /> Today</button>
        <Seg<ZoomDays> value={zoom} onChange={setZoom} options={ZOOMS.map((z) => ({ value: z, label: `${z} days` }))} />
        <ColourLegend title="Schedule colours" items={[
          { swatch: 'op', label: 'Solid block in a contract colour: a flight with passengers, flown by us' },
          { swatch: 'pos', label: 'Striped outline: positioning or ferry, empty' },
          { swatch: 'corner', label: 'Red corner: the crew cannot legally fly it · amber corner: no crew yet' },
          { swatch: <span className="cs-banner red" style={{ height: 18, fontSize: 11 }}>CREW SHORT</span>, label: 'A crew shortage the warning ladder has flagged (tap the block → Crew Control)' },
          { swatch: 'maint', label: 'Hatched grey: a check, repair or paint shop' },
          { swatch: 'idle', label: 'Dashed outline: idle 12 h or more (rent still runs)' },
          { swatch: 'grey', label: 'Faded: already flown' },
        ]} />
      </ScreenHead>
      <Legend g={g} win={win} />
      <div className="gantt card">
        <div className="gantt-left">
          <div className="gantt-corner tiny dim">{fleet.length} aircraft</div>
          {fleet.map((ac) => (
            <button key={ac.id} className={`gantt-ac ${sel === ac.id ? 'sel' : ''}`} onClick={() => store.navigate('fleet', { sel: { kind: 'aircraft', id: ac.id } })}>
              <span className="row gap-8 gantt-ac-reg"><AcBadge g={g} ac={ac} /><b className="mono">{ac.reg}</b></span>
              <span className="tiny muted ellipsis">{typeOf(ac.typeId).short} · {ac.cabin.label}</span>
              <span className="tiny ellipsis row gap-4"><Dot tone={STATUS_TONE[ac.status]} />{ac.at} · {STATUS_LABEL[ac.status]}</span>
            </button>
          ))}
        </div>
        <div className="gantt-scroll" ref={scroller} onScroll={syncWin}>
          <div className={`gantt-track z${zoom}`} style={{ width, ['--day-px' as string]: `${(ppm * DAY).toFixed(2)}px` }}>
            <div className="gantt-axis">
              {ticks.map((t) => (
                <span key={t.t} className={`gt ${t.major ? 'major' : ''}`} style={{ transform: `translateX(${((t.t - from) * ppm).toFixed(1)}px)` }}>{t.label}</span>
              ))}
            </div>
            {fleet.map((ac) => <Row key={ac.id} g={g} ac={ac} from={from} until={to} win={win} zoom={zoom} ppm={ppm} sel={sel === ac.id} />)}
            <TodayLine from={from} ppm={ppm} />
          </div>
        </div>
      </div>
    </div>
  );
}
