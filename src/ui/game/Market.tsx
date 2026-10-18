import { Factory, KeyRound, Lock, ShoppingCart, Sparkles, Tag } from 'lucide-react';
import { useState } from 'react';
import { AIRCRAFT, AIRCRAFT_BY_ID, BODY_LABEL, type AircraftType, type BodyType } from '../../data/aircraft';
import { AIRPORT_BY_CODE } from '../../data/airports';
import * as A from '../../engine/actions';
import { type CabinConfig, cabinSeats, cabinSummary, defaultCabin, totalSeats, validateCabin } from '../../engine/cabin';
import { ageYears, leaseCapacity, leaseCommitments, trainingCost } from '../../engine/economy';
import type { GameState } from '../../engine/types';
import { formatDate, yearOf } from '../../engine/util';
import { AircraftArt } from '../components/AircraftArt';
import { Bar, Empty, Modal, Stepper, Tabs, useSort } from '../components/ui';
import { dist, money } from '../format';
import { store, useGame } from '../store';
import { CabinEditor } from './CabinConfig';

type MTab = 'new' | 'used' | 'lease';
const BODIES: (BodyType | 'all')[] = ['all', 'turboprop', 'regional', 'narrow', 'wide', 'jumbo', 'supersonic'];

function HubSelect({ g, value, onChange }: { g: GameState; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label>Base at hub</label>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {g.hubs.map((h) => <option key={h.code} value={h.code}>{h.code} · {AIRPORT_BY_CODE[h.code].city}</option>)}
      </select>
    </div>
  );
}

function fuelPerSeat(t: AircraftType) {
  return (t.fuelBurn * 100) / t.typicalSeats;
}

export function Market() {
  const g = useGame();
  const [tab, setTab] = useState<MTab>(store.nav.marketTab ?? 'new');
  const [body, setBody] = useState<BodyType | 'all'>('all');
  const commitments = leaseCommitments(g);
  const capacity = leaseCapacity(g);
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>Aircraft Market</h1>
          <div className="subtitle">Order factory-new jets, snap up used bargains or lease to preserve cash.</div>
        </div>
        <div className="actions">
          <Tabs<MTab> value={tab} onChange={setTab} tabs={[
            { id: 'new', label: 'New', icon: <Factory /> },
            { id: 'used', label: 'Used', icon: <Tag />, count: g.market.used.length },
            { id: 'lease', label: 'Leasing', icon: <KeyRound />, count: g.market.leases.length },
          ]} />
        </div>
      </div>
      <div className="row wrap gap-8 mb-16">
        {BODIES.map((b) => (
          <button key={b} className={`chip ${body === b ? 'active' : ''}`} onClick={() => setBody(b)}>{b === 'all' ? 'All types' : BODY_LABEL[b]}</button>
        ))}
        <span className="grow" />
        {tab === 'lease' && (
          <div className="lease-credit">
            <span className="small muted">Lease credit</span>
            <div style={{ width: 160 }}><Bar value={commitments / capacity} tone={commitments / capacity > 0.85 ? 'warn' : undefined} /></div>
            <span className="small num">{money(commitments)} / {money(capacity)} per month</span>
          </div>
        )}
      </div>
      {tab === 'new' && <NewAircraft g={g} body={body} />}
      {tab === 'used' && <UsedMarket g={g} body={body} />}
      {tab === 'lease' && <LeaseMarket g={g} body={body} />}
    </div>
  );
}

function NewAircraft({ g, body }: { g: GameState; body: BodyType | 'all' }) {
  const list = AIRCRAFT.filter((t) => t.inProduction && (body === 'all' || t.body === body));
  const year = yearOf(g.day);
  return (
    <div className="type-grid">
      {list.map((t) => {
        const locked = g.level < t.minLevel;
        const deal = A.dealDiscount(g, t.id);
        const future = t.availableFrom > year;
        return (
          <div key={t.id} className={`card type-card ${locked ? 'locked' : ''}`}>
            <div className="row between">
              <div>
                <div className="upper dim">{t.manufacturer}</div>
                <h3>{t.name}</h3>
              </div>
              <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
                {t.generation === 'new' && <span className="badge accent"><Sparkles size={12} /> New gen</span>}
                {deal > 0 && <span className="badge gold">−{Math.round(deal * 100)}% deal</span>}
              </div>
            </div>
            <div className="type-art"><AircraftArt typeId={t.id} livery={g.airline.livery} code={g.airline.code} /></div>
            <div className="spec-row">
              <div><span>Seats</span><b>{t.typicalSeats}<span className="dim">–{t.maxSeats}</span></b></div>
              <div><span>Range</span><b>{dist(t.rangeKm)}</b></div>
              <div><span>Fuel / seat</span><b>{fuelPerSeat(t).toFixed(2)} kg</b></div>
            </div>
            <div className="row between mt-8">
              <div>
                <div className="price">{money(t.price * (1 - deal))}</div>
                <div className="tiny dim">{future ? `First deliveries ${t.availableFrom}` : `Lead time ~${t.leadMonths} months`} · {BODY_LABEL[t.body]}</div>
              </div>
              {locked ? (
                <span className="badge"><Lock size={12} /> Level {t.minLevel}</span>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={() => store.openModal({ kind: 'order', typeId: t.id })}><ShoppingCart /> Order</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UsedMarket({ g, body }: { g: GameState; body: BodyType | 'all' }) {
  const rows = g.market.used.filter((u) => body === 'all' || AIRCRAFT_BY_ID[u.typeId].body === body);
  const { sorted, th } = useSort(rows, { key: 'price', dir: 1 }, {
    type: (u) => AIRCRAFT_BY_ID[u.typeId].name, age: (u) => ageYears(g, u), cond: (u) => u.condition, price: (u) => u.price, seats: (u) => totalSeats(cabinSeats(AIRCRAFT_BY_ID[u.typeId], u.cabin)),
  });
  if (!rows.length) return <section className="card"><Empty title="No listings right now">New aircraft come onto the market every month.</Empty></section>;
  return (
    <section className="card">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {th('type', 'Aircraft')}
              {th('age', 'Age', 'num')}
              {th('cond', 'Condition')}
              {th('seats', 'Cabin')}
              <th>Seller</th>
              {th('price', 'Price', 'num')}
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((u) => {
              const t = AIRCRAFT_BY_ID[u.typeId];
              const s = cabinSeats(t, u.cabin);
              const locked = g.level < t.minLevel;
              return (
                <tr key={u.id}>
                  <td><div className="row gap-12"><div className="mini-art"><AircraftArt typeId={t.id} livery={{ primary: '#8792a8', secondary: '#c7cede', tail: 'solid' }} gear={false} /></div><div><b>{t.name}</b><div className="tiny dim">{BODY_LABEL[t.body]} · {dist(t.rangeKm)}</div></div></div></td>
                  <td className="num">{ageYears(g, u).toFixed(1)} yrs</td>
                  <td style={{ minWidth: 110 }}><div className="row gap-8"><div className="grow"><Bar value={u.condition / 100} tone="auto" size="thin" /></div><span className="small num">{u.condition}%</span></div></td>
                  <td className="small">{totalSeats(s)} · <span className="dim">{cabinSummary(s)}</span></td>
                  <td className="small muted">{u.seller}<div className="tiny dim">Until {formatDate(u.expiresDay)}</div></td>
                  <td className="num"><b>{money(u.price)}</b></td>
                  <td>{locked ? <span className="badge"><Lock size={12} /> Lv {t.minLevel}</span> : <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'buyUsed', listingId: u.id })}>Buy</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LeaseMarket({ g, body }: { g: GameState; body: BodyType | 'all' }) {
  const rows = g.market.leases.filter((o) => body === 'all' || AIRCRAFT_BY_ID[o.typeId].body === body);
  const { sorted, th } = useSort(rows, { key: 'monthly', dir: 1 }, {
    type: (o) => AIRCRAFT_BY_ID[o.typeId].name, monthly: (o) => o.monthly, delivery: (o) => o.deliveryDays, term: (o) => o.termMonths,
  });
  if (!rows.length) return <section className="card"><Empty title="No lease offers">Lessors post new offers every month.</Empty></section>;
  return (
    <section className="card">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {th('type', 'Aircraft')}
              <th>Condition</th>
              {th('monthly', 'Monthly', 'num')}
              {th('term', 'Term', 'num')}
              {th('delivery', 'Delivery', 'num')}
              <th className="num">Available</th>
              <th>Lessor</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((o) => {
              const t = AIRCRAFT_BY_ID[o.typeId];
              const locked = g.level < t.minLevel;
              return (
                <tr key={o.id}>
                  <td><div className="row gap-12"><div className="mini-art"><AircraftArt typeId={t.id} livery={o.isNew ? g.airline.livery : { primary: '#8792a8', secondary: '#c7cede', tail: 'solid' }} gear={false} /></div><div><b>{t.name}</b><div className="tiny dim">{o.isNew ? <span className="accent">Factory new</span> : `${ageYears(g, o).toFixed(0)} years old`} · {dist(t.rangeKm)}</div></div></div></td>
                  <td style={{ minWidth: 100 }}>{o.isNew ? <span className="badge accent">New</span> : <div className="row gap-8"><div className="grow"><Bar value={o.condition / 100} tone="auto" size="thin" /></div><span className="small num">{o.condition}%</span></div>}</td>
                  <td className="num"><b>{money(o.monthly)}</b></td>
                  <td className="num">{o.termMonths / 12} yrs</td>
                  <td className="num">{o.deliveryDays} days</td>
                  <td className="num">{o.qty}</td>
                  <td className="small muted">{o.lessor}</td>
                  <td>{locked ? <span className="badge"><Lock size={12} /> Lv {t.minLevel}</span> : <button className="btn btn-sm btn-primary" onClick={() => store.openModal({ kind: 'lease', offerId: o.id })}>Lease</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Purchase dialogs
// ---------------------------------------------------------------------------

function TrainingNote({ g, t }: { g: GameState; t: AircraftType }) {
  if (g.familiesTrained.includes(t.family)) return null;
  return <div className="note warn small">First {t.family}-family aircraft: pilot type rating & spares cost {money(trainingCost(t))}, plus ~$90K/month for each extra family you run.</div>;
}

export function OrderModal({ typeId }: { typeId: string }) {
  const g = useGame();
  const t = AIRCRAFT_BY_ID[typeId];
  const [qty, setQty] = useState(1);
  const [hub, setHub] = useState(g.hubs[0].code);
  const [cabin, setCabin] = useState<CabinConfig>(() => defaultCabin(t));
  const q = A.newOrderQuote(g, typeId, qty, cabin);
  const valid = validateCabin(t, cabin).ok;
  const order = () => {
    const res = store.act((gg) => A.orderNew(gg, typeId, qty, cabin, hub), { sound: 'cash' });
    if (res.ok) store.closeModal();
  };
  return (
    <Modal title={`Order ${t.name}`} icon={<Factory className="accent" />} size="xwide" onClose={() => store.closeModal()} footer={
      <>
        <span className="grow small muted">First delivery {formatDate(q.firstDelivery)}{qty > 1 ? `, then one every ${q.interval} days` : ''}</span>
        <button className="btn" onClick={() => store.closeModal()}>Cancel</button>
        <button className="btn btn-primary" disabled={!valid || g.cash < q.total} onClick={order}><ShoppingCart /> Order for {money(q.total)}</button>
      </>
    }>
      <div className="order-grid">
        <div className="col gap-12">
          <AircraftArt typeId={typeId} livery={g.airline.livery} code={g.airline.code} name={g.airline.name} />
          <div className="grid-2">
            <div className="field"><label>Quantity</label><Stepper value={qty} min={1} max={30} onChange={setQty} /></div>
            <HubSelect g={g} value={hub} onChange={setHub} />
          </div>
          <div className="kv">
            <span>List price</span><b>{money(t.price)}</b>
            <span>Discount</span><b className={q.discount > 0 ? 'good' : ''}>{q.discount > 0 ? `−${Math.round(q.discount * 100)}%` : '—'}</b>
            <span>Cabin fit-out</span><b>{money(q.unit - t.price * (1 - q.discount))} each</b>
            <span>Training</span><b>{q.training ? money(q.training) : 'Already certified'}</b>
            <span>Total</span><b className="big">{money(q.total)}</b>
            <span>Cash after</span><b className={g.cash - q.total < 0 ? 'bad' : ''}>{money(g.cash - q.total)}</b>
          </div>
          <div className="tiny dim">Bulk discounts: 3+ aircraft 4%, 5+ 7%, 10+ 12%.</div>
          <TrainingNote g={g} t={t} />
        </div>
        <div>
          <div className="upper dim mb-8">Cabin configuration</div>
          <CabinEditor typeId={typeId} value={cabin} onChange={setCabin} />
        </div>
      </div>
    </Modal>
  );
}

export function BuyUsedModal({ listingId }: { listingId: string }) {
  const g = useGame();
  const u = g.market.used.find((x) => x.id === listingId);
  const [hub, setHub] = useState(g.hubs[0].code);
  if (!u) return null;
  const t = AIRCRAFT_BY_ID[u.typeId];
  const s = cabinSeats(t, u.cabin);
  const training = g.familiesTrained.includes(t.family) ? 0 : trainingCost(t);
  const buy = () => {
    const res = store.act((gg) => A.buyUsed(gg, listingId, hub), { sound: 'cash' });
    if (res.ok) store.closeModal();
  };
  return (
    <Modal title={`Buy used ${t.name}`} icon={<Tag className="accent" />} size="wide" onClose={() => store.closeModal()} footer={
      <>
        <button className="btn" onClick={() => store.closeModal()}>Cancel</button>
        <button className="btn btn-primary" disabled={g.cash < u.price + training} onClick={buy}>Buy for {money(u.price + training)}</button>
      </>
    }>
      <AircraftArt typeId={u.typeId} livery={g.airline.livery} code={g.airline.code} name={g.airline.name} />
      <div className="grid-2 mt-12">
        <div className="kv">
          <span>Age</span><b>{ageYears(g, u).toFixed(1)} years</b>
          <span>Condition</span><b>{u.condition}%</b>
          <span>Cabin</span><b>{totalSeats(s)} seats · {cabinSummary(s)}</b>
          <span>Seller</span><b>{u.seller}</b>
          <span>Price</span><b className="big">{money(u.price)}</b>
        </div>
        <div className="col gap-12">
          <HubSelect g={g} value={hub} onChange={setHub} />
          <div className="small muted">Ferry & registration take 1–2 weeks. You can reconfigure the cabin after delivery.</div>
          <TrainingNote g={g} t={t} />
        </div>
      </div>
    </Modal>
  );
}

export function LeaseModal({ offerId }: { offerId: string }) {
  const g = useGame();
  const o = g.market.leases.find((x) => x.id === offerId);
  const [hub, setHub] = useState(g.hubs[0].code);
  const [cabin, setCabin] = useState<CabinConfig>(() => (o ? defaultCabin(AIRCRAFT_BY_ID[o.typeId]) : {}));
  if (!o) return null;
  const t = AIRCRAFT_BY_ID[o.typeId];
  const q = A.leaseQuote(g, offerId)!;
  const commitments = leaseCommitments(g);
  const capacity = leaseCapacity(g);
  const over = commitments + o.monthly > capacity;
  const lease = () => {
    const res = store.act((gg) => A.leaseAircraft(gg, offerId, hub, cabin), { sound: 'cash' });
    if (res.ok) store.closeModal();
  };
  const valid = validateCabin(t, cabin).ok;
  return (
    <Modal title={`Lease ${t.name}`} icon={<KeyRound className="accent" />} size={o.isNew ? 'xwide' : 'wide'} onClose={() => store.closeModal()} footer={
      <>
        <span className="grow small muted">Arrives {formatDate(g.day + o.deliveryDays)} · first payment after delivery</span>
        <button className="btn" onClick={() => store.closeModal()}>Cancel</button>
        <button className="btn btn-primary" disabled={over || !valid || g.cash < q.deposit + q.training} onClick={lease}><KeyRound /> Sign lease</button>
      </>
    }>
      <div className={o.isNew ? 'order-grid' : ''}>
        <div className="col gap-12">
          <AircraftArt typeId={o.typeId} livery={g.airline.livery} code={g.airline.code} name={g.airline.name} />
          <div className="kv">
            <span>Lessor</span><b>{o.lessor}</b>
            <span>Aircraft</span><b>{o.isNew ? 'Factory new' : `${ageYears(g, o).toFixed(1)} years · ${o.condition}% condition`}</b>
            <span>Monthly rent</span><b className="big">{money(o.monthly)}</b>
            <span>Term</span><b>{o.termMonths} months</b>
            <span>Security deposit</span><b>{money(q.deposit)} (refundable)</b>
            <span>Training</span><b>{q.training ? money(q.training) : 'Already certified'}</b>
          </div>
          <HubSelect g={g} value={hub} onChange={setHub} />
          <div>
            <div className="row between small"><span className="muted">Lease credit after signing</span><span className="num">{money(commitments + o.monthly)} / {money(capacity)}</span></div>
            <Bar value={(commitments + o.monthly) / capacity} tone={over ? 'bad' : undefined} />
            {over && <div className="small bad mt-8">Lessors won’t extend more credit yet — grow revenue or equity, or buy aircraft outright.</div>}
          </div>
          <TrainingNote g={g} t={t} />
          {!o.isNew && <div className="small muted">Used aircraft come with the lessor’s standard cabin; you can refit it later.</div>}
        </div>
        {o.isNew && (
          <div>
            <div className="upper dim mb-8">Cabin configuration</div>
            <CabinEditor typeId={o.typeId} value={cabin} onChange={setCabin} />
          </div>
        )}
      </div>
    </Modal>
  );
}
