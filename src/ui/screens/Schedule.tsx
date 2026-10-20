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
import { Empty, Seg } from '../components/ui';
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
  const text = w >= 64 ? b.label : w >= 22 ? b.short ?? '' : '';
  // Long idle gaps that start off-screen: keep the label near the visible left edge (window start + 18 h).
  const shift = b.kind === 'idle' ? Math.min(Math.max(0, (win0 + 18 * 60 - b.start) * ppm), Math.max(0, w - 90)) : 0;
  return (
    <div
      className={`gb gb-${b.kind}${b.done ? ' done' : ''}${b.crew ? ` crew-${b.crew}` : ''}`}
      style={{ transform: `translateX(${x.toFixed(1)}px)`, width: w, ['--kc' as string]: k }}
    >
      {text && <span style={shift ? { marginLeft: shift } : undefined}>{text}</span>}
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

function Legend({ g }: { g: GameState }) {
  const list = Object.values(g.contracts).filter((c) => c.status === 'signed' || c.status === 'active');
  return (
    <div className="gantt-legend small muted">
      {list.slice(0, 5).map((c) => (
        <span key={c.id} className="gl-item ellipsis" style={{ ['--kc' as string]: contractColor(c.color) }}><span className="sc-kdot" />{c.title}</span>
      ))}
      <span className="gl-item"><span className="gl-sw gl-pos" />positioning</span>
      <span className="gl-item"><span className="gl-sw gl-maint" />maintenance</span>
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
  const sel = store.nav.sel?.kind === 'aircraft' ? store.nav.sel.id : null;
  const fleet = Object.values(g.fleet).filter((a) => a.status !== 'leasedOut' || sel === a.id);

  const syncWin = () => {
    const el = scroller.current;
    if (!el) return;
    const w = visibleWindow(el.scrollLeft, el.clientWidth, from, ppm);
    setWin((cur) => (cur[0] === w[0] && cur[1] === w[1] ? cur : w));
  };

  const scrollTo = (t: number, frac = 0.2) => {
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
        if (cur > 0 && pending.current === null) pending.current = from + (el.scrollLeft + el.clientWidth / 2) / ppmRef.current;
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

  // Zoom keeps the time at the centre of the view.
  const setZoom = (z: ZoomDays) => {
    const el = scroller.current;
    if (el && z !== zoom) pending.current = from + (el.scrollLeft + el.clientWidth / 2) / ppm;
    setZoomState(z);
    try {
      localStorage.setItem('bh.ganttZoom', String(z));
    } catch {
      // private mode
    }
  };
  useLayoutEffect(() => {
    if (pending.current === null) return;
    scrollTo(pending.current, 0.5);
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
      </ScreenHead>
      <Legend g={g} />
      <div className="gantt card">
        <div className="gantt-left">
          <div className="gantt-corner tiny dim">{fleet.length} aircraft</div>
          {fleet.map((ac) => (
            <button key={ac.id} className={`gantt-ac ${sel === ac.id ? 'sel' : ''}`} onClick={() => store.navigate('fleet', { sel: { kind: 'aircraft', id: ac.id } })}>
              <b className="mono">{ac.reg}</b>
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
