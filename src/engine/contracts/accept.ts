// Player actions on offers and contracts, and the contract lifecycle (B1). DESIGN.md §5.1.9.

import { v09Stats } from '../crew/dayPlan';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { nextId, removeFlights } from '../core/entities';
import { accrue, cashOnly, invoice, post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { requestPause } from '../core/pause';
import { schedule } from '../core/queue';
import { DAY, fmtDay, monthKey, monthStart, fmtDayRange } from '../core/time';
import { clamp } from '../core/util';
import type { ActionResult, Contract, ContractOffer, CrewExtra, Flight, GameState, Minute, OfferStatus, Product, Receivable, SimEvent } from '../core/types';
import { autoRoster, crewExtraFor, flightCrewStatus, onContractDoneMorale } from '../crew';
import { billContractMonth, issueBill, mghFor, mghRemaining } from './billing';
import { feasibility } from './feasibility';
import { baseDayOf, flownRotations, programmeOf } from './plan';
import { productValue } from './pricing';
import { generateFlights, relinkPositioning } from './schedule';
import { bookPaint, cancelPaintFor } from '../ops/paint';
import { paintWindow, type PaintSlot } from './paintTerms';
import { termsProduct } from './cabinTerms';
import { bookClientCabin, cancelClientCabinFor } from '../ops/clientCabin';
import { replyTime } from './counter';
import { bumpClient, noteJobDone, statsV08 } from './relations';
import { noteHiredUs } from './rivals';
import { rollRepeat } from './missions';
import { cancelDry, recallDry, recallTerms, signDryLease } from '../ops/dryLease';

// ---------- offers ----------

/** The offer's asking price in counter units: rate per BH (wet), all-in price (charter) or monthly rent (dry). */
export function askingPrice(o: Pick<ContractOffer, 'product'>): number {
  const p = o.product;
  return p.kind === 'wet' ? p.ratePerBH : p.kind === 'charter' ? p.price : p.rentPerMonth;
}

export function setPrice(o: { product: Product }, price: number): void {
  const p = o.product;
  if (p.kind === 'wet') p.ratePerBH = Math.round(price);
  else if (p.kind === 'charter') p.price = Math.round(price);
  else p.rentPerMonth = Math.round(price);
}

export function closeOffer(g: GameState, o: ContractOffer, status: OfferStatus, lostTo?: string): void {
  o.status = status;
  o.closedAt = g.now;
  if (lostTo) o.lostTo = lostTo;
}

/** Broker commission share (5%) when the job came through a broker. */
export const brokerCut = (c: { broker?: string }) => (c.broker ? BAL.brokerCommission : 0);

const firstNo = (rep: ReturnType<typeof feasibility>, skipPaint = false, skipCabin = false) => rep.checks.find((c) => c.level === 'no' && !(skipPaint && c.id === 'paint') && !(skipCabin && c.id === 'cabinReq'));

/** v0.5.1 accept/counter options: client paint on (default when the offer has it) or off; `priced` = counter reply (price final). */
export interface SignOpts {
  paint?: boolean;
  /** v0.7.4: the client's cabin request on (default when the offer has one) or off (optional requests only). */
  cabin?: boolean;
  priced?: boolean;
  /** v0.6: extra crew for this contract (paid option met when cabin ≥ requirements.extraCabin + extraCabinPaid.n). */
  crewExtra?: CrewExtra;
}

/** v0.9 ops/heads.ts: a deposit share for a charter signed without one (the credit controller's rule); 0 = none. */
let depositHook: ((g: GameState, c: Contract) => number) | null = null;
export function setDepositHook(f: typeof depositHook): void {
  depositHook = f;
}

/** v0.9 round 4 ops/heads.ts: the analyst notes its estimate on the contract at signing and is judged when it ends. */
let signHook: ((g: GameState, c: Contract, o: ContractOffer, aircraftId: string) => void) | null = null;
let completeHook: ((g: GameState, c: Contract) => void) | null = null;
export function setSignHook(f: typeof signHook): void {
  signHook = f;
}
export function setCompleteHook(f: typeof completeHook): void {
  completeHook = f;
}

/**
 * Signs the offer on the chosen aircraft: creates the Contract, generates flights (schedule.ts),
 * books the charter deposit, queues contract.start/end, asks crew to roster (crew.autoRoster).
 */
export function acceptOffer(g: GameState, offerId: string, aircraftIds: string[], opts: SignOpts = {}): ActionResult<{ contractId: string }> {
  const o = g.offers[offerId];
  if (!o) return { ok: false, error: 'Offer not found' };
  if (o.status !== 'open' && o.status !== 'countered') return { ok: false, error: 'This offer is no longer on the market' };
  if (g.now >= o.expires && o.counter?.result !== 'accepted') return { ok: false, error: 'The offer has expired' };
  let ids = [...new Set(aircraftIds)].filter((id) => g.fleet[id]);
  if (!ids.length) return { ok: false, error: 'Choose an aircraft' };
  if (o.pattern.kind === 'legs') ids = ids.slice(0, 1);
  // v0.8 a dry lease out: no flying of ours but the two ferries (ops/dryLease.ts).
  if (o.product.kind === 'dry') return acceptDry(g, o, ids[0]);
  // v0.12.1 the client met our counter halfway: that price is final and holds for the terms we countered with
  // (paint, cabin, extra crew), so no discount is taken a second time.
  const k = o.counter;
  if (k?.result === 'halfway' && !opts.priced) {
    opts = { ...opts, priced: true, paint: k.paint !== false, cabin: k.cabin, crewExtra: opts.crewExtra ?? k.crewExtra };
  }
  const paint = !!o.paint && opts.paint !== false;
  if (o.paint?.required && !paint && !opts.priced) return { ok: false, error: 'The client requires their livery on the aircraft' };
  // v0.7.4 the client's cabin request (a quick reconfiguration before the start).
  const cabinOn = !!o.cabin && (opts.cabin !== false || o.cabin.required);
  const slots: Record<string, PaintSlot> = {};
  const cabinSlots: Record<string, { label: string; start: Minute; from: string }> = {};
  for (const id of ids) {
    const rep = feasibility(g, offerId, id, { paint, cabin: cabinOn, crewExtra: opts.crewExtra });
    const no = firstNo(rep, !paint);
    if (no) return { ok: false, error: `${g.fleet[id].reg}: ${no.label}` };
    if (cabinOn && rep.cabinSlot) cabinSlots[id] = { ...rep.cabinSlot, from: g.fleet[id].cabin.label };
    if (paint) {
      // Each aircraft's own first departure (base slots are staggered).
      const tr = programmeOf(o, g.fleet[id].typeId, ids.indexOf(id)).trips[0];
      const slot = (tr && paintWindow(g, id, o.paint!, tr.std, undefined, { nextAt: tr.from })) ?? rep.paint;
      if (!slot) return { ok: false, error: `${g.fleet[id].reg}: no paint-shop slot before the job` };
      slots[id] = slot;
    }
  }
  const used = new Set(Object.values(g.contracts).filter((c) => c.status === 'signed' || c.status === 'active').map((c) => c.color));
  let color = 0;
  while (used.has(color) && color < 7) color++;
  if (used.has(color)) color = Object.keys(g.contracts).length % 8;
  const c: Contract = {
    id: nextId(g, 'k'),
    offerId: o.id, archetype: o.archetype, clientId: o.clientId, broker: o.broker, title: o.title,
    product: opts.priced ? structuredClone(o.product) : termsProduct(o, { paint, cabin: cabinOn }), pattern: structuredClone(o.pattern), requirements: structuredClone(o.requirements),
    penalties: structuredClone(o.penalties), payment: { ...o.payment }, effects: { ...o.effects },
    aircraftIds: ids, start: o.start, end: o.end, signed: g.now, status: 'signed',
    generatedUntil: o.pattern.kind === 'base' ? o.pattern.from : o.end,
    use: {}, billedMonths: [], color, balanceAt: null,
    invoiced: 0, accrued: 0, legsFlown: 0, legsOnTime: 0,
  };
  if (o.paint) c.paint = { ...structuredClone(o.paint), accepted: paint, inMx: {}, outMx: {} };
  if (o.cabin) {
    c.cabin = { ...structuredClone(o.cabin), accepted: cabinOn, from: {}, inMx: {}, outMx: {} };
    // The contract flies the client's layout (a later refit may not take it away).
    if (cabinOn) c.requirements.layouts = [o.cabin.layout];
  }
  signHook?.(g, c, o, ids[0]);
  g.contracts[c.id] = c;
  signCrewExtra(g, c, ids[0], opts.crewExtra);
  closeOffer(g, o, 'accepted');
  const prog = programmeOf(c, g.fleet[ids[0]].typeId);
  c.planRevMin = prog.revenueMin;
  if (c.product.kind === 'charter') c.revMinDone = 0;
  // Paint-in first, so the positioning to the job is planned from the paint shop.
  for (const id of Object.keys(slots)) {
    const err = bookPaint(g, c, id, 'in', slots[id]);
    if (err) pushMessage(g, { tone: 'warn', cat: 'tech', title: `Paint not booked: ${g.fleet[id].reg}`, body: `${err}. It flies ${c.title} without the client's livery.`, ref: { kind: 'aircraft', id } });
  }
  // v0.7.4 the client's cabin: a quick reconfiguration in our hangar before the start (flights planned after it).
  for (const id of Object.keys(cabinSlots)) {
    const x = cabinSlots[id];
    const err = bookClientCabin(g, c, id, 'in', x.label, x.start);
    if (err) pushMessage(g, { tone: 'warn', cat: 'tech', title: `Cabin not booked: ${g.fleet[id].reg}`, body: `${err}. Book the ${x.label} reconfiguration from the Fleet screen before ${fmtDay(c.start)}.`, ref: { kind: 'aircraft', id } });
    else c.cabin!.from![id] = x.from;
  }
  generateFlights(g, c);
  // v0.9 the credit controller asks a slow payer for a deposit (ops/heads.ts).
  if (c.product.kind === 'charter' && !c.product.depositPct) {
    const pct = depositHook?.(g, c) ?? 0;
    if (pct > 0) c.product = { ...c.product, depositPct: pct };
  }
  // Charter money: deposit now, balance per trip 7–14 days before it (DESIGN §5.1.9); governments pay after the job.
  const cp = c.product;
  if (cp.kind === 'charter') {
    const net = cp.price * (1 - brokerCut(c));
    const dep = Math.round(net * cp.depositPct);
    if (dep > 0) bill(g, c, `Deposit ${Math.round(cp.depositPct * 100)}%: ${c.title}`, dep);
    if (c.payment.basis !== 'arrears') {
      const rest = net - dep;
      const total = prog.trips.reduce((s, t) => s + tripMin(t), 0) || 1;
      c.instalments = prog.trips.map((t) => ({ at: Math.max(g.now, t.std - cp.balanceDaysBefore * DAY), amount: Math.round((rest * tripMin(t)) / total) }));
      runInstalments(g, c);
    }
  }
  schedule(g, Math.max(g.now, c.start), 'contract.start', c.id);
  schedule(g, Math.max(g.now + 1, c.end), 'contract.end', c.id);
  if (o.terms) c.terms = o.terms.map(([a, b]) => [a, b] as [Minute, Minute]);
  if (o.eventId) c.eventId = o.eventId;
  // v0.8 a presidential job flies a spare pilot on every duty.
  if (c.requirements.extraPilot) c.crewExtra = { cabin: c.crewExtra?.cabin ?? crewExtraFor(g, ids[0], c.id).cabin, pilot: 1 };
  // v0.8 short-notice cover is a favour; a rival hiring us counts on both sides.
  if (o.urgency === 'urgent') bumpClient(g, c.clientId, BAL.v08.rel.urgentSign, `Took ${c.title} at short notice`);
  // v0.9 achievement: signed while a rival was quoting for it.
  if (o.rivalBid) v09Stats(g).firstCall = (v09Stats(g).firstCall ?? 0) + 1;
  if (o.jumbo) v09Stats(g).jumboLoads++;
  if (c.archetype === 'subcharterIn') {
    statsV08(g).subIn++;
    const rv = g.clients[c.clientId]?.rivalId;
    if (rv) noteHiredUs(g, rv, c.title);
  }
  autoRoster(g, { aircraftIds: ids });
  const regs = ids.map((id) => g.fleet[id].reg).join(' + ');
  pushMessage(g, { tone: 'good', cat: 'commercial', title: `Signed: ${c.title}`, body: `${g.clients[c.clientId]?.name ?? 'Client'} · ${regs} · ${fmtDayRange(c.start, c.end)}.`, ref: { kind: 'contract', id: c.id }, cue: 'contractSigned' });
  return { ok: true, msg: `Signed: ${c.title}`, data: { contractId: c.id } };
}

/** v0.8 signs a dry lease out on one aircraft: the contract, the deposit and both ferries (ops/dryLease.ts). */
function acceptDry(g: GameState, o: ContractOffer, aircraftId: string): ActionResult<{ contractId: string }> {
  const no = firstNo(feasibility(g, o.id, aircraftId));
  if (no) return { ok: false, error: `${g.fleet[aircraftId].reg}: ${no.label}` };
  const used = new Set(Object.values(g.contracts).filter((c) => c.status === 'signed' || c.status === 'active').map((c) => c.color));
  let color = 0;
  while (used.has(color) && color < 7) color++;
  const c: Contract = {
    id: nextId(g, 'k'), offerId: o.id, archetype: o.archetype, clientId: o.clientId, title: o.title,
    product: structuredClone(o.product), pattern: { kind: 'legs', legs: [] }, requirements: structuredClone(o.requirements),
    penalties: structuredClone(o.penalties), payment: { ...o.payment }, effects: { ...o.effects },
    aircraftIds: [aircraftId], start: o.start, end: o.end, signed: g.now, status: 'signed', generatedUntil: o.end,
    use: {}, billedMonths: [], color, balanceAt: null, invoiced: 0, accrued: 0, legsFlown: 0, legsOnTime: 0,
  };
  g.contracts[c.id] = c;
  const res = signDryLease(g, c, o);
  if (!res.ok) {
    delete g.contracts[c.id];
    return { ok: false, error: res.error };
  }
  closeOffer(g, o, 'accepted');
  schedule(g, Math.max(g.now, c.start), 'contract.start', c.id);
  const ac = g.fleet[aircraftId];
  pushMessage(g, { tone: 'good', cat: 'commercial', title: `Signed: ${c.title}`, body: `${g.clients[c.clientId]?.name ?? 'Lessee'} · ${ac.reg} · ${fmtDayRange(c.start, c.end)}. Our pilots ferry her out; the deposit is in.`, ref: { kind: 'contract', id: c.id }, cue: 'contractSigned' });
  return { ok: true, msg: `Signed: ${c.title}`, data: { contractId: c.id } };
}

/**
 * v0.6: the contract's extra crew (chosen at signing), and the client's paid option: flying at least n extra cabin
 * crew raises the rate or price by pct and locks the contract at n or more for its life.
 */
function signCrewExtra(g: GameState, c: Contract, aircraftId: string, x: CrewExtra | undefined): void {
  if (x) c.crewExtra = { cabin: clamp(Math.round(x.cabin), 0, BAL.crewExtra.cabinMax), pilot: x.pilot ? 1 : 0 };
  const paid = c.requirements.extraCabinPaid;
  if (!paid) return;
  // Paid crew fly above the client's own required extra.
  const want = c.requirements.extraCabin + paid.n;
  const eff = crewExtraFor(g, aircraftId, c.id);
  // v0.10 the chosen number counts even past the crew seats (paid crew beyond them take passenger seats)
  if (Math.max(eff.cabin, c.crewExtra?.cabin ?? 0) < want) return;
  c.extraPaid = true;
  c.crewExtra = { cabin: Math.max(eff.cabin, want), pilot: eff.pilot ? 1 : 0 };
  const p = c.product;
  setPrice(c, (p.kind === 'wet' ? p.ratePerBH : p.kind === 'charter' ? p.price : p.rentPerMonth) * (1 + paid.pct));
}

const tripMin = (t: { legs: { kind: string; std: number; sta: number }[] }) => t.legs.filter((l) => l.kind !== 'positioning').reduce((s, l) => s + l.sta - l.std, 0);

/** Issues a deferred charter invoice (revenue is recognised as legs fly). */
function bill(g: GameState, c: Contract, desc: string, amount: number): void {
  if (amount <= 0) return;
  const gov = c.payment.basis === 'arrears';
  invoice(g, { clientId: c.clientId, contractId: c.id, desc, amount, cat: 'charterRevenue', dueDays: gov ? c.payment.dueDays : 7, deferred: true });
  c.invoiced = (c.invoiced ?? 0) + Math.round(amount);
}

/** Invoices charter instalments that are due; keeps balanceAt on the next one. */
export function runInstalments(g: GameState, c: Contract): void {
  const list = c.instalments ?? [];
  while (list.length && list[0].at <= g.now) {
    const it = list.shift()!;
    bill(g, c, `Balance: ${c.title}`, it.amount);
  }
  c.instalments = list;
  c.balanceAt = list.length ? list[0].at : null;
}

/** Daily: charter balances that fell due. */
export function dailyContracts(g: GameState): void {
  for (const c of Object.values(g.contracts)) {
    if ((c.status === 'signed' || c.status === 'active') && c.balanceAt !== null && c.balanceAt <= g.now) runInstalments(g, c);
  }
}

/** Proposes a different price (rate per BH or charter price); the client replies before the offer lapses (counter.ts). */
export function counterOffer(g: GameState, offerId: string, price: number, aircraftIds: string[], opts: SignOpts = {}): ActionResult {
  const o = g.offers[offerId];
  if (!o) return { ok: false, error: 'Offer not found' };
  if (o.status !== 'open') return { ok: false, error: o.status === 'countered' ? 'Waiting for the client to answer' : 'This offer is no longer on the market' };
  if (o.counter) return { ok: false, error: 'The client already answered a counter on this one' };
  if (!(price > 0)) return { ok: false, error: 'Enter a price' };
  const ids = aircraftIds.filter((id) => g.fleet[id]);
  if (!ids.length) return { ok: false, error: 'Choose an aircraft' };
  const paint = !!o.paint && opts.paint !== false;
  // v0.12.1 the counter carries the cabin choice and the extra crew, as an accept would (signed with them on reply).
  const cabinOn = !!o.cabin && (opts.cabin !== false || o.cabin.required);
  for (const id of ids) {
    const no = firstNo(feasibility(g, offerId, id, { paint, cabin: cabinOn, crewExtra: opts.crewExtra }), !paint);
    if (no) return { ok: false, error: `${g.fleet[id].reg}: ${no.label}` };
  }
  // v0.5.2: the client always answers before the offer lapses (its expiry clock pauses while the counter is
  // pending) and before the job needs to get going (an hour before the positioning leaves).
  const replyAt = replyTime(g, o, ids, paint, cabinOn);
  o.counter = { price: Math.round(price), at: g.now, replyAt, aircraftIds: ids, left: Math.max(60, o.expires - g.now) };
  if (o.paint) o.counter.paint = paint;
  if (o.cabin) o.counter.cabin = cabinOn;
  if (opts.crewExtra) o.counter.crewExtra = { cabin: opts.crewExtra.cabin, pilot: opts.crewExtra.pilot ? 1 : 0 };
  o.status = 'countered';
  schedule(g, replyAt, 'offer.reply', o.id);
  const hrs = Math.max(1, Math.ceil((replyAt - g.now) / 60));
  return { ok: true, msg: `Counter sent. ${g.clients[o.clientId]?.name ?? 'The client'} will answer within ${hrs > 20 ? 'a day' : `${hrs} h`}; the offer won't lapse meanwhile.` };
}

export function declineOffer(g: GameState, offerId: string): ActionResult {
  const o = g.offers[offerId];
  if (!o) return { ok: false, error: 'Offer not found' };
  if (o.status !== 'open' && o.status !== 'countered') return { ok: false, error: 'This offer is no longer on the market' };
  closeOffer(g, o, 'declined');
  return { ok: true };
}

// ---------- cancellation ----------

function cancelScale(c: Contract, daysBefore: number): number {
  for (const [d, f] of c.penalties.cancelScale) if (daysBefore >= d) return f;
  return 1;
}

/**
 * Penalty if we cancel now: before start value × cancelScale; active wet = 100% of the MGH still to come (v0.12.1
 * Hajj: inside the phases); a charter (v0.12.1, signed or active) = per trip not yet flown, its share × cancelScale
 * by the days to its first departure.
 */
export function cancelPenalty(g: GameState, contractId: string): number {
  const c = g.contracts[contractId];
  if (!c || (c.status !== 'signed' && c.status !== 'active')) return 0;
  const p = c.product;
  // v0.8 a delivered dry lease is recalled (even a day before its start): one month's rent to the lessee.
  const recall = c.dry ? recallTerms(g, c) : null;
  if (recall) return recall.penalty;
  // v0.12.1 a charter series: each rotation not yet flown at the cancel scale for the days to its own first
  // departure (charter series terms), the part of a rotation under way in full.
  if (p.kind === 'charter') {
    const value = g.now < c.start ? p.price : p.price * (1 - brokerCut(c));
    const trips = programmeOf(c, g.fleet[c.aircraftIds[0]]?.typeId ?? 'a320ceo').trips;
    const total = trips.reduce((s, t) => s + tripMin(t), 0) || 1;
    let ahead = 0;
    let pen = 0;
    for (const t of trips) {
      if (t.std <= g.now) continue;
      const share = (value * tripMin(t)) / total;
      ahead += share;
      pen += share * cancelScale(c, (t.std - g.now) / DAY);
    }
    const underWay = Math.max(0, value - (c.accrued ?? 0) - ahead);
    return Math.round(pen + underWay);
  }
  if (g.now < c.start) {
    // v0.12.1 wet: the guaranteed hours over the term (Hajj: the phases only), as billing counts them.
    const value = p.kind === 'wet' ? p.ratePerBH * mghRemaining(c, c.start) : productValue(p, 0, c.start, c.end);
    return Math.round(value * cancelScale(c, (c.start - g.now) / DAY));
  }
  if (p.kind === 'wet') return Math.round(p.ratePerBH * mghRemaining(c, g.now));
  return 0;
}

/** v0.12.1 an open invoice of the charter price (bill(): 'charterRevenue'), not a fuel re-bill or a fee. */
const isCharterInv = (r: Receivable, c: Contract): boolean => r.contractId === c.id && r.paid === null && r.cat === 'charterRevenue';

/** Charter money invoiced and already paid by the client (unpaid = still open receivables). */
function charterPaid(g: GameState, c: Contract): number {
  let open = 0;
  // v0.12.1 only the charter price's own invoices (c.invoiced): a fuel re-bill is a separate debt, not a prepayment.
  for (const r of g.finance.receivables) if (isCharterInv(r, c)) open += r.amount;
  return Math.max(0, (c.invoiced ?? 0) - open);
}

/**
 * Brings a charter's invoicing to `target`: bills a shortfall; an excess voids open invoices first (newest
 * first; charter invoices carry no revenue line) and refunds the rest of what was paid. Returns the cash refunded.
 */
function settleCharter(g: GameState, c: Contract, target: number, desc: string): number {
  const inv = c.invoiced ?? 0;
  if (inv < target) {
    bill(g, c, desc, target - inv);
    return 0;
  }
  let excess = inv - target;
  const open = g.finance.receivables.filter((r) => isCharterInv(r, c));
  for (let i = open.length - 1; i >= 0 && excess > 0; i--) {
    const r = open[i];
    const v = Math.min(excess, r.amount);
    r.amount -= v;
    excess -= v;
  }
  g.finance.receivables = g.finance.receivables.filter((r) => !isCharterInv(r, c) || r.amount > 0);
  if (excess > 0) cashOnly(g, -excess);
  c.invoiced = target;
  return excess;
}

/** What cancelling costs now: the penalty plus refunding what the client prepaid beyond what was flown. Pure. */
export function cancelCost(g: GameState, contractId: string): { penalty: number; refund: number; total: number } {
  const c = g.contracts[contractId];
  const penalty = cancelPenalty(g, contractId);
  const refund = c && c.product.kind === 'charter' ? Math.round(Math.max(0, charterPaid(g, c) - (c.accrued ?? 0))) : c?.dry ? recallTerms(g, c)?.refund ?? 0 : 0;
  return { penalty, refund, total: penalty + refund };
}

/** Cancels a signed/active contract: removes future flights, charges the penalty, reputation and relationship hit. */
export function cancelContract(g: GameState, contractId: string): ActionResult {
  const c = g.contracts[contractId];
  if (!c) return { ok: false, error: 'Contract not found' };
  if (c.status !== 'signed' && c.status !== 'active') return { ok: false, error: 'This contract is already closed' };
  // v0.8 a delivered dry lease can't just stop: we recall her (back in 2 days, ferried home, a month's rent to them).
  if (c.dry && c.dry.leasedAt !== undefined) {
    const res = recallDry(g, c);
    if (!res.ok) return res;
    const ac = g.fleet[c.aircraftIds[0]];
    g.company.reputation.reliable = clamp(g.company.reputation.reliable - 3, 0, 100);
    bumpClient(g, c.clientId, -20, `We recalled ${ac?.reg ?? 'the aircraft'} early`);
    const { penalty, refund } = res.data!;
    pushMessage(g, { tone: 'warn', cat: 'commercial', title: `Recalled: ${c.title}`, body: `${g.clients[c.clientId]?.name ?? 'The lessee'} hands ${ac?.reg ?? 'her'} back in 2 days and our pilots ferry her home. One month's rent ($${penalty.toLocaleString('en-US')}) compensates them${refund ? `, and $${refund.toLocaleString('en-US')} of prepaid rent goes back` : ''}.`, ref: { kind: 'contract', id: c.id }, hurt: { money: penalty + refund, pax: 0, delayMin: 0, level: 'low' } });
    return { ok: true, msg: `Recalled ${c.title}` };
  }
  const penalty = cancelPenalty(g, contractId);
  const future = Object.values(g.flights).filter((f) => f.contractId === c.id && f.status === 'scheduled').map((f) => f.id);
  removeFlights(g, future);
  // v0.5.1: paint-ins not started are called off; finished paint is stripped (dailyPaint), not reimbursed.
  cancelPaintFor(g, c);
  cancelClientCabinFor(g, c);
  c.cancelledAt = g.now;
  if (c.product.kind === 'wet' && g.now > c.start) {
    // Bill what was flown this month (MGH pro-rated to today); the penalty covers the rest of the term.
    const k = monthKey(g.now);
    if (!c.billedMonths.includes(k)) issueBill(g, c, k, billContractMonth(g, c, k));
  }
  let refund = 0;
  if (c.product.kind === 'charter') {
    // Invoices for what was flown stay; unpaid ones for the rest are voided, prepaid money refunded.
    c.instalments = [];
    c.balanceAt = null;
    refund = settleCharter(g, c, Math.round(c.accrued ?? 0), `Flown part: ${c.title}`);
  }
  if (penalty > 0) post(g, 'penalties', -penalty);
  c.status = 'cancelled';
  if (c.dry) cancelDry(g, c);
  const rep = g.company.reputation;
  rep.reliable = clamp(rep.reliable - 5, 0, 100);
  const cl = g.clients[c.clientId];
  bumpClient(g, c.clientId, -30, `We cancelled ${c.title}`);
  for (const id of c.aircraftIds) relinkPositioning(g, id);
  const money = `Penalty $${penalty.toLocaleString('en-US')}${refund ? ` and $${refund.toLocaleString('en-US')} prepaid refunded` : ''}.`;
  pushMessage(g, { tone: 'bad', cat: 'commercial', title: `Cancelled: ${c.title}`, body: `${money} ${cl?.name ?? 'The client'} will remember this.`, ref: { kind: 'contract', id: c.id }, problem: { kind: 'contractCancelled', ref: { kind: 'contract', id: c.id } }, hurt: { money: Math.round(penalty), pax: 0, delayMin: 0, level: penalty >= 10_000 ? 'high' : 'low' } });
  return { ok: true, msg: `Cancelled ${c.title}` };
}

// ---------- progress ----------

export interface ContractProgress {
  legsDone: number;
  legsTotal: number;
  /** This month: billable block hours vs MGH (wet). */
  bhMonth: number;
  mgh: number;
  revenueToDate: number;
  nextFlightId: string | null;
  /** First uncrewed or illegal flight, if any. */
  problemFlightId: string | null;
}

/** Progress summary for cards and the contract panel. Pure. */
export function contractProgress(g: GameState, contractId: string): ContractProgress {
  const c = g.contracts[contractId];
  const out: ContractProgress = { legsDone: 0, legsTotal: 0, bhMonth: 0, mgh: 0, revenueToDate: 0, nextFlightId: null, problemFlightId: null };
  if (!c) return out;
  let next: { id: string; std: Minute } | null = null;
  let problem: { id: string; std: Minute } | null = null;
  const horizon = g.now + BAL.rosterHorizonDays * DAY;
  for (const f of Object.values(g.flights)) {
    if (f.contractId !== c.id || f.status === 'cancelled') continue;
    // Legs flown are counted on the contract (done flights are pruned a week after landing).
    if ((f.kind === 'revenue' || f.kind === 'techstop') && f.status !== 'done') out.legsTotal++;
    if (f.status !== 'scheduled') continue;
    // Tickets keep 'scheduled' until they land: "next" is what has not left yet.
    if (f.std >= g.now && (!next || f.std < next.std)) next = { id: f.id, std: f.std };
    if (f.aircraftId && f.std < horizon && (!problem || f.std < problem.std)) {
      const st = flightCrewStatus(g, f.id).level;
      if (st === 'missing' || st === 'illegal') problem = { id: f.id, std: f.std };
    }
  }
  // Base patterns: rotations not generated yet still count towards the total.
  if (c.pattern.kind === 'base' && c.generatedUntil < c.pattern.to && (c.status === 'signed' || c.status === 'active')) {
    for (const id of c.aircraftIds) {
      const ac = g.fleet[id];
      if (!ac) continue;
      const days = flownRotations(c.pattern, ac.typeId, c.aircraftIds.indexOf(id));
      for (let k = Math.max(0, baseDayOf(c.pattern, c.generatedUntil)); k < days.length; k++) out.legsTotal += days[k].length * 2;
    }
  }
  const k = monthKey(g.now);
  out.bhMonth = Math.round(((c.use[k]?.blockMin ?? 0) / 60) * 10) / 10;
  if (c.product.kind === 'wet') {
    out.mgh = Math.round(mghFor(c, k) * 10) / 10;
    const unbilled = c.billedMonths.includes(k) ? 0 : c.product.ratePerBH * out.bhMonth;
    out.revenueToDate = Math.round((c.invoiced ?? 0) + unbilled);
  } else out.revenueToDate = Math.round(c.accrued ?? 0);
  out.legsDone = c.legsFlown ?? 0;
  out.legsTotal += out.legsDone;
  out.nextFlightId = next?.id ?? null;
  out.problemFlightId = problem?.id ?? null;
  return out;
}

// ---------- lifecycle ----------

/** 'contract.start': status → active, message, optional pause. */
export function onContractStart(g: GameState, ev: SimEvent): void {
  const c = g.contracts[ev.id];
  if (!c || c.status !== 'signed') return;
  c.status = 'active';
  const where = c.pattern.kind === 'base' ? ` at ${AIRPORT_BY_CODE[c.pattern.base]?.city ?? c.pattern.base}` : '';
  pushMessage(g, { tone: 'info', cat: 'commercial', title: `Started: ${c.title}`, body: `${g.clients[c.clientId]?.name ?? 'Client'}${where}.`, ref: { kind: 'contract', id: c.id } });
  requestPause('contractStart');
}

/** 'contract.end': waits for the last leg (delayed positioning out), then completes: final bills, effects, stats. */
export function onContractEnd(g: GameState, ev: SimEvent): void {
  const c = g.contracts[ev.id];
  if (!c || (c.status !== 'signed' && c.status !== 'active') || c.dry) return;
  // v0.12.1 the job's own legs only: revenue and tech stops, and the empty legs that are its way out (leaving
  // within two days of the last revenue leg: a night stop or a delay on the way home). Crew deadheads and later positioning never hold the contract open.
  const live = Object.values(g.flights).filter((f) => f.contractId === c.id && (f.status === 'scheduled' || f.status === 'enroute') && f.kind !== 'deadhead');
  const endOf = (f: Flight) => (f.status === 'enroute' ? (f.eta ?? f.sta) : f.sta + f.delay);
  const rev = live.filter((f) => f.kind === 'revenue' || f.kind === 'techstop');
  const lastRev = Math.max(0, ...rev.map(endOf), ...Object.values(g.flights).filter((f) => f.contractId === c.id && f.status === 'done' && (f.kind === 'revenue' || f.kind === 'techstop')).map((f) => f.ata ?? f.sta));
  let last = 0;
  for (const f of live) {
    if (f.kind !== 'revenue' && f.kind !== 'techstop' && f.std + f.delay > (lastRev || c.end) + 2 * DAY) continue;
    last = Math.max(last, endOf(f));
  }
  if (last) {
    // Next look just after the last leg's on-blocks; a leg held past its time is looked at hourly, not every 5 min.
    schedule(g, Math.max(g.now + 60, last + 5), 'contract.end', c.id);
    return;
  }
  completeContract(g, c);
}

/** v0.12.1 a leg cancelled by the client or by force majeure (a closure, a court, no war-risk cover), not by us. */
const notOursCancel = (why = ''): boolean => /^(Cancelled: |Closed: |Court injunction|No war-risk cover)|cancelled$/.test(why);

function completeContract(g: GameState, c: Contract): void {
  c.status = 'completed';
  // v0.6: service quality settles into the client relation; a job well done thanks its crews.
  onContractDoneMorale(g, c);
  if (c.product.kind === 'wet') {
    const months = new Set<number>(Object.keys(c.use).map(Number));
    for (let k = monthKey(c.start); monthStart(k) < c.end; k++) months.add(k);
    for (const k of [...months].sort((a, b) => a - b)) if (!c.billedMonths.includes(k)) issueBill(g, c, k, billContractMonth(g, c, k));
  } else if (c.product.kind === 'charter') {
    // Revenue is earned by the legs flown or sub-chartered; cancelled legs earn nothing (their unflown share of
    // any deposit is voided or refunded). Old saves without revMinDone count everything as flown.
    const net = Math.round(c.product.price * (1 - brokerCut(c)));
    const all = c.revMinDone === undefined || c.revMinDone >= (c.planRevMin ?? 0) * 0.99;
    if (all) {
      const rem = net - Math.round(c.accrued ?? 0);
      if (rem > 0) accrue(g, 'charterRevenue', rem);
      c.accrued = net;
      if (c.instalments?.length) {
        for (const it of c.instalments) it.at = g.now;
        runInstalments(g, c);
      }
    } else {
      c.instalments = [];
      c.balanceAt = null;
    }
    settleCharter(g, c, Math.round(c.accrued ?? 0), c.payment.basis === 'arrears' ? `Invoice: ${c.title}` : `Final balance: ${c.title}`);
  }
  // v0.12.1 the legs that did not fly count: ours (recovery, AOG, no crew) against the on-time score; the client's
  // own or force majeure (a closure, a court) not. Flights are pruned a week after their day, so older
  // cancellations are no longer seen here. legsFlown includes legs a rival flew for us.
  const flown = c.legsFlown ?? 0;
  let sub = 0;
  let cxUs = 0;
  let cxFm = 0;
  for (const f of Object.values(g.flights)) {
    if (f.contractId !== c.id || (f.kind !== 'revenue' && f.kind !== 'techstop')) continue;
    if (f.status === 'cancelled') {
      if (notOursCancel(f.delayReason)) cxFm++;
      else cxUs++;
    } else if (f.operatedBy) sub++;
  }
  const onTime = flown + cxUs ? (c.legsOnTime ?? 0) / (flown + cxUs) : 1;
  const rep = g.company.reputation;
  const e = c.effects;
  const cl = g.clients[c.clientId];
  // Nothing flew (every leg cancelled): no completion credit, no job counted, no repeat business.
  const flewAny = flown > 0;
  if (flewAny) {
    if (e.reliable && (c.archetype !== 'seasonBase' || onTime >= 0.85)) rep.reliable = clamp(rep.reliable + e.reliable, 0, 100);
    if (e.clean) rep.clean = clamp(rep.clean + e.clean, 0, 100);
    // v0.8 completion moves the relation (§1.3) and counts a job; repeat business may follow.
    const R = BAL.v08.rel;
    const d = c.archetype === 'aogCover' ? R.doneAog : onTime >= 0.85 ? R.done : R.doneBad;
    bumpClient(g, c.clientId, d, d > 0 ? `Completed ${c.title}, ${Math.round(onTime * 100)} % on time` : `${c.title}: only ${Math.round(onTime * 100)} % on time`);
    noteJobDone(g, c.clientId);
    // Deportation: the press noticed (clean −2 a flight with returnees, capped −10 a contract; billed as flown).
    g.stats.contractsDone++;
    const v = v09Stats(g);
    if (c.archetype === 'hajj') v.hajjDone = (v.hajjDone ?? 0) + 1;
    if (c.archetype === 'evacuation' || c.archetype === 'repatriation') v.homeSafe = (v.homeSafe ?? 0) + 1;
    rollRepeat(g, c.id);
  }
  const own = flown - sub;
  const parts = [`${own} ${own === 1 ? 'leg' : 'legs'} flown${own ? `, ${Math.round(onTime * 100)}% on time` : ''}`];
  if (sub) parts.push(`${sub} sub-chartered`);
  if (cxUs + cxFm) parts.push(`${cxUs + cxFm} cancelled`);
  pushMessage(g, {
    tone: flewAny ? 'good' : 'info', cat: 'commercial', title: flewAny ? `Completed: ${c.title}` : `Closed without flying: ${c.title}`,
    body: `${parts.join(', ')}. ${cl?.name ?? 'The client'} ${!flewAny ? 'has closed the contract' : onTime >= 0.85 ? 'is pleased' : 'noticed the delays'}.`,
    ref: { kind: 'contract', id: c.id },
  });
  completeHook?.(g, c);
}

/** Days until start (UI helper). */
export function leadDays(g: GameState, start: Minute): number {
  return Math.floor((start - g.now) / 1440);
}
