// v0.23.1 a route's cabin (report bmwdnxjlp5jo6): business and economy, or economy only, changed while the route runs.
// Picking the other cabin opens the comparison first (seats, passengers, load, yield, money a flight / week / month,
// from the game's own demand and fare model); the change applies only on Switch. Explanations sit behind the "?".

import { Armchair, Check } from 'lucide-react';
import { useMemo, useState } from 'react';
import { typeOf } from '../../../engine/core/perf';
import { fmtDay } from '../../../engine/core/time';
import type { GameState } from '../../../engine/core/types';
import { cabinQuote, routeCabin, setRouteCabin, type RouteCabin } from '../../../engine/network/cabin';
import type { Route } from '../../../engine/network/types';
import { Help } from '../../components/Help';
import { Seg } from '../../components/ui';
import { int, money } from '../../format';
import { cabinRows, type Per } from './cabinLogic';
import { store } from '../../store';

const CABIN_WORD: Record<RouteCabin, string> = { 'two-class': 'Business + Economy', 'all-economy': 'Economy only' };
const PER_WORD: Record<Per, string> = { flight: 'A flight', week: 'A week', month: 'A month' };

function Compare({ g, r, to, onDone }: { g: GameState; r: Route; to: RouteCabin; onDone: () => void }) {
  const [per, setPer] = useState<Per>('month');
  const rev = g.network?.rev ?? 0;
  const day = Math.floor(g.now / 1440);
  const q = useMemo(() => cabinQuote(g, r.id, to), [g, r.id, to, rev, day]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!q) return <div className="small muted">No timetable to compare yet.</div>;
  const rows = cabinRows(q, per);
  const typeName = typeOf(q.typeId)?.name ?? q.typeId;
  const go = () => {
    const res = store.act((gg) => {
      const why = setRouteCabin(gg, r.id, to);
      return why ? { ok: false, error: why } : { ok: true, msg: `${CABIN_WORD[to]} from now` };
    });
    if (res.ok) onDone();
  };
  return (
    <div className="card nw-cabin-cmp">
      <div className="row between wrap gap-8">
        <b className="small row gap-6"><Armchair className="sc-ico-s" /> {CABIN_WORD[q.from.cabin]} → {CABIN_WORD[to]}
          <Help title="Changing the cabin">
            <p>The numbers come from the same demand and fare model as the route's study: its expected travellers, your timetable, fares and marketing, over the next 12 months.</p>
            <p>With economy only, the business seats are sold as economy. Most business and government travellers then fly with another airline; a few take economy.</p>
            <p>Passengers already booked in business are moved to economy now and told in advance. EU rules (EU261, Art. 10) give them back 30 %, 50 % or 75 % of the fare by distance. On the day it would cost the same refund plus a voucher, and business bookings would dip.</p>
          </Help>
        </b>
        <Seg<Per> value={per} onChange={setPer} options={(['flight', 'week', 'month'] as Per[]).map((v) => ({ value: v, label: PER_WORD[v] }))} />
      </div>
      <div className="nw-cabin-grid" role="table" aria-label="Cabin comparison">
        <div className="nw-cabin-r head" role="row"><span role="columnheader" /><span role="columnheader" className="tiny dim upper">Now</span><span role="columnheader" className="tiny dim upper">{to === 'all-economy' ? 'Economy only' : 'With business'}</span><span role="columnheader" className="tiny dim upper">Change</span></div>
        {rows.map((x) => (
          <div key={x.k} className={`nw-cabin-r ${x.total ? 'total' : ''}`} role="row">
            <span role="cell" className="small">{x.k}</span>
            <span role="cell" className="num small">{x.a}</span>
            <span role="cell" className="num small">{x.b}</span>
            <span role="cell" className={`num small ${x.tone ?? 'muted'}`}>{x.d}</span>
          </div>
        ))}
      </div>
      <div className="col gap-4 small">
        <span>{q.departures ? `Takes effect now on ${q.departures} departure${q.departures === 1 ? '' : 's'} on sale${q.first ? `, the first ${fmtDay(q.first)}` : ''}.` : 'Takes effect now; new departures sell this way.'}</span>
        {q.bookedJ > 0 && <span className="warn">{int(q.bookedJ)} business passenger{q.bookedJ === 1 ? '' : 's'} already booked move to economy now: {money(q.refund)} refunded.</span>}
        {q.refund > 0 && <span className={q.cashAfter < 0 ? 'bad' : 'muted'}>Cash after the refunds: {money(q.cashAfter)}{q.cashAfter < 0 ? ', below zero' : ''}.</span>}
        {q.liveSeats && (q.liveSeats.min !== q.to.seats || q.liveSeats.max !== q.to.seats) && <span className="muted">Figures for a {typeName} with {int(q.to.seats)} seats. The departures on sale keep their own aircraft: {q.liveSeats.min === q.liveSeats.max ? int(q.liveSeats.min) : `${int(q.liveSeats.min)}–${int(q.liveSeats.max)}`} seats.</span>}
        {to === 'two-class' && q.noJSeats && <span className="warn">The {typeName} has no business seats: business passengers are moved down on the day.</span>}
      </div>
      <div className="row gap-8 wrap">
        <button className="btn btn-primary btn-sm" onClick={go}><Check /> Switch to {CABIN_WORD[to].toLowerCase()}</button>
        <button className="btn btn-sm" onClick={onDone}>Keep as is</button>
      </div>
    </div>
  );
}

/** The Sales tab's cabin row; the other cabin opens its comparison. */
export function CabinRow({ g, r }: { g: GameState; r: Route }) {
  const cur = routeCabin(g, r);
  const [want, setWant] = useState<RouteCabin | null>(null);
  return (
    <>
      <div className="nw-set">
        <div><b className="small"><Armchair className="sc-ico-s" /> Cabin</b></div>
        <Seg<RouteCabin> value={want ?? cur} onChange={(v) => setWant(v === cur ? null : v)} options={(['two-class', 'all-economy'] as RouteCabin[]).map((v) => ({ value: v, label: CABIN_WORD[v] }))} />
      </div>
      {want && want !== cur && <Compare g={g} r={r} to={want} onDone={() => setWant(null)} />}
    </>
  );
}
