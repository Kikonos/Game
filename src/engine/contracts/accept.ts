// Player actions on offers and contracts, and the contract lifecycle (B1). DESIGN.md §5.1.9.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { nextId, removeFlights } from '../core/entities';
import { accrue, cashOnly, invoice, post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { requestPause } from '../core/pause';
import { schedule } from '../core/queue';
import { int } from '../core/rng';
import { DAY, fmtDay, monthKey, monthStart } from '../core/time';
import { clamp } from '../core/util';
import type { ActionResult, Contract, ContractOffer, GameState, Minute, OfferStatus, Product, SimEvent } from '../core/types';
import { autoRoster, flightCrewStatus } from '../crew';
import { billContractMonth, issueBill } from './billing';
import { feasibility } from './feasibility';
import { baseDayOf, flownRotations, programmeOf } from './plan';
import { mghInMonth, productValue } from './pricing';
import { generateFlights, relinkPositioning } from './schedule';

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

const firstNo = (rep: ReturnType<typeof feasibility>) => rep.checks.find((c) => c.level === 'no');

/**
 * Signs the offer on the chosen aircraft: creates the Contract, generates flights (schedule.ts),
 * books the charter deposit, queues contract.start/end, asks crew to roster (crew.autoRoster).
 */
export function acceptOffer(g: GameState, offerId: string, aircraftIds: string[]): ActionResult<{ contractId: string }> {
  const o = g.offers[offerId];
  if (!o) return { ok: false, error: 'Offer not found' };
  if (o.status !== 'open' && o.status !== 'countered') return { ok: false, error: 'This offer is no longer on the market' };
  if (g.now >= o.expires && o.counter?.result !== 'accepted') return { ok: false, error: 'The offer has expired' };
  let ids = [...new Set(aircraftIds)].filter((id) => g.fleet[id]);
  if (!ids.length) return { ok: false, error: 'Choose an aircraft' };
  if (o.pattern.kind === 'legs') ids = ids.slice(0, 1);
  for (const id of ids) {
    const rep = feasibility(g, offerId, id);
    const no = firstNo(rep);
    if (no) return { ok: false, error: `${g.fleet[id].reg}: ${no.label}` };
  }
  const used = new Set(Object.values(g.contracts).filter((c) => c.status === 'signed' || c.status === 'active').map((c) => c.color));
  let color = 0;
  while (used.has(color) && color < 7) color++;
  if (used.has(color)) color = Object.keys(g.contracts).length % 8;
  const c: Contract = {
    id: nextId(g, 'k'),
    offerId: o.id, archetype: o.archetype, clientId: o.clientId, broker: o.broker, title: o.title,
    product: structuredClone(o.product), pattern: structuredClone(o.pattern), requirements: structuredClone(o.requirements),
    penalties: structuredClone(o.penalties), payment: { ...o.payment }, effects: { ...o.effects },
    aircraftIds: ids, start: o.start, end: o.end, signed: g.now, status: 'signed',
    generatedUntil: o.pattern.kind === 'base' ? o.pattern.from : o.end,
    use: {}, billedMonths: [], color, balanceAt: null,
    invoiced: 0, accrued: 0, legsFlown: 0, legsOnTime: 0,
  };
  g.contracts[c.id] = c;
  closeOffer(g, o, 'accepted');
  const prog = programmeOf(c, g.fleet[ids[0]].typeId);
  c.planRevMin = prog.revenueMin;
  generateFlights(g, c);
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
  autoRoster(g, { aircraftIds: ids });
  const regs = ids.map((id) => g.fleet[id].reg).join(' + ');
  pushMessage(g, { tone: 'good', cat: 'commercial', title: `Signed: ${c.title}`, body: `${g.clients[c.clientId]?.name ?? 'Client'} · ${regs} · ${fmtDay(c.start)}–${fmtDay(c.end)}.`, ref: { kind: 'contract', id: c.id } });
  return { ok: true, msg: `Signed: ${c.title}`, data: { contractId: c.id } };
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

/** Proposes a different price (rate per BH or charter price); the client replies after BAL.counterReplyHours. */
export function counterOffer(g: GameState, offerId: string, price: number, aircraftIds: string[]): ActionResult {
  const o = g.offers[offerId];
  if (!o) return { ok: false, error: 'Offer not found' };
  if (o.status !== 'open') return { ok: false, error: o.status === 'countered' ? 'Waiting for the client to answer' : 'This offer is no longer on the market' };
  if (o.counter) return { ok: false, error: 'The client already answered a counter on this one' };
  if (!(price > 0)) return { ok: false, error: 'Enter a price' };
  const ids = aircraftIds.filter((id) => g.fleet[id]);
  if (!ids.length) return { ok: false, error: 'Choose an aircraft' };
  for (const id of ids) {
    const no = firstNo(feasibility(g, offerId, id));
    if (no) return { ok: false, error: `${g.fleet[id].reg}: ${no.label}` };
  }
  const replyAt = g.now + int(g, BAL.counterReplyHours[0], BAL.counterReplyHours[1]) * 60;
  o.counter = { price: Math.round(price), at: g.now, replyAt, aircraftIds: ids };
  o.status = 'countered';
  schedule(g, replyAt, 'offer.reply', o.id);
  return { ok: true, msg: `Counter sent. ${g.clients[o.clientId]?.name ?? 'The client'} will answer within ${BAL.counterReplyHours[1]} h.` };
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

/** Penalty if we cancel now: before start value × cancelScale; active wet = 100% of unflown MGH; active charter = unflown share. */
export function cancelPenalty(g: GameState, contractId: string): number {
  const c = g.contracts[contractId];
  if (!c || (c.status !== 'signed' && c.status !== 'active')) return 0;
  const n = c.aircraftIds.length;
  const p = c.product;
  if (g.now < c.start) {
    const value = p.kind === 'wet' ? productValue(p, 0, c.start, c.end) * n : p.kind === 'charter' ? p.price : productValue(p, 0, c.start, c.end);
    return Math.round(value * cancelScale(c, (c.start - g.now) / DAY));
  }
  if (p.kind === 'wet') {
    let mgh = 0;
    for (let k = monthKey(g.now); monthStart(k) < c.end; k++) mgh += mghInMonth(p.mghPerMonth, g.now, c.end, k);
    return Math.round(p.ratePerBH * mgh * n);
  }
  if (p.kind === 'charter') return Math.round(Math.max(0, p.price * (1 - brokerCut(c)) - (c.accrued ?? 0)));
  return 0;
}

/** Cancels a signed/active contract: removes future flights, charges the penalty, reputation and relationship hit. */
export function cancelContract(g: GameState, contractId: string): ActionResult {
  const c = g.contracts[contractId];
  if (!c) return { ok: false, error: 'Contract not found' };
  if (c.status !== 'signed' && c.status !== 'active') return { ok: false, error: 'This contract is already closed' };
  const penalty = cancelPenalty(g, contractId);
  const future = Object.values(g.flights).filter((f) => f.contractId === c.id && f.status === 'scheduled').map((f) => f.id);
  removeFlights(g, future);
  c.cancelledAt = g.now;
  if (c.product.kind === 'wet' && g.now > c.start) {
    // Bill what was flown this month (MGH pro-rated to today); the penalty covers the rest of the term.
    const k = monthKey(g.now);
    if (!c.billedMonths.includes(k)) issueBill(g, c, k, billContractMonth(g, c, k));
  }
  if (c.product.kind === 'charter') {
    const refund = (c.invoiced ?? 0) - (c.accrued ?? 0);
    if (c.payment.basis === 'arrears' && (c.accrued ?? 0) > (c.invoiced ?? 0)) bill(g, c, `Flown part: ${c.title}`, (c.accrued ?? 0) - (c.invoiced ?? 0));
    else if (refund > 0) cashOnly(g, -refund);
    c.instalments = [];
    c.balanceAt = null;
  }
  if (penalty > 0) post(g, 'penalties', -penalty);
  c.status = 'cancelled';
  const rep = g.company.reputation;
  rep.reliable = clamp(rep.reliable - 5, 0, 100);
  const cl = g.clients[c.clientId];
  if (cl) cl.relation = clamp(cl.relation - 30, -100, 100);
  for (const id of c.aircraftIds) relinkPositioning(g, id);
  pushMessage(g, { tone: 'bad', cat: 'commercial', title: `Cancelled: ${c.title}`, body: `Penalty $${penalty.toLocaleString('en-US')}. ${cl?.name ?? 'The client'} will remember this.`, ref: { kind: 'contract', id: c.id } });
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
    if (f.kind === 'revenue' || f.kind === 'techstop') {
      out.legsTotal++;
      if (f.status === 'done') out.legsDone++;
    }
    if (f.status !== 'scheduled') continue;
    if (!next || f.std < next.std) next = { id: f.id, std: f.std };
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
    out.mgh = Math.round(mghInMonth(c.product.mghPerMonth, c.start, Math.min(c.end, c.cancelledAt ?? Infinity), k) * c.aircraftIds.length * 10) / 10;
    const unbilled = c.billedMonths.includes(k) ? 0 : c.product.ratePerBH * out.bhMonth;
    out.revenueToDate = Math.round((c.invoiced ?? 0) + unbilled);
  } else out.revenueToDate = Math.round(c.accrued ?? 0);
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
  if (!c || (c.status !== 'signed' && c.status !== 'active')) return;
  let last = 0;
  for (const f of Object.values(g.flights)) {
    if (f.contractId !== c.id || (f.status !== 'scheduled' && f.status !== 'enroute')) continue;
    last = Math.max(last, f.status === 'enroute' ? (f.eta ?? f.sta) : f.sta + f.delay);
  }
  if (last) {
    // Next look just after the last leg's on-blocks; a leg held past its time is looked at hourly, not every 5 min.
    schedule(g, Math.max(g.now + 60, last + 5), 'contract.end', c.id);
    return;
  }
  completeContract(g, c);
}

function completeContract(g: GameState, c: Contract): void {
  c.status = 'completed';
  if (c.product.kind === 'wet') {
    const months = new Set<number>(Object.keys(c.use).map(Number));
    for (let k = monthKey(c.start); monthStart(k) < c.end; k++) months.add(k);
    for (const k of [...months].sort((a, b) => a - b)) if (!c.billedMonths.includes(k)) issueBill(g, c, k, billContractMonth(g, c, k));
  } else if (c.product.kind === 'charter') {
    const net = Math.round(c.product.price * (1 - brokerCut(c)));
    const rem = net - Math.round(c.accrued ?? 0);
    if (rem > 0) accrue(g, 'charterRevenue', rem);
    c.accrued = net;
    if (c.instalments?.length) {
      for (const it of c.instalments) it.at = g.now;
      runInstalments(g, c);
    }
    if ((c.invoiced ?? 0) < net) bill(g, c, c.payment.basis === 'arrears' ? `Invoice: ${c.title}` : `Final balance: ${c.title}`, net - (c.invoiced ?? 0));
  }
  const flown = c.legsFlown ?? 0;
  const onTime = flown ? (c.legsOnTime ?? 0) / flown : 1;
  const rep = g.company.reputation;
  const e = c.effects;
  if (e.reliable && (c.archetype !== 'seasonBase' || onTime >= 0.85)) rep.reliable = clamp(rep.reliable + e.reliable, 0, 100);
  if (e.clean) rep.clean = clamp(rep.clean + e.clean, 0, 100);
  const cl = g.clients[c.clientId];
  if (cl) cl.relation = clamp(cl.relation + (c.archetype === 'aogCover' ? 10 : onTime >= 0.85 ? 5 : -5), -100, 100);
  g.stats.contractsDone++;
  // Legs a rival flew for us or that were cancelled (still in the flight table), so "0 legs flown" reads right.
  let sub = 0;
  let cx = 0;
  for (const f of Object.values(g.flights)) {
    if (f.contractId !== c.id || f.kind !== 'revenue') continue;
    if (f.status === 'cancelled') cx++;
    else if (f.operatedBy) sub++;
  }
  const parts = [`${flown} ${flown === 1 ? 'leg' : 'legs'} flown${flown ? `, ${Math.round(onTime * 100)}% on time` : ''}`];
  if (sub) parts.push(`${sub} sub-chartered`);
  if (cx) parts.push(`${cx} cancelled`);
  pushMessage(g, {
    tone: flown ? 'good' : 'info', cat: 'commercial', title: `Completed: ${c.title}`,
    body: `${parts.join(', ')}. ${cl?.name ?? 'The client'} ${!flown ? 'has closed the contract' : onTime >= 0.85 ? 'is pleased' : 'noticed the delays'}.`,
    ref: { kind: 'contract', id: c.id },
  });
}

/** Days until start (UI helper). */
export function leadDays(g: GameState, start: Minute): number {
  return Math.floor((start - g.now) / 1440);
}
