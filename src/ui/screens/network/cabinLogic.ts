// v0.23.1 the cabin comparison's rows (pure; CabinChange.tsx draws them).

import type { CabinQuote, CabinSide } from '../../../engine/network/cabin';
import { int, money, moneyDelta } from '../../format';

export type Per = 'flight' | 'week' | 'month';

/** A year's money in the period chosen. Pure. */
export function perPeriod(v: number, side: Pick<CabinSide, 'flights'>, per: Per): number {
  if (per === 'flight') return v / Math.max(1, side.flights);
  return per === 'week' ? v / 52 : v / 12;
}

/** The rows of the comparison: label, now, after, the change (formatted). Pure. */
export function cabinRows(q: Pick<CabinQuote, 'from' | 'to'>, per: Per): { k: string; a: string; b: string; d: string; tone?: 'good' | 'bad'; total?: boolean }[] {
  const { from: a, to: b } = q;
  const signed = (n: number, f: (x: number) => string) => (Math.round(n) === 0 ? '—' : `${n > 0 ? '+' : '−'}${f(Math.abs(n))}`);
  const pp = (x: number) => `${Math.round(x * 100)} %`;
  const m = (v: number, s: CabinSide) => perPeriod(v, s, per);
  const rows: ReturnType<typeof cabinRows> = [
    { k: 'Seats a flight', a: `${int(a.seats)}${a.seatsJ ? ` (${a.seatsJ} J)` : ''}`, b: `${int(b.seats)}${b.seatsJ ? ` (${b.seatsJ} J)` : ''}`, d: signed(b.seats - a.seats, (x) => int(x)) },
    { k: 'Passengers a flight', a: `${int(Math.round(a.pax))}${a.paxJ >= 0.5 ? ` (${int(Math.round(a.paxJ))} J)` : ''}`, b: `${int(Math.round(b.pax))}${b.paxJ >= 0.5 ? ` (${int(Math.round(b.paxJ))} J)` : ''}`, d: signed(Math.round(b.pax) - Math.round(a.pax), (x) => int(x)) },
    { k: 'Load factor', a: pp(a.lf), b: pp(b.lf), d: signed(Math.round(b.lf * 100) - Math.round(a.lf * 100), (x) => `${int(x)} pts`) },
    { k: 'Ticket revenue a passenger', a: money(a.yieldPax), b: money(b.yieldPax), d: signed(b.yieldPax - a.yieldPax, money) },
    { k: 'Revenue', a: money(m(a.rev, a)), b: money(m(b.rev, b)), d: signed(m(b.rev, b) - m(a.rev, a), money) },
  ];
  if (a.downgrades || b.downgrades) rows.push({ k: 'Of the costs: downgrades on the day', a: a.downgrades ? money(m(a.downgrades, a)) : '—', b: b.downgrades ? money(m(b.downgrades, b)) : '—', d: signed(m(b.downgrades, b) - m(a.downgrades, a), money) });
  rows.push({ k: 'Costs', a: money(m(a.cost, a)), b: money(m(b.cost, b)), d: signed(m(b.cost, b) - m(a.cost, a), money) });
  const ra = m(a.result, a);
  const rb = m(b.result, b);
  rows.push({ k: 'Profit / loss', a: moneyDelta(Math.round(ra)), b: moneyDelta(Math.round(rb)), d: signed(rb - ra, money), tone: rb - ra >= 0 ? 'good' : 'bad', total: true });
  return rows;
}

