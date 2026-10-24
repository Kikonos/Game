// v0.9.1 the offer dialog's schedule portal: under each candidate aircraft a mini timeline of that aircraft (a window
// into the Schedule screen) with the requested contract window highlighted, shown whether or not the aircraft is free.
// A trip on it moves to another aircraft as on the Schedule: hold and drag it onto another candidate's timeline, or tap
// it and pick the aircraft. Either way the Schedule's profit/loss confirm (TripMoveModal, quoteTripMove) decides, and
// the offer dialog comes back with its feasibility lines worked out again. Touch first: blocks are 30 px tall.

import { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, X } from 'lucide-react';
import { DAY, fmtDay, fmtTime } from '../../engine/core/time';
import type { ContractOffer, GameState, Minute } from '../../engine/core/types';
import { quoteTripMove, tripOf } from '../../engine/ops/tripMove';
import { contractColor } from '../screens/palette';
import { rowBlocks } from '../screens/scheduleLogic';
import { store } from '../store';

/** The portal's window: two days either side of the job, at most three weeks (a long base shows its first weeks). Pure. */
export function portalWindow(o: Pick<ContractOffer, 'start' | 'end'>, now: Minute): [Minute, Minute] {
  const from = Math.max(Math.floor(now / DAY) * DAY, Math.floor(o.start / DAY) * DAY - 2 * DAY);
  const to = Math.min(Math.ceil(o.end / DAY) * DAY + 2 * DAY, from + 21 * DAY);
  return [from, Math.max(to, from + 4 * DAY)];
}

/** Long-press before a trip lifts (touch), and the slop that cancels it (a scroll). */
const HOLD_MS = 350;
const SLOP = 10;

interface Drag { flightId: string; sourceId: string; x0: number; y0: number; timer: number; lifted: boolean; ghost?: HTMLDivElement; hover?: string | null }

/** Opens the Schedule's trip move confirm, coming back to this offer afterwards. */
function askMove(offerId: string, flightId: string, targetId: string) {
  store.openModal({ kind: 'tripMove', flightId, targetId, back: { kind: 'offer', offerId } });
}

export function SchedulePortal({ g, o, aircraftId, candidates }: { g: GameState; o: ContractOffer; aircraftId: string; candidates: string[] }) {
  const [from, to] = portalWindow(o, g.now);
  const span = to - from;
  const pct = (t: Minute) => `${(Math.min(Math.max(t - from, 0), span) / span) * 100}%`;
  const blocks = rowBlocks(g, aircraftId, from, to).filter((b) => b.kind === 'flight' || b.kind === 'pos' || b.kind === 'maint' || b.kind === 'band' || b.kind === 'lease');
  const [picked, setPicked] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const days: Minute[] = [];
  for (let t = from; t <= to; t += DAY) days.push(t);
  const jobFrom = Math.max(o.start, from);
  const jobTo = Math.min(o.end, to);

  useEffect(() => () => {
    const d = drag.current;
    if (d) {
      window.clearTimeout(d.timer);
      d.ghost?.remove();
    }
  }, []);

  const rowAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.v91-portal[data-ac]');
    return el?.dataset.ac ?? null;
  };
  const clearHover = () => {
    for (const el of document.querySelectorAll('.v91-portal.drop-ok, .v91-portal.drop-no')) el.classList.remove('drop-ok', 'drop-no');
  };
  const onDown = (e: React.PointerEvent, flightId: string) => {
    if (e.button !== 0) return;
    const d: Drag = { flightId, sourceId: aircraftId, x0: e.clientX, y0: e.clientY, timer: 0, lifted: false };
    d.timer = window.setTimeout(() => lift(d), e.pointerType === 'touch' ? HOLD_MS : 150);
    drag.current = d;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
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
    ghost.textContent = `${trip.label} · ${g.fleet[d.sourceId]?.reg ?? ''}`;
    ghost.style.left = `${d.x0}px`;
    ghost.style.top = `${d.y0}px`;
    document.body.append(ghost);
    d.ghost = ghost;
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.lifted) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > SLOP) {
        window.clearTimeout(d.timer);
        drag.current = null;
      }
      return;
    }
    e.preventDefault();
    if (d.ghost) {
      d.ghost.style.left = `${e.clientX}px`;
      d.ghost.style.top = `${e.clientY}px`;
    }
    const ac = rowAt(e.clientX, e.clientY);
    if (ac === d.hover) return;
    d.hover = ac;
    clearHover();
    if (ac && ac !== d.sourceId) {
      const ok = quoteTripMove(g, d.flightId, ac, { quick: true }).ok;
      document.querySelector(`.v91-portal[data-ac="${CSS.escape(ac)}"]`)?.classList.add(ok ? 'drop-ok' : 'drop-no');
    }
  };
  const onUp = (e: React.PointerEvent, flightId: string) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    window.clearTimeout(d.timer);
    d.ghost?.remove();
    clearHover();
    if (!d.lifted) {
      // A tap: the move-to chooser for this trip.
      setPicked((p) => (p === flightId ? null : flightId));
      return;
    }
    const target = rowAt(e.clientX, e.clientY);
    if (target && target !== d.sourceId) askMove(o.id, d.flightId, target);
  };
  const onCancel = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    window.clearTimeout(d.timer);
    d.ghost?.remove();
    clearHover();
  };

  const pickedTrip = picked ? tripOf(g, picked) : null;
  const others = candidates.filter((id) => id !== aircraftId && g.fleet[id] && g.fleet[id].status !== 'leasedOut');
  return (
    <div className="v91-portal-wrap">
      <div className="v91-portal" data-ac={aircraftId} aria-label={`${g.fleet[aircraftId]?.reg ?? ''} schedule ${fmtDay(from)} to ${fmtDay(to)}`}>
        {days.map((t, i) => (
          <span key={t} className={`v91-day ${i % 2 ? 'odd' : ''}`} style={{ left: pct(t), width: `${(DAY / span) * 100}%` }}>
            {(span <= 10 * DAY || i % 2 === 0) && <span className="v91-day-l">{fmtDay(t).replace(/ \d{4}$/, '')}</span>}
          </span>
        ))}
        {jobTo > jobFrom && <span className="v91-job" style={{ left: pct(jobFrom), width: `${((jobTo - jobFrom) / span) * 100}%` }} title={`This job: ${fmtDay(o.start)} – ${fmtDay(o.end)}`} />}
        {blocks.map((b) => {
          const style: React.CSSProperties = { left: pct(b.start), width: `max(10px, ${((Math.min(b.end, to) - Math.max(b.start, from)) / span) * 100}%)` };
          if (b.kind === 'flight' && b.color !== null) style.background = contractColor(b.color);
          const fid = b.refs[0]?.kind === 'flight' ? b.refs[0].id : null;
          const movable = b.kind === 'flight' && !!fid && !b.done;
          return (
            <span
              key={b.key}
              className={`v91-b ${b.kind} ${b.done ? 'done' : ''} ${fid && pickedTrip?.legs.some((l) => l.id === fid) ? 'picked' : ''} ${movable ? 'movable' : ''}`}
              style={style}
              title={`${b.label} · ${fmtDay(b.start)} ${fmtTime(b.start)}`}
              onPointerDown={movable ? (e) => onDown(e, fid!) : undefined}
              onPointerMove={movable ? onMove : undefined}
              onPointerUp={movable ? (e) => onUp(e, fid!) : undefined}
              onPointerCancel={movable ? onCancel : undefined}
            />
          );
        })}
      </div>
      {pickedTrip && (
        <div className="v91-move row gap-6 wrap">
          {pickedTrip.ok ? (
            <>
              <span className="small"><ArrowRightLeft /> Move {pickedTrip.label} ({fmtDay(pickedTrip.start)}) to</span>
              {others.map((id) => {
                const q = quoteTripMove(g, picked!, id, { quick: true });
                return (
                  <button key={id} className={`btn btn-sm ${q.ok ? '' : 'dim'}`} disabled={!q.ok} title={q.ok ? undefined : q.reasons[0]} onClick={() => askMove(o.id, picked!, id)}>
                    {g.fleet[id].reg}
                  </button>
                );
              })}
              {!others.length && <span className="small muted">No other aircraft.</span>}
            </>
          ) : (
            <span className="small muted">{pickedTrip.reason}</span>
          )}
          <button className="btn btn-sm btn-ghost btn-icon" aria-label="Close" onClick={() => setPicked(null)}><X /></button>
        </div>
      )}
    </div>
  );
}
