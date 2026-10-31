// Crew costs (B2): per diems and hotels daily while away, salaries at month end. DESIGN.md §5.4.

import { BAL } from '../core/balance';
import { post } from '../core/ledger';
import { monthKey, monthStart } from '../core/time';
import type { CrewMember, GameState, Minute, Pairing } from '../core/types';
import { salariesLate } from './morale';
import { crewIx } from './timeline';

/** The pairing a crew member is on (or just finished) now. */
function currentPairing(g: GameState, c: CrewMember): Pairing | undefined {
  let best: Pairing | undefined;
  for (const p of crewIx(g).pairingsOf.get(c.id) ?? []) if (p.start <= g.now && (!best || p.start > best.start)) best = p;
  return best;
}

/** Per diem (BAL rate × perDiemPct) per crew member away, and hotel nights at outstations (client pays on wet leases). */
export function dailyCrewCosts(g: GameState): void {
  const pct = g.company.policies.perDiemPct / 100;
  const night = BAL.hotelPerNight[g.company.policies.hotelTier] ?? BAL.hotelPerNight[4];
  let perDiem = 0;
  let hotels = 0;
  for (const c of Object.values(g.crew)) {
    if (c.awaySince === null) continue;
    perDiem += (BAL.perDiem[c.role] ?? 54) * pct;
    if (c.loc === c.base || c.status === 'onDuty') continue;
    const p = currentPairing(g, c);
    const k = p?.contractId ? g.contracts[p.contractId] : undefined;
    if (k?.product.kind !== 'wet') hotels += night;
  }
  post(g, 'perDiem', -Math.round(perDiem));
  post(g, 'hotels', -Math.round(hotels));
}

/**
 * v0.12.1 the share of the month [a, b) a crew member is on the payroll: from the day they joined (payFrom), so a joiner
 * on the 30th is paid a day, not the month (April paid a whole $11,750 for crew who joined at its end). Pure.
 */
export function paidShare(c: CrewMember, a: Minute, b: Minute): number {
  const from = Math.max(a, c.payFrom ?? a);
  return b > a ? Math.max(0, Math.min(1, (b - from) / (b - a))) : 0;
}

/** Month end: salaries × (1 + BAL.onCosts) under 'salaries' (crew still joining are not paid yet; v0.12.1 joiners pro rata). */
export function monthlySalaries(g: GameState): void {
  let total = 0;
  // (The month handler runs on the new month's first minute: the month paid is the one just ended.)
  const a = monthStart(monthKey(g.now - 1));
  for (const c of Object.values(g.crew)) if (c.status !== 'joining') total += c.salary * paidShare(c, a, g.now);
  post(g, 'salaries', -Math.round(total * (1 + BAL.onCosts)));
  for (const c of Object.values(g.crew)) c.discretion = 0;
  // v0.6: paid out of a negative balance, salaries are late.
  if (total > 0 && g.company.cash < 0) salariesLate(g);
}

/**
 * v0.12.1 a crew member leaving the company is paid the part of the month they worked (with on-costs) before their record
 * goes (they were paid nothing for it: the month-end run no longer finds them).
 */
export function payLeaver(g: GameState, c: CrewMember): void {
  if (c.status === 'joining') return;
  const a = monthStart(monthKey(g.now));
  const b = monthStart(monthKey(g.now) + 1);
  const worked = Math.max(0, g.now - Math.max(a, c.payFrom ?? a)) / (b - a);
  const pay = Math.round(c.salary * worked * (1 + BAL.onCosts));
  if (pay > 0) post(g, 'salaries', -pay);
}

/** Monthly salary bill including on-costs (for forecasts). */
export function salaryBill(g: GameState): number {
  let total = 0;
  for (const c of Object.values(g.crew)) if (c.status !== 'joining') total += c.salary;
  return Math.round(total * (1 + BAL.onCosts));
}
