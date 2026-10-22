// v0.7 cabin refit (UPDATE-0.7.md §F7.5): layout and start on the left; what it costs, the seats and cabin-crew
// minimum before and after, what work it opens and closes, the lessor's reinstatement at the lease return and any
// clash on the right. v0.7.2 (UPDATE-0.7.2.md F6, §3.3): cabin work happens in our own hangar at home base and starts
// as soon as the aircraft is free: the earliest windows (refitSlots) come first, the first pre-selected, with a plain
// "Why not sooner?"; the two-week day grid stays behind 'Another day…'. Widebodies without bunks get a second
// section: crew rest seats (the last economy row behind a curtain, class 3 rest).

import { AlertTriangle, BedDouble, CalendarDays, ChevronLeft, ChevronRight, Sofa } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CabinLayout } from '../../data/acmiTypes';
import type { GameState, Minute } from '../../engine/core/types';
import { flightsOf, flightsRev } from '../../engine/core/entities';
import { route } from '../../engine/contracts/plan';
import { typeOf } from '../../engine/core/perf';
import { DAY, HOUR, dayStart, fmtDay, fmtDuration, fmtTime, toDate } from '../../engine/core/time';
import { bookRefit, bookRestSeats, cabinOptions, refitQuote, refitSlots, refitStations, restSeatsQuote, type RefitQuote } from '../../engine/ops';
import { REST_SEATS } from '../../engine/ops/cabin';
import { Term } from '../components/Term';
import { Modal, Seg } from '../components/ui';
import { money } from '../format';
import { layoutLabel } from '../screens/screenLogic';
import { store, useGame } from '../store';

/** How far the custom-day grid reaches. */
const SCAN_WEEKS = 26;
const PAGE = 14;
/** Earliest windows listed (the dialog fits 750 px). */
const SLOTS = 4;

/** Where the aircraft will be at t (its last planned arrival before t), as refitQuote's ferry in measures it. Pure. */
function plannedAt(g: GameState, aircraftId: string, t: Minute): string {
  const ac = g.fleet[aircraftId];
  let at = ac.at;
  let free = g.now;
  const cur = ac.flightId ? g.flights[ac.flightId] : undefined;
  if (cur) {
    at = cur.to;
    free = cur.eta ?? cur.sta;
  }
  for (const f of flightsOf(g, aircraftId)) {
    if (f.status !== 'scheduled' || f.sta > t || f.sta < free) continue;
    at = f.to;
    free = f.sta;
  }
  return at;
}

/** 'today 14:00', 'tomorrow 06:30', 'Thu 12 Nov 08:00'. */
export function whenLabel(now: Minute, t: Minute): string {
  const d = dayStart(t);
  const d0 = dayStart(now);
  const day = d === d0 ? 'today' : d === d0 + DAY ? 'tomorrow' : `${toDate(t).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${fmtDay(t)}`;
  return `${day} ${fmtTime(t)}`;
}

type Mode = 'cabin' | 'rest';

export function RefitModal({ aircraftId, layout, offerId, rest }: { aircraftId: string; layout?: CabinLayout; offerId?: string; rest?: boolean }) {
  const g = useGame();
  const ac = g.fleet[aircraftId];
  const t = ac ? typeOf(ac.typeId) : null;
  const presets = useMemo(() => (ac ? cabinOptions(ac.typeId) : []), [ac]);
  const cr = ac?.crewRest ?? { bunks: false, seats: 0 };
  // Crew rest seats: widebodies without bunks that have a full economy row (or seats to remove).
  const restOffer = !!t && t.body === 'wide' && !cr.bunks && (cr.seats > 0 || (ac?.cabin.y ?? 0) >= t.yAbreast);
  const [mode, setMode] = useState<Mode>(rest && restOffer ? 'rest' : 'cabin');
  const [label, setLabel] = useState(() => (layout && presets.find((p) => p.layout === layout)?.label) || presets.find((p) => p.label !== ac?.cabin.label)?.label || presets[0]?.label || '');
  const stations = useMemo(() => refitStations(g, aircraftId), [g, aircraftId, ac?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const station = stations[0]?.code ?? g.company.homeBase;
  const rev = flightsRev(g);
  const fit = !(cr.seats > 0);
  const key = mode === 'rest' ? REST_SEATS : label;
  const nMaint = Object.keys(g.maintenance).length;
  const plan = useMemo(() => refitSlots(g, aircraftId, key, SLOTS), [g, aircraftId, key, rev, g.now, nMaint]); // eslint-disable-line react-hooks/exhaustive-deps
  const quoteAt = (s: Minute): RefitQuote => (mode === 'rest' ? restSeatsQuote(g, aircraftId, fit, s) : refitQuote(g, aircraftId, label, station, s));
  // Custom days (the grid behind 'Another day…'), quoted on demand.
  const days = useMemo(() => {
    const out: number[] = [];
    for (let d = dayStart(g.now) + 6 * HOUR; out.length < SCAN_WEEKS * 7; d += DAY) if (d >= g.now) out.push(d);
    return out;
  }, [g.now]);
  const quotes = useMemo(() => new Map<number, RefitQuote>(), [g, aircraftId, key, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const quote = (d: number) => {
    let x = quotes.get(d);
    if (!x) quotes.set(d, (x = quoteAt(d)));
    return x;
  };
  const [picked, setPicked] = useState<number | null>(null);
  const [grid, setGrid] = useState(false);
  const start = picked ?? plan.slots[0]?.start ?? days[0];
  const mon0 = days[0] - ((toDate(days[0]).getUTCDay() + 6) % 7) * DAY;
  const pageOf = (d: number) => Math.floor((d - mon0) / (PAGE * DAY));
  const lastPage = pageOf(days[days.length - 1]);
  const [pg, setPg] = useState<number | null>(null);
  const page = Math.min(lastPage, Math.max(0, pg ?? pageOf(start)));
  const cells = Array.from({ length: PAGE }, (_, k) => mon0 + (page * PAGE + k) * DAY);
  const inRange = (d: number) => d >= days[0] && d <= days[days.length - 1];
  const reset = () => { setPicked(null); setPg(null); };
  // Opened from an offer's 'Plan refit…': back to that offer.
  const close = () => (offerId && store.game?.offers[offerId] ? store.openModal({ kind: 'offer', offerId }) : store.closeModal());
  if (!ac || !t) return null;
  const q = quote(start);
  const from = plannedAt(g, aircraftId, start - 1);
  const ferry = route(ac.typeId, from, station)?.reduce((n, l) => n + l.block, 0) ?? null;
  const leased = ac.ownership.kind === 'dryLeaseIn';
  const book = () => {
    const ok = mode === 'rest'
      ? store.act((gg) => bookRestSeats(gg, aircraftId, fit, start)).ok
      : store.act((gg) => bookRefit(gg, aircraftId, label, station, start)).ok;
    if (ok) close();
  };
  const bookLabel = mode === 'rest' ? `${fit ? 'Fit crew rest seats' : 'Remove crew rest seats'} · ${money(q.cost)}` : `Book refit · ${money(q.cost)}`;
  return (
    <Modal size="wide" className="rf-modal" title={`${mode === 'rest' ? 'Crew rest seats' : 'Cabin refit'} · ${ac.reg}`} icon={mode === 'rest' ? <BedDouble className="accent" /> : <Sofa className="accent" />} onClose={close} footer={
      <>
        <button className="btn" onClick={close}>Cancel</button>
        <span className="grow small muted">{q.ok ? `${fmtDay(q.start)} – ${fmtDay(q.end)} at ${station}` : ''}</span>
        <button className="btn btn-primary" onClick={book} disabled={!q.ok}>{mode === 'rest' ? <BedDouble /> : <Sofa />} {bookLabel}</button>
      </>
    }>
      <div className="cv-cols">
        <div className="col gap-12" style={{ minWidth: 0 }}>
          {restOffer && (
            <Seg<Mode> value={mode} onChange={(m) => { setMode(m); reset(); setGrid(false); }} options={[{ value: 'cabin', label: 'Cabin layout' }, { value: 'rest', label: 'Crew rest seats' }]} />
          )}
          {mode === 'cabin' ? (
            <>
              <div className="small muted">{t.name} · now <b>{ac.cabin.label}</b> {layoutLabel(ac.cabin.layout)}</div>
              <div className="cv-chips">
                {presets.map((p) => {
                  const cur = p.label === ac.cabin.label;
                  return (
                    <button key={p.label} className={`cv-chip rf-chip ${p.label === label ? 'on' : ''} ${cur ? 'off' : ''}`} onClick={() => { setLabel(p.label); reset(); }} aria-pressed={p.label === label}>
                      <b>{p.label}</b>
                      <span className="tiny dim">{cur ? 'current' : `${layoutLabel(p.layout)} · ${p.j + p.w + p.y} seats`}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="small rf-rest-what">
              <span><Term id="restSeats">Crew rest seats</Term>: block off the last economy row behind a curtain (<Term id="restClass3">class 3 rest</Term>). The {t.yAbreast} seats still sell on flights that need no in-flight rest.</span>
              <span className="muted">{cr.seats > 0 ? `Fitted now: ${cr.seats} seats (last row).` : `${ac.reg} has no crew rest: long duties that need an augmented crew can't be flown on it.`}</span>
            </div>
          )}
          <div className="small muted rf-where">At {stations[0]?.name ?? `our hangar, ${station}`}{ferry === null ? ' · no ferry route' : ferry ? ` · ferry ${fmtDuration(ferry)} from ${from}` : ''}</div>
          <div className="upper dim">Earliest start</div>
          {plan.busyUntil !== null && plan.busyWhy && <div className="small rf-why"><b>Why not sooner?</b> {plan.busyWhy.replace(/^Busy until ([^:]+): /, `${ac.reg} is busy until $1: it `)}.</div>}
          {plan.slots.length ? (
            <div className="rf-slots" role="group" aria-label="Earliest windows">
              {plan.slots.map((s, i) => {
                const on = s.start === start;
                const d = Math.round((s.end - s.start) / DAY);
                return (
                  <button key={s.start} className={`rf-slot ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => { setPicked(s.start); setPg(null); }}>
                    <span className="rf-slot-k">{i === 0 ? 'Earliest' : 'Then'}</span>
                    <span className="rf-slot-v">{whenLabel(g.now, s.start)} – {fmtDay(s.end)} <span className="dim">({d} day{d === 1 ? '' : 's'})</span></span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="small warn">{plan.busyWhy ?? `No free window in the next ${SCAN_WEEKS} weeks: move flights first.`}</div>
          )}
          <button className="btn btn-sm rf-more" onClick={() => setGrid(!grid)} aria-expanded={grid}><CalendarDays /> {grid ? 'Hide days' : 'Another day…'}</button>
          {grid && (
            <>
              <div className="row between gap-8">
                <span className="upper dim">Start day</span>
                <span className="row gap-4 rf-nav">
                  <button className="btn btn-sm btn-icon" onClick={() => setPg(page - 1)} disabled={page <= 0} aria-label="Earlier weeks"><ChevronLeft /></button>
                  <span className="small muted nowrap">{fmtDay(Math.max(cells[0], days[0]))} – {fmtDay(Math.min(cells[PAGE - 1], days[days.length - 1]))}</span>
                  <button className="btn btn-sm btn-icon" onClick={() => setPg(page + 1)} disabled={page >= lastPage} aria-label="Later weeks"><ChevronRight /></button>
                </span>
              </div>
              <div className="rf-grid" role="group" aria-label="Start day">
                {cells.map((d) => {
                  if (!inRange(d)) return <span key={d} className="rf-blank" aria-hidden />;
                  const dq = quote(d);
                  const dt = toDate(d);
                  const on = d === start;
                  return (
                    <button key={d} className={`cv-day ${dt.getUTCDay() === 1 ? 'mon' : ''} ${on ? 'on' : ''} ${dq.ok ? '' : 'rf-off'}`} onClick={() => setPicked(d)} aria-pressed={on} title={dq.ok ? undefined : dq.why ?? undefined}>
                      <span className="tiny">{dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
                      <b>{dt.getUTCDate()}</b>
                      <span className="tiny dim">{dt.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</span>
                    </button>
                  );
                })}
              </div>
              <div className="small dim">Greyed days clash with flights or checks.</div>
            </>
          )}
        </div>
        <div className="col gap-12 cv-right" style={{ minWidth: 0 }}>
          <div className="upper dim">Summary</div>
          <div className="cv-cost">
            <div className="row between small"><span className="muted">Out of service</span><b className="num">{q.days} days</b></div>
            {mode === 'rest' ? (
              <div className="row between small"><span className="muted">Seats on long duties</span><b className="num">{fit ? `${ac.cabin.total} → ${ac.cabin.total - t.yAbreast}` : `${ac.cabin.total - cr.seats} → ${ac.cabin.total}`}</b></div>
            ) : (
              <>
                <div className="row between small"><span className="muted">Seats</span><b className="num">{q.seatsFrom} → {q.seatsTo}</b></div>
                <div className="row between small"><span className="muted">Cabin crew minimum</span><b className="num">{q.cabinMinFrom} → {q.cabinMinTo}</b></div>
              </>
            )}
            {q.ferryIn.length > 0 && <div className="row between small"><span className="muted">Ferry in</span><span className="num">{q.ferryIn.map((l) => `${l.from}–${l.to}`).join(', ')} {fmtDay(q.ferryIn[0].std)}</span></div>}
            <div className="row between"><b>Cost</b><b className="num">{money(q.cost)}</b></div>
            <div className="tiny dim">Paid when the work starts. Free to cancel until then.</div>
          </div>
          {mode === 'rest' && <div className="small muted">Seats are blocked only on flights whose duty needs in-flight rest; every other flight sells all {ac.cabin.total}.</div>}
          {(q.opens.length > 0 || q.closes.length > 0) && (
            <div className="col gap-4 small">
              {q.opens.length > 0 && <div><span className="good">Opens:</span> {q.opens.join(', ')}</div>}
              {q.closes.length > 0 && <div><span className="warn">Closes:</span> {q.closes.join(', ')}</div>}
            </div>
          )}
          {mode === 'cabin' && leased && <div className="small muted">{q.reinstateAtReturn ? `Leased: the lessor consents; reinstated at the lease return ≈ ${money(q.reinstateAtReturn)}.` : 'Leased: back to the delivered cabin, nothing to reinstate.'}</div>}
          {!q.ok && q.why && <div className="small row gap-8 cv-warn bad"><AlertTriangle className="sc-ico-s" /><span>{q.why}</span></div>}
        </div>
      </div>
    </Modal>
  );
}
