// v0.7 cabin refit (UPDATE-0.7.md §F7.5): layout, MRO station (nearest first, ferry block) and start day on the
// left; what it costs, the seats and cabin-crew minimum before and after, what work it opens and closes, the
// lessor's reinstatement at the lease return and any clash on the right. Books through bookRefit.

import { AlertTriangle, Sofa } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CabinLayout } from '../../data/acmiTypes';
import { flightsRev } from '../../engine/core/entities';
import { typeOf } from '../../engine/core/perf';
import { DAY, HOUR, dayStart, fmtDay, fmtDuration, toDate } from '../../engine/core/time';
import { BAL } from '../../engine/core/balance';
import { bookRefit, cabinOptions, refitQuote, refitStations } from '../../engine/ops';
import { Modal } from '../components/ui';
import { money } from '../format';
import { layoutLabel } from '../screens/screenLogic';
import { store, useGame } from '../store';

const WEEKS = 8;

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
    for (let t = dayStart(g.now) + BAL.refit.leadDays * DAY + 6 * HOUR; out.length < WEEKS * 7; t += DAY) if (t >= earliest) out.push(t);
    return out;
  }, [g.now, earliest]); // eslint-disable-line react-hooks/exhaustive-deps
  const quotes = useMemo(() => new Map(days.map((t) => [t, refitQuote(g, aircraftId, label, station, t)])), [g, aircraftId, label, station, days, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setDay] = useState<number | null>(null);
  const start = picked ?? days.find((t) => quotes.get(t)?.ok) ?? days[0];
  const strip = useRef<HTMLDivElement>(null);
  // The chosen day (first free one by default) scrolls into the strip, without moving the page.
  useEffect(() => {
    const el = strip.current;
    const on = el?.querySelector<HTMLElement>('.cv-day.on');
    if (el && on && (on.offsetLeft < el.scrollLeft || on.offsetLeft + on.offsetWidth > el.scrollLeft + el.clientWidth)) el.scrollLeft = on.offsetLeft - 8;
  }, [start, label, station]);
  // Opened from an offer's 'Plan refit…': back to that offer.
  const close = () => (offerId && store.game?.offers[offerId] ? store.openModal({ kind: 'offer', offerId }) : store.closeModal());
  if (!ac) return null;
  const q = quotes.get(start) ?? refitQuote(g, aircraftId, label, station, start);
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
                <button key={p.label} className={`cv-chip rf-chip ${p.label === label ? 'on' : ''} ${cur ? 'off' : ''}`} onClick={() => { setLabel(p.label); setDay(null); }} aria-pressed={p.label === label}>
                  <b>{p.label}</b>
                  <span className="tiny dim">{cur ? 'current' : `${layoutLabel(p.layout)} · ${p.j + p.w + p.y} seats`}</span>
                </button>
              );
            })}
          </div>
          <div className="upper dim">Station</div>
          <div className="cv-chips">
            {stations.map((s) => (
              <button key={s.code} className={`cv-chip rf-chip ${s.code === station ? 'on' : ''}`} onClick={() => { setStation(s.code); setDay(null); }} aria-pressed={s.code === station}>
                <b>{s.name.split(', ').pop()}</b>
                <span className="tiny dim">{s.ferryBlock ? `ferry ${fmtDuration(s.ferryBlock)}` : 'here'}</span>
              </button>
            ))}
            {!stations.length && <span className="small muted">No refit station can take this aircraft.</span>}
          </div>
          <div className="upper dim">Start</div>
          <div className="cv-days rf-days" ref={strip} role="group" aria-label="Start day">
            {days.map((d) => {
              const dq = quotes.get(d);
              const dt = toDate(d);
              const on = d === start;
              return (
                <button key={d} className={`cv-day ${dt.getUTCDay() === 1 ? 'mon' : ''} ${on ? 'on' : ''} ${dq?.ok ? '' : 'rf-off'}`} onClick={() => setDay(d)} aria-pressed={on} title={dq?.ok ? undefined : dq?.why ?? undefined}>
                  <span className="tiny">{dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
                  <b>{dt.getUTCDate()}</b>
                  <span className="tiny dim">{dt.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</span>
                </button>
              );
            })}
          </div>
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
