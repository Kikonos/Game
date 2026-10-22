// v0.8 dry lease out (UPDATE-0.8.md §6): the client leases the aircraft only. Our pilots ferry it to the lessee's
// base and deadhead home; the lessee flies it in its own colours with its crews and does the line and A-checks;
// rent is invoiced monthly in advance and reserves monthly in arrears on the hours flown (leaseIncome); at the end
// our pilots fetch it, a return inspection follows (damage risk), the deposit comes back. Views are pure.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { DAY, fmtDay, fmtMonth, monthKey } from '../core/time';
import type { Contract, GameState, Minute } from '../core/types';
import { usd } from './util';

export interface DryLeaseView {
  contractId: string; aircraftId: string; lessee: string; site: string; phase: 'signed' | 'delivering' | 'leased' | 'returning' | 'done';
  out: [Minute, Minute]; lease: [Minute, Minute]; back: [Minute, Minute]; rent: number; reservesPerFH: number; fhSoFar: number; fhExpected: number;
  income: number; deposit: number; late: number; damage: string | null; cCheck: string;
}

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;
const MONTH = 30.44 * DAY;

/** Span of a list of flights [first std, last sta] (fallback when none). */
function spanOf(g: GameState, ids: string[], fallback: [Minute, Minute]): [Minute, Minute] {
  const fs = ids.map((id) => g.flights[id]).filter((f) => !!f);
  if (!fs.length) return fallback;
  return [Math.min(...fs.map((f) => f.std)), Math.max(...fs.map((f) => f.sta))];
}

/** The C-check line: when it falls due against the lease (projected with the lessee's hours). Pure. */
export function cCheckLine(g: GameState, c: Contract): string {
  const ac = g.fleet[c.aircraftIds[0]];
  if (!ac || !c.dry) return '';
  const wide = typeOf(ac.typeId).body === 'wide';
  const fhLimit = BAL.cCheckFH[wide ? 'wide' : 'narrow'];
  const left = fhLimit - ac.maint.fhSinceC;
  const months = left / Math.max(1, c.dry.fhPerMonth);
  const byFh = c.start + months * MONTH;
  const byCal = ac.maint.lastC + 2 * 365 * DAY;
  const due = Math.min(byFh, byCal);
  const end = c.dry.leaseEnd ?? c.end;
  return due > end + 30 * DAY ? `C-check due ${fmtMonth(monthKey(due))}, after the return` : `C-check due ${fmtMonth(monthKey(due))}, during the lease: book it before`;
}

/** One dry lease for the offer/contract sheets, the fleet card and the schedule. Pure. */
export function dryLeaseView(g: GameState, contractId: string): DryLeaseView | null {
  const c = g.contracts[contractId];
  if (!c || !c.dry || c.product.kind !== 'dry') return null;
  const d = c.dry;
  const leaseEnd = (d.leaseEnd ?? c.end) + (d.late ?? 0) * DAY;
  const out = spanOf(g, d.outIds, [c.start - DAY, c.start]);
  const back = spanOf(g, d.backIds, [leaseEnd + DAY, leaseEnd + 2 * DAY]);
  const phase: DryLeaseView['phase'] = c.status === 'completed' || c.status === 'cancelled' ? 'done'
    : d.returnedAt !== undefined ? 'returning'
    : d.leasedAt !== undefined ? (g.now >= leaseEnd ? 'returning' : 'leased')
    : g.now >= out[0] ? 'delivering' : 'signed';
  const wide = typeOf(g.fleet[c.aircraftIds[0]]?.typeId ?? 'a320ceo').body === 'wide';
  const months = Math.max(0, (leaseEnd - c.start) / MONTH);
  let income = 0;
  for (const r of g.finance.receivables) if (r.contractId === c.id && r.cat === 'leaseIncome') income += r.amount;
  income = Math.max(income, Math.round(c.invoiced ?? 0));
  return {
    contractId: c.id, aircraftId: c.aircraftIds[0], lessee: g.clients[c.clientId]?.name ?? 'Lessee', site: d.site, phase,
    out, lease: [d.leasedAt ?? c.start, leaseEnd], back, rent: c.product.rentPerMonth, reservesPerFH: c.product.reservesPerFH,
    fhSoFar: Math.round(d.fh), fhExpected: Math.round(d.fhPerMonth * months || BAL.v08.dry.fh[wide ? 'wide' : 'narrow'] * months),
    income, deposit: d.deposit, late: d.late ?? 0,
    damage: d.damage ? `${d.damage.what ?? 'Damage'}: ${d.damage.days} days, ${usd(d.damage.cost)} (${Math.round(BAL.v08.dry.lesseeShare * 100)} % theirs)` : null,
    cCheck: cCheckLine(g, c),
  };
}

/** The live dry lease of an aircraft (signed, delivering, leased or returning). Pure. */
export function dryLeaseOf(g: GameState, aircraftId: string): DryLeaseView | null {
  for (const c of Object.values(g.contracts)) {
    if (!c.dry || !c.aircraftIds.includes(aircraftId) || (c.status !== 'signed' && c.status !== 'active')) continue;
    return dryLeaseView(g, c.id);
  }
  return null;
}

/** 'Leased to TAAG until 14 Mar' (fleet card / map panel). Pure. */
export function leasedText(g: GameState, aircraftId: string): string | null {
  const v = dryLeaseOf(g, aircraftId);
  if (!v || (v.phase !== 'leased' && v.phase !== 'returning')) return null;
  return `Leased to ${v.lessee} until ${fmtDay(v.lease[1])} · ${v.fhSoFar.toLocaleString('en-US')} FH flown by them at ${city(v.site)}`;
}
