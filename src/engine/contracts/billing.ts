// Usage counting and invoicing (B1). DESIGN.md §5.1.10. The contracts 'month' handler bills the closing month.

import { BAL } from '../core/balance';
import { accrue, invoice } from '../core/ledger';
import { DAY, fmtMonth, monthKey, monthStart } from '../core/time';
import type { Contract, Flight, GameState, LedgerCat, Minute, MonthKey, SimEvent } from '../core/types';
import { mghInMonth, mghTotal } from './pricing';
import { bumpClient } from './relations';
import { excusedLate, onTimeLeg } from '../ops/latePolicy';

export interface BillingLine {
  contractId: string;
  clientId: string;
  desc: string;
  amount: number;
  cat: LedgerCat;
}

/** Short-cycle protection applies to sectors under this many block minutes. */
export const SHORT_CYCLE_MIN = 90;

/**
 * 'flight.arr' (after ops marked it done): wet contracts count billable block time and cycles in use[month of
 * arrival] (revenue, tech-stop and sub-chartered legs; positioning when billable); charters recognise revenue per
 * revenue leg flown. On-time stats for completion effects.
 */
export function onFlightArrivedContracts(g: GameState, ev: SimEvent): void {
  const f = g.flights[ev.id];
  if (!f || f.ev !== ev.v || f.status !== 'done' || f.ata !== g.now || !f.contractId || f.kind === 'deadhead') return;
  const c = g.contracts[f.contractId];
  if (!c) return;
  const rev = f.kind === 'revenue' || f.kind === 'techstop';
  const block = Math.max(0, (f.ata ?? g.now) - (f.atd ?? f.std));
  if (c.product.kind === 'wet') {
    if (rev || (f.kind === 'positioning' && c.product.positioningBillable)) {
      const k = monthKey(g.now);
      const u = (c.use[k] ??= { blockMin: 0, cycles: 0, shortCycles: 0 });
      u.blockMin += block;
      u.cycles++;
      if (block < SHORT_CYCLE_MIN) u.shortCycles++;
    }
  } else if (c.product.kind === 'charter' && rev && c.status !== 'cancelled') {
    const net = c.product.price * (1 - (c.broker ? BAL.brokerCommission : 0));
    const share = Math.round((net * f.block) / Math.max(1, c.planRevMin ?? f.block));
    const amount = Math.min(share, Math.round(net - (c.accrued ?? 0)));
    if (c.revMinDone !== undefined) c.revMinDone += f.block;
    if (amount > 0) {
      accrue(g, 'charterRevenue', amount);
      c.accrued = (c.accrued ?? 0) + amount;
    }
  }
  if (rev) {
    // v0.12.1 against the original schedule (ops retimes keep schedStd; a client's move re-bases it).
    // v0.12.1 (review) a delay the client forgave (Trusted / Partner, up to 3 h) counts as on time for them.
    const onTime = onTimeLeg(f) || (!!f.forgiven && excusedLate(f) <= 15);
    c.legsFlown = (c.legsFlown ?? 0) + 1;
    if (onTime) c.legsOnTime = (c.legsOnTime ?? 0) + 1;
    g.stats.blockMin += block;
    // v0.8 the month's on-time share (wet: the relation at month close).
    const u = (c.use[monthKey(g.now)] ??= { blockMin: 0, cycles: 0, shortCycles: 0 });
    u.legs = (u.legs ?? 0) + 1;
    // The client's month judges only our lateness (world waits and its own slots are excused).
    if (excusedLate(f) <= 15) u.onTime = (u.onTime ?? 0) + 1;
    // v0.8 deportation: the press notices every flight with returnees (clean −2, capped −10 a contract).
    if (c.archetype === 'deportation' && (f.pax ?? 0) > 0) {
      const D = BAL.v08.deport;
      const hit = Math.max(D.cleanCap - (c.cleanHit ?? 0), D.cleanPerLeg);
      if (hit < 0) {
        c.cleanHit = (c.cleanHit ?? 0) + hit;
        const rep = g.company.reputation;
        rep.clean = Math.max(0, Math.round((rep.clean + hit) * 100) / 100);
      }
    }
  }
}

/**
 * v0.8 a charter leg the client still pays although it did not fly (a court injunction): its share of the price is
 * earned as if flown. Wet legs keep the month's guarantee anyway.
 */
export function creditCancelledLeg(g: GameState, f: Flight): void {
  const c = f.contractId ? g.contracts[f.contractId] : undefined;
  if (!c || c.product.kind !== 'charter' || c.status === 'cancelled') return;
  const net = c.product.price * (1 - (c.broker ? BAL.brokerCommission : 0));
  const amount = Math.min(Math.round((net * f.block) / Math.max(1, c.planRevMin ?? f.block)), Math.round(net - (c.accrued ?? 0)));
  if (c.revMinDone !== undefined) c.revMinDone += f.block;
  if (amount > 0) {
    accrue(g, 'charterRevenue', amount);
    c.accrued = (c.accrued ?? 0) + amount;
  }
}

/** Revenue legs we cancelled (not agreed drops): wet contracts lose those hours from the month's MGH. */
export function noteLostLegs(g: GameState, legs: Flight[]): void {
  for (const f of legs) {
    const c = f.contractId ? g.contracts[f.contractId] : undefined;
    if (!c || c.product.kind !== 'wet' || (f.kind !== 'revenue' && f.kind !== 'techstop')) continue;
    const u = (c.use[monthKey(f.std)] ??= { blockMin: 0, cycles: 0, shortCycles: 0 });
    u.lostMin = (u.lostMin ?? 0) + f.block;
  }
}

/**
 * Guaranteed hours of a wet contract-month, all aircraft: MGH pro-rated to the active days (Hajj: inside `terms`).
 * v0.12.1 `upTo` caps the term at that minute (what is earned so far this month).
 */
export function mghFor(c: Contract, month: MonthKey, upTo?: Minute): number {
  if (c.product.kind !== 'wet') return 0;
  const m = c.product.mghPerMonth;
  const end = Math.min(c.end, c.cancelledAt ?? Infinity, upTo ?? Infinity);
  // v0.8 terms (Hajj phases): MGH only inside them.
  const one = c.terms?.length
    ? c.terms.reduce((s, [a, b]) => s + (Math.min(b, end) > a ? mghInMonth(m, a, Math.min(b, end), month) : 0), 0)
    : end > c.start ? mghInMonth(m, c.start, end, month) : 0;
  return one * c.aircraftIds.length;
}

/**
 * v0.12.1 guaranteed hours still to come from `from` to the end, all aircraft (Hajj: inside the phases only, so the
 * gap between them counts nothing). The cancellation penalty and the cash forecast use it. Pure.
 */
export function mghRemaining(c: Contract, from: Minute): number {
  if (c.product.kind !== 'wet') return 0;
  const m = c.product.mghPerMonth;
  const end = Math.min(c.end, c.cancelledAt ?? Infinity);
  const spans = c.terms?.length ? c.terms : [[c.start, end] as [Minute, Minute]];
  let s = 0;
  for (const [a0, b0] of spans) {
    const a = Math.max(a0, from), b = Math.min(b0, end);
    if (b > a) s += mghTotal(m, a, b);
  }
  return s * c.aircraftIds.length;
}

const fmtUSD = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

/**
 * Invoice lines for a wet contract-month (DESIGN §5.1.10): MGH per aircraft pro-rated to the active days;
 * rate × MGH when flown ≤ MGH, plus excess hours at excessRate; short-cycle fees; minus the broker commission.
 * Months outside the term (positioning before the start or after the end) bill flown hours at the full rate.
 * v0.12.1 pure (billContractMonth marks the month billed); `asOf` gives what is earned so far in an open month
 * (Finance 'earned', the profit pill), with the MGH counted up to that minute.
 */
export function wetMonthLines(c: Contract, month: MonthKey, asOf?: Minute): BillingLine[] {
  if (c.product.kind !== 'wet') return [];
  const p = c.product;
  const line = (desc: string, amount: number): BillingLine => ({ contractId: c.id, clientId: c.clientId, desc, amount: Math.round(amount), cat: 'acmiRevenue' });
  const u = c.use[month] ?? { blockMin: 0, cycles: 0, shortCycles: 0 };
  const flown = u.blockMin / 60;
  const full = mghFor(c, month, asOf);
  // Hours we failed to fly (our cancellations) are not guaranteed to us; v0.12.1 nor hours a world event stopped
  // (force majeure frees both sides). Never below what was flown.
  const lost = (u.lostMin ?? 0) / 60;
  const lostFm = (u.lostFmMin ?? 0) / 60;
  const mgh = full > 0.05 ? Math.max(Math.min(flown, full), full - lost - lostFm) : full;
  const lines: BillingLine[] = [];
  if (full > 0.05) {
    const ours = Math.min(lost, full - mgh), fm = Math.min(lostFm, full - mgh - ours);
    const less = (ours > 0.05 ? `, less ${ours.toFixed(1)} BH we cancelled` : '') + (fm > 0.05 ? `, less ${fm.toFixed(1)} BH cancelled by force majeure` : '');
    lines.push(line(flown < mgh ? `MGH ${mgh.toFixed(1)} BH (flown ${flown.toFixed(1)}${less}) × ${fmtUSD(p.ratePerBH)}` : `${mgh.toFixed(1)} BH × ${fmtUSD(p.ratePerBH)}`, p.ratePerBH * mgh));
    if (flown > mgh) lines.push(line(`Excess ${(flown - mgh).toFixed(1)} BH × ${Math.round(p.excessRate * 100)}%`, (flown - mgh) * p.excessRate * p.ratePerBH));
  } else if (flown > 0) {
    lines.push(line(`${flown.toFixed(1)} BH × ${fmtUSD(p.ratePerBH)}`, flown * p.ratePerBH));
  }
  if (u.shortCycles && p.cycleFee) lines.push(line(`Short-cycle fee ${u.shortCycles} × ${fmtUSD(p.cycleFee)}`, u.shortCycles * p.cycleFee));
  if (c.broker && lines.length) {
    const gross = lines.reduce((s, l) => s + l.amount, 0);
    lines.push(line(`${c.broker} commission ${Math.round(BAL.brokerCommission * 100)}%`, -gross * BAL.brokerCommission));
  }
  return lines;
}

/** The month's invoice lines (wetMonthLines), and marks the month billed. Charter money is invoiced by the lifecycle. */
export function billContractMonth(_g: GameState, c: Contract, month: MonthKey): BillingLine[] {
  if (c.product.kind !== 'wet' || c.billedMonths.includes(month)) return [];
  const lines = wetMonthLines(c, month);
  c.billedMonths.push(month);
  return lines;
}

/** Issues one invoice for a contract-month's lines (acmiRevenue, due per the payment terms). */
export function issueBill(g: GameState, c: Contract, month: MonthKey, lines: BillingLine[]): number {
  const total = Math.round(lines.reduce((s, l) => s + l.amount, 0));
  if (total <= 0) return 0;
  invoice(g, { clientId: c.clientId, contractId: c.id, desc: `${c.title}: ${fmtMonth(month)}`, amount: total, cat: 'acmiRevenue', dueDays: c.payment.dueDays });
  c.invoiced = (c.invoiced ?? 0) + total;
  return total;
}

/** 'month' (crew → contracts → ops): invoice every wet contract that used or overlapped the closing month. */
export function onMonthContracts(g: GameState, ev: SimEvent): void {
  const month = monthKey(ev.t - 1);
  const ms = monthStart(month);
  const me = monthStart(month + 1);
  for (const c of Object.values(g.contracts)) {
    if (c.product.kind !== 'wet' || (c.status !== 'signed' && c.status !== 'active') || c.billedMonths.includes(month)) continue;
    const overlaps = c.start < me && c.end > ms;
    if (!overlaps && !c.use[month]) continue;
    if (!overlaps && c.start >= me + 40 * DAY) continue;
    issueBill(g, c, month, billContractMonth(g, c, month));
    monthRelation(g, c, month);
  }
}

/** v0.8 (§1.3) a wet month flown: ≥ 90 % of legs on time +4, ≥ 75 % +1, below −2. */
export function monthRelation(g: GameState, c: Contract, month: MonthKey): void {
  const u = c.use[month];
  if (!u?.legs) return;
  const share = (u.onTime ?? 0) / u.legs;
  const R = BAL.v08.rel.wetMonth;
  const d = share >= 0.9 ? R[0] : share >= 0.75 ? R[1] : R[2];
  bumpClient(g, c.clientId, d, `${fmtMonth(month)}: ${Math.round(share * 100)} % of ${u.legs} legs on time`);
}
