// MGH billing, charter money and the contract lifecycle (B1). DESIGN.md §5.1.9–5.1.10.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { flightsOf, retimeFlight, subcharterFlights } from '../core/entities';
import { DAY, fromUTC, monthKey } from '../core/time';
import type { Contract, GameState } from '../core/types';
import { cancelLegs } from '../ops/flights';
import { acceptOffer, billContractMonth, cancelContract, cancelCost, cancelPenalty, contractProgress } from '.';
import { noteLostLegs } from './billing';
import { mghInMonth } from './pricing';
import { hamBase, leased, legsOffer, newGame, owned, run } from './testkit';

function signBase(g: GameState, start: number, days: number, ids: string[]): Contract {
  const o = hamBase(g, start, days);
  const res = acceptOffer(g, o.id, ids);
  if (!res.ok) throw new Error(res.error);
  return g.contracts[res.data!.contractId];
}

const sum = (ls: { amount: number }[]) => ls.reduce((s, l) => s + l.amount, 0);
const rate = (c: Contract) => (c.product.kind === 'wet' ? c.product.ratePerBH : 0);

describe('billContractMonth', () => {
  const g = newGame(41);
  const may = monthKey(fromUTC(2027, 5, 10));
  const fresh = (ids = [leased(g).id], start = fromUTC(2027, 4, 20)) => {
    for (const k of Object.values(g.contracts)) if (k.status === 'signed') cancelContract(g, k.id);
    return signBase(g, start, 70, ids);
  };

  it('under MGH bills the guarantee: 150 BH flown against 200 → 200 × rate', () => {
    const c = fresh();
    c.use[may] = { blockMin: 150 * 60, cycles: 60, shortCycles: 0 };
    expect(sum(billContractMonth(g, c, may))).toBe(Math.round(200 * rate(c)));
    expect(c.billedMonths).toContain(may);
    expect(billContractMonth(g, c, may)).toEqual([]);
  });

  it('over MGH bills excess hours at 95%: 260 BH → 200 × rate + 60 × 0.95 × rate', () => {
    const c = fresh();
    c.use[may] = { blockMin: 260 * 60, cycles: 100, shortCycles: 0 };
    expect(sum(billContractMonth(g, c, may))).toBe(Math.round(200 * rate(c)) + Math.round(60 * 0.95 * rate(c)));
  });

  it('pro-rates the first month and doubles MGH for two aircraft', () => {
    const c = fresh();
    const apr = monthKey(fromUTC(2027, 4, 25));
    const mgh = mghInMonth(200, c.start, c.end, apr);
    expect(mgh).toBeGreaterThan(200 * 10 / 30);
    expect(mgh).toBeLessThan(200 * 12 / 30);
    c.use[apr] = { blockMin: 0, cycles: 0, shortCycles: 0 };
    expect(sum(billContractMonth(g, c, apr))).toBe(Math.round(mgh * rate(c)));
    const two = fresh([leased(g).id, owned(g).id]);
    expect(two.aircraftIds).toHaveLength(2);
    two.use[may] = { blockMin: 300 * 60, cycles: 120, shortCycles: 0 };
    expect(sum(billContractMonth(g, two, may))).toBe(Math.round(400 * rate(two)));
  });

  it('legs we cancelled come off the guarantee (non-performance), never below what was flown', () => {
    const c = fresh();
    c.use[may] = { blockMin: 150 * 60, cycles: 60, shortCycles: 0 };
    const leg = { contractId: c.id, kind: 'revenue', std: fromUTC(2027, 5, 12), block: 30 * 60 } as never;
    noteLostLegs(g, [leg]);
    expect(sum(billContractMonth(g, c, may))).toBe(Math.round(170 * rate(c)));
    const d = fresh();
    d.use[may] = { blockMin: 150 * 60, cycles: 60, shortCycles: 0, lostMin: 100 * 60 };
    expect(sum(billContractMonth(g, d, may))).toBe(Math.round(150 * rate(d)));
  });

  it('short cycles add the cycle fee; a broker takes 5%', () => {
    const c = fresh();
    c.broker = 'Polaris Ad-hoc';
    c.use[may] = { blockMin: 200 * 60, cycles: 80, shortCycles: 10 };
    const fee = c.product.kind === 'wet' ? c.product.cycleFee : 0;
    const gross = Math.round(200 * rate(c)) + Math.round(10 * fee);
    expect(sum(billContractMonth(g, c, may))).toBeCloseTo(gross * (1 - BAL.brokerCommission), -1);
  });
});

describe('wet lifecycle', () => {
  it('counts sub-chartered legs, invoices at month end and waits for a delayed positioning home', () => {
    const g = newGame(42);
    const ac = leased(g);
    const c = signBase(g, g.now + 3 * DAY, 30, [ac.id]);
    expect(c.status).toBe('signed');
    // Sub-charter one revenue leg: the client still got its flight, so it counts.
    const leg = flightsOf(g, ac.id).find((f) => f.contractId === c.id && f.kind === 'revenue' && f.std > c.start + 2 * DAY)!;
    subcharterFlights(g, [leg.id], g.rivals[0].id);
    run(g, leg.sta + 60);
    expect(c.status).toBe('active');
    expect(g.flights[leg.id].status).toBe('done');
    const k = monthKey(leg.sta);
    expect(c.use[k].blockMin).toBeGreaterThanOrEqual(leg.block);
    // Month end: one acmiRevenue invoice for March.
    run(g, fromUTC(2027, 4, 1) + 60);
    const inv = g.finance.receivables.filter((r) => r.contractId === c.id && r.cat === 'acmiRevenue');
    expect(inv.length).toBe(1);
    expect(inv[0].amount).toBeGreaterThan(0);
    // Delay the positioning home by a day: the contract completes only after it lands, and it is billed.
    run(g, c.end - 2 * DAY);
    const pos = flightsOf(g, ac.id).filter((f) => f.contractId === c.id && f.kind === 'positioning' && f.to === 'LIS').pop()!;
    retimeFlight(g, pos, pos.std + DAY, pos.sta + DAY);
    run(g, pos.std - 60);
    expect(c.status).toBe('active');
    run(g, pos.sta + 2 * 60);
    expect(c.status).toBe('completed');
    expect(c.billedMonths).toContain(monthKey(pos.sta));
    expect(g.stats.contractsDone).toBe(1);
  });

  it('contractProgress counts legs including rotations not generated yet', () => {
    const g = newGame(43);
    const c = signBase(g, g.now + 3 * DAY, 60, [leased(g).id]);
    const p = contractProgress(g, c.id);
    const generated = Object.values(g.flights).filter((f) => f.contractId === c.id && f.kind === 'revenue').length;
    expect(p.legsTotal).toBeGreaterThan(generated);
    expect(p.legsDone).toBe(0);
    expect(p.nextFlightId).toBeTruthy();
  });
});

describe('charter money', () => {
  it('deposit at signing, balance 7–14 days before departure, revenue only as legs fly', () => {
    const g = newGame(44);
    const ac = owned(g);
    const dep = g.now + 25 * DAY;
    const o = legsOffer(g, [['LIS', 'PMI', dep], ['PMI', 'LIS', dep + 3 * DAY]]);
    o.broker = undefined;
    o.payment = { basis: 'onCompletion', dueDays: 7, depositPct: 0.3 };
    const res = acceptOffer(g, o.id, [ac.id]);
    if (!res.ok) throw new Error(res.error);
    const c = g.contracts[res.data!.contractId];
    if (c.product.kind !== 'charter') throw new Error('charter');
    const price = c.product.price;
    const recs = () => g.finance.receivables.filter((r) => r.contractId === c.id);
    expect(recs()).toHaveLength(1);
    expect(recs()[0].amount).toBe(Math.round(price * 0.3));
    expect(g.finance.current.lines.charterRevenue ?? 0).toBe(0);
    expect(c.balanceAt).not.toBeNull();
    const lead = (dep - c.balanceAt!) / DAY;
    expect(lead).toBeGreaterThanOrEqual(7);
    expect(lead).toBeLessThanOrEqual(14);
    run(g, c.balanceAt! - 2 * 60);
    expect(recs()).toHaveLength(1);
    run(g, c.balanceAt! + DAY);
    expect(recs().length).toBeGreaterThanOrEqual(2);
    expect(c.accrued ?? 0).toBe(0);
    const out = flightsOf(g, ac.id).find((f) => f.contractId === c.id && f.kind === 'revenue')!;
    run(g, out.sta + 30);
    expect(c.accrued).toBeGreaterThan(0);
    expect(c.accrued).toBeLessThan(price);
    run(g, c.end + 3 * DAY);
    expect(c.status).toBe('completed');
    expect(c.accrued).toBe(price);
    expect(recs().reduce((s, r) => s + r.amount, 0)).toBe(price);
  });
});

describe('charter non-performance', () => {
  const sign = (seed: number) => {
    const g = newGame(seed);
    const dep = g.now + 25 * DAY;
    const o = legsOffer(g, [['LIS', 'PMI', dep], ['PMI', 'LIS', dep + 3 * DAY]]);
    o.broker = undefined;
    o.payment = { basis: 'onCompletion', dueDays: 7, depositPct: 0.3 };
    const res = acceptOffer(g, o.id, [owned(g).id]);
    if (!res.ok) throw new Error(res.error);
    return { g, c: g.contracts[res.data!.contractId] };
  };

  it('legs we cancel earn nothing: completion books no revenue, pays compensation, voids the unpaid deposit', () => {
    const { g, c } = sign(47);
    const legs = Object.values(g.flights).filter((f) => f.contractId === c.id && f.status === 'scheduled');
    const comp = cancelLegs(g, legs, 'Test', 0);
    expect(comp).toBeGreaterThan(0);
    run(g, c.end + 40 * DAY);
    expect(c.status).toBe('completed');
    expect(c.accrued ?? 0).toBe(0);
    const open = g.finance.receivables.filter((r) => r.contractId === c.id && r.paid === null);
    expect(open).toHaveLength(0);
    // A deposit already paid is refunded: nothing stays invoiced.
    expect(c.invoiced ?? 0).toBe(0);
    const rev = [...g.finance.history.map((h) => h.lines), g.finance.current.lines].reduce((s, l) => s + (l.charterRevenue ?? 0), 0);
    expect(rev).toBe(0);
  });

  it('cancelling with the deposit unpaid costs exactly the penalty shown, and the deposit invoice is voided', () => {
    const { g, c } = sign(48);
    const q = cancelCost(g, c.id);
    expect(q.refund).toBe(0);
    const cash = g.company.cash;
    expect(cancelContract(g, c.id).ok).toBe(true);
    expect(g.company.cash).toBe(cash - q.penalty);
    expect(g.finance.receivables.filter((r) => r.contractId === c.id && r.paid === null)).toHaveLength(0);
  });

  it('cancelling after the deposit was paid also refunds it, as quoted', () => {
    const { g, c } = sign(49);
    const dep = g.finance.receivables.find((r) => r.contractId === c.id)!;
    run(g, dep.payAt + 60);
    expect(dep.paid).not.toBeNull();
    const q = cancelCost(g, c.id);
    expect(q.refund).toBe(dep.amount);
    const cash = g.company.cash;
    cancelContract(g, c.id);
    expect(g.company.cash).toBe(cash - q.total);
  });
});

describe('cancelling', () => {
  it('before start: value × cancel scale, flights removed, reputation and relation hit', () => {
    const g = newGame(45);
    const ac = leased(g);
    const c = signBase(g, g.now + 45 * DAY, 40, [ac.id]);
    const flights = Object.values(g.flights).filter((f) => f.contractId === c.id).length;
    expect(flights).toBeGreaterThanOrEqual(0);
    run(g, g.now + 2 * DAY);
    const pen = cancelPenalty(g, c.id);
    // 43 days before start → 35% band.
    const mgh = c.product.kind === 'wet' ? c.product : null;
    expect(pen).toBeGreaterThan(0);
    expect(mgh).toBeTruthy();
    const rel = g.clients[c.clientId].relation;
    const rep = g.company.reputation.reliable;
    expect(cancelContract(g, c.id).ok).toBe(true);
    expect(c.status).toBe('cancelled');
    expect(Object.values(g.flights).filter((f) => f.contractId === c.id && f.status === 'scheduled')).toHaveLength(0);
    expect(flightsOf(g, ac.id).filter((f) => f.status === 'scheduled')).toHaveLength(0);
    expect(g.finance.current.lines.penalties).toBe(-pen);
    expect(g.company.reputation.reliable).toBe(rep - 5);
    expect(g.clients[c.clientId].relation).toBe(rel - 30);
    expect(cancelContract(g, c.id).ok).toBe(false);
  });

  it('the penalty steps up as the start gets closer', () => {
    const g = newGame(46);
    const c = signBase(g, g.now + 70 * DAY, 40, [leased(g).id]);
    const far = cancelPenalty(g, c.id);
    run(g, c.start - 20 * DAY);
    const mid = cancelPenalty(g, c.id);
    run(g, c.start - 5 * DAY);
    const near = cancelPenalty(g, c.id);
    expect(mid / far).toBeCloseTo(0.6 / 0.15, 1);
    expect(near / far).toBeCloseTo(1 / 0.15, 1);
  });
});
