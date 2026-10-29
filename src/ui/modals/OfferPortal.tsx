// v0.9.1 the offer dialog's schedule portal: under each candidate aircraft a mini timeline of that aircraft (a window
// into the Schedule screen) with the requested contract window highlighted, shown whether or not the aircraft is free.
// A trip on it moves to another aircraft as on the Schedule: hold and drag it onto another candidate's timeline, or tap
// it and pick the aircraft. Either way the Schedule's profit/loss confirm (TripMoveModal, quoteTripMove) decides, and
// the offer dialog comes back with its feasibility lines worked out again. Touch first: blocks are 30 px tall.
//
// v0.12 (player request) every scheduled flight is its own block at a readable scale (a day at least 120 px; the
// timeline scrolls sideways and opens on the job); only work without flights yet stays one block (a base programme's
// days still to come, a dry lease, a delivery). Flights in the way of the new job have a red outline, and the open
// aircraft lists those trips with what can be done: move it to another aircraft, or sub-lease it (another operator
// flies it for us; the client still pays us). Touch and mouse: a long press lifts a trip on a touch screen (the
// timeline still scrolls with a swipe), a mouse drags at once; a tap or click picks it.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRightLeft, Handshake, Menu, TriangleAlert, X } from 'lucide-react';
import { DAY, fmtDay, fmtTime } from '../../engine/core/time';
import type { ContractOffer, GameState, Minute } from '../../engine/core/types';
import type { FeasibilityReport } from '../../engine/contracts';
import { quoteTripMove, tripOf } from '../../engine/ops/tripMove';
import { subleaseTrip } from '../../engine/ops/sublease';
import { contractColor } from '../screens/palette';
import { store } from '../store';
import { toCss } from '../device';
import { money } from '../format';
import { clashTrips, offerGhosts, portalBlocks, portalWidth, subleaseGroups, type ClashTrip } from './offerPortalLogic';
import { SUBLEASE_LINE } from './SubcharterModal';

/** The portal's window: two days either side of the job, at most three weeks (a long base shows its first weeks). Pure. */
export function portalWindow(o: Pick<ContractOffer, 'start' | 'end'>, now: Minute): [Minute, Minute] {
  const from = Math.max(Math.floor(now / DAY) * DAY, Math.floor(o.start / DAY) * DAY - 2 * DAY);
  const to = Math.min(Math.ceil(o.end / DAY) * DAY + 2 * DAY, from + 21 * DAY);
  return [from, Math.max(to, from + 4 * DAY)];
}

/** Long-press before a trip lifts (touch), the slop that makes it a scroll instead, and the mouse's drag threshold. */
const HOLD_MS = 350;
const SLOP = 10;
const MOUSE_SLOP = 6;

interface Drag { flightId: string; x0: number; y0: number; timer: number; lifted: boolean; touch: boolean; ghost?: HTMLDivElement; hover?: string | null; x?: number; y?: number; raf?: number }

/** Near the dialog's top or bottom edge (px) a lifted trip scrolls the dialog, so every aircraft can be reached. */
const EDGE = 64;

/** Opens the Schedule's trip move confirm, coming back to this offer afterwards. */
function askMove(offerId: string, flightId: string, targetId: string) {
  store.openModal({ kind: 'tripMove', flightId, targetId, back: { kind: 'offer', offerId } });
}

/** Opens the sub-lease (sub-charter) dialog on these legs, coming back to this offer afterwards. */
export function askSublease(offerId: string, contractId: string, flightIds: string[], flightId?: string) {
  store.openModal({ kind: 'subcharter', contractId, flightIds, flightId, back: { kind: 'offer', offerId } });
}

const rowAt = (x: number, y: number): string | null => document.elementFromPoint(x, y)?.closest<HTMLElement>('.v91-portal[data-ac]')?.dataset.ac ?? null;
const clearHover = () => {
  for (const el of document.querySelectorAll('.v91-portal.drop-ok, .v91-portal.drop-no')) el.classList.remove('drop-ok', 'drop-no');
};

/** What a picked trip can do: move to another candidate aircraft, or be sub-leased (with the price, or why not). */
function TripActions({ g, offerId, flightId, others, onClose }: { g: GameState; offerId: string; flightId: string; others: string[]; onClose: () => void }) {
  const trip = tripOf(g, flightId);
  const sub = subleaseTrip(g, flightId);
  const f = g.flights[flightId];
  const quotes = trip.ok ? others.map((id) => ({ id, q: quoteTripMove(g, flightId, id, { quick: true }) })) : [];
  return (
    <div className="v91-move v12-trip-actions">
      <div className="row gap-6 v12-ta-head">
        <span className="small grow"><b>{trip.label || (f ? `${f.from}–${f.to}` : '')}</b> <span className="muted">{fmtDay(trip.start)} {fmtTime(trip.start)} UTC</span></span>
        <button className="btn btn-sm btn-ghost btn-icon" aria-label="Close" onClick={onClose}><X /></button>
      </div>
      <div className="row gap-6 wrap v12-ta-row">
        <span className="small v12-ta-k"><ArrowRightLeft /> Move to</span>
        {trip.ok ? (
          <>
            {quotes.map(({ id, q }) => (
              <button key={id} className={`btn btn-sm ${q.ok ? '' : 'dim'}`} disabled={!q.ok} title={q.ok ? undefined : q.reasons[0]} onClick={() => askMove(offerId, flightId, id)}>
                {g.fleet[id].reg}
              </button>
            ))}
            {!others.length && <span className="small muted">No other aircraft.</span>}
          </>
        ) : (
          <span className="small muted v12-ta-why">{trip.reason}</span>
        )}
      </div>
      {/* A touch screen shows no tooltips: why an aircraft can't take it, in words. */}
      {trip.ok && quotes.filter((x) => !x.q.ok).slice(0, 2).map(({ id, q }) => (
        <span key={id} className="tiny muted v12-ta-note">{q.reasons[0]?.startsWith(g.fleet[id].reg) ? q.reasons[0] : `${g.fleet[id].reg}: ${q.reasons[0]}`}</span>
      ))}
      <div className="row gap-6 wrap v12-ta-row">
        <button className="btn btn-sm v12-sublease" disabled={!sub.ok} onClick={() => sub.contractId && askSublease(offerId, sub.contractId, sub.flightIds, flightId)}>
          <Handshake /> Sub-lease{sub.best ? ` · ${money(sub.best.cost)}` : ''}
        </button>
        <span className={`small v12-ta-why ${sub.ok ? 'muted' : 'warn'}`}>{sub.ok ? `${SUBLEASE_LINE} Best: ${sub.best!.rivalName}.` : sub.reason}</span>
      </div>
    </div>
  );
}

/** The open aircraft's work in the way of the new job: each trip (tap: what it can do), programmes without flights yet, checks. */
function ClashList({ g, o, r, trips, picked, onPick, others }: { g: GameState; o: ContractOffer; r: FeasibilityReport; trips: ClashTrip[]; picked: string | null; onPick: (id: string | null) => void; others: string[] }) {
  const progs = r.conflicts.programmes.map((id) => g.contracts[id]).filter((c) => !!c);
  const checks = r.conflicts.maintenance.map((id) => g.maintenance[id]).filter((m) => !!m);
  if (!trips.length && !progs.length && !checks.length) return null;
  const groups = subleaseGroups(trips);
  const pickedTrip = picked ? trips.find((t) => t.legIds.includes(picked)) : undefined;
  return (
    <div className="col gap-6 v12-clash">
      <div className="row gap-8 wrap v12-clash-head">
        <span className="small bad grow"><TriangleAlert /> In the way of this job{trips.length ? ` · ${trips.length} trip${trips.length > 1 ? 's' : ''}` : ''}</span>
        {groups.length === 1 && groups[0].trips.length > 1 && (
          <button className="btn btn-sm v12-sublease" onClick={() => askSublease(o.id, groups[0].contractId, groups[0].flightIds)}><Handshake /> Sub-lease all {groups[0].trips.length}</button>
        )}
      </div>
      {trips.map((t) => (
        <div key={t.key} className="col">
          <button className={`v12-clash-row ${pickedTrip === t ? 'on' : ''}`} onClick={() => onPick(pickedTrip === t ? null : t.flightId)} aria-expanded={pickedTrip === t}>
            <span className="v12-clash-when num">{fmtDay(t.start)} <span className="dim">{fmtTime(t.start)}</span></span>
            <span className="col grow v12-clash-what">
              <b className="ellipsis">{t.label}</b>
              <span className="tiny muted ellipsis">{t.nos}{t.contractId && g.contracts[t.contractId] ? ` · ${g.contracts[t.contractId].title}` : ''}</span>
            </span>
            {/* v0.12 (player) one quiet 'more' mark instead of Move / Sub-lease tags: the row opens what it can do */}
            <span className="v12-clash-more" aria-hidden title={t.move.ok || t.sub.ok ? 'Move or sub-lease' : 'Fixed: it can\'t move or be sub-leased'}><Menu /></span>
          </button>
          {pickedTrip === t && <TripActions g={g} offerId={o.id} flightId={t.flightId} others={others} onClose={() => onPick(null)} />}
        </div>
      ))}
      {progs.map((c) => (
        <div key={c.id} className="small muted v12-clash-prog">
          {c.dry
            ? <><b>{c.title}</b>: the aircraft is with the lessee then (a dry lease has no flights of ours to move or sub-lease); choose another aircraft or let this job go.</>
            : <><b>{c.title}</b>: its later days have no flights yet (they are added day by day), so that part shows as one block. It can't be moved or sub-leased until its flights exist; choose another aircraft or let this job go.</>}
        </div>
      ))}
      {checks.map((m) => (
        <div key={m.id} className="small muted v12-clash-prog"><b>{m.kind === 'AOG' ? 'AOG' : `${m.kind}-check`} at {m.at}</b> {fmtDay(m.start)}–{fmtDay(m.end)}: move it on the Schedule (hold and drag it along its row).</div>
      ))}
    </div>
  );
}

export function SchedulePortal({ g, o, aircraftId, candidates, report, open = false }: { g: GameState; o: ContractOffer; aircraftId: string; candidates: string[]; report?: FeasibilityReport; open?: boolean }) {
  const [from, to] = portalWindow(o, g.now);
  const span = to - from;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(0);
  const width = portalWidth(from, to, box);
  const x = (t: Minute) => (Math.min(Math.max(t - from, 0), span) / span) * width;
  const blocks = portalBlocks(g, aircraftId, from, to, report);
  const trips = report ? clashTrips(g, report) : [];
  const [picked, setPicked] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const days: Minute[] = [];
  for (let t = from; t < to; t += DAY) days.push(t);
  // v0.12 the offer's flights (and this aircraft's positioning for it) as ghosts; none for a base programme.
  const ghosts = offerGhosts(o, g.fleet[aircraftId]?.typeId ?? 'a320ceo', report);
  const jobFrom = Math.max(o.start, from);
  const jobTo = Math.min(o.end, to);
  const others = candidates.filter((id) => id !== aircraftId && g.fleet[id] && g.fleet[id].status !== 'leasedOut');

  // The box width (the timeline is at least that wide; wider scrolls), and the first view on the job's start.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setBox(el.clientWidth);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const scrolled = useRef(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !box || scrolled.current) return;
    scrolled.current = true;
    const first = trips[0]?.start ?? jobFrom;
    el.scrollLeft = Math.max(0, x(Math.min(first, jobFrom)) - (DAY / span) * width * 0.5);
  });

  const lift = (d: Drag) => {
    if (drag.current !== d) return;
    const trip = tripOf(g, d.flightId);
    if (!trip.ok) {
      drag.current = null;
      store.toast('warn', "This trip can't change aircraft", trip.reason);
      return;
    }
    d.lifted = true;
    const ghost = document.createElement('div');
    ghost.className = 'tm-ghost v91-ghost';
    ghost.textContent = `${trip.label} · ${g.fleet[aircraftId]?.reg ?? ''}`;
    ghost.style.left = `${toCss(d.x0)}px`;
    ghost.style.top = `${toCss(d.y0)}px`;
    document.body.append(ghost);
    d.ghost = ghost;
    scrollRef.current?.closest('.v91-portal-wrap')?.classList.add('v12-dragging');
    d.raf = requestAnimationFrame(() => autoScroll(d));
  };
  /** While lifted: the dialog body scrolls when the finger or pointer rests near its top or bottom edge. */
  const autoScroll = (d: Drag) => {
    const body = scrollRef.current?.closest<HTMLElement>('.modal-body');
    if (!body || drag.current !== d || !d.lifted) return;
    const r = body.getBoundingClientRect();
    const y = d.y ?? d.y0;
    const dy = y > r.bottom - EDGE ? Math.min(EDGE, y - (r.bottom - EDGE)) : y < r.top + EDGE ? -Math.min(EDGE, r.top + EDGE - y) : 0;
    if (dy) {
      body.scrollTop += dy / 4;
      d.hover = undefined;
      place(d, d.x ?? d.x0, y);
    }
    d.raf = requestAnimationFrame(() => autoScroll(d));
  };
  const place = (d: Drag, cx: number, cy: number) => {
    d.x = cx;
    d.y = cy;
    if (d.ghost) {
      d.ghost.style.left = `${toCss(cx)}px`;
      d.ghost.style.top = `${toCss(cy)}px`;
    }
    const ac = rowAt(cx, cy);
    if (ac === d.hover) return;
    d.hover = ac;
    clearHover();
    if (ac && ac !== aircraftId) {
      const ok = quoteTripMove(g, d.flightId, ac, { quick: true }).ok;
      document.querySelector(`.v91-portal[data-ac="${CSS.escape(ac)}"]`)?.classList.add(ok ? 'drop-ok' : 'drop-no');
    }
  };
  /** Ends a press or a drag; `drop` at (cx, cy) asks for the move when it was lifted over another aircraft. */
  const finish = (drop: boolean, cx = 0, cy = 0) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    window.clearTimeout(d.timer);
    if (d.raf) cancelAnimationFrame(d.raf);
    d.ghost?.remove();
    clearHover();
    scrollRef.current?.closest('.v91-portal-wrap')?.classList.remove('v12-dragging');
    if (!d.lifted) return;
    // A drag is not a tap as well.
    suppressClick.current = true;
    window.setTimeout(() => (suppressClick.current = false), 400);
    const target = drop ? rowAt(cx, cy) : null;
    if (target && target !== aircraftId) askMove(o.id, d.flightId, target);
  };

  // Touch: a long press lifts (the timeline scrolls with a swipe before that); the move is held from the page scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onStart = (e: TouchEvent) => {
      const b = (e.target as Element).closest<HTMLElement>('.v91-b.movable');
      if (!b || e.touches.length > 1 || drag.current) return;
      const t = e.touches[0];
      const d: Drag = { flightId: b.dataset.fid!, x0: t.clientX, y0: t.clientY, timer: 0, lifted: false, touch: true };
      d.timer = window.setTimeout(() => lift(d), HOLD_MS);
      drag.current = d;
    };
    const onMove = (e: TouchEvent) => {
      const d = drag.current;
      if (!d || !d.touch) return;
      const t = e.touches[0];
      if (!d.lifted) {
        if (Math.hypot(t.clientX - d.x0, t.clientY - d.y0) > SLOP) finish(false);
        return;
      }
      e.preventDefault();
      place(d, t.clientX, t.clientY);
    };
    const onEnd = (e: TouchEvent) => {
      const d = drag.current;
      if (!d || !d.touch) return;
      if (d.lifted) e.preventDefault();
      const t = e.changedTouches[0];
      finish(e.type === 'touchend', t?.clientX ?? 0, t?.clientY ?? 0);
    };
    const onMenu = (e: Event) => {
      if (drag.current) e.preventDefault();
    };
    const onScroll = () => {
      if (drag.current && !drag.current.lifted) finish(false);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    el.addEventListener('touchcancel', onEnd, { passive: false });
    el.addEventListener('contextmenu', onMenu);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('contextmenu', onMenu);
      el.removeEventListener('scroll', onScroll);
    };
  });
  // Unmount mid-drag: no ghost left behind.
  useEffect(() => () => {
    const d = drag.current;
    if (d) {
      window.clearTimeout(d.timer);
      if (d.raf) cancelAnimationFrame(d.raf);
      d.ghost?.remove();
      clearHover();
    }
  }, []);

  // Mouse or trackpad: press and move a few pixels to drag; a click picks.
  const onMouseDown = (e: React.PointerEvent, flightId: string) => {
    if (e.pointerType === 'touch' || e.button !== 0 || drag.current) return;
    const d: Drag = { flightId, x0: e.clientX, y0: e.clientY, timer: 0, lifted: false, touch: false };
    drag.current = d;
    const move = (ev: PointerEvent) => {
      if (drag.current !== d) return;
      if (!d.lifted) {
        if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) >= MOUSE_SLOP) lift(d);
        return;
      }
      ev.preventDefault();
      place(d, ev.clientX, ev.clientY);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (drag.current === d) finish(true, ev.clientX, ev.clientY);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onClick = (flightId: string) => {
    if (suppressClick.current) return;
    setPicked((p) => (p === flightId ? null : flightId));
  };

  const pickedTrip = picked ? tripOf(g, picked) : null;
  const pickedLegs = new Set(pickedTrip?.legs.map((l) => l.id) ?? (picked ? [picked] : []));
  // The chooser sits under the clash row when the open aircraft lists that trip, else under the timeline.
  const listed = open && !!picked && trips.some((t) => t.legIds.includes(picked));
  return (
    <div className="v91-portal-wrap">
      <div className="v91-portal" ref={scrollRef} data-ac={aircraftId} aria-label={`${g.fleet[aircraftId]?.reg ?? ''} schedule ${fmtDay(from)} to ${fmtDay(to)}`}>
        <div className="v12-portal-in" style={{ width }}>
          {days.map((t, i) => (
            <span key={t} className={`v91-day ${i % 2 ? 'odd' : ''}`} style={{ left: x(t), width: (DAY / span) * width }}>
              <span className="v91-day-l">{fmtDay(t).replace(/ \d{4}$/, '')}</span>
            </span>
          ))}
          {/* v0.12 the job as one block only when it has no flights yet (a base programme); otherwise its flights, ghosted */}
          {ghosts.length === 0 && jobTo > jobFrom && <span className="v91-job" style={{ left: x(jobFrom), width: x(jobTo) - x(jobFrom) }} title={`This job: ${fmtDay(o.start)} – ${fmtDay(o.end)}`} />}
          {blocks.map((b) => {
            const w = Math.max(b.kind === 'cont' ? 12 : 4, x(Math.min(b.end, to)) - x(Math.max(b.start, from)));
            const style: React.CSSProperties = { left: x(b.start), width: w };
            if ((b.kind === 'flight' || b.kind === 'cont') && b.color !== null) style.background = contractColor(b.color);
            if (b.kind === 'sub' && b.color !== null) style.borderColor = contractColor(b.color);
            const fid = b.flightId;
            const movable = b.kind === 'flight' && !!fid && !b.done;
            const tip = b.kind === 'cont' ? `${b.label} · no flights yet` : `${b.label} · ${fmtDay(b.start)} ${fmtTime(b.start)} UTC${b.clash ? ' · in the way of this job' : ''}`;
            return (
              <span
                key={b.key}
                className={`v91-b ${b.kind} ${b.done ? 'done' : ''} ${b.clash ? 'clash' : ''} ${fid && pickedLegs.has(fid) ? 'picked' : ''} ${movable ? 'movable' : ''}`}
                style={style}
                title={tip}
                data-fid={movable ? fid! : undefined}
                role={movable ? 'button' : undefined}
                aria-label={movable ? tip : undefined}
                onPointerDown={movable ? (e) => onMouseDown(e, fid!) : undefined}
                onClick={movable ? () => onClick(fid!) : undefined}
              >
                {b.kind === 'cont' && w >= 150 && <span className="v12-cont-l">Programme · no flights yet</span>}
              </span>
            );
          })}
          {ghosts.map((gh) => {
            if (gh.end <= from || gh.start >= to) return null;
            const w = Math.max(6, x(Math.min(gh.end, to)) - x(Math.max(gh.start, from)));
            return <span key={gh.key} className={`v12-ghost ${gh.kind}`} style={{ left: x(gh.start), width: w }} title={`From this offer, not booked yet: ${gh.label} · ${fmtDay(gh.start)} ${fmtTime(gh.start)} UTC`} />;
          })}
        </div>
      </div>
      {picked && !listed && <TripActions g={g} offerId={o.id} flightId={picked} others={others} onClose={() => setPicked(null)} />}
      {open && report && <ClashList g={g} o={o} r={report} trips={trips} picked={picked} onPick={setPicked} others={others} />}
    </div>
  );
}
