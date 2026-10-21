// v0.7 cabin refit (UPDATE-0.7.md §F7.5): layout, MRO station (nearest first, ferry block) and start day on the
// left; what it costs, the seats and cabin-crew minimum before and after, what work it opens and closes, the
// lessor's reinstatement at the lease return and any clash on the right. Books through bookRefit. v0.7 fix: start
// days as a Monday-aligned two-week grid with arrows (8 weeks by default); with none free, the first free slot
// up to 26 weeks out, one tap away.

import { AlertTriangle, ChevronLeft, ChevronRight, Sofa } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CabinLayout } from '../../data/acmiTypes';
import type { GameState, Minute } from '../../engine/core/types';
import { flightsOf, flightsRev } from '../../engine/core/entities';
import { route } from '../../engine/contracts/plan';
import { typeOf } from '../../engine/core/perf';
import { DAY, HOUR, dayStart, fmtDay, fmtDuration, toDate } from '../../engine/core/time';
import { BAL } from '../../engine/core/balance';
import { bookRefit, cabinOptions, refitQuote, refitStations } from '../../engine/ops';
import { Modal } from '../components/ui';
import { money } from '../format';
import { layoutLabel } from '../screens/screenLogic';
import { store, useGame } from '../store';

const WEEKS = 8;
/** How far the first-free-slot scan looks. */
const SCAN_WEEKS = 26;
const PAGE = 14;

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

export function RefitModal({ aircraftId, layout, offerId }: { aircraftId: string; layout?: CabinLayout; offerId?: string }) {
  const g = useGame();
  const ac = g.fleet[aircraftId];
  const presets = useMemo(() => (ac ? cabinOptions(ac.typeId) : []), [ac]);
  const [label, setLabel] = useState(() => (layout && presets.find((p) => p.layout === layout)?.label) || presets.find((p) => p.label !== ac?.cabin.label)?.label || presets[0]?.label || '');
  const stations = useMemo(() => refitStations(g, aircraftId), [g, aircraftId, ac?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const [station, setStation] = useState(() => stations[0]?.code ?? '');
  const rev = flightsRev(g);
  const earliest = g.now + BAL.refit.leadDays * DAY - 60;
  const days = useMemo(() => {
    const out: number[] = [];
    for (let t = dayStart(g.now) + BAL.refit.leadDays * DAY + 6 * HOUR; out.length < SCAN_WEEKS * 7; t += DAY) if (t >= earliest) out.push(t);
    return out;
  }, [g.now, earliest]); // eslint-disable-line react-hooks/exhaustive-deps
  // Quotes on demand (the visible page and the first-free scan), cached per layout / station / plan revision.
  const quotes = useMemo(() => new Map<number, ReturnType<typeof refitQuote>>(), [g, aircraftId, label, station, days, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const quote = (t: number) => {
    let x = quotes.get(t);
    if (!x) quotes.set(t, (x = refitQuote(g, aircraftId, label, station, t)));
    return x;
  };
  const firstFree = useMemo(() => days.find((t) => quote(t).ok) ?? null, [quotes]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setDay] = useState<number | null>(null);
  const start = picked ?? firstFree ?? days[0];
  // Two-week pages from the Monday on or before the first day; the default page holds the chosen day.
  const mon0 = days[0] - ((toDate(days[0]).getUTCDay() + 6) % 7) * DAY;
  const pageOf = (t: number) => Math.floor((t - mon0) / (PAGE * DAY));
  const lastPage = pageOf(days[days.length - 1]);
  const [pg, setPg] = useState<number | null>(null);
  const page = Math.min(lastPage, Math.max(0, pg ?? pageOf(start)));
  const cells = Array.from({ length: PAGE }, (_, k) => mon0 + (page * PAGE + k) * DAY);
  const inRange = (t: number) => t >= days[0] && t <= days[days.length - 1];
  const late = firstFree === null || firstFree >= days[0] + WEEKS * 7 * DAY;
  const pick = (t: number) => {
    setDay(t);
    setPg(null);
  };
  // Opened from an offer's 'Plan refit…': back to that offer.
  const close = () => (offerId && store.game?.offers[offerId] ? store.openModal({ kind: 'offer', offerId }) : store.closeModal());
  if (!ac) return null;
  const q = quote(start);
  // v0.7 fix: station ferry times from where it will be on the chosen start day (the summary's 'Ferry in' leg).
  const from = plannedAt(g, aircraftId, start - 1);
  const ferryTo = (code: string) => route(ac.typeId, from, code)?.reduce((n, l) => n + l.block, 0) ?? null;
  const leased = ac.ownership.kind === 'dryLeaseIn';
  const book = () => {
    if (store.act((gg) => bookRefit(gg, aircraftId, label, station, start)).ok) close();
  };
  const t = typeOf(ac.typeId);
  return (
    <Modal size="wide" className="rf-modal" title={`Cabin refit · ${ac.reg}`} icon={<Sofa className="accent" />} onClose={close} footer={
      <>
        <button className="btn" onClick={close}>Cancel</button>
        <span className="grow small muted">{q.ok ? `${fmtDay(q.start)} – ${fmtDay(q.end)} at ${station}` : ''}</span>
        <button className="btn btn-primary" onClick={book} disabled={!q.ok}><Sofa /> Book refit · {money(q.cost)}</button>
      </>
    }>
      <div className="cv-cols">
        <div className="col gap-12" style={{ minWidth: 0 }}>
          <div className="small muted">{t.name} · now <b>{ac.cabin.label}</b> {layoutLabel(ac.cabin.layout)}</div>
          <div className="upper dim">Layout</div>
          <div className="cv-chips">
            {presets.map((p) => {
              const cur = p.label === ac.cabin.label;
              return (
                <button key={p.label} className={`cv-chip rf-chip ${p.label === label ? 'on' : ''} ${cur ? 'off' : ''}`} onClick={() => { setLabel(p.label); setDay(null); setPg(null); }} aria-pressed={p.label === label}>
                  <b>{p.label}</b>
                  <span className="tiny dim">{cur ? 'current' : `${layoutLabel(p.layout)} · ${p.j + p.w + p.y} seats`}</span>
                </button>
              );
            })}
          </div>
          <div className="upper dim">Station</div>
          <div className="cv-chips">
            {stations.map((s) => {
              const fb = ferryTo(s.code);
              return (
                <button key={s.code} className={`cv-chip rf-chip ${s.code === station ? 'on' : ''}`} onClick={() => { setStation(s.code); setDay(null); setPg(null); }} aria-pressed={s.code === station}>
                  <b>{s.name.split(', ').pop()}</b>
                  <span className="tiny dim">{fb === null ? 'no ferry route' : fb ? `ferry ${fmtDuration(fb)}` : 'here'}</span>
                </button>
              );
            })}
            {!stations.length && <span className="small muted">No refit station can take this aircraft.</span>}
          </div>
          <div className="row between gap-8">
            <span className="upper dim">Start</span>
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
                <button key={d} className={`cv-day ${dt.getUTCDay() === 1 ? 'mon' : ''} ${on ? 'on' : ''} ${dq.ok ? '' : 'rf-off'}`} onClick={() => pick(d)} aria-pressed={on} title={dq.ok ? undefined : dq.why ?? undefined}>
                  <span className="tiny">{dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
                  <b>{dt.getUTCDate()}</b>
                  <span className="tiny dim">{dt.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</span>
                </button>
              );
            })}
          </div>
          {late && (
            <div className="row gap-8 small warn wrap">
              {firstFree !== null ? <>
                <span>Nothing free in the next {WEEKS} weeks. First free slot: {fmtDay(firstFree)}.</span>
                {start !== firstFree && <button className="btn btn-sm" onClick={() => pick(firstFree)}>Go to {fmtDay(firstFree)}</button>}
              </> : <span>No free slot in the next {SCAN_WEEKS} weeks here: move flights first or try another station.</span>}
            </div>
          )}
          <div className="small dim">Hangar slots open {BAL.refit.leadDays} days ahead. Greyed days clash with flights or checks.</div>
        </div>
        <div className="col gap-12 cv-right" style={{ minWidth: 0 }}>
          <div className="upper dim">Summary</div>
          <div className="cv-cost">
            <div className="row between small"><span className="muted">Out of service</span><b className="num">{q.days} days</b></div>
            <div className="row between small"><span className="muted">Seats</span><b className="num">{q.seatsFrom} → {q.seatsTo}</b></div>
            <div className="row between small"><span className="muted">Cabin crew minimum</span><b className="num">{q.cabinMinFrom} → {q.cabinMinTo}</b></div>
            {q.ferryIn.length > 0 && <div className="row between small"><span className="muted">Ferry in</span><span className="num">{q.ferryIn.map((l) => `${l.from}–${l.to}`).join(', ')} {fmtDay(q.ferryIn[0].std)}</span></div>}
            <div className="row between"><b>Cost</b><b className="num">{money(q.cost)}</b></div>
            <div className="tiny dim">Paid when the work starts. Free to cancel until then.</div>
          </div>
          {(q.opens.length > 0 || q.closes.length > 0) && (
            <div className="col gap-4 small">
              {q.opens.length > 0 && <div><span className="good">Opens:</span> {q.opens.join(', ')}</div>}
              {q.closes.length > 0 && <div><span className="warn">Closes:</span> {q.closes.join(', ')}</div>}
            </div>
          )}
          {leased && <div className="small muted">{q.reinstateAtReturn ? `Leased: the lessor consents; reinstated at the lease return ≈ ${money(q.reinstateAtReturn)}.` : 'Leased: back to the delivered cabin, nothing to reinstate.'}</div>}
          {!q.ok && q.why && <div className="small row gap-8 cv-warn bad"><AlertTriangle className="sc-ico-s" /><span>{q.why}</span></div>}
        </div>
      </div>
    </Modal>
  );
}
