// v0.23.1 the cabin comparison's rows (report bmwdnxjlp5jo6): a flight, a week, a month; the change column.

import { describe, expect, it } from 'vitest';
import type { CabinSide } from '../../../engine/network/cabin';
import { cabinRows, perPeriod } from './cabinLogic';

const side = (x: Partial<CabinSide>): CabinSide => ({
  cabin: 'two-class', seats: 200, seatsJ: 16, pax: 175.3, paxJ: 9.7, lf: 0.88, yieldPax: 259, rev: 5_653_000, cost: 4_927_000, result: 726_000, downgrades: 411_000, flights: 104, rotations: 52, ...x,
});

describe('v0.23.1 the cabin comparison', () => {
  it('money a flight, a week and a month from the year', () => {
    const s = side({});
    expect(perPeriod(5_200, s, 'week')).toBe(100);
    expect(perPeriod(1_200, s, 'month')).toBe(100);
    expect(perPeriod(10_400, s, 'flight')).toBe(100);
  });

  it('rows: seats, passengers, load, yield, revenue, the downgrades, costs and the result with its change', () => {
    const a = side({});
    const b = side({ cabin: 'all-economy', seats: 235, seatsJ: 0, pax: 176.1, paxJ: 0, lf: 0.75, yieldPax: 232, rev: 5_131_000, cost: 4_435_000, result: 696_000, downgrades: 0 });
    const rows = cabinRows({ from: a, to: b }, 'month');
    expect(rows.map((r) => r.k)).toEqual(['Seats a flight', 'Passengers a flight', 'Load factor', 'Ticket revenue a passenger', 'Revenue', 'Of the costs: downgrades on the day', 'Costs', 'Profit / loss']);
    expect(rows[0]).toMatchObject({ a: '200 (16 J)', b: '235', d: '+35' });
    expect(rows[2]).toMatchObject({ a: '88 %', b: '75 %', d: '−13 pts' });
    const last = rows.at(-1)!;
    expect(last.total).toBe(true);
    expect(last.tone).toBe('bad');
    // Without downgrades on either side the row is left out.
    expect(cabinRows({ from: side({ downgrades: 0 }), to: b }, 'week').some((r) => r.k.includes('downgrades'))).toBe(false);
  });

  it('final debug round: the refunds paid now are a row of their own and the first year counts them', () => {
    const a = side({ downgrades: 0, result: 2_376_000 });
    const b = side({ cabin: 'all-economy', seatsJ: 0, paxJ: 0, downgrades: 0, result: 2_489_000 });
    const rows = cabinRows({ from: a, to: b, refund: 580_000 }, 'month');
    expect(rows.find((r) => r.k === 'Profit / loss')).toMatchObject({ d: '+$9.4K', total: false });
    expect(rows.find((r) => r.k === 'Refunds now (once)')).toMatchObject({ b: '−$580K', tone: 'bad' });
    expect(rows.at(-1)).toMatchObject({ k: 'First 12 months, with the refunds', d: '−$467K', tone: 'bad', total: true });
    expect(cabinRows({ from: a, to: b, refund: 0 }, 'month').some((r) => r.k.startsWith('Refunds'))).toBe(false);
  });
});
