import {
  ArrowLeft, Armchair, Gauge, KeyRound, Pencil, Plane, Plus, ShoppingCart, Wrench, X, ArrowRightLeft, Tag,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { AIRCRAFT_BY_ID, BODY_LABEL } from '../../data/aircraft';
import { AIRPORT_BY_CODE } from '../../data/airports';
import * as A from '../../engine/actions';
import { cabinSeats, cabinSummary, totalSeats } from '../../engine/cabin';
import { ageYears, heavyCheckCost, heavyCheckDays, marketValue } from '../../engine/economy';
import type { Aircraft, GameState } from '../../engine/types';
import { formatDate } from '../../engine/util';
import { AircraftArt } from '../components/AircraftArt';
import { SeatMap } from '../components/SeatMap';
import { Bar, Card, Empty, Modal, Seg, Stepper, Toggle } from '../components/ui';
import { dist, int, money, pct } from '../format';
import { store, useGame } from '../store';
import { aircraftStatus, utilization } from './common';

type Filter = 'all' | 'flying' | 'idle' | 'order' | 'hangar';

export function Fleet() {
  const g = useGame();
  const id = store.nav.aircraftId;
  const ac = id ? g.fleet.find((a) => a.id === id) : undefined;
  if (ac) return <AircraftDetail g={g} ac={ac} />;
  return <FleetList g={g} />;
}

function FleetList({ g }: { g: GameState }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [hub, setHub] = useState('all');
  const list = g.fleet.filter((ac) => {
    if (hub !== 'all' && ac.hub !== hub) return false;
    const st = aircraftStatus(g, ac).label;
    switch (filter) {
      case 'flying': return st === 'Flying';
      case 'idle': return st === 'Idle';
      case 'order': return ac.status === 'delivering';
      case 'hangar': return ac.status === 'maintenance' || ac.status === 'refit';
      default: return true;
    }
  });
  const byType = useMemo(() => {
    const m = new Map<string, number>();
    for (const ac of g.fleet) m.set(ac.typeId, (m.get(ac.typeId) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [g.fleet.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const owned = g.fleet.filter((a) => a.ownership === 'owned');
  const leased = g.fleet.filter((a) => a.ownership === 'leased');
  const avgAge = g.fleet.length ? g.fleet.reduce((s, a) => s + ageYears(g, a), 0) / g.fleet.length : 0;
  const counts: Record<Filter, number> = {
    all: g.fleet.length,
    flying: g.fleet.filter((a) => aircraftStatus(g, a).label === 'Flying').length,
    idle: g.fleet.filter((a) => aircraftStatus(g, a).label === 'Idle').length,
    order: g.fleet.filter((a) => a.status === 'delivering').length,
    hangar: g.fleet.filter((a) => a.status === 'maintenance' || a.status === 'refit').length,
  };
  const p = g.policies;

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>Fleet</h1>
          <div className="subtitle">{g.fleet.length} aircraft · {owned.length} owned · {leased.length} leased · average age {avgAge.toFixed(1)} years</div>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => store.navigate('market')}><ShoppingCart /> Aircraft market</button>
        </div>
      </div>

      <div className="grid-3 mb-16">
        <Card title="Fleet mix" icon={<Plane className="ico" />} className="span-2">
          {byType.length ? (
            <div className="row wrap gap-8">
              {byType.map(([t, n]) => (
                <span key={t} className="chip"><b>{n}×</b> {AIRCRAFT_BY_ID[t].name}</span>
              ))}
            </div>
          ) : <div className="small muted">No aircraft yet.</div>}
          <div className="small dim mt-12">Each aircraft family you operate needs its own pilot training and spares — a simpler fleet is cheaper to run.</div>
        </Card>
        <Card title="Maintenance programme" icon={<Wrench className="ico" />}>
          <Seg value={p.maintenance} onChange={(v) => store.update((gg) => { gg.policies.maintenance = v; })} options={[{ value: 0, label: 'Light' }, { value: 1, label: 'Standard' }, { value: 2, label: 'Premium' }]} />
          <div className="tiny dim mt-8">{['Cheaper hourly maintenance, but aircraft wear 40% faster.', 'Balanced cost and wear.', '25% costlier per hour, aircraft wear 30% slower and stay reliable.'][p.maintenance]}</div>
          <div className="row between mt-12">
            <span className="small">Auto heavy checks below</span>
            <div className="row gap-8">
              <Stepper value={p.autoMaintThreshold} min={30} max={80} step={5} onChange={(v) => store.update((gg) => { gg.policies.autoMaintThreshold = v; })} format={(v) => `${v}%`} />
              <Toggle on={p.autoMaint} onChange={(v) => store.update((gg) => { gg.policies.autoMaint = v; })} label="Auto maintenance" />
            </div>
          </div>
        </Card>
      </div>

      <div className="row between mb-12 wrap gap-8">
        <div className="row wrap gap-8">
          {(['all', 'flying', 'idle', 'order', 'hangar'] as Filter[]).map((f) => (
            <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {{ all: 'All', flying: 'Flying', idle: 'Idle', order: 'On order', hangar: 'In hangar' }[f]} <span className="dim">{counts[f]}</span>
            </button>
          ))}
        </div>
        {g.hubs.length > 1 && (
          <select className="select sm" value={hub} onChange={(e) => setHub(e.target.value)}>
            <option value="all">All hubs</option>
            {g.hubs.map((h) => <option key={h.code} value={h.code}>{h.code}</option>)}
          </select>
        )}
      </div>

      {g.fleet.length === 0 ? (
        <section className="card">
          <Empty icon={<Plane className="big-ico" />} title="Your hangar is empty">
            <p>Lease your first aircraft — leasing needs only a small deposit and delivery takes a couple of weeks.</p>
            <button className="btn btn-primary" onClick={() => store.navigate('market', { marketTab: 'lease' })}><KeyRound /> Browse leases</button>
          </Empty>
        </section>
      ) : (
        <div className="fleet-grid">
          {list.map((ac) => <AircraftCard key={ac.id} g={g} ac={ac} />)}
        </div>
      )}
    </div>
  );
}

function AircraftCard({ g, ac }: { g: GameState; ac: Aircraft }) {
  const t = AIRCRAFT_BY_ID[ac.typeId];
  const st = aircraftStatus(g, ac);
  const seats = cabinSeats(t, ac.cabin);
  return (
    <button className="card ac-card hoverable" onClick={() => store.navigate('fleet', { aircraftId: ac.id })}>
      <div className="row between">
        <div className="col" style={{ gap: 0, alignItems: 'flex-start' }}>
          <b className="mono">{ac.reg}</b>
          <span className="small muted ellipsis">{ac.name || t.name}</span>
        </div>
        <span className={`badge ${st.tone}`}>{st.label}</span>
      </div>
      <div className="ac-art"><AircraftArt typeId={ac.typeId} livery={g.airline.livery} code={g.airline.code} gear={false} /></div>
      <div className="row between small">
        <span className="muted">{t.short} · {ac.hub}</span>
        <span className="muted">{totalSeats(seats)} seats</span>
      </div>
      <div className="ac-bars">
        <span className="tiny dim">Condition</span><Bar value={ac.condition / 100} tone="auto" size="thin" />
        <span className="tiny dim">Utilisation</span><Bar value={utilization(g, ac)} size="thin" />
      </div>
      <div className="row between small">
        <span className={`badge ${ac.ownership === 'owned' ? 'outline' : 'info'}`}>{ac.ownership === 'owned' ? 'Owned' : 'Leased'}</span>
        <span className={ac.lastMonthProfit >= 0 ? 'good' : 'bad'}>{ac.status === 'delivering' ? '' : `${money(ac.lastMonthProfit)}/mo`}</span>
      </div>
    </button>
  );
}

function AircraftDetail({ g, ac }: { g: GameState; ac: Aircraft }) {
  const t = AIRCRAFT_BY_ID[ac.typeId];
  const st = aircraftStatus(g, ac);
  const seats = cabinSeats(t, ac.cabin);
  const age = ageYears(g, ac);
  const value = marketValue(t, age, ac.condition);
  const checkCost = heavyCheckCost(t, age);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(ac.name);
  const [transfer, setTransfer] = useState(false);
  const routes = g.routes.filter((r) => r.from === ac.hub && !ac.assignments.some((x) => x.routeId === r.id) && !A.canFly(t, r.from, r.to));
  const [pick, setPick] = useState('');
  const pickRoute = routes.find((r) => r.id === pick) ?? routes[0];

  const sell = () => {
    const isLease = ac.ownership === 'leased';
    const price = A.saleValue(g, ac);
    const fee = A.earlyReturnFee(g, ac);
    store.openModal({
      kind: 'confirm',
      title: isLease ? `Return ${ac.reg} to the lessor?` : ac.status === 'delivering' ? `Cancel order for ${ac.reg}?` : `Sell ${ac.reg}?`,
      body: isLease
        ? `Your deposit of ${money(ac.leaseDeposit)} is refunded.${fee > 0 ? ` Early return fee: ${money(fee)}.` : ''}`
        : ac.status === 'delivering' ? `You get 90% of the purchase price back (${money(ac.purchasePrice * 0.9)}).` : `A buyer offers ${money(price)} (book value ${money(ac.bookValue)}).`,
      confirm: isLease ? 'Return aircraft' : ac.status === 'delivering' ? 'Cancel order' : 'Sell aircraft',
      danger: true,
      onConfirm: () => { store.act((gg) => A.sellAircraft(gg, ac.id), { sound: 'cash' }); store.navigate('fleet'); },
    });
  };

  return (
    <div className="screen">
      <button className="back" onClick={() => store.navigate('fleet')}><ArrowLeft /> Fleet</button>
      <section className="card ac-hero">
        <div className="ac-hero-art">
          <AircraftArt typeId={ac.typeId} livery={g.airline.livery} code={g.airline.code} name={g.airline.name} />
        </div>
        <div className="ac-hero-info">
          <div className="row gap-8 wrap">
            <span className={`badge ${st.tone}`}>{st.label}</span>
            <span className="badge outline">{BODY_LABEL[t.body]}</span>
            <span className={`badge ${ac.ownership === 'owned' ? 'outline' : 'info'}`}>{ac.ownership === 'owned' ? 'Owned' : 'Leased'}</span>
          </div>
          {renaming ? (
            <div className="row gap-8 mt-8">
              <input className="input" value={name} autoFocus maxLength={32} placeholder="e.g. Spirit of Lisbon" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { store.act((gg) => A.renameAircraft(gg, ac.id, name), { toastOk: false }); setRenaming(false); } }} />
              <button className="btn btn-primary btn-sm" onClick={() => { store.act((gg) => A.renameAircraft(gg, ac.id, name), { toastOk: false }); setRenaming(false); }}>Save</button>
            </div>
          ) : (
            <h1 className="mt-8 row gap-8">{ac.name || ac.reg}<button className="btn btn-ghost btn-icon btn-sm" onClick={() => setRenaming(true)} aria-label="Rename"><Pencil /></button></h1>
          )}
          <div className="muted">{t.name} · <span className="mono">{ac.reg}</span> · based at {ac.hub} ({AIRPORT_BY_CODE[ac.hub].city})</div>
          <div className="row gap-8 mt-16 wrap">
            <button className="btn" onClick={() => store.openModal({ kind: 'cabin', aircraftId: ac.id })}><Armchair /> Configure cabin</button>
            <button className="btn" disabled={ac.status !== 'active'} onClick={() => store.act((gg) => A.startHeavyCheck(gg, ac.id))}><Wrench /> Heavy check ({money(checkCost)})</button>
            {g.hubs.length > 1 && <button className="btn" onClick={() => setTransfer(true)}><ArrowRightLeft /> Transfer</button>}
            <button className="btn btn-danger" onClick={sell}><Tag /> {ac.ownership === 'leased' ? 'Return lease' : ac.status === 'delivering' ? 'Cancel order' : 'Sell'}</button>
          </div>
        </div>
      </section>

      <div className="grid-3 mt-16">
        <Card title="Condition & maintenance" icon={<Gauge className="ico" />}>
          <div className="row between"><span className="muted">Condition</span><b className={ac.condition < 45 ? 'bad' : ac.condition < 65 ? 'warn' : 'good'}>{Math.round(ac.condition)}%</b></div>
          <Bar value={ac.condition / 100} tone="auto" size="thick" />
          <div className="kv mt-12">
            <span>Age</span><b>{age.toFixed(1)} years</b>
            <span>Flight hours</span><b>{int(ac.hours)}</b>
            <span>Cycles</span><b>{int(ac.cycles)}</b>
            <span>Heavy check</span><b>{money(checkCost)} · {heavyCheckDays(t)} days</b>
          </div>
          <div className="tiny dim mt-8">Low condition raises maintenance costs, breakdowns and hurts reputation.</div>
        </Card>
        <Card title="Ownership" icon={<KeyRound className="ico" />}>
          <div className="kv">
            {ac.ownership === 'owned' ? (
              <>
                <span>Purchase price</span><b>{money(ac.purchasePrice)}</b>
                <span>Book value</span><b>{money(ac.bookValue)}</b>
                <span>Market value</span><b>{money(value)}</b>
              </>
            ) : (
              <>
                <span>Lease</span><b>{money(ac.leaseMonthly)} / month</b>
                <span>Deposit held</span><b>{money(ac.leaseDeposit)}</b>
                <span>Lease ends</span><b>{formatDate(ac.leaseEndDay)}</b>
                <span>Early return fee</span><b>{money(A.earlyReturnFee(g, ac))}</b>
              </>
            )}
            <span>Acquired</span><b>{formatDate(ac.acquiredDay)}</b>
          </div>
        </Card>
        <Card title="Performance" icon={<Plane className="ico" />}>
          <div className="kv">
            <span>Last month</span><b className={ac.lastMonthProfit >= 0 ? 'good' : 'bad'}>{money(ac.lastMonthProfit)}</b>
            <span>Lifetime revenue</span><b>{money(ac.lifetimeRevenue)}</b>
            <span>Lifetime op. cost</span><b>{money(ac.lifetimeCost)}</b>
            <span>Utilisation</span><b>{pct(utilization(g, ac))}</b>
          </div>
          <div className="tiny dim mt-8">Profit includes the lease payment; owned aircraft also depreciate.</div>
        </Card>
      </div>

      <div className="grid-2 mt-16">
        <Card title="Cabin" icon={<Armchair className="ico" />} sub={`${totalSeats(seats)} seats · ${cabinSummary(seats)}`} actions={<button className="btn btn-sm" onClick={() => store.openModal({ kind: 'cabin', aircraftId: ac.id })}>Configure</button>}>
          <SeatMap typeId={ac.typeId} cabin={ac.pendingCabin ?? ac.cabin} />
          {ac.pendingCabin && <div className="badge warn mt-8">New cabin being installed</div>}
        </Card>
        <Card title="Schedule" icon={<Plane className="ico" />} sub={`${pct(utilization(g, ac))} of available hours`}>
          {ac.assignments.length === 0 && <div className="small muted mb-12">Not assigned — this aircraft is earning nothing.</div>}
          {ac.assignments.map((x) => {
            const r = g.routes.find((rr) => rr.id === x.routeId);
            if (!r) return null;
            return (
              <div key={x.routeId} className="assign-row">
                <button className="link grow" onClick={() => store.navigate('routes', { routeId: r.id })}><b>{r.from} → {r.to}</b> <span className="dim small">{dist(r.dist)}</span></button>
                <Stepper value={x.freq} min={0} max={A.maxFreqFor(g, ac, r.id)} onChange={(v) => store.act((gg) => A.assignAircraft(gg, ac.id, r.id, v), { toastOk: false, sound: 'click' })} format={(v) => `${v}×`} />
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => store.act((gg) => A.assignAircraft(gg, ac.id, r.id, 0), { toastOk: false })} aria-label="Remove"><X /></button>
              </div>
            );
          })}
          <div className="divider" />
          {routes.length ? (
            <div className="row gap-8">
              <select className="select sm grow" value={pickRoute?.id ?? ''} onChange={(e) => setPick(e.target.value)}>
                {routes.map((r) => <option key={r.id} value={r.id}>{r.from} → {r.to} · {dist(r.dist)} · up to {A.maxFreqFor(g, ac, r.id)}×</option>)}
              </select>
              <button className="btn btn-primary btn-sm" disabled={!pickRoute || A.maxFreqFor(g, ac, pickRoute.id) === 0} onClick={() => pickRoute && store.act((gg) => A.assignAircraft(gg, ac.id, pickRoute.id, A.suggestFreq(gg, gg.fleet.find((x) => x.id === ac.id)!, pickRoute.id)), { toastOk: false })}><Plus /> Add</button>
            </div>
          ) : <div className="small muted">No other routes from {ac.hub} are in range. <button className="link" onClick={() => store.openModal({ kind: 'planner', hub: ac.hub })}>Plan one</button></div>}
        </Card>
      </div>

      <Card title="Specifications" className="mt-16">
        <div className="spec-grid">
          <div><span>Manufacturer</span><b>{t.manufacturer}</b></div>
          <div><span>Range</span><b>{dist(t.rangeKm)}</b></div>
          <div><span>Cruise speed</span><b>{int(t.speedKmh)} km/h</b></div>
          <div><span>Seats (typical / max)</span><b>{t.typicalSeats} / {t.maxSeats}</b></div>
          <div><span>Fuel burn</span><b>{t.fuelBurn.toFixed(2)} kg/km</b></div>
          <div><span>Length / span</span><b>{t.lengthM} m / {t.spanM} m</b></div>
          <div><span>MTOW</span><b>{t.mtow} t</b></div>
          <div><span>Belly cargo</span><b>{t.cargoT} t</b></div>
        </div>
        <p className="small muted mt-12">{t.fact}</p>
      </Card>

      {transfer && (
        <Modal title={`Transfer ${ac.reg}`} onClose={() => setTransfer(false)} footer={<button className="btn" onClick={() => setTransfer(false)}>Cancel</button>}>
          <p className="small muted">The aircraft leaves its current routes and ferries to the new base (2 days).</p>
          <div className="col gap-8 mt-12">
            {g.hubs.filter((h) => h.code !== ac.hub).map((h) => (
              <button key={h.code} className="list-btn" onClick={() => { store.act((gg) => A.transferAircraft(gg, ac.id, h.code)); setTransfer(false); }}>
                <span><b>{h.code}</b> {AIRPORT_BY_CODE[h.code].city}</span>
                <span className="dim small">Ferry flight</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
