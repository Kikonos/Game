// v0.7.2 selling owned aircraft (UPDATE-0.7.2.md §6.1): the market value, blockers, the close and cancelling.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { leased, newGame, owned, run } from '../contracts/testkit';
import { cancelSale, saleQuote, sellAircraft } from './sale';
import { acquireAircraft, devMarketOffer } from './market';

const line = (g: GameState, cat: 'assetSale') => [g.finance.current, ...g.finance.history].reduce((s, st) => s + (st.lines[cat] ?? 0), 0);

describe('selling an owned aircraft', () => {
  it('the value falls with age, hours, cycles and C-check life used; broker 2%; leased aircraft cannot be sold', () => {
    const g = newGame(3);
    const ac = owned(g);
    const base = saleQuote(g, ac.id);
    expect(base.ok).toBe(true);
    expect(base.lines.map((l) => l.label)).toEqual([`Market value ${ac.builtYear} A320`, expect.stringMatching(/hours and cycles$/), 'C-check life used', 'Quick sale 6%', 'Broker 2%']);
    expect(base.price).toBeGreaterThan(0);
    const p = (f: () => void) => {
      const was = structuredClone(ac);
      f();
      const v = saleQuote(g, ac.id).price;
      Object.assign(ac, was);
      return v;
    };
    expect(p(() => (ac.builtYear -= 5))).toBeLessThan(base.price);
    expect(p(() => (ac.hours *= 1.5))).toBeLessThan(base.price);
    expect(p(() => (ac.cycles *= 1.5))).toBeLessThan(base.price);
    expect(p(() => (ac.maint.lastC -= 300 * DAY))).toBeLessThan(base.price);
    expect(saleQuote(g, leased(g).id).ok).toBe(false);
    expect(base.closes - g.now).toBeGreaterThanOrEqual(10 * DAY);
    expect(base.closes - g.now).toBeLessThanOrEqual(21 * DAY);
    expect(saleQuote(g, ac.id)).toEqual(base);
  });

  it('signed work after the handover blocks the sale and is named', () => {
    const g = newGame(3);
    const ac = owned(g);
    const t = g.now + 30 * DAY;
    addFlight(g, { no: 'AW5', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'FAO', std: t, sta: t + 60 });
    const q = saleQuote(g, ac.id);
    expect(q.ok).toBe(false);
    expect(q.blockers[0]).toMatch(/^Other flights: 1 leg after/);
    expect(sellAircraft(g, ac.id).ok).toBe(false);
  });

  it('closes: cash moves by the price, assetSale shows price − book value, the aircraft leaves; cancelling is free', () => {
    const g = newGame(4);
    const ac = owned(g);
    const q = saleQuote(g, ac.id);
    const r = sellAircraft(g, ac.id, q.price);
    if (!r.ok) throw new Error(r.error);
    expect(ac.sale).toMatchObject({ buyer: q.buyer, price: q.price, closes: q.closes });
    expect(sellAircraft(g, ac.id).ok).toBe(false);
    const cash = g.company.cash;
    const sale0 = line(g, 'assetSale');
    run(g, q.closes - 60);
    const before = g.company.cash;
    run(g, q.closes + 60);
    expect(g.fleet[ac.id]).toBeUndefined();
    expect(line(g, 'assetSale') - sale0).toBe(q.price - q.bookValue);
    expect(g.stats.sales).toBe(1);
    expect(g.company.cash - before).toBeGreaterThanOrEqual(q.price - 200_000);
    expect(cash).toBeGreaterThan(0);
    // A second game: agree, then call it off.
    const h = newGame(4);
    const b = owned(h);
    expect(sellAircraft(h, b.id).ok).toBe(true);
    expect(cancelSale(h, b.id).ok).toBe(true);
    expect(b.sale).toBeUndefined();
    run(h, h.now + 25 * DAY);
    expect(h.fleet[b.id]).toBeDefined();
  });

  it('buying and selling straight back loses money at an unchanged index (200 offers)', () => {
    const g = newGame(3);
    g.company.cash = 1e12;
    const free: number[] = [];
    for (let i = 0; i < 200; i++) {
      const id = devMarketOffer(g, i % 2 ? 'a321ceo' : 'a320ceo', { kind: 'buy' });
      const o = g.market.aircraft.find((x) => x.id === id)!;
      const r = acquireAircraft(g, id);
      if (!r.ok) throw new Error(r.error);
      const ac = g.fleet[r.data!.aircraftId];
      ac.status = 'available';
      ac.at = g.company.homeBase;
      const q = saleQuote(g, ac.id);
      expect(q.ok, q.why ?? '').toBe(true);
      expect(q.price / o.price).toBeLessThan(1);
      // Without the first-year cap the spread alone still loses money on average.
      if (ac.ownership.kind === 'owned') delete ac.ownership.boughtAt;
      free.push(saleQuote(g, ac.id).price / o.price);
    }
    const mean = free.reduce((a, b) => a + b, 0) / free.length;
    expect(mean).toBeLessThan(0.95);
    expect(mean).toBeGreaterThan(0.75);
  });

  it('a booked C-check is its own blocker (not "Other flights"): cancel it or sell after it', () => {
    const g = newGame(3);
    const ac = owned(g);
    const t = g.now + 40 * DAY;
    g.maintenance.mx = { id: 'mx', aircraftId: ac.id, kind: 'C', at: 'SOF', start: t, end: t + 14 * DAY, status: 'planned', cost: 500_000, hub: { code: 'SOF', name: 'Lufthansa Technik Sofia', price: 0.85 } } as never;
    addFlight(g, { no: 'AW6', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'SOF', to: 'LIS', std: t + 15 * DAY, sta: t + 15 * DAY + 240 }).purpose = 'check';
    const q = saleQuote(g, ac.id);
    expect(q.ok).toBe(false);
    expect(q.blockers).toHaveLength(1);
    expect(q.blockers[0]).toMatch(/^C-check at Lufthansa Technik Sofia .+: cancel it or sell after /);
    expect(q.booking).toMatchObject({ maintId: 'mx', kind: 'C' });
  });

  it('away from home: a ferry home (purpose sale) is booked before the handover', () => {
    const g = newGame(5);
    const ac = owned(g);
    ac.at = 'MAD';
    const r = sellAircraft(g, ac.id);
    if (!r.ok) throw new Error(r.error);
    expect(ac.sale!.ferryIds!.length).toBeGreaterThan(0);
    expect(g.flights[ac.sale!.ferryIds![0]]).toMatchObject({ kind: 'ferry', purpose: 'sale', from: 'MAD' });
  });
});
