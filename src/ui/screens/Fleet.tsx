// Fleet (B5): aircraft cards (art, ownership, hours, A/C-check bars with Plan check, AOG risk) and the
// scarce aircraft market below (lease / buy with a confirm). DESIGN.md §6.3.

import { CalendarRange, Plane, ShoppingCart, Wrench } from 'lucide-react';
import { useEffect } from 'react';
import { artFor } from '../../data/acmiTypes';
import { typeOf } from '../../engine/core/perf';
import { DAY, fmtDate, fmtDay, yearOf } from '../../engine/core/time';
import type { Aircraft, AircraftOffer, GameState } from '../../engine/core/types';
import { acquireAircraft, checkStatus } from '../../engine/ops';
import { AircraftArt } from '../components/AircraftArt';
import { Empty } from '../components/ui';
import { money } from '../format';
import { store, useGame } from '../store';
import { KV, ScreenHead, useRenderCount } from './common';
import { limitTone, spanLabel } from './screenLogic';

const STATUS: Record<Aircraft['status'], [string, string]> = {
  available: ['On ground', 'good'], flying: ['Flying', 'info'], maintenance: ['In check', 'warn'], aog: ['AOG', 'bad'],
  delivering: ['Delivering', 'accent'], stored: ['Stored', ''], leasedOut: ['Leased out', ''],
};

function safeCheck(g: GameState, ac: Aircraft) {
  try {
    return checkStatus(g, ac);
  } catch {
    return null;
  }
}

function CheckBar({ label, used, due, hoursLeft, next, onPlan }: { label: string; used: number; due: number; hoursLeft: number; next: string | null; onPlan: () => void }) {
  const tone = limitTone(used);
  return (
    <div className="sc-check-bar">
      <div className="row between small">
        <span><b>{label}</b> <span className="muted">{next ? `booked ${next}` : `due ${fmtDay(due)}`}</span></span>
        <span className="num dim">{Math.max(0, Math.round(hoursLeft))} FH left</span>
      </div>
      <div className="row gap-8">
        <div className={`bar grow ${tone}`}><span style={{ width: `${Math.min(100, used * 100)}%` }} /></div>
        <button className="btn btn-sm" onClick={onPlan}>{next ? 'Change' : 'Plan'}</button>
      </div>
    </div>
  );
}

function AircraftCard({ g, ac, sel }: { g: GameState; ac: Aircraft; sel: boolean }) {
  const t = typeOf(ac.typeId);
  const cs = safeCheck(g, ac);
  const [label, tone] = STATUS[ac.status];
  const o = ac.ownership;
  const own: [string, string][] = o.kind === 'owned'
    ? [['Owned', `book value ${money(o.bookValue)}`]]
    : [['Lessor', o.lessor], ['Lease', `to ${fmtDate(o.leaseEnd)} · ${money(o.rentPerMonth)}/month`]];
  const plan = (kind: 'A' | 'C') => store.openModal({ kind: 'check', aircraftId: ac.id, checkKind: kind });
  return (
    <div className={`card sc-ac ${sel ? 'selected' : ''}`} data-ac={ac.id}>
      <div className="sc-ac-top">
        <div className="sc-ac-art"><AircraftArt typeId={artFor(ac.typeId)} livery={g.company.livery} code={g.company.code} detail="simple" /></div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-8">
            <b className="mono sc-ac-reg">{ac.reg}</b>
            <span className={`badge ${tone}`}>{label}</span>
            {cs && cs.risk >= 0.5 && <span className={`badge ${cs.risk >= 0.9 ? 'bad' : 'warn'}`} data-tip="Chance of a technical fault grows with deferred defects and overdue checks">AOG risk</span>}
          </div>
          <div className="small muted ellipsis">{t.name} · {ac.cabin.label} · {yearOf(g.now) - ac.builtYear} years</div>
        </div>
      </div>
      <KV rows={[
        ...own,
        ['At', ac.status === 'delivering' ? `arrives ${fmtDate(ac.deliveredAt)}` : ac.at],
        ['Hours / cycles', `${Math.round(ac.hours).toLocaleString('en-US')} / ${Math.round(ac.cycles).toLocaleString('en-US')}`],
        ['ETOPS', ac.etops ? `${ac.etops} min` : 'no'],
      ]} />
      {cs ? (
        <div className="col gap-8">
          <CheckBar label="A-check" used={cs.aUsed} due={cs.aDue} hoursLeft={cs.aHoursLeft} next={cs.nextA} onPlan={() => plan('A')} />
          <CheckBar label="C-check" used={cs.cUsed} due={cs.cDue} hoursLeft={cs.cHoursLeft} next={cs.nextC} onPlan={() => plan('C')} />
          {cs.grounded && <div className="small bad">Past the check tolerance: grounded until the check is done.</div>}
        </div>
      ) : (
        <div className="small muted">Maintenance status unavailable.</div>
      )}
      <div className="row gap-8">
        <button className="btn grow" onClick={() => store.navigate('schedule', { sel: { kind: 'aircraft', id: ac.id } })}><CalendarRange /> Schedule</button>
        <button className="btn grow" onClick={() => store.navigate('map', { sel: { kind: 'aircraft', id: ac.id } })}><Plane /> On map</button>
      </div>
    </div>
  );
}

function acquire(o: AircraftOffer) {
  const t = typeOf(o.typeId);
  const lease = o.kind === 'dryLeaseIn';
  store.openModal({
    kind: 'confirm', title: `${lease ? 'Lease' : 'Buy'} a ${t.name}?`, confirm: lease ? 'Sign the lease' : `Buy for ${money(o.price)}`,
    body: lease
      ? `${o.lessor}, built ${o.builtYear}, ${o.cabin.label}. ${money(o.rentPerMonth)}/month for ${o.leaseMonths} months plus ${money(o.reservesPerFH)}/FH reserves. Deposit ${money(o.deposit)} now. Delivery in ${o.leadDays} days.`
      : `${o.lessor}, built ${o.builtYear}, ${o.cabin.label}. ${money(o.price)} now. Delivery in ${o.leadDays} days.`,
    onConfirm: () => store.act((gg) => acquireAircraft(gg, o.id)),
  });
}

function MarketRow({ g, o }: { g: GameState; o: AircraftOffer }) {
  const t = typeOf(o.typeId);
  const lease = o.kind === 'dryLeaseIn';
  return (
    <div className="sc-list-row">
      <div className="sc-mkt-art"><AircraftArt typeId={artFor(o.typeId)} livery={{ primary: '#e8eefb', secondary: '#9aa6bf', tail: 'solid' }} detail="simple" /></div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row gap-8"><b className="ellipsis">{t.name}</b><span className={`badge ${lease ? 'info' : 'gold'}`}>{lease ? 'Dry lease' : 'Buy'}</span></div>
        <div className="small muted ellipsis">{o.lessor} · built {o.builtYear} · {o.cabin.label} · delivery {o.leadDays} d · offer ends in {spanLabel(o.expires - g.now)}</div>
      </div>
      <div className="right nowrap">
        <b className="num">{lease ? `${money(o.rentPerMonth)}/mo` : money(o.price)}</b>
        <div className="tiny dim">{lease ? `${o.leaseMonths} months · deposit ${money(o.deposit)}` : 'outright'}</div>
      </div>
      <button className="btn btn-primary" onClick={() => acquire(o)}><ShoppingCart /> {lease ? 'Lease' : 'Buy'}</button>
    </div>
  );
}

export function FleetScreen() {
  useRenderCount('fleet');
  const g = useGame();
  const nav = store.nav;
  const sel = nav.sel?.kind === 'aircraft' ? nav.sel.id : null;
  const fleet = Object.values(g.fleet);
  const offers = g.market.aircraft.filter((o) => o.expires > g.now);

  // Deep links: navigate('fleet', {sel, view: 'check'}) opens check planning; a selected card scrolls into view.
  useEffect(() => {
    if (!sel) return;
    document.querySelector(`.sc-ac[data-ac="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
    if (nav.view === 'check' && g.fleet[sel]) {
      store.navigate('fleet', { sel: nav.sel });
      store.openModal({ kind: 'check', aircraftId: sel });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, nav.view]);

  const monthly = fleet.reduce((s, a) => s + (a.ownership.kind === 'dryLeaseIn' ? a.ownership.rentPerMonth : 0), 0);
  return (
    <div className="screen sc-fleet">
      <ScreenHead title="Fleet" sub={`${fleet.length} aircraft · rent ${money(monthly)}/month`} />
      {!fleet.length ? (
        <Empty icon={<Wrench />} title="No aircraft">Lease one from the market below.</Empty>
      ) : (
        <div className="sc-ac-grid">{fleet.map((ac) => <AircraftCard key={ac.id} g={g} ac={ac} sel={sel === ac.id} />)}</div>
      )}
      <h2 className="sc-h2">Aircraft market</h2>
      <div className="small muted mb-8">Good airframes are scarce. Offers stay open for a few days; delivery takes weeks.</div>
      {offers.length ? (
        <div className="card sc-list">{offers.map((o) => <MarketRow key={o.id} g={g} o={o} />)}</div>
      ) : (
        <div className="card sc-pad muted small">No aircraft on offer right now. Lessors call every few weeks{g.now - g.started < 30 * DAY ? '; the first offer usually comes within two months' : ''}.</div>
      )}
    </div>
  );
}
