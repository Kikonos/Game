// Usage counting and invoicing (B1). DESIGN.md §5.1.10. The contracts 'month' handler bills the closing month.

import { BAL } from '../core/balance';
import { accrue, invoice } from '../core/ledger';
import { DAY, fmtMonth, monthKey, monthStart } from '../core/time';
import type { Contract, Flight, GameState, LedgerCat, MonthKey, SimEvent } from '../core/types';
import { mghInMonth } from './pricing';

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
    c.legsFlown = (c.legsFlown ?? 0) + 1;
    if ((f.atd ?? f.std) - f.std <= 15) c.legsOnTime = (c.legsOnTime ?? 0) + 1;
    g.stats.blockMin += block;
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

const fmtUSD = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

/**
 * Invoice lines for a wet contract-month (DESIGN §5.1.10): MGH per aircraft pro-rated to the active days;
 * rate × MGH when flown ≤ MGH, plus excess hours at excessRate; short-cycle fees; minus the broker commission.
 * Months outside the term (positioning before the start or after the end) bill flown hours at the full rate.
 * Marks the month billed. Charter money is invoiced by the lifecycle instead.
 */
export function billContractMonth(_g: GameState, c: Contract, month: MonthKey): BillingLine[] {
  if (c.product.kind !== 'wet' || c.billedMonths.includes(month)) return [];
  const p = c.product;
  const line = (desc: string, amount: number): BillingLine => ({ contractId: c.id, clientId: c.clientId, desc, amount: Math.round(amount), cat: 'acmiRevenue' });
  const u = c.use[month] ?? { blockMin: 0, cycles: 0, shortCycles: 0 };
  const flown = u.blockMin / 60;
  const end = Math.min(c.end, c.cancelledAt ?? Infinity);
  const full = mghInMonth(p.mghPerMonth, c.start, end, month) * c.aircraftIds.length;
  // Hours we failed to fly (our cancellations) are not guaranteed to us.
  const lost = (u.lostMin ?? 0) / 60;
  const mgh = full > 0.05 ? Math.max(Math.min(flown, full), full - lost) : full;
  const lines: BillingLine[] = [];
  if (full > 0.05) {
    const less = lost > 0.05 && mgh < full ? `, less ${lost.toFixed(1)} BH we cancelled` : '';
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
  }
}
