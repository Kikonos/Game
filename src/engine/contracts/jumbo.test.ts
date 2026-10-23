// v0.9 §Y.2 747-400 economics (UPDATE-0.9.md): jumbo loads (420–480 passengers) price on a 400-seat type, charters
// carry fuel at cost billed at the actual burn; a 747 makes money on them and stays a poor choice on 300-seat work.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { devAddType, devJumbo } from '../dev';
import { fixtureGame } from '../crew/fixtures';
import { advanceTo } from '../sim';
import { acceptOffer, feasibility, generateOffer } from '.';
import { devHajj } from './missions';
import { forceJumbo, fmtPrice } from './offers';
import { isJumboType, isWideJob, referenceType } from './pricing';

/** Margin after the aircraft's own fixed costs over the job (rent, insurance, its overhead share). */
const margin = (g: GameState, offerId: string, acId: string) => {
  const r = feasibility(g, offerId, acId);
  const o = g.offers[offerId];
  const ac = g.fleet[acId];
  const months = (o.end - o.start) / (30 * DAY);
  const fixed = ((ac.ownership.kind === 'dryLeaseIn' ? ac.ownership.rentPerMonth : 0) + typeOf(ac.typeId).insuranceMonth + BAL.overheadPerAircraft) * months;
  return (r.estMargin - fixed) / Math.max(1, r.estRevenue);
};

describe('§Y.2 jumbo loads', () => {
  it('a jumbo load: 420–480 seats in any cabin, priced on a 400-seat type of about $10–11K a block hour', () => {
    const g = fixtureGame(101);
    const id = devJumbo(g);
    expect(id).not.toBe('');
    const o = g.offers[id];
    expect(o.jumbo).toBe(true);
    expect(o.requirements.minSeats).toBeGreaterThanOrEqual(420);
    expect(o.requirements.minSeats).toBeLessThanOrEqual(480);
    // v0.9 fix: any cabin with the seats, never more passengers than our 747 seats as configured.
    expect(o.requirements.layouts).toBeUndefined();
    const ours = Object.values(g.fleet).filter((a) => isJumboType(a.typeId));
    if (ours.length) expect(o.requirements.minSeats).toBeLessThanOrEqual(Math.max(...ours.map((a) => a.cabin.total)));
    const ref = referenceType(o.requirements, o.pattern.kind === 'legs' ? o.pattern.legs.map((l) => [l.from, l.to] as [string, string]) : []);
    expect(ref && isJumboType(ref)).toBe(true);
    if (o.product.kind === 'charter') {
      expect(o.product.fuelAtCost).toBe(true);
      expect(fmtPrice(o.product)).toMatch(/plus fuel at cost$/);
    }
  });

  it('a 747-400 on a jumbo Hajj makes at least +15 % after its fixed costs, far more than on a 300-seat A330 season base', () => {
    const g = fixtureGame(102);
    const acId = devAddType(g, 'b744');
    g.company.approvals.push('etops120', 'etops180');
    forceJumbo(true);
    let hajj = '';
    try {
      for (let i = 0; i < 10 && !hajj; i++) { const id = devHajj(g); if (id && g.offers[id].jumbo) hajj = id; }
    } finally {
      forceJumbo(false);
    }
    expect(hajj).not.toBe('');
    expect(margin(g, hajj, acId)).toBeGreaterThanOrEqual(0.15);
    let base = '';
    for (let i = 0; i < 40 && !base; i++) {
      const o = generateOffer(g, 'seasonBase', { wide: true });
      if (o && o.requirements.minSeats <= 300) base = o.id;
    }
    expect(base).not.toBe('');
    // Our contribution model leaves crew salaries out: the gap, not the level, is what the 747's economics show.
    expect(margin(g, hajj, acId) - margin(g, base, acId)).toBeGreaterThanOrEqual(0.2);
  });

  it('a 747-400 on a 450-seat Hajj still makes +10 % after the salaries of its crew sets (v0.9 fix)', async () => {
    const { complement } = await import('../core/perf');
    const { salaryFor } = await import('../crew/generate');
    const g = fixtureGame(102);
    const acId = devAddType(g, 'b744');
    g.company.approvals.push('etops120', 'etops180');
    forceJumbo(true);
    let hajj = '';
    try {
      for (let i = 0; i < 10 && !hajj; i++) { const id = devHajj(g); if (id && g.offers[id].jumbo) hajj = id; }
    } finally {
      forceJumbo(false);
    }
    expect(hajj).not.toBe('');
    const o = g.offers[hajj];
    const ac = g.fleet[acId];
    const months = (o.end - o.start) / (30 * DAY);
    // Five sets of the 747's complement on their full monthly salaries for the length of the job.
    const crewMonth = BAL.crewSetsPerAircraft * complement(ac.typeId, ac.cabin.total).reduce((n, r) => n + salaryFor(r, typeOf(ac.typeId).family), 0);
    const rev = Math.max(1, feasibility(g, hajj, acId).estRevenue);
    const net = margin(g, hajj, acId) - (crewMonth * months) / rev;
    expect(net).toBeGreaterThanOrEqual(0.1);
  });

  it('fuel at cost is billed after flying at the burn of the aircraft that flew', () => {
    const g = fixtureGame(103);
    const id = devJumbo(g);
    const o = g.offers[id];
    if (o.product.kind !== 'charter') return;
    const acId = Object.values(g.fleet).find((a) => a.typeId === 'b744')!.id;
    g.company.cash = 50_000_000;
    g.company.approvals.push('etops120', 'etops180');
    const r = acceptOffer(g, id, [acId]);
    if (!r.ok) throw new Error(r.error);
    const k = g.contracts[r.data!.contractId];
    expect(k.product.kind === 'charter' && k.product.fuelAtCost).toBe(true);
    advanceTo(g, o.end + DAY, new Set());
    const flown = Object.values(g.flights).filter((f) => f.contractId === k.id && f.kind === 'revenue' && f.status === 'done' && !f.operatedBy);
    const bills = g.finance.receivables.filter((x) => x.contractId === k.id && /^Fuel re-billed/.test(x.desc));
    expect(bills.length).toBe(flown.length);
    for (const b of bills) expect(b.amount).toBeGreaterThan(0);
  });

  it('jumbo loads stay at most 12 % of widebody offers', () => {
    const g = fixtureGame(104);
    devAddType(g, 'b744');
    let wide = 0;
    let jumbo = 0;
    for (let i = 0; i < 600; i++) {
      const o = generateOffer(g);
      if (!o) continue;
      if (isWideJob(o.requirements)) wide++;
      if (o.jumbo) jumbo++;
      delete g.offers[o.id];
    }
    expect(wide).toBeGreaterThan(30);
    expect(jumbo).toBeGreaterThan(0);
    expect(jumbo / wide).toBeLessThanOrEqual(0.12);
  });
});
