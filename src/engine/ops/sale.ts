// v0.7.2 selling owned aircraft and the least-used ranking (UPDATE-0.7.2.md §6.1, §6.3). The sale is priced with the
// v0.7 market model (age, market index) adjusted for hours, cycles, C-check life and cabin; it closes 10–20 days
// after agreement with the handover at home base (a ferry home when it would be elsewhere).

import { EX_OPERATORS } from '../../data/market';
import { BAL } from '../core/balance';
import { flightsOf, removeFlights, touchFlights } from '../core/entities';
import { cashOnly, post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { DAY, fmtDay, yearOf, fmtDayRange } from '../core/time';
import type { ActionResult, Aircraft, GameState, Minute, SimEvent } from '../core/types';
import { clamp, hashUnit } from '../core/util';
import { planPositioning } from '../contracts';
import { settleDeparture } from './finance';
import { cancelLegs, subcharterInstead } from './flights';
import { checkStatus } from './maintenance';
import { isRevenue, usd } from './util';

export interface SaleQuote {
  ok: boolean;
  why: string | null;
  price: number;
  /** 'Market value 2009 A320' … 'C-check life used' … 'Broker 2%'. */
  lines: { label: string; amount: number }[];
  buyer: string;
  closes: Minute;
  bookValue: number;
  gain: number;
  /** 'TUI summer programme: 12 legs after 14 Nov'; 'C-check at Lufthansa Technik Sofia 11–25 Apr: cancel it or sell after 25 Apr'. */
  blockers: string[];
  /** v0.7.2 the first check, refit or other booking in the way (its ferries can't be sub-chartered). */
  booking?: SaleBooking;
}

/**
 * v0.8 pre-release: flight hours per cycle in a type's earlier airline life: the type's own (long-haul widebodies fly
 * few long sectors), else the body's norm (fhYear / cyclesYear). Pure.
 */
export function hoursPerCycle(typeId: string): number {
  const S = BAL.v072.sale;
  const t = typeOf(typeId);
  const w = t?.body === 'wide' ? 1 : 0;
  return t?.hPerCycle ?? S.fhYear[w] / S.cyclesYear[w];
}

/** v0.8 pre-release: a used airframe's hours and cycles at `age` years on the sale model's norms (`spread` scales the hours). Pure. */
export function usedHoursCycles(typeId: string, age: number, spread = 1): { hours: number; cycles: number } {
  const w = typeOf(typeId)?.body === 'wide' ? 1 : 0;
  const hours = Math.round(Math.max(0, age) * BAL.v072.sale.fhYear[w] * spread);
  return { hours, cycles: Math.round(hours / hoursPerCycle(typeId)) };
}

/** v0.7 market model: the type's used value × age (−2%/year past 12, −4%/year past 18; 0.55–1.15) × the segment's index. Pure. */
export function usedMarketValue(g: GameState, typeId: string, builtYear: number): number {
  const t = typeOf(typeId);
  const age = Math.max(0, yearOf(g.now) - builtYear);
  const ageAdj = clamp(1 - (age - 12) * 0.02 - Math.max(0, age - 18) * 0.04, 0.55, 1.15);
  return t.valueUsed * ageAdj * (t.body === 'wide' ? g.market.wideIndex : g.market.narrowIndex);
}

/** A booking that blocks a sale: cancel it, or sell after `until` (its ferry home landed). */
export interface SaleBooking { maintId: string; kind: string; until: Minute; text: string }

const BUYERS = ['AerCap', 'Avolon', 'SMBC Aviation Capital', 'BOC Aviation', 'Carlyle Aviation Partners', 'Air Lease Corporation', 'Aviation Capital Group'];
const r1k = (v: number) => Math.round(v / 1000) * 1000;

/** The buyer and closing day: fixed per aircraft and day (hashUnit), so the quote the player saw is the deal. */
function terms(g: GameState, ac: Aircraft): { buyer: string; closes: Minute } {
  const S = BAL.v072.sale;
  const day = Math.floor(g.now / DAY);
  const airlines = (EX_OPERATORS[ac.typeId] ?? []).map((x) => x.airline);
  const pool = [...BUYERS, ...airlines];
  const buyer = pool[Math.floor(hashUnit(`buyer:${ac.id}:${day}`) * pool.length)];
  const days = S.daysMin + Math.floor(hashUnit(`close:${ac.id}:${day}`) * (S.daysMax - S.daysMin + 1));
  return { buyer, closes: (day + days) * DAY + 12 * 60 };
}

/** What a buyer pays for an owned aircraft now (pure: buyer and days from hashUnit(id + day)). */
export function saleQuote(g: GameState, aircraftId: string): SaleQuote {
  const ac = g.fleet[aircraftId];
  const none: SaleQuote = { ok: false, why: null, price: 0, lines: [], buyer: '', closes: g.now, bookValue: 0, gain: 0, blockers: [] };
  if (!ac) return { ...none, why: 'Aircraft not found' };
  if (ac.ownership.kind !== 'owned') return { ...none, why: 'Only aircraft we own can be sold; leased ones go back to the lessor' };
  const S = BAL.v072.sale;
  const t = typeOf(ac.typeId);
  const w = t.body === 'wide' ? 1 : 0;
  const age = Math.max(0, yearOf(g.now) - ac.builtYear);
  // The v0.7 market model: −2%/year past 12, −4%/year past 18 (0.55–1.15), times the market index.
  const index = w ? g.market.wideIndex : g.market.narrowIndex;
  const market = usedMarketValue(g, ac.typeId, ac.builtYear);
  const yrs = Math.max(1, age);
  const hoursAdj = clamp(1 - 0.15 * (ac.hours / (yrs * S.fhYear[w]) - 1), 0.85, 1.1);
  // v0.8 pre-release: cycles against the type's own norm (a 747-400 flies about one cycle per 8.5 h).
  const cyclesAdj = clamp(1 - 0.1 * (ac.cycles / ((yrs * S.fhYear[w]) / hoursPerCycle(ac.typeId)) - 1), 0.85, 1.1);
  const use = market * (hoursAdj * cyclesAdj - 1);
  const cUsed = Math.min(1, Math.max(0, checkStatus(g, ac).cUsed));
  const cLife = cUsed * BAL.checkCost.C[w] * S.cLifeShare;
  const vip = ac.cabin.layout === 'vip' ? (market + use) * S.vipAdj : 0;
  const gross = market + use - cLife + vip;
  // A quick sale to a trader, then the broker; in the first year never above what we paid (moved by the index since).
  const discount = gross * S.discount;
  let before = gross - discount;
  const own = ac.ownership.kind === 'owned' ? ac.ownership : undefined;
  let cap = 0;
  if (own?.boughtAt !== undefined && own.boughtPrice && g.now - own.boughtAt < 365 * DAY) {
    const limit = (own.boughtPrice * (index / (own.boughtIndex || 1)) * S.firstYearCap) / (1 - S.broker);
    if (before > limit) {
      cap = limit - before;
      before = limit;
    }
  }
  const broker = before * S.broker;
  const lines = [
    { label: `Market value ${ac.builtYear} ${t.short}`, amount: r1k(market) },
    { label: hoursAdj * cyclesAdj >= 1 ? 'Low hours and cycles' : 'High hours and cycles', amount: r1k(use) },
    { label: 'C-check life used', amount: -r1k(cLife) },
    ...(vip ? [{ label: 'VIP cabin (few buyers)', amount: r1k(vip) }] : []),
    { label: `Quick sale ${Math.round(S.discount * 100)}%`, amount: -r1k(discount) },
    ...(cap ? [{ label: 'Bought this year: below the price we paid', amount: r1k(cap) }] : []),
    { label: `Broker ${Math.round(S.broker * 100)}%`, amount: -r1k(broker) },
  ];
  const price = Math.max(0, Math.round((before - broker) / 10_000) * 10_000);
  const { buyer, closes } = terms(g, ac);
  const bookValue = ac.ownership.bookValue;
  const q: SaleQuote = { ok: false, why: null, price, lines, buyer, closes, bookValue, gain: price - bookValue, blockers: [] };
  if (ac.sale) return { ...q, why: `Already sold to ${ac.sale.buyer}: hands over ${fmtDay(ac.sale.closes)}` };
  if (ac.status === 'delivering') return { ...q, why: `${ac.reg} has not been delivered yet` };
  if (ac.status === 'leasedOut' || ac.status === 'stored') return { ...q, why: `${ac.reg} is not on the AOC` };
  const b = blockersOf(g, ac, closes);
  q.blockers = b.lines;
  if (b.booking) q.booking = b.booking;
  return { ...q, ok: !q.blockers.length, why: q.blockers[0] ?? null };
}

/** Signed work or bookings after the aircraft must leave for the handover (one line per contract or booking). */
function blockersOf(g: GameState, ac: Aircraft, closes: Minute): { lines: string[]; booking: SaleBooking | null } {
  const home = g.company.homeBase;
  const leave = closes - (ac.at === home ? 0 : 2 * DAY);
  const n = new Map<string, number>();
  for (const f of flightsOf(g, ac.id)) {
    // check, refit, return and delivery ferries belong to their booking (listed below), not 'Other flights'
    if ((f.status !== 'scheduled' && f.status !== 'enroute') || f.kind === 'positioning' || f.purpose || (f.eta ?? f.sta) <= leave) continue;
    const k = f.contractId ?? '';
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  const lines = [...n].map(([k, c]) => `${k ? g.contracts[k]?.title ?? 'A contract' : 'Other flights'}: ${c} leg${c > 1 ? 's' : ''} after ${fmtDay(leave)}`);
  // Only base deployments roll legs forward (not yet built); other patterns' legs all exist, so moved or sub-chartered ones no longer block.
  for (const c of Object.values(g.contracts)) {
    if ((c.status === 'signed' || c.status === 'active') && c.pattern.kind === 'base' && c.aircraftIds.includes(ac.id) && !n.has(c.id) && c.pattern.to > leave) lines.push(`${c.title}: runs to ${fmtDay(c.pattern.to)}`);
  }
  let booking: SaleBooking | null = null;
  for (const m of Object.values(g.maintenance)) {
    if (m.aircraftId !== ac.id || (m.status !== 'planned' && m.status !== 'inWork') || m.kind === 'AOG') continue;
    const back = (m.homeIds ?? []).map((id) => g.flights[id]).filter((f) => f && f.status !== 'cancelled');
    const until = back.length ? Math.max(...back.map((f) => f.sta)) : m.end;
    if (until <= leave) continue;
    const what = m.kind === 'A' || m.kind === 'C' ? `${m.kind}-check` : m.kind === 'refit' ? 'Cabin refit' : m.kind === 'return' ? 'Lease return check' : m.kind === 'paint' ? 'Paint' : m.kind;
    const text = `${what}${m.hub ? ` at ${m.hub.name}` : ''} ${fmtDayRange(m.start, m.end)}: cancel it or sell after ${fmtDay(until)}`;
    lines.push(text);
    if (!booking) booking = { maintId: m.id, kind: m.kind, until, text };
  }
  return { lines, booking };
}

/** Agrees the sale at the quoted price; it closes on `closes` (a ferry home is booked when it would be elsewhere). */
export function sellAircraft(g: GameState, aircraftId: string, expectPrice?: number): ActionResult<{ closes: Minute }> {
  const q = saleQuote(g, aircraftId);
  if (!q.ok) return { ok: false, error: q.why ?? 'Cannot sell it now' };
  if (expectPrice !== undefined && q.price < expectPrice) return { ok: false, error: `${q.buyer} now offers ${usd(q.price)}; review the quote again` };
  const ac = g.fleet[aircraftId];
  ac.sale = { buyer: q.buyer, price: q.price, agreed: g.now, closes: q.closes };
  // Soft positioning legs after the handover go back to contracts (they would fly an aircraft we no longer have).
  const soft = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled' && f.kind === 'positioning' && f.std >= q.closes - DAY);
  if (soft.length) removeFlights(g, soft.map((f) => f.id));
  const where = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled' || f.status === 'enroute').at(-1)?.to ?? ac.at;
  if (where !== g.company.homeBase) {
    const legs = planPositioning(g, ac.id, g.company.homeBase, q.closes - 60, 'ferry', null) ?? [];
    for (const f of legs) f.purpose = 'sale';
    ac.sale.ferryIds = legs.map((f) => f.id);
  }
  schedule(g, q.closes, 'aircraft.sale', ac.id);
  touchFlights(g);
  pushMessage(g, {
    tone: 'info', cat: 'company', title: `Sale agreed: ${ac.reg} to ${q.buyer} (handover ${fmtDay(q.closes)})`,
    body: `${usd(q.price)} (book value ${usd(q.bookValue)}). Handover at ${g.company.homeBase} on ${fmtDay(q.closes)}${ac.sale.ferryIds?.length ? '; a ferry brings it home first' : ''}. It takes no new work.`,
    ref: { kind: 'aircraft', id: ac.id },
  });
  return { ok: true, msg: `${ac.reg} goes to ${q.buyer} on ${fmtDay(q.closes)} for ${usd(q.price)}`, data: { closes: q.closes } };
}

/** Calls off an agreed sale before it closes (free: the buyer walks away). */
export function cancelSale(g: GameState, aircraftId: string): ActionResult {
  const ac = g.fleet[aircraftId];
  if (!ac?.sale) return { ok: false, error: 'No sale agreed' };
  const ferries = (ac.sale.ferryIds ?? []).filter((id) => g.flights[id]?.status === 'scheduled');
  if (ferries.length) removeFlights(g, ferries);
  const buyer = ac.sale.buyer;
  delete ac.sale;
  touchFlights(g);
  pushMessage(g, { tone: 'info', cat: 'company', title: `Sale of ${ac.reg} called off`, body: `${buyer} walks away; nothing to pay. ${ac.reg} can take work again.`, ref: { kind: 'aircraft', id: ac.id } });
  return { ok: true, msg: `${ac.reg} stays with us` };
}

/** 'aircraft.sale': the handover at home base (a day later while it is still flying or in the hangar). */
export function onSaleClose(g: GameState, ev: SimEvent): void {
  const ac = g.fleet[ev.id];
  const s = ac?.sale;
  if (!ac || !s || s.closes > g.now) return;
  const busy = ac.flightId || ac.status === 'maintenance' || ac.status === 'aog' || ac.status === 'flying';
  if (busy) {
    s.closes = g.now + DAY;
    schedule(g, s.closes, 'aircraft.sale', ac.id);
    return;
  }
  // Work still on it (retimed past the handover): operations hand revenue legs to a rival (we still bill the
  // client) or cancel them when that costs less; empty legs go.
  const left = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled');
  const rev = left.filter(isRevenue);
  let kept = '';
  if (rev.length) {
    const n = rev.length === 1 ? 'The 1 leg still on it was' : `The ${rev.length} legs still on it were`;
    if (subcharterInstead(g, ac, rev, `${ac.reg} was handed over to ${s.buyer}`, false)) kept = ` ${n} handed to a rival operator.`;
    else {
      cancelLegs(g, rev, `${ac.reg} sold`, 1);
      kept = ` ${n} cancelled.`;
    }
  }
  const rest = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled');
  if (rest.length) removeFlights(g, rest.map((f) => f.id));
  const book = ac.ownership.kind === 'owned' ? ac.ownership.bookValue : 0;
  // Cash moves by exactly the price; the statement shows the gain or loss over book value.
  cashOnly(g, book);
  post(g, 'assetSale', s.price - book);
  settleDeparture(g, ac);
  delete g.fleet[ac.id];
  g.stats.sales = (g.stats.sales ?? 0) + 1;
  touchFlights(g);
  const gain = s.price - book;
  pushMessage(g, {
    tone: 'good', cat: 'company', title: `${ac.reg} sold to ${s.buyer}`,
    body: `${ac.reg} sold to ${s.buyer} for ${usd(s.price)}. Handed over at ${ac.at}; a ${usd(Math.abs(gain))} ${gain >= 0 ? 'gain over' : 'loss against'} book value.${kept}`,
  });
}

export interface LeastUsedRow {
  aircraftId: string; bh90: number; perDay: number; days: number;
  /** At least a week of tracking: false → say 'not enough history yet' rather than name it. */
  enough: boolean;
}

/**
 * Aircraft by utilisation over the last 90 days (block hours from bhDays over the days it was in the fleet and
 * tracked, idle days included), lowest first; rows with less than a week of history last. Pure.
 */
export function leastUsed(g: GameState, kind: 'owned' | 'leased' | 'any'): LeastUsedRow[] {
  const today = Math.floor(g.now / DAY);
  const out: LeastUsedRow[] = [];
  for (const ac of Object.values(g.fleet)) {
    if (ac.status === 'delivering' || ac.status === 'leasedOut' || ac.status === 'stored' || ac.sale || ac.returning) continue;
    if (kind === 'owned' && ac.ownership.kind !== 'owned') continue;
    if (kind === 'leased' && ac.ownership.kind !== 'dryLeaseIn') continue;
    const bd = (ac.bhDays ?? []).filter(([d]) => d > today - 90);
    const min = bd.reduce((s, [, m]) => s + m, 0);
    const since = Math.max(Math.floor(ac.deliveredAt / DAY), ac.bhSince ?? -Infinity);
    const days = Math.max(1, Math.min(90, today - since + 1));
    out.push({ aircraftId: ac.id, bh90: Math.round(min / 6) / 10, perDay: Math.round((min / 60 / days) * 100) / 100, days, enough: days >= 7 });
  }
  return out.sort((a, b) => Number(b.enough) - Number(a.enough) || a.perDay - b.perDay || a.bh90 - b.bh90 || (a.aircraftId < b.aircraftId ? -1 : 1));
}
