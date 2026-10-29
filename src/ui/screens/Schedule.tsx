// Schedule (B5): per-aircraft Gantt. Rows of 56 px with a sticky left column, UTC axis with day lines,
// zoom presets 3 d / 7 d / 28 d (and pinch), native momentum scroll, only blocks in the visible window
// (±12 h, snapped to 6 h so scrolling rarely re-renders), a today line moved by rAF, and tap-to-nearest-block.
// DESIGN.md §6.3.

import { CalendarRange, Crosshair } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flightsRev } from '../../engine/core/entities';
import { typeOf } from '../../engine/core/perf';
import { DAY, fmtDay, fmtTime, localOffset } from '../../engine/core/time';
import type { Aircraft, GameState } from '../../engine/core/types';
import { TailBadge } from '../components/Logo';
import { ColourLegend } from '../components/ColourLegend';
import { Empty, Seg } from '../components/ui';
import { FLIGHT_TYPE_HINT } from '../../engine/ops';
import { mapLivery } from '../map/mapLogic';
import { liveMinute, store, useGame } from '../store';
import { Dot, ScreenHead, useRenderCount } from './common';
import { contractColor } from './palette';
import { hangarWord } from './screenLogic';
import {
  axisTicks, blockText, chooseHits, dragStart, idleAt, pickBlocks, ppmOf, pressFlight, pressMaint, rowBlocks, timelineSpan, visibleWindow, type GanttBlock, type ZoomDays,
} from './scheduleLogic';
import { quoteTripMove, tripOf, type TripMoveQuote, type TripView } from '../../engine/ops/tripMove';
import { checkMaintMove, maintWord, movableMaint, type MaintMoveCheck } from '../../engine/ops/maintMove';
import { ScreenHint } from '../components/ScreenHint';
import { cssRect, toCss } from '../device';

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

// ---------- v0.7.2.1 trip swap: long-press a flight, drag its whole trip onto another aircraft's row ----------

/** Hold this long to pick a trip up (a shorter tap opens the flight sheet as before). */
const LONG_PRESS = 350;
/** A finger that moves this far before the long press is scrolling: no pick-up. */
const TOUCH_SLOP = 10;
/** A mouse picks up after moving this far with the button down (or after the long press). */
const MOUSE_SLOP = 6;
/** When the last drag ended (its release is not a tap). */
let dragEndedAt = 0;

interface TripDrag {
  phase: 'press' | 'drag';
  /** v0.7.2.2 'maint': a booked check or refit dragged along its own row (sideways only). */
  mode: 'trip' | 'maint';
  touch: boolean;
  x0: number;
  y0: number;
  x: number;
  y: number;
  flightId: string;
  sourceId: string;
  timer: number;
  trip?: TripView;
  ghost?: HTMLDivElement;
  bubble?: HTMLDivElement;
  hover: string | null;
  quotes: Map<string, TripMoveQuote>;
  /** Maint drag: the booking, the minutes between where it was grabbed and its start, the candidate start and its check. */
  maintId?: string;
  grab?: number;
  start?: number;
  check?: MaintMoveCheck;
  checks?: Map<number, MaintMoveCheck>;
  row?: HTMLElement;
  /** Edge auto-scroll while dragging a booking: −1 / 0 / +1 and its timer. */
  edge?: number;
  edgeTimer?: number;
}

function Block({ b, from, ppm, win0 }: { b: GanttBlock; from: number; ppm: number; win0: number }) {
  const x = (b.start - from) * ppm;
  const w = Math.max(b.kind === 'idle' || b.kind === 'cont' ? 0 : 3, (b.end - b.start) * ppm);
  const k = b.color !== null ? contractColor(b.color) : undefined;
  // v0.12 only whole labels (never 'L…'): the full label, else number over route, else the number, else the short one.
  const bt = blockText(b, w);
  const tag = bt.tag === 'ferry';
  const short = bt.tag === 'short';
  // Long idle gaps that start off-screen: keep the label near the visible left edge (window start + 18 h).
  const shift = b.kind === 'idle' || b.kind === 'cont' || b.kind === 'lease' ? Math.min(Math.max(0, (win0 + 18 * 60 - b.start) * ppm), Math.max(0, w - 90)) : 0;
  return (
    <div
      data-k={b.key}
      className={`gb gb-${b.kind}${b.ftype && b.ftype !== 'operating' ? ` ${b.ftype}` : ''}${b.paint ? ' gb-paint' : ''}${b.done ? ' done' : ''}${b.crew ? ` crew-${b.crew}` : ''}${b.alert ? ' crew-short' : ''}`}
      style={{ transform: `translateX(${x.toFixed(1)}px)`, width: w, ['--kc' as string]: k, ['--pc' as string]: b.paint }}
    >
      {bt.lines.length === 2
        ? <span className="gb-two"><span>{bt.lines[0]}</span><span>{bt.lines[1]}</span></span>
        : bt.lines.length === 1 && <span style={shift ? { marginLeft: shift } : undefined}>{tag && <b className="gb-tag">FERRY</b>}{short && <b className="gb-tag cs">CREW SHORT</b>}{bt.lines[0]}</span>}
    </div>
  );
}

function Row({ g, ac, from, until, win, zoom, ppm, sel }: { g: GameState; ac: Aircraft; from: number; until: number; win: [number, number]; zoom: ZoomDays; ppm: number; sel: boolean }) {
  const blocks = rowBlocks(g, ac.id, win[0], win[1], { pills: zoom === 28, until });
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // The release of a trip drag is not a tap.
    if (performance.now() - dragEndedAt < 450) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = from + toCss(e.clientX - r.left) / ppm;
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
  const lv = mapLivery(g, ac);
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

      {/* v0.11 outlined: a leg of our contract flown by another airline */}
      <span className="gl-item"><span className="gl-sw gl-sub" />sub-chartered</span>
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
  // v0.8: an aircraft leased out dry keeps its row (the lease block sits between its two ferries).
  const fleet = Object.values(g.fleet);

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

  // v0.7.2.1 trip swap. Touch: hold a flight ~350 ms, then drag (moving first scrolls as usual; a scroll cancels the
  // press). Mouse: hold, or press and move. Rows light green / red under the finger with the reason; release on
  // another aircraft opens the confirm pop-up. No animation beyond the ghost following the finger.
  const card = useRef<HTMLDivElement>(null);
  const liveRef = useRef({ g, from, to, ppm, win, zoom });
  liveRef.current = { g, from, to, ppm, win, zoom };
  const dragRef = useRef<TripDrag | null>(null);
  useEffect(() => {
    const el = card.current;
    const sc = scroller.current;
    if (!el || !sc) return;
    const rows = (id: string | null) => (id ? [...el.querySelectorAll<HTMLElement>(`[data-ac="${CSS.escape(id)}"]`)] : []);
    const setHover = (d: TripDrag, id: string | null) => {
      if (id === d.hover) return;
      for (const r of rows(d.hover)) r.classList.remove('tm-ok', 'tm-no', 'tm-hover');
      d.hover = id;
      if (!id || id === d.sourceId) return;
      const gg = liveRef.current.g;
      let q = d.quotes.get(id);
      if (!q) d.quotes.set(id, (q = quoteTripMove(gg, d.flightId, id, { quick: true })));
      for (const r of rows(id)) r.classList.add('tm-hover', q.ok ? 'tm-ok' : 'tm-no');
    };
    const placeMaint = (d: TripDrag) => {
      const gh = d.ghost;
      const row = d.row;
      const { g: gg, from: f0, ppm: p } = liveRef.current;
      const m = d.maintId ? gg.maintenance[d.maintId] : undefined;
      if (!gh || !row || !m) return;
      // v0.12 the ghost and bubble are placed in the page's px (Settings › Size zooms it); pointer and rects are screen px.
      const rr = cssRect(row);
      const t = f0 + (toCss(d.x) - rr.left) / p;
      const start = dragStart(t, d.grab ?? 0);
      const dur = m.end - m.start;
      // Fixed on the page (never inside React's tree), clipped to the Gantt's visible width.
      const sr0 = cssRect(sc);
      const x0 = rr.left + (start - f0) * p;
      const x1 = Math.max(x0 + 3, x0 + dur * p);
      const l = Math.max(sr0.left, x0);
      const r = Math.min(sr0.right, x1);
      gh.style.display = r - l > 1 ? '' : 'none';
      gh.style.transform = `translate(${l.toFixed(1)}px, ${(rr.top + 8).toFixed(1)}px)`;
      gh.style.width = `${Math.max(0, r - l).toFixed(1)}px`;
      if (start !== d.start) {
        d.start = start;
        let c = d.checks!.get(start);
        if (!c) d.checks!.set(start, (c = checkMaintMove(gg, m.id, start)));
        d.check = c;
        const same = start === m.start;
        const tone = same ? '' : !c.ok ? 'no' : c.level === 'warn' ? 'amber' : 'ok';
        gh.className = `mm-ghost ${tone}`;
        const b = d.bubble;
        if (b) {
          const head = `${maintWord(m)[0].toUpperCase()}${maintWord(m).slice(1)} · ${fmtDay(start)} ${fmtTime(start)}${m.kind === 'refit' ? ` – ${fmtDay(start + dur)}` : ''}`;
          const tail = same ? 'Slide it left or right along the row' : `${c.usageText}${c.usageText ? ' · ' : ''}${c.ok ? 'slot free' : c.reason}`;
          b.replaceChildren(Object.assign(document.createElement('b'), { textContent: head }), Object.assign(document.createElement('span'), { textContent: tail }));
          b.className = `tm-bubble mm-bubble ${tone}`;
        }
      }
      const b = d.bubble;
      if (b) {
        const bw = b.offsetWidth || 260;
        const r = cssRect(row);
        b.style.left = `${Math.round(Math.min(Math.max(toCss(d.x), bw / 2 + 8), toCss(window.innerWidth) - bw / 2 - 8))}px`;
        // Above the row when there is room, so the finger never covers it.
        const above = r.top - (b.offsetHeight || 48) - 10;
        b.style.top = `${Math.round(above > 70 ? above : Math.min(r.bottom + 10, toCss(window.innerHeight) - (b.offsetHeight || 48) - 6))}px`;
      }
      // Near the edge of the Gantt: scroll it along (the drag keeps its place under the finger).
      const sr = sc.getBoundingClientRect();
      d.edge = d.x < sr.left + 44 ? -1 : d.x > sr.right - 44 ? 1 : 0;
    };
    const place = (d: TripDrag) => {
      if (d.mode === 'maint') return placeMaint(d);
      const gh = d.ghost;
      if (gh) gh.style.transform = `translate(${Math.round(toCss(d.x) - gh.offsetWidth / 2)}px, ${Math.round(toCss(d.y) - 58)}px)`;
      const hit = document.elementFromPoint(d.x, d.y)?.closest<HTMLElement>('[data-ac]');
      setHover(d, hit && el.contains(hit) ? hit.dataset.ac ?? null : null);
      const b = d.bubble;
      if (!b) return;
      const gg = liveRef.current.g;
      const q = d.hover ? d.quotes.get(d.hover) : undefined;
      b.textContent = !d.hover || d.hover === d.sourceId ? `Drop ${d.trip?.label ?? 'the trip'} on another aircraft` : q?.ok ? `${gg.fleet[d.hover]?.reg ?? ''}: release to see the money` : q?.reasons[0] ?? '';
      b.className = `tm-bubble ${!d.hover || d.hover === d.sourceId ? '' : q?.ok ? 'ok' : 'no'}`;
      const bw = b.offsetWidth || 240;
      b.style.left = `${Math.round(Math.min(Math.max(toCss(d.x), bw / 2 + 8), toCss(window.innerWidth) - bw / 2 - 8))}px`;
      b.style.top = `${Math.round(Math.min(toCss(d.y) + 30, toCss(window.innerHeight) - (b.offsetHeight || 34) - 6))}px`;
    };
    const pickupMaint = (d: TripDrag) => {
      const gg = liveRef.current.g;
      const m = d.maintId ? gg.maintenance[d.maintId] : undefined;
      const mv = d.maintId ? movableMaint(gg, d.maintId) : { ok: false, reason: 'Not found' };
      const row = rows(d.sourceId).find((r) => r.classList.contains('gantt-row'));
      if (!m || !mv.ok || !row) {
        dragRef.current = null;
        dragEndedAt = performance.now();
        store.toast('warn', `This ${m ? maintWord(m) : 'booking'} can't move`, mv.reason ?? undefined);
        return;
      }
      d.phase = 'drag';
      d.row = row;
      d.checks = new Map();
      store.holdTime = true;
      el.classList.add('tm-drag', 'mm-drag');
      for (const b of el.querySelectorAll<HTMLElement>(`.gb[data-k="${CSS.escape(m.id)}"]`)) b.classList.add('gb-picked', 'mm-from');
      for (const r of rows(d.sourceId)) r.classList.add('tm-src');
      const ghost = document.createElement('div');
      ghost.className = 'mm-ghost';
      const bubble = document.createElement('div');
      bubble.className = 'tm-bubble mm-bubble';
      document.body.append(ghost, bubble);
      d.ghost = ghost;
      d.bubble = bubble;
      d.edgeTimer = window.setInterval(() => {
        if (!d.edge || dragRef.current !== d) return;
        sc.scrollLeft += d.edge * 10;
        placeMaint(d);
      }, 30);
      placeMaint(d);
    };
    const pickup = (d: TripDrag) => {
      if (d.mode === 'maint') return pickupMaint(d);
      const gg = liveRef.current.g;
      const trip = tripOf(gg, d.flightId);
      if (!trip.ok) {
        dragRef.current = null;
        dragEndedAt = performance.now();
        store.toast('warn', "This trip can't change aircraft", trip.reason);
        return;
      }
      d.phase = 'drag';
      d.trip = trip;
      store.holdTime = true;
      el.classList.add('tm-drag');
      for (const f of trip.legs) for (const b of el.querySelectorAll<HTMLElement>(`.gb[data-k="${CSS.escape(f.id)}"]`)) b.classList.add('gb-picked');
      for (const r of rows(d.sourceId)) r.classList.add('tm-src');
      const k = trip.contractId ? gg.contracts[trip.contractId]?.color : undefined;
      const ghost = document.createElement('div');
      ghost.className = 'tm-ghost';
      if (k !== undefined) ghost.style.setProperty('--kc', contractColor(k));
      ghost.textContent = `${trip.label} · ${gg.fleet[d.sourceId]?.reg ?? ''}`;
      const bubble = document.createElement('div');
      bubble.className = 'tm-bubble';
      document.body.append(ghost, bubble);
      d.ghost = ghost;
      d.bubble = bubble;
      place(d);
    };
    const finish = (drop: boolean) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      window.clearTimeout(d.timer);
      if (d.edgeTimer) window.clearInterval(d.edgeTimer);
      if (d.phase !== 'drag') return;
      store.holdTime = false;
      dragEndedAt = performance.now();
      d.ghost?.remove();
      d.bubble?.remove();
      el.classList.remove('tm-drag', 'mm-drag');
      for (const x of el.querySelectorAll('.gb-picked')) x.classList.remove('gb-picked', 'mm-from');
      if (d.mode === 'maint') {
        for (const x of el.querySelectorAll('.tm-src')) x.classList.remove('tm-src');
        const m = d.maintId ? liveRef.current.g.maintenance[d.maintId] : undefined;
        if (!drop || !m || d.start === undefined || d.start === m.start) return;
        if (d.check?.ok) store.openModal({ kind: 'maintMove', maintId: m.id, start: d.start });
        else store.toast('warn', `Can't move the ${maintWord(m)} there`, d.check?.reason ?? undefined);
        return;
      }
      for (const x of el.querySelectorAll('.tm-src, .tm-hover')) x.classList.remove('tm-src', 'tm-hover', 'tm-ok', 'tm-no');
      if (drop && d.hover && d.hover !== d.sourceId) store.openModal({ kind: 'tripMove', flightId: d.flightId, targetId: d.hover });
    };
    const press = (target: EventTarget | null, x: number, y: number, touch: boolean): TripDrag | null => {
      const row = (target as Element | null)?.closest?.<HTMLElement>('.gantt-row');
      const acId = row?.dataset.ac;
      if (!row || !acId) return null;
      const { g: gg, from: f0, to: t1, ppm: p, win: w, zoom: z } = liveRef.current;
      const t = f0 + toCss(x - row.getBoundingClientRect().left) / p;
      const blocks = rowBlocks(gg, acId, w[0], w[1], { pills: z === 28, until: t1 });
      // v0.7.2.2: a booked check or refit slides along its own row.
      const mid = pressMaint(gg, blocks, t, p);
      if (mid) return { phase: 'press', mode: 'maint', touch, x0: x, y0: y, x, y, flightId: '', sourceId: acId, timer: 0, hover: null, quotes: new Map(), maintId: mid, grab: t - gg.maintenance[mid].start };
      const id = pressFlight(gg, blocks, t, p);
      if (!id) return null;
      return { phase: 'press', mode: 'trip', touch, x0: x, y0: y, x, y, flightId: id, sourceId: acId, timer: 0, hover: null, quotes: new Map() };
    };
    const arm = (d: TripDrag) => {
      d.timer = window.setTimeout(() => {
        if (dragRef.current === d && d.phase === 'press') pickup(d);
      }, LONG_PRESS);
      dragRef.current = d;
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || dragRef.current) return finish(false);
      const t = e.touches[0];
      const d = press(e.target, t.clientX, t.clientY, true);
      if (d) arm(d);
    };
    const onTouchMove = (e: TouchEvent) => {
      const d = dragRef.current;
      if (!d || !d.touch) return;
      const t = e.touches[0];
      d.x = t.clientX;
      d.y = t.clientY;
      if (d.phase === 'press') {
        if (Math.hypot(d.x - d.x0, d.y - d.y0) > TOUCH_SLOP) finish(false);
        return;
      }
      e.preventDefault();
      place(d);
    };
    const onTouchEnd = (e: TouchEvent) => {
      const d = dragRef.current;
      if (!d || !d.touch) return;
      if (d.phase === 'drag') e.preventDefault();
      finish(e.type === 'touchend');
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button !== 0 || dragRef.current) return;
      const d = press(e.target, e.clientX, e.clientY, false);
      if (d) arm(d);
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || d.touch) return;
      d.x = e.clientX;
      d.y = e.clientY;
      if (d.phase === 'press') {
        if (Math.hypot(d.x - d.x0, d.y - d.y0) >= MOUSE_SLOP) {
          window.clearTimeout(d.timer);
          pickup(d);
        }
        return;
      }
      e.preventDefault();
      place(d);
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d && !d.touch) finish(true);
    };
    // A scroll (the Gantt sideways, the page up and down) before the pick-up is a scroll, not a press.
    const onScroll = () => {
      if (dragRef.current?.phase === 'press') finish(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current) finish(false);
    };
    const onMenu = (e: Event) => {
      if (dragRef.current) e.preventDefault();
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchEnd, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('contextmenu', onMenu);
    sc.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      finish(false);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('contextmenu', onMenu);
      sc.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [fleet.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const ticks = axisTicks(win[0], win[1], zoom, ppm);
  return (
    <div className="screen sc-schedule">
      <ScreenHead title="Schedule" sub={<>Times in UTC · {base} local is {offLabel} · tap a flight for details · hold and drag it to move the trip, or a check or refit to move it along its row · pinch to zoom</>}>
        <button className="btn" onClick={() => scrollTo(g.now)}><Crosshair /> Today</button>
        <Seg<ZoomDays> value={zoom} onChange={setZoom} options={ZOOMS.map((z) => ({ value: z, label: `${z} days` }))} />
        <ColourLegend title="Schedule colours" hint="schedule" items={[
          { swatch: 'op', label: 'Solid block in a contract colour: a flight with passengers, flown by us' },
          { swatch: 'pos', label: 'Striped outline: positioning or ferry, empty' },
          { swatch: 'corner', label: 'Red corner: the crew cannot legally fly it · amber corner: no crew yet' },
          { swatch: <span className="cs-banner red" style={{ height: 18, fontSize: 11 }}>CREW SHORT</span>, label: 'A crew shortage the warning ladder has flagged (tap the block → Crew Control)' },
          { swatch: <span className="gl-sw gl-sub" />, label: 'Outlined: a leg of our contract flown by another airline (sub-chartered)' },
          { swatch: 'maint', label: 'Hatched grey: a check, repair or paint shop' },
          { swatch: 'idle', label: 'Dashed outline: idle 12 h or more (rent still runs)' },
          { swatch: 'grey', label: 'Faded: already flown' },
        ]} />
      </ScreenHead>
      <ScreenHint id="schedule" />
      <Legend g={g} win={win} />
      <div className="gantt card" ref={card}>
        <div className="gantt-left">
          <div className="gantt-corner tiny dim">{fleet.length} aircraft</div>
          {fleet.map((ac) => (
            <button key={ac.id} data-ac={ac.id} className={`gantt-ac ${sel === ac.id ? 'sel' : ''}`} onClick={() => performance.now() - dragEndedAt > 450 && store.navigate('fleet', { sel: { kind: 'aircraft', id: ac.id } })}>
              <span className="row gap-8 gantt-ac-reg"><AcBadge g={g} ac={ac} /><b className="mono">{ac.reg}</b></span>
              <span className="tiny muted ellipsis">{typeOf(ac.typeId).short} · {ac.cabin.label}</span>
              <span className="tiny ellipsis row gap-4"><Dot tone={STATUS_TONE[ac.status]} />{ac.at} · {ac.status === 'maintenance' ? hangarWord(g, ac) : STATUS_LABEL[ac.status]}</span>
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
