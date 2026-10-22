// v0.7.2 selling owned aircraft (UPDATE-0.7.2.md §6.1): the market value, blockers, the close and cancelling.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { leased, newGame, owned, run } from '../contracts/testkit';
import { cancelSale, saleQuote, sellAircraft } from './sale';

const line = (g: GameState, cat: 'assetSale') => [g.finance.current, ...g.finance.history].reduce((s, st) => s + (st.lines[cat] ?? 0), 0);

describe('selling an owned aircraft', () => {
  it('the value falls with age, hours, cycles and C-check life used; broker 2%; leased aircraft cannot be sold', () => {
    const g = newGame(3);
    const ac = owned(g);
    const base = saleQuote(g, ac.id);
    expect(base.ok).toBe(true);
    expect(base.lines.map((l) => l.label)).toEqual([`Market value ${ac.builtYear} A320`, expect.stringMatching(/hours and cycles$/), '−C-check life used', 'Broker 2%']);
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
