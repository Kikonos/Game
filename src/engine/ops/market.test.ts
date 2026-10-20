// Aircraft market and lease lifecycle (B3). DESIGN.md §5.10.

import { describe, expect, it } from 'vitest';
import { typeOf } from '../core/perf';
import { DAY, monthKey, monthStart } from '../core/time';
import type { GameState, SimEvent } from '../core/types';
import { leased, newGame } from '../contracts/testkit';
import { advanceTo } from '../sim';
import { acquireAircraft, onDelivery, onLeaseEnd, refreshMarket } from './market';

const REAL_LESSORS = ['AerCap', 'Avolon', 'SMBC Aviation Capital', 'BOC Aviation', 'Carlyle Aviation Partners', 'Air Lease Corporation', 'Aviation Capital Group'];
const ev = (g: GameState, type: SimEvent['type'], id: string): SimEvent => ({ t: g.now, seq: 0, type, id, v: 0 });

/** Runs the monthly refreshes (as the 'month' handler does) up to month index `last`; returns offers seen per month. */
function months(seed: number, last: number) {
  const g = newGame(seed);
  const k0 = monthKey(g.started);
  const seen: { month: number; typeId: string; kind: string }[] = g.market.aircraft.map((o) => ({ month: 0, typeId: o.typeId, kind: o.kind }));
  for (let m = 1; m <= last; m++) {
    g.now = monthStart(k0 + m);
    refreshMarket(g);
    for (const o of g.market.aircraft) seen.push({ month: m, typeId: o.typeId, kind: o.kind });
  }
  return { g, seen };
}

describe('refreshMarket', () => {
  it('guarantees a narrowbody dry lease by month 2 and an old 767/A330 lease by month 6, over 50 seeds', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { g, seen } = months(seed, 5);
      const narrow = seen.find((s) => s.month <= 1 && s.kind === 'dryLeaseIn' && (s.typeId === 'a320ceo' || s.typeId === 'b738'));
      const wide = seen.find((s) => s.month >= 3 && s.month <= 5 && s.kind === 'dryLeaseIn' && (s.typeId === 'b763' || s.typeId === 'a332'));
      expect(narrow, `seed ${seed} narrowbody`).toBeTruthy();
      expect(wide, `seed ${seed} widebody`).toBeTruthy();
      expect(g.market.gotNarrow && g.market.gotWide).toBe(true);
    }
  });

  it('offers tier ≤ 2 types only at the start, from real lessors, with DESIGN lease terms; at most 6 open', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { g } = months(seed, 11);
      for (const o of g.market.aircraft) {
        expect(typeOf(o.typeId).tier).toBeLessThanOrEqual(2);
        expect(REAL_LESSORS.some((l) => o.lessor.startsWith(l))).toBe(true);
        expect(o.leadDays).toBeGreaterThanOrEqual(30);
        expect(o.leadDays).toBeLessThanOrEqual(90);
        if (o.kind === 'dryLeaseIn') {
          expect(o.deposit).toBe(2 * o.rentPerMonth);
          expect(o.leaseMonths).toBeGreaterThanOrEqual(36);
          expect(o.leaseMonths).toBeLessThanOrEqual(96);
        } else {
          expect(typeOf(o.typeId).body === 'narrow' || ['b763', 'a332', 'a343', 'b752'].includes(o.typeId)).toBe(true);
          expect(o.deposit).toBe(o.price);
        }
      }
      expect(g.market.aircraft.length).toBeLessThanOrEqual(6);
    }
  });

  it('drops expired offers and keeps fuel and demand indices in range', () => {
    const { g } = months(3, 24);
    expect(g.market.aircraft.every((o) => o.expires > g.now)).toBe(true);
    expect(g.market.fuelPrice).toBeGreaterThanOrEqual(550);
    expect(g.market.fuelPrice).toBeLessThanOrEqual(1050);
    for (const i of [g.market.narrowIndex, g.market.wideIndex]) expect(i).toBeGreaterThanOrEqual(0.8);
  });

  it('is deterministic per seed', () => {
    expect(months(9, 6).seen).toEqual(months(9, 6).seen);
  });
});

describe('acquireAircraft and delivery', () => {
  it('signs: deposit paid, aircraft delivering, then available at home base on delivery', () => {
    const { g } = months(4, 1);
    g.company.cash = 50_000_000;
    const o = g.market.aircraft.find((x) => x.kind === 'dryLeaseIn')!;
    expect(o).toBeTruthy();
    const cash = g.company.cash;
    const r = acquireAircraft(g, o.id);
    if (!r.ok) throw new Error(r.error);
    const ac = g.fleet[r.data!.aircraftId];
    expect(ac.status).toBe('delivering');
    expect(ac.typeId).toBe(o.typeId);
    expect(g.company.cash).toBe(cash - o.deposit);
    expect(g.market.aircraft.some((x) => x.id === o.id)).toBe(false);
    expect(ac.deliveredAt).toBe(g.now + o.leadDays * DAY);
    expect(g.queue.some((e) => e.type === 'aircraft.delivery' && e.id === ac.id && e.t === ac.deliveredAt)).toBe(true);
    if (ac.ownership.kind === 'dryLeaseIn') expect(g.queue.some((e) => e.type === 'lease.end' && e.id === ac.id)).toBe(true);
    advanceTo(g, ac.deliveredAt + 60, new Set());
    expect(ac.status).toBe('available');
    expect(ac.at).toBe(g.company.homeBase);
    expect(g.messages.some((m) => m.title === `${ac.reg} delivered`)).toBe(true);
    // A second delivery event is ignored.
    onDelivery(g, ev(g, 'aircraft.delivery', ac.id));
    expect(ac.status).toBe('available');
  });

  it('refuses unknown or expired offers and short cash', () => {
    const { g } = months(4, 1);
    const o = g.market.aircraft[0];
    expect(acquireAircraft(g, 'nope').ok).toBe(false);
    g.company.cash = o.deposit - 1;
    const r = acquireAircraft(g, o.id);
    expect(r.ok ? '' : r.error).toMatch(/Not enough cash/);
    g.company.cash = 1e9;
    g.now = o.expires;
    expect(acquireAircraft(g, o.id).ok).toBe(false);
  });
});

describe('onLeaseEnd', () => {
  it('extends month by month at +10% while the aircraft is busy', () => {
    const g = newGame(5);
    const ac = leased(g);
    if (ac.ownership.kind !== 'dryLeaseIn') throw new Error('no lease');
    ac.ownership.leaseEnd = g.now;
    ac.status = 'flying';
    const rent = ac.ownership.rentPerMonth;
    onLeaseEnd(g, ev(g, 'lease.end', ac.id));
    expect(g.fleet[ac.id]).toBe(ac);
    expect(ac.ownership.rentPerMonth).toBe(Math.round(rent * 1.1));
    expect(ac.ownership.leaseEnd).toBeGreaterThan(g.now + 29 * DAY);
    expect(g.queue.some((e) => e.type === 'lease.end' && e.id === ac.id && e.t === (ac.ownership.kind === 'dryLeaseIn' ? ac.ownership.leaseEnd : 0))).toBe(true);
    expect(g.messages[0].title).toBe(`Lease extended: ${ac.reg}`);
  });

  it('returns the aircraft at base when free and refunds the deposit', () => {
    const g = newGame(5);
    const ac = leased(g);
    if (ac.ownership.kind !== 'dryLeaseIn') throw new Error('no lease');
    ac.ownership.leaseEnd = g.now;
    ac.ownership.deposit = 456_000;
    ac.status = 'available';
    ac.at = g.company.homeBase;
    const cash = g.company.cash;
    onLeaseEnd(g, ev(g, 'lease.end', ac.id));
    expect(g.fleet[ac.id]).toBeUndefined();
    expect(g.company.cash).toBe(cash + 456_000);
    expect(g.messages[0].title).toBe(`${ac.reg} returned`);
  });

  it('ignores a stale event before the lease end', () => {
    const g = newGame(5);
    const ac = leased(g);
    onLeaseEnd(g, ev(g, 'lease.end', ac.id));
    expect(g.fleet[ac.id]).toBe(ac);
  });
});
