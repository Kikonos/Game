// Scarce aircraft market and lease lifecycle (B3). DESIGN.md §5.10.

import { ACMI_TYPES_LIST, type AcmiType } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { flightsOf, nextId, touchFlights } from '../core/entities';
import { cashOnly } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { chance, gaussian, int, next, pick, range, weightedPick } from '../core/rng';
import { DAY, fmtDate, monthKey, yearOf } from '../core/time';
import type { ActionResult, Aircraft, AircraftOffer, Cabin, GameState, SimEvent } from '../core/types';
import { clamp } from '../core/util';
import { usd } from './util';

/** Real operating lessors (names only; they also trade used aircraft). */
const LESSORS = ['AerCap', 'Avolon', 'SMBC Aviation Capital', 'BOC Aviation', 'Carlyle Aviation Partners', 'Air Lease Corporation', 'Aviation Capital Group'];
const MONTH = 30.44 * DAY;

const cabinOf = (t: AcmiType): Cabin => {
  const p = t.cabins[0];
  return { j: p.j, w: p.w, y: p.y, total: p.j + p.w + p.y, label: p.label, layout: p.layout };
};

/** Types on offer now: tier ≤ 2 from the start; tier 3+ once reliability ≥ 70 and 4+ aircraft. */
function eligibleTypes(g: GameState): AcmiType[] {
  const fleet = Object.keys(g.fleet).length;
  const big = g.company.reputation.reliable >= 70 && fleet >= 4;
  return ACMI_TYPES_LIST.filter((t) => t.available && (t.tier <= 2 || big));
}

/** One offer of type t; `lease` forces a dry lease (the guaranteed offers). */
function makeOffer(g: GameState, t: AcmiType, lease = false): AircraftOffer {
  const now = yearOf(g.now);
  const old = t.id === 'b763' || t.id === 'a332' || t.id === 'a343' || t.id === 'b752';
  const built = old ? int(g, 1996, 2008) : t.tier <= 1 ? int(g, 2005, 2017) : int(g, now - 16, now - 6);
  const index = t.body === 'wide' ? g.market.wideIndex : g.market.narrowIndex;
  const age = now - built;
  const ageAdj = clamp(1 - (age - 12) * 0.015, 0.75, 1.15);
  const canBuy = t.body === 'narrow' || old;
  const buy = !lease && canBuy && chance(g, 0.3);
  const rent = Math.round((t.rentMonth * range(g, 0.9, 1.15) * index * ageAdj) / 1000) * 1000;
  const price = buy ? Math.round((t.valueUsed * range(g, 0.85, 1.1) * ageAdj) / 10_000) * 10_000 : 0;
  return {
    id: nextId(g, 'mo'), typeId: t.id, kind: buy ? 'buy' : 'dryLeaseIn', lessor: buy ? `${pick(g, LESSORS)} (used sale)` : pick(g, LESSORS),
    builtYear: built, cabin: cabinOf(t), rentPerMonth: buy ? 0 : rent, reservesPerFH: buy ? 0 : Math.round((t.maintBH * range(g, 0.38, 0.46)) / 10) * 10,
    leaseMonths: buy ? 0 : int(g, BAL.leaseMonths[0] / 6, BAL.leaseMonths[1] / 6) * 6, price, deposit: buy ? price : 2 * rent,
    leadDays: t.body === 'wide' ? int(g, BAL.deliveryDaysWide[0], BAL.deliveryDaysWide[1]) : int(g, BAL.deliveryDays[0], BAL.deliveryDays[1]), expires: g.now + int(g, BAL.marketOfferDays[0], BAL.marketOfferDays[1]) * DAY,
  };
}

function poisson(g: GameState, mean: number): number {
  let k = 0;
  let p = Math.exp(-mean);
  let s = p;
  const u = next(g);
  while (u > s && k < 6) {
    k++;
    p *= mean / k;
    s += p;
  }
  return k;
}

/** Monthly (and at the start): drop expired offers, drift fuel and demand, add Poisson(0.8) offers plus the guaranteed ones. */
export function refreshMarket(g: GameState): void {
  const m = g.market;
  m.aircraft = m.aircraft.filter((o) => o.expires > g.now);
  m.fuelPrice = Math.round(clamp(m.fuelPrice * (1 + gaussian(g) * 0.04) + (BAL.fuelPrice - m.fuelPrice) * 0.15, 550, 1050));
  m.narrowIndex = Math.round(clamp(m.narrowIndex + gaussian(g) * 0.03 + (1 - m.narrowIndex) * 0.2, 0.8, 1.25) * 1000) / 1000;
  m.wideIndex = Math.round(clamp(m.wideIndex + gaussian(g) * 0.03 + (1 - m.wideIndex) * 0.2, 0.8, 1.25) * 1000) / 1000;
  const month = monthKey(g.now) - monthKey(g.started);
  const types = eligibleTypes(g);
  for (let i = poisson(g, BAL.marketPerMonth); i > 0; i--) {
    // Widebodies are rare early on (DESIGN §5.10), until the guaranteed one has been offered.
    const t = weightedPick(g, types, (x) => (1 - x.scarcity) * (x.body === 'wide' && !m.gotWide ? BAL.wideMarketWeight : 1));
    if (t) m.aircraft.push(makeOffer(g, t));
  }
  // Guaranteed: a narrowbody dry lease in month 1–2, an old 767-300ER or A330-200 lease in month 4–6.
  if (!m.gotNarrow && (month >= 1 || chance(g, 0.5))) {
    m.gotNarrow = true;
    m.aircraft.push(makeOffer(g, typeOf(chance(g, 0.6) ? 'a320ceo' : 'b738'), true));
  }
  if (!m.gotWide && month >= 3 && (month >= 5 || chance(g, 0.4))) {
    m.gotWide = true;
    m.aircraft.push(makeOffer(g, typeOf(chance(g, 0.5) ? 'b763' : 'a332'), true));
  }
  if (m.aircraft.length > 6) m.aircraft = m.aircraft.slice(-6);
}

function registration(g: GameState): string {
  const used = new Set(Object.values(g.fleet).map((a) => a.reg));
  const prefix = g.company.regPrefix;
  const n = prefix.length <= 2 ? 4 : 3;
  for (;;) {
    let s = prefix === 'CS-' ? 'T' : '';
    while (s.length < n) s += String.fromCharCode(65 + int(g, 0, 25));
    if (!used.has(prefix + s)) return prefix + s;
  }
}

/** Signs a dry lease in (deposit) or a purchase (price): the aircraft is 'delivering' until leadDays, then joins at base. */
export function acquireAircraft(g: GameState, offerId: string): ActionResult<{ aircraftId: string }> {
  const i = g.market.aircraft.findIndex((o) => o.id === offerId);
  if (i < 0) return { ok: false, error: 'Offer not found' };
  const o = g.market.aircraft[i];
  if (o.expires <= g.now) return { ok: false, error: 'This offer has expired' };
  if (g.company.cash < o.deposit) return { ok: false, error: `Not enough cash: ${usd(o.deposit)} due at signing` };
  const t = typeOf(o.typeId);
  g.market.aircraft.splice(i, 1);
  cashOnly(g, -o.deposit);
  const delivered = g.now + o.leadDays * DAY;
  const age = Math.max(0, yearOf(g.now) - o.builtYear);
  const hours = Math.round(age * (t.body === 'wide' ? 3_600 : 2_600) * range(g, 0.85, 1.1));
  const ac: Aircraft = {
    id: nextId(g, 'a'), reg: registration(g), typeId: o.typeId,
    ownership: o.kind === 'buy'
      ? { kind: 'owned', bookValue: o.price }
      : { kind: 'dryLeaseIn', lessor: o.lessor, rentPerMonth: o.rentPerMonth, reservesPerFH: o.reservesPerFH, leaseStart: delivered, leaseEnd: delivered + Math.round(o.leaseMonths * MONTH), deposit: o.deposit },
    builtYear: o.builtYear, hours, cycles: Math.round(hours / (t.body === 'wide' ? 4.5 : 1.7)),
    // Delivered fresh from a redelivery check.
    maint: { fhSinceA: 0, lastA: delivered, fhSinceC: Math.round(range(g, 0.1, 0.4) * (t.body === 'wide' ? 6000 : 7500)), lastC: delivered - int(g, 60, 300) * DAY, deferred: 0.03 },
    cabin: { ...o.cabin }, etops: t.body === 'wide' ? Math.min(180, t.etopsMax) : 0,
    at: g.company.homeBase, flightId: null, status: 'delivering', maintId: null, deliveredAt: delivered,
  };
  g.fleet[ac.id] = ac;
  schedule(g, delivered, 'aircraft.delivery', ac.id);
  if (ac.ownership.kind === 'dryLeaseIn') schedule(g, ac.ownership.leaseEnd, 'lease.end', ac.id);
  touchFlights(g);
  const rated = Object.values(g.crew).some((c) => c.ratings.includes(t.family));
  pushMessage(g, {
    tone: 'good', cat: 'company', title: `${t.short} signed: ${ac.reg}`,
    body: `${o.kind === 'buy' ? `Bought for ${usd(o.price)}` : `Leased from ${o.lessor} at ${usd(o.rentPerMonth)}/month for ${o.leaseMonths} months`}. Delivery ${fmtDate(delivered)}.${rated ? '' : ` You need ${t.family}-rated crew: hire or train before it flies.`}`,
    ref: { kind: 'aircraft', id: ac.id },
  });
  return { ok: true, msg: `${ac.reg} arrives ${fmtDate(delivered)}`, data: { aircraftId: ac.id } };
}

/** 'aircraft.delivery': on the AOC at home base. */
export function onDelivery(g: GameState, ev: SimEvent): void {
  const ac = g.fleet[ev.id];
  if (!ac || ac.status !== 'delivering') return;
  ac.status = 'available';
  ac.at = g.company.homeBase;
  touchFlights(g);
  pushMessage(g, { tone: 'good', cat: 'company', title: `${ac.reg} delivered`, body: `The ${typeOf(ac.typeId).name} is on the AOC at ${g.company.homeBase}.`, ref: { kind: 'aircraft', id: ac.id } });
}

/** 'lease.end': return at base when free (deposit back), else extend month by month at +10%. */
export function onLeaseEnd(g: GameState, ev: SimEvent): void {
  const ac = g.fleet[ev.id];
  if (!ac || ac.ownership.kind !== 'dryLeaseIn' || ac.ownership.leaseEnd > g.now) return;
  const busy = ac.status !== 'available' || ac.at !== g.company.homeBase || flightsOf(g, ac.id).some((f) => f.status === 'scheduled' || f.status === 'enroute')
    || Object.values(g.contracts).some((c) => (c.status === 'signed' || c.status === 'active') && c.aircraftIds.includes(ac.id));
  if (busy) {
    ac.ownership.leaseEnd = g.now + Math.round(MONTH);
    ac.ownership.rentPerMonth = Math.round(ac.ownership.rentPerMonth * 1.1);
    schedule(g, ac.ownership.leaseEnd, 'lease.end', ac.id);
    pushMessage(g, { tone: 'warn', cat: 'company', title: `Lease extended: ${ac.reg}`, body: `${ac.reg} is still working, so the lease rolls on a month at ${usd(ac.ownership.rentPerMonth)} (+10%).`, ref: { kind: 'aircraft', id: ac.id } });
    return;
  }
  if (ac.ownership.deposit) cashOnly(g, ac.ownership.deposit);
  delete g.fleet[ac.id];
  touchFlights(g);
  pushMessage(g, { tone: 'info', cat: 'company', title: `${ac.reg} returned`, body: `Redelivered to ${ac.ownership.lessor}.${ac.ownership.deposit ? ` Deposit ${usd(ac.ownership.deposit)} refunded.` : ''}` });
}
