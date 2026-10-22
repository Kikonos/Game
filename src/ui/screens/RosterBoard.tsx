// v0.6 roster board (UPDATE-0.6.md §F1): crew × day grid like a crew-control screen. Rows grouped by base › rank ›
// type, virtualised (visible rows + 6 overscan, snapped to 4); days zoom Week ↔ Month and scroll natively both ways.
// Long-press (touch) or press-and-drag (mouse) a duty to move it to another row: every row is tinted by the
// engine's dropTargets verdict, the ghost bubble names the hovered row's reason, a red drop asks first. Nothing
// animates but the ghost; the drag runs on refs (no React render per move).

import { BedDouble, CalendarDays, Check, Lock } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flightsRev } from '../../engine/core/entities';
import { DAY, HOUR, dayStart, fmtDay, toDate } from '../../engine/core/time';
import type { GameState, Role } from '../../engine/core/types';
import type { RatingFamily } from '../../data/acmiTypes';
import { crewRev, dropTargets, familyLabel, moveDuty, rosterBoard, type BoardBlock, type BoardRow, type DropTarget, type MoveScope } from '../../engine/crew';
import { ColourLegend } from '../components/ColourLegend';
import { Seg } from '../components/ui';
import { liveMinute, store, useThrottledNow } from '../store';
import { useRenderCount } from './common';
import { seatLabel } from '../../engine/core/perf';
import { CAL_KEY_LABEL, calKey, calLayer, calLegend, type CalKey } from './crewLogic';
import {
  BACK_DAYS, BOARD_DAYS, blockCands, blockKeys, boardItems, itemsSig, rowSig, boardLayout, dayCodes, dayWidth, dayWindow, edgeSpeed, fitText, HEAD_H, itemAt, LEFT_W,
  moraleTone, NO_BOARD_FILTER, ROLE_PLURAL, splitMark, verdictText, visibleRange, weekLabels, type BoardFilter, type BoardItem, type BoardZoom, type RankFilter,
} from './rosterBoardLogic';

const ZOOM_KEY = 'bh.boardZoom';
const SCOPE_KEY = 'bh.boardScope';
const LONG_PRESS = 400;
const TOUCH_SLOP = 8;
const MOUSE_SLOP = 6;

function stored<T extends string>(key: string, ok: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && ok.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // storage unavailable
  }
}

// Text width at the board's 12 px semibold (canvas measure, cached); falls back to an estimate.
const widths = new Map<string, number>();
let ctx: CanvasRenderingContext2D | null | undefined;
function measure(s: string): number {
  let w = widths.get(s);
  if (w !== undefined) return w;
  if (ctx === undefined) {
    ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    if (ctx) ctx.font = '650 12px "Inter Variable", Inter, system-ui, sans-serif';
  }
  w = ctx ? ctx.measureText(s).width : s.length * 7.4;
  widths.set(s, w);
  return w;
}

const fmtLeave = (t: number) => fmtDay(t - 1);
const WD_SHORT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });
const WD_NARROW = new Intl.DateTimeFormat('en-GB', { weekday: 'narrow', timeZone: 'UTC' });
const MON_SHORT = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });

interface RowProps {
  row: BoardRow;
  from: number;
  dayW: number;
  d0: number;
  d1: number;
  zoom: BoardZoom;
  tone?: DropTarget['level'] | 'source';
  selecting: boolean;
  checked: boolean;
}

const Row = memo(function Row({ row, from, dayW, d0, d1, zoom, tone, selecting, checked }: RowProps) {
  const ppm = dayW / DAY;
  const lo = from + d0 * DAY;
  const hi = from + d1 * DAY;
  const W = BOARD_DAYS * dayW;
  const month = zoom === 'month';
  const keys = blockKeys(row.blocks);
  const blocks = row.blocks
    .map((b, i) => [b, i] as const)
    .filter(([b]) => b.end > lo && b.start < hi && !(month && b.kind === 'rest'))
    .sort((a, b) => calLayer(a[0]) - calLayer(b[0]));
  const codes = month ? dayCodes(row.blocks, from, BOARD_DAYS).filter((c) => c.day >= d0 && c.day < d1) : [];
  // Week: flight numbers and route in the band above the bars, each with a ≥ 44 px tap / drag area.
  const labels = month ? [] : weekLabels(row.blocks, from, dayW, measure).filter((l) => l.hx < d1 * dayW && l.hx + l.hw > d0 * dayW);
  return (
    <div className={`rb-row ${tone ? `dt-${tone}` : ''} ${checked ? 'checked' : ''}`} data-row={row.crewId}>
      <div className="rb-name" data-name={row.crewId}>
        {selecting && <span className={`rb-check ${checked ? 'on' : ''}`} aria-hidden>{checked && <Check />}</span>}
        <span className="col rb-name-txt">
          <span className="row gap-4"><span className={`sc-role r-${row.role}`}>{row.role}</span><b className="ellipsis">{row.name}</b></span>
          <span className="row gap-4 tiny muted">
            <span className={`rb-morale ${moraleTone(row.morale)}`} aria-label={`Morale ${row.morale}`} title={`Morale ${row.morale}`} />
            <span>{row.base}</span>
            {row.leaves !== null && <span className="rb-leaves">Leaves {fmtLeave(row.leaves)}</span>}
          </span>
        </span>
      </div>
      <div className="rb-lane" style={{ width: W }}>
        {row.leaves !== null && row.leaves < hi && (
          <span className="rb-left" style={{ left: Math.max(0, (row.leaves - from) * ppm), width: Math.max(0, W - Math.max(0, (row.leaves - from) * ppm)) }} />
        )}
        {blocks.map(([b, i]) => <Block key={keys[i]} b={b} i={i} crewId={row.crewId} from={from} ppm={ppm} W={W} month={month} />)}
        {labels.map((l) => {
          const b = row.blocks[l.i];
          return (
            <span key={`h${l.i}`} className={`rb-hit k-${calKey(b)}`} style={{ left: l.hx, width: l.hw }} data-c={row.crewId} data-i={l.i} data-mv={b.movable ? 1 : undefined}>
              {l.text && <span className="rb-lbl" style={{ left: l.lx - l.hx, width: l.lw }}><LabelText text={l.text} /></span>}
            </span>
          );
        })}
        {codes.map((c) => {
          // Wide codes (MRS, WAW) set tighter rather than vanish from a 28 px day.
          const cw = measure(c.code);
          const tight = cw + 2 > dayW && cw - 3 <= dayW + 1;
          const txt = tight ? c.code : fitText([c.code], dayW, measure, 2);
          const b = row.blocks[c.i];
          return (
            <span key={c.day} className={`rb-code k-${c.key}`} style={{ left: c.day * dayW, width: dayW }} data-c={row.crewId} data-i={c.i} data-mv={b?.movable ? 1 : undefined}>
              {txt && <span className={`rb-code-t ${tight ? 'tight' : ''}`}>{txt}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
});

/** v0.7.3 a label with its duty mark drawn as a tag: bed icon + 3P/4P, +1h, SPLIT. Static. */
function LabelText({ text }: { text: string }) {
  const [base, mark] = splitMark(text);
  if (!mark) return <>{text}</>;
  return <>{base}<span className="rb-mark" aria-label={mark === '+1h' ? 'planned extension' : mark === 'SPLIT' ? 'split duty' : `${mark[0]} pilots, in-flight rest`}>{mark.endsWith('P') && <BedDouble aria-hidden />}{mark}</span></>;
}

const Block = memo(function Block({ b, i, crewId, from, ppm, W, month }: { b: BoardBlock; i: number; crewId: string; from: number; ppm: number; W: number; month: boolean }) {
  const key = calKey(b);
  const layer = calLayer(b);
  const l = Math.max(0, (b.start - from) * ppm);
  const r = Math.min(W, (b.end - from) * ppm);
  const w = r - l;
  if (w <= 0) return null;
  const thin = month && layer === 2;
  // Work and travel labels live in the week band (weekLabels) or the month day tile; status windows label themselves.
  const txt = layer === 2 || key === 'rest' ? '' : fitText(blockCands(b), w - (b.locked ? 14 : 0), measure, month ? 4 : 12);
  const free = key === 'off' && b.label === 'Free';
  // Sticky label only on status windows of two days or more (see .rb-blk.long).
  const long = layer === 1 && w >= 2 * DAY * ppm;
  return (
    <span
      className={`sc-cal rb-blk k-${key} l${layer} ${thin ? 'rb-thin' : ''} ${free ? 'free' : ''} ${b.movable ? 'mv' : ''} ${long ? 'long' : ''} ${b.legality && b.legality !== 'legal' ? b.legality : ''}`}
      style={{ left: l, width: Math.max(3, w) }}
      data-c={crewId}
      data-i={i}
      data-mv={b.movable ? 1 : undefined}
    >
      {txt && <span className="sc-cal-t"><LabelText text={txt} /></span>}
      {b.locked && w >= 16 && <Lock className="rb-lock" aria-label="set by you" />}
    </span>
  );
});

/** Today line in the grid, moved every frame from liveMinute() (no React renders). */
function TodayLine({ from, ppm }: { from: number; ppm: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      const x = Math.round((LEFT_W + (liveMinute() - from) * ppm) * 2) / 2;
      if (x !== last && ref.current) {
        ref.current.style.transform = `translateX(${x}px)`;
        last = x;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [from, ppm]);
  return <div ref={ref} className="rb-now" aria-hidden />;
}

interface Drag {
  phase: 'press' | 'drag';
  touch: boolean;
  x0: number;
  y0: number;
  x: number;
  y: number;
  crewId: string;
  dutyId: string;
  /** The block's bar (the ghost is drawn from it) and its label. */
  el: HTMLElement;
  label: string;
  timer: number;
  offX: number;
  offY: number;
  ghost?: HTMLElement;
  bubble?: HTMLElement;
  targets?: Record<string, DropTarget>;
  hover: string | null;
  raf: number;
  t: number;
}

interface Pop {
  x: number;
  y: number;
  key: CalKey;
  title: string;
  detail: string;
}

export interface RosterBoardProps {
  g: GameState;
  selecting: boolean;
  selected: Set<string>;
  onSelect: (ids: string[], on: boolean) => void;
}

const RANKS: { value: RankFilter; label: string }[] = [
  { value: 'all', label: 'All ranks' }, { value: 'pilots', label: 'Pilots' }, { value: 'cabin', label: 'Cabin' },
  ...(['CPT', 'FO', 'CRP', 'PUR', 'CC'] as Role[]).map((r) => ({ value: r as RankFilter, label: `${r} · ${ROLE_PLURAL[r]}` })),
];

/** v0.7 C2: memo'd against the Crew screen's hourly renders; the board refreshes from useThrottledNow (≤ 1 Hz running). */
export const RosterBoard = memo(function RosterBoard(props: RosterBoardProps) {
  return <Board {...props} />;
}, (a, b) => a.g === b.g && a.selecting === b.selecting && a.selected === b.selected);

function Board({ g, selecting, selected, onSelect }: RosterBoardProps) {
  const now = useThrottledNow(1000);
  useRenderCount('board');
  const [f, setF] = useState<BoardFilter>(NO_BOARD_FILTER);
  const [zoom, setZoomS] = useState<BoardZoom>(() => stored(ZOOM_KEY, ['week', 'month'] as const, 'week'));
  const [scope, setScopeS] = useState<MoveScope>(() => stored(SCOPE_KEY, ['duty', 'trip'] as const, 'trip'));
  const [view, setView] = useState({ w: 900, h: 480 });
  const [range, setRange] = useState<[number, number]>([0, 24]);
  const [days, setDays] = useState<[number, number]>([0, 14]);
  const [drag, setDrag] = useState<{ from: string; targets: Record<string, DropTarget> } | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const from = dayStart(now) - BACK_DAYS * DAY;
  const to = from + BOARD_DAYS * DAY;
  const dayW = dayWidth(zoom, view.w);
  const ppm = dayW / DAY;
  const crev = crewRev(g);
  const rev = flightsRev(g);
  const hour = Math.floor(now / HOUR);
  const nCrew = Object.keys(g.crew).length;
  // v0.7 C2: an hourly rebuild that changes nothing keeps the previous items (no re-layout, no row re-render).
  const itemsRef = useRef<{ sig: string; items: BoardItem[] } | null>(null);
  const items = useMemo(() => {
    const next = boardItems(Object.values(g.crew), f, g.company.homeBase);
    const sig = itemsSig(next);
    if (itemsRef.current?.sig === sig) return itemsRef.current.items;
    itemsRef.current = { sig, items: next };
    return next;
  }, [g, f, crev, nCrew, hour]); // eslint-disable-line react-hooks/exhaustive-deps
  const groupH = selecting ? 44 : 28;
  const { tops, total } = useMemo(() => boardLayout(items, groupH), [items, groupH]);
  const [a, b] = range;
  const shown = items.slice(a, Math.min(b, items.length));
  const ids = shown.filter((x): x is Extract<BoardItem, { kind: 'crew' }> => x.kind === 'crew').map((x) => x.id);
  // Rows whose content is unchanged keep their old object, so the memo'd Row skips them (the engine rebuilds every
  // visible row each game hour: under a second at 4×).
  const stable = useRef(new Map<string, { sig: string; row: BoardRow }>());
  const rows = useMemo(() => {
    const out = new Map<string, BoardRow>();
    for (const r of rosterBoard(g, from, to, ids)) {
      const prev = stable.current.get(r.crewId);
      if (prev?.row === r) {
        out.set(r.crewId, r);
        continue;
      }
      const sig = rowSig(r);
      if (prev && prev.sig === sig) out.set(r.crewId, prev.row);
      else {
        stable.current.set(r.crewId, { sig, row: r });
        out.set(r.crewId, r);
      }
    }
    return out;
  }, [g, from, to, ids.join(), crev, rev, now]); // eslint-disable-line react-hooks/exhaustive-deps

  // Latest values for the native drag listeners.
  const live = useRef({ items, tops, total, scope, from, g });
  live.current = { items, tops, total, scope, from, g };
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const sync = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const { tops: t, total: tt } = live.current;
    const r = visibleRange(t, tt, el.scrollTop - HEAD_H, el.clientHeight);
    setRange((p) => (p[0] === r[0] && p[1] === r[1] ? p : r));
    const dw = dayWidth(zoomRef.current, el.clientWidth);
    const d = dayWindow(el.scrollLeft, el.clientWidth, dw);
    setDays((p) => (p[0] === d[0] && p[1] === d[1] ? p : d));
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setView((v) => (v.w === el.clientWidth && v.h === el.clientHeight ? v : { w: el.clientWidth, h: el.clientHeight }));
      sync();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sync]);
  useLayoutEffect(sync, [sync, items, groupH, dayW]);

  // Today near the left edge on open and on Today (yesterday whole in Week, three days back in Month); a new day
  // width (resize, zoom) keeps the same day at the left edge, so a column is never cut at the name column.
  // scrollDW: the day width scrollLeft is currently measured in.
  const scrollDW = useRef(dayW);
  const goToday = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const dw = dayWidth(zoomRef.current, el.clientWidth);
    el.scrollLeft = Math.max(0, (BACK_DAYS - (zoomRef.current === 'week' ? 1 : 3)) * dw);
    scrollDW.current = dw;
  }, []);
  useLayoutEffect(goToday, [goToday]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && scrollDW.current !== dayW) el.scrollLeft = Math.round(el.scrollLeft / scrollDW.current) * dayW;
    scrollDW.current = dayW;
  }, [dayW]);
  const prevFrom = useRef(from);
  useLayoutEffect(() => {
    // Midnight: the window moves a day; keep the grid still under the finger.
    const el = scroller.current;
    if (el && prevFrom.current !== from) el.scrollLeft -= ((from - prevFrom.current) / DAY) * dayW;
    prevFrom.current = from;
  }, [from, dayW]);
  // The day-width effect above keeps the left-edge day.
  const setZoom = (z: BoardZoom) => {
    zoomRef.current = z;
    setZoomS(z);
    remember(ZOOM_KEY, z);
  };
  const setScope = (s: MoveScope) => {
    setScopeS(s);
    remember(SCOPE_KEY, s);
  };

  // ---------- drag ----------
  const dragRef = useRef<Drag | null>(null);
  const clickBlock = useRef(0);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const rowEl = (id: string | null) => (id ? el.querySelector<HTMLElement>(`.rb-row[data-row="${CSS.escape(id)}"]`) : null);

    const hoverAt = (d: Drag) => {
      const r = el.getBoundingClientRect();
      let id: string | null = null;
      if (d.x >= r.left && d.x < r.right && d.y >= r.top + HEAD_H && d.y < r.bottom) {
        const { items: it, tops: t, total: tt } = live.current;
        const i = itemAt(t, tt, d.y - r.top + el.scrollTop - HEAD_H);
        const x = it[i];
        if (x && x.kind === 'crew') id = x.id;
      }
      if (id !== d.hover) {
        rowEl(d.hover)?.classList.remove('rb-hover');
        d.hover = id;
      }
      rowEl(id)?.classList.add('rb-hover');
      const t = id && id !== d.crewId ? d.targets?.[id] : undefined;
      if (d.bubble) {
        d.bubble.textContent = id === d.crewId ? 'Drop on another crew member' : t ? verdictText(t) : 'Drop on a crew row';
        d.bubble.className = `rb-bubble ${t ? `dt-${t.level}` : ''}`;
      }
    };

    // Bubble above the ghost, below it in the top third of the grid; never over the source row.
    const place = (d: Drag) => {
      if (d.ghost) d.ghost.style.transform = `translate(${d.x - d.offX}px, ${d.y - d.offY}px) scale(1.04)`;
      const bub = d.bubble;
      if (!bub) return;
      const r = el.getBoundingClientRect();
      const gTop = d.y - d.offY;
      const gBot = gTop + (d.ghost?.offsetHeight ?? 26) * 1.04;
      const bh = bub.offsetHeight || 34;
      const bw = bub.offsetWidth || 200;
      const above = gTop - 10 - bh;
      const below = gBot + 10;
      const src = rowEl(d.crewId)?.getBoundingClientRect();
      const hits = (t: number) => !!src && t < src.bottom && t + bh > src.top;
      let top = d.y < r.top + HEAD_H + (r.height - HEAD_H) / 3 ? below : above;
      if (hits(top)) top = top === above ? below : above;
      bub.style.left = `${Math.round(Math.min(Math.max(d.x, bw / 2 + 8), window.innerWidth - bw / 2 - 8))}px`;
      bub.style.top = `${Math.round(Math.max(4, Math.min(top, window.innerHeight - bh - 4)))}px`;
    };

    const pickup = (d: Drag) => {
      const { g: gg, scope: sc } = live.current;
      d.phase = 'drag';
      // The clock holds while a duty is in hand (the verdicts are taken once, at pick-up).
      store.holdTime = true;
      d.targets = dropTargets(gg, d.dutyId, d.crewId, sc);
      const rect = d.el.getBoundingClientRect();
      const ghost = d.el.cloneNode(false) as HTMLElement;
      ghost.classList.add('rb-ghost');
      ghost.classList.remove('rb-thin');
      const t = document.createElement('span');
      t.className = 'sc-cal-t';
      t.textContent = d.label;
      ghost.append(t);
      const gw = Math.max(56, rect.width, d.label ? measure(d.label) + 14 : 0);
      const gh = Math.max(26, rect.height);
      ghost.style.left = '0px';
      ghost.style.top = '0px';
      ghost.style.width = `${gw}px`;
      ghost.style.height = `${gh}px`;
      d.offX = Math.min(Math.max(0, d.x0 - rect.left), gw);
      d.offY = Math.min(Math.max(0, d.y0 - rect.top), gh);
      const bubble = document.createElement('div');
      bubble.className = 'rb-bubble';
      document.body.append(ghost, bubble);
      d.ghost = ghost;
      d.bubble = bubble;
      place(d);
      hoverAt(d);
      setDrag({ from: d.crewId, targets: d.targets });
      setPop(null);
      // Auto-scroll near the top / bottom edge (≤ 600 px/s).
      d.t = performance.now();
      const tick = (now: number) => {
        const dt = Math.min(64, now - d.t) / 1000;
        d.t = now;
        const r = el.getBoundingClientRect();
        const v = edgeSpeed(d.y, r.top + HEAD_H, r.bottom);
        if (v) {
          el.scrollTop += v * dt;
          hoverAt(d);
        }
        d.raf = requestAnimationFrame(tick);
      };
      d.raf = requestAnimationFrame(tick);
    };

    const finish = (drop: boolean) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      window.clearTimeout(d.timer);
      if (d.phase !== 'drag') return;
      store.holdTime = false;
      cancelAnimationFrame(d.raf);
      d.ghost?.remove();
      d.bubble?.remove();
      rowEl(d.hover)?.classList.remove('rb-hover');
      clickBlock.current = performance.now();
      setDrag(null);
      const to = d.hover;
      const t = to && d.targets ? d.targets[to] : undefined;
      if (!drop || !to || to === d.crewId || !t || t.level === 'ineligible') return;
      const sc = live.current.scope;
      if (t.level === 'illegal') {
        store.openModal({
          kind: 'confirm', danger: true, title: 'Assign anyway?', confirm: 'Assign anyway',
          body: `${t.reason}. It stays flagged red until fixed.`,
          onConfirm: () => store.act((gg) => moveDuty(gg, d.dutyId, d.crewId, to, sc, { force: true })),
        });
      } else store.act((gg) => moveDuty(gg, d.dutyId, d.crewId, to, sc));
    };

    const press = (target: EventTarget | null, x: number, y: number, touch: boolean): Drag | null => {
      // The bar, its week label / hit area or its month day tile.
      const hit = (target as Element | null)?.closest?.<HTMLElement>('[data-mv][data-c]');
      if (!hit) return null;
      const crewId = hit.dataset.c!;
      const i = hit.dataset.i!;
      const b = rowsRef.current.get(crewId)?.blocks[Number(i)];
      if (!b?.dutyId) return null;
      const bar = hit.classList.contains('rb-blk') ? hit : hit.parentElement?.querySelector<HTMLElement>(`.rb-blk[data-i="${i}"]`) ?? hit;
      const label = splitMark(blockCands(b).find((c) => c && measure(c) <= 220) ?? '').filter(Boolean).join(' ');
      return { phase: 'press', touch, x0: x, y0: y, x, y, crewId, dutyId: b.dutyId, el: bar, label, timer: 0, offX: 0, offY: 0, hover: null, raf: 0, t: 0 };
    };

    // Touch: a long press picks up; moving first scrolls as normal.
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || dragRef.current) return finish(false);
      const t = e.touches[0];
      const d = press(e.target, t.clientX, t.clientY, true);
      if (!d) return;
      d.timer = window.setTimeout(() => {
        if (dragRef.current === d) pickup(d);
      }, LONG_PRESS);
      dragRef.current = d;
    };
    const onTouchMove = (e: TouchEvent) => {
      const d = dragRef.current;
      if (!d || !d.touch) return;
      const t = e.touches[0];
      d.x = t.clientX;
      d.y = t.clientY;
      if (d.phase === 'press') {
        if (Math.hypot(d.x - d.x0, d.y - d.y0) > TOUCH_SLOP) {
          window.clearTimeout(d.timer);
          dragRef.current = null;
        }
        return;
      }
      e.preventDefault();
      place(d);
      hoverAt(d);
    };
    const onTouchEnd = (e: TouchEvent) => {
      const d = dragRef.current;
      if (!d || !d.touch) return;
      if (d.phase === 'drag') e.preventDefault();
      finish(e.type === 'touchend');
    };
    // Mouse: press and move 6 px.
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || dragRef.current) return;
      const d = press(e.target, e.clientX, e.clientY, false);
      if (d) dragRef.current = d;
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || d.touch) return;
      d.x = e.clientX;
      d.y = e.clientY;
      if (d.phase === 'press') {
        if (Math.hypot(d.x - d.x0, d.y - d.y0) >= MOUSE_SLOP) pickup(d);
        return;
      }
      e.preventDefault();
      place(d);
      hoverAt(d);
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d && !d.touch) finish(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current) finish(false);
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchEnd, { passive: false });
    el.addEventListener('pointerdown', onDown);
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
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // ---------- taps ----------
  const onClick = (e: React.MouseEvent) => {
    if (performance.now() - clickBlock.current < 450) return;
    const t = e.target as Element;
    const grp = t.closest<HTMLElement>('[data-group]');
    if (grp) {
      const it = items.find((x) => x.kind === 'group' && x.key === grp.dataset.group);
      if (it && it.kind === 'group') onSelect(it.ids, !it.ids.every((id) => selected.has(id)));
      return;
    }
    const name = t.closest<HTMLElement>('[data-name]');
    if (name) {
      const id = name.dataset.name!;
      if (selecting) onSelect([id], !selected.has(id));
      else store.navigate('crew', { sel: { kind: 'crew', id }, view: 'people' });
      return;
    }
    const blk = t.closest<HTMLElement>('[data-c][data-i]');
    if (!blk) return setPop(null);
    const b = rows.get(blk.dataset.c!)?.blocks[Number(blk.dataset.i)];
    if (!b) return;
    if (b.kind === 'duty' && b.dutyId && g.duties[b.dutyId] && !g.duties[b.dutyId].done) {
      setPop(null);
      store.openModal({ kind: 'duty', id: b.dutyId });
      return;
    }
    const k = calKey(b);
    // v0.7.2 §2: a flown duty in a junior seat says so ('CPT (as FO)').
    const cm = g.crew[blk.dataset.c!];
    const d = b.dutyId ? g.duties[b.dutyId] : undefined;
    const slot = d && cm ? g.pairings[d.pairingId]?.slots.find((x) => x.crewId === cm.id) : undefined;
    const as = slot && cm && slot.role !== cm.role ? `\nSeat: ${seatLabel(slot.role, cm.role)}` : '';
    setPop({ x: e.clientX, y: e.clientY, key: k, title: b.kind === 'training' || b.kind === 'leave' ? b.label : b.label === 'Free' ? 'Not rostered yet' : CAL_KEY_LABEL[k], detail: b.detail + as });
  };

  const families = useMemo(() => [...new Set(Object.values(g.crew).flatMap((c) => c.ratings))].sort() as RatingFamily[], [g, nCrew, crev]); // eslint-disable-line react-hooks/exhaustive-deps
  const bases = useMemo(() => [...new Set(Object.values(g.crew).map((c) => c.base))].sort(), [g, nCrew]); // eslint-disable-line react-hooks/exhaustive-deps
  const legend = calLegend([...rows.values()].flatMap((r) => r.blocks)).filter((k) => !(zoom === 'month' && k === 'rest'));
  const W = LEFT_W + BOARD_DAYS * dayW;
  const [d0, d1] = days;
  const today = Math.floor((dayStart(now) - from) / DAY);
  const nRows = items.filter((x) => x.kind === 'crew').length;
  // v0.7 C2: day header and columns only change with the window (toLocaleDateString was the board's top self cost).
  const head = useMemo(() => Array.from({ length: d1 - d0 }, (_, k) => {
    const i = d0 + k;
    const dt = toDate(from + i * DAY);
    const wd = dt.getUTCDay();
    return (
      <span key={i} className={`rb-day ${wd === 0 || wd === 6 ? 'we' : ''} ${i === today ? 'today' : ''}`} style={{ left: LEFT_W + i * dayW, width: dayW }}>
        {zoom === 'week' ? <>{WD_SHORT.format(dt)} <b>{dt.getUTCDate()}</b> {MON_SHORT.format(dt)}</>
          : <><span className="rb-wd">{WD_NARROW.format(dt)}</span><b>{dt.getUTCDate()}</b></>}
      </span>
    );
  }), [d0, d1, from, dayW, today, zoom]);
  const cols = useMemo(() => Array.from({ length: d1 - d0 }, (_, k) => {
    const i = d0 + k;
    const wd = toDate(from + i * DAY).getUTCDay();
    return <span key={i} className={`rb-col ${wd === 0 || wd === 6 ? 'we' : ''}`} style={{ left: LEFT_W + i * dayW, width: dayW }} />;
  }), [d0, d1, from, dayW]);

  return (
    <div className="rb">
      <div className="rb-tools">
        {bases.length > 1 && (
          <select className="select" value={f.base} onChange={(e) => setF({ ...f, base: e.target.value })} aria-label="Base">
            <option value="all">All bases</option>
            {bases.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        )}
        <select className="select" value={f.rank} onChange={(e) => setF({ ...f, rank: e.target.value as RankFilter })} aria-label="Rank">
          {RANKS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {families.length > 1 && (
          <select className="select" value={f.family} onChange={(e) => setF({ ...f, family: e.target.value as BoardFilter['family'] })} aria-label="Type">
            <option value="all">Any type</option>
            {families.map((x) => <option key={x} value={x}>{familyLabel(x)}</option>)}
          </select>
        )}
        <input className="input rb-search" value={f.q} placeholder="Name, base" onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Search crew" />
        <span className="grow" />
        <Seg<BoardZoom> value={zoom} onChange={setZoom} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
        <span className="row gap-4 rb-scope"><span className="tiny dim nowrap">Drag moves</span><Seg<MoveScope> value={scope} onChange={setScope} options={[{ value: 'duty', label: 'Duty' }, { value: 'trip', label: 'Trip' }]} /></span>
        <button className="btn" onClick={goToday}><CalendarDays /> Today</button>
      </div>
      <div className={`rb-scroll ${drag ? 'dragging' : ''} z-${zoom}`} ref={scroller} onScroll={() => { sync(); if (pop) setPop(null); }} onClick={onClick}>
        <div className="rb-canvas" style={{ width: W }}>
          <div className="rb-head" style={{ width: W }}>
            <div className="rb-corner small muted">{nRows} crew</div>
            {head}
          </div>
          <div className="rb-body" style={{ height: total }}>
            {cols}
            <TodayLine from={from} ppm={ppm} />
            <div style={{ height: tops[a] ?? 0 }} />
            {shown.map((it) => {
              if (it.kind === 'group') {
                const all = selecting && it.ids.every((id) => selected.has(id));
                return (
                  <div key={it.key} className="rb-group" style={{ height: groupH }}>
                    <span className="rb-group-l">
                      <b className="small">{it.label}</b>
                      {selecting && <button className="btn btn-sm rb-group-all" data-group={it.key}>{all ? 'Clear group' : 'Select all'}</button>}
                    </span>
                  </div>
                );
              }
              const r = rows.get(it.id);
              if (!r) return <div key={it.id} className="rb-row" />;
              const tone = drag ? (it.id === drag.from ? 'source' : drag.targets[it.id]?.level) : undefined;
              return <Row key={it.id} row={r} from={from} dayW={dayW} d0={d0} d1={d1} zoom={zoom} tone={tone} selecting={selecting} checked={selected.has(it.id)} />;
            })}
          </div>
        </div>
        {!items.length && <div className="small muted sc-pad rb-empty">Nobody matches these filters.</div>}
      </div>
      <div className="rb-foot">
        {legend.map((k) => <span key={k} className="row gap-4 tiny muted"><span className={`sc-cal-sw k-${k}`} aria-hidden />{CAL_KEY_LABEL[k]}</span>)}
        <ColourLegend title="Roster board colours" align="left" items={[
          { swatch: <span className="sc-cal-sw k-operating" aria-hidden />, label: 'A duty: flights with passengers (in the contract colour)' },
          { swatch: <span className="sc-cal-sw k-positioning" aria-hidden />, label: 'Positioning or ferry: flying empty' },
          { swatch: <span className="sc-cal-sw k-deadhead" aria-hidden />, label: 'Deadhead: travelling as a passenger on an airline or a private jet' },
          { swatch: <span className="sc-cal-sw k-rest" aria-hidden />, label: 'Rest: the time off needed before the next duty' },
          { swatch: <span className="sc-cal-sw k-off" aria-hidden />, label: 'Day off' },
          { swatch: 'ring-amber', label: 'Amber ring: legal but tight (one delay breaks it)' },
          { swatch: 'ring-red', label: 'Red ring: cannot legally fly as rostered' },
          { swatch: 'idle', label: 'Faint hatch: not rostered yet (beyond 14 days)' },
          { swatch: <span className="sc-cal-sw k-standby" aria-hidden />, label: 'Dashed: home standby 06:00–18:00, on call without overtime' },
          { swatch: <span className="rb-mark"><BedDouble aria-hidden />3P</span>, label: '3P / 4P: an augmented crew, resting in turns in flight' },
          { swatch: <span className="rb-mark">+1h</span>, label: '+1h: a planned extension (at most twice a week each)' },
          { swatch: <span className="rb-mark">SPLIT</span>, label: 'SPLIT: a split duty, a long wait on the ground adds to the day' },
        ]} />
        <span className="grow" />
        <span className="tiny dim">{drag ? 'Drop on a green or amber row · red asks first · grey can’t take it' : 'Tap a duty to change its crew · long-press to drag it to someone else'}</span>
      </div>
      {pop && (
        <div className={`rb-pop k-${pop.key}`} style={{ left: Math.min(pop.x, window.innerWidth - 300), top: Math.min(pop.y + 12, window.innerHeight - 140) }} onClick={() => setPop(null)}>
          <div className="row gap-8"><span className={`sc-cal-sw k-${pop.key}`} aria-hidden /><b className="small">{pop.title}</b></div>
          {pop.detail.split('\n').map((l, i) => <div key={i} className="small muted">{l}</div>)}
        </div>
      )}
    </div>
  );
}

