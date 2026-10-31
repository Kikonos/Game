// MGH billing, charter money and the contract lifecycle (B1). DESIGN.md §5.1.9–5.1.10.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { addFlight, flightsOf, retimeFlight, subcharterFlights } from '../core/entities';
import { DAY, fromUTC, monthKey } from '../core/time';
import type { Contract, GameState } from '../core/types';
import { cancelLegs } from '../ops/flights';
import { acceptOffer, billContractMonth, cancelContract, cancelCost, cancelPenalty, contractProgress } from '.';
import { mghFor, mghRemaining, noteLostLegs, onFlightArrivedContracts } from './billing';
import { clientMoved, moveFlight } from '../ops/flights';
import { v09Stats } from '../crew/dayPlan';
import { feasibility } from './feasibility';
import { devHajj } from './missions';
import { earnedUnbilled } from '../../ui/screens/screenLogic';
import { mghInMonth, mghTotal, productValue } from './pricing';
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

describe('v0.12.1 Hajj phases (MGH inside the terms only)', () => {
  // A signed wet contract given two phases with a gap, as a Hajj airlift has.
  const hajjLike = () => {
    const g = newGame(47);
    const c = signBase(g, g.now + 140 * DAY, 66, [leased(g).id]);
    c.terms = [[c.start, c.start + 27 * DAY], [c.start + 36 * DAY, c.end - DAY]];
    return { g, c };
  };
  const phases = (c: Contract, from: number) => c.terms!.reduce((s, [a, b]) => s + (Math.min(b, c.end) > Math.max(a, from) ? mghTotal(c.product.kind === 'wet' ? c.product.mghPerMonth : 0, Math.max(a, from), b) : 0), 0);

  it('before the start the penalty is rate × Σ phase MGH × cancel scale (not the whole start–end)', () => {
    const { g, c } = hajjLike();
    const want = rate(c) * phases(c, c.start);
    const scale = c.penalties.cancelScale.find(([d]) => (c.start - g.now) / DAY >= d)![1];
    expect(mghRemaining(c, c.start)).toBeCloseTo(phases(c, c.start), 6);
    expect(cancelPenalty(g, c.id)).toBe(Math.round(want * scale));
  });
  it('between the phases only the second phase still to come counts', () => {
    const { g, c } = hajjLike();
    g.now = c.terms![0][1] + 2 * DAY;
    c.status = 'active';
    expect(cancelPenalty(g, c.id)).toBe(Math.round(rate(c) * phases(c, c.terms![1][0])));
  });
  it('a fresh Hajj offer: the offer dialog revenue equals the offer value when the hours stay under the MGH', () => {
    const g = newGame(5);
    const o = g.offers[devHajj(g)];
    expect(o?.terms?.length).toBeGreaterThan(0);
    // A guarantee above any hours flown, so the value is the phases' MGH alone.
    if (o.product.kind === 'wet') o.product.mghPerMonth = 600;
    o.estValue = productValue(o.product, o.estBH, o.start, o.end, o.terms);
    const ids = Object.keys(g.fleet);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(feasibility(g, o.id, id).estRevenue).toBe(Math.round(o.estValue * (1 - (o.broker ? BAL.brokerCommission : 0))));
    expect(o.estValue).toBeLessThan(productValue(o.product, o.estBH, o.start, o.end));
  });
});

describe('v0.12.1 earned so far this month = the invoice lines', () => {
  let g = newGame(41);
  const may = monthKey(fromUTC(2027, 5, 10));
  const mk = () => {
    g = newGame(41);
    const c = signBase(g, fromUTC(2027, 4, 20), 70, [leased(g).id]);
    c.status = 'active';
    return c;
  };
  const atEnd = (c: Contract) => {
    g.now = fromUTC(2027, 5, 31) + 23 * 60 + 59;
    const want = sum(billContractMonth(g, structuredClone(c), may));
    // One minute short of the month's end: within a minute's share of the MGH.
    expect(Math.abs(earnedUnbilled(g) - want)).toBeLessThanOrEqual(Math.ceil((rate(c) * 200) / (31 * 24 * 60)) + 1);
    return want;
  };
  it('(a) hours we cancelled come off', () => {
    const c = mk();
    c.use[may] = { blockMin: 20 * 60, cycles: 8, shortCycles: 0, lostMin: 155.8 * 60 };
    expect(atEnd(c)).toBeLessThan(Math.round(200 * rate(c)));
  });
  it('(b) hours over the MGH at the excess rate', () => {
    const c = mk();
    c.use[may] = { blockMin: 260 * 60, cycles: 100, shortCycles: 0 };
    expect(atEnd(c)).toBe(Math.round(200 * rate(c)) + Math.round(60 * 0.95 * rate(c)));
  });
  it('(c) Hajj phases and (d) a broker', () => {
    const c = mk();
    c.terms = [[c.start, fromUTC(2027, 5, 10)], [fromUTC(2027, 5, 20), c.end]];
    c.broker = 'Polaris Ad-hoc';
    c.use[may] = { blockMin: 50 * 60, cycles: 20, shortCycles: 0 };
    atEnd(c);
  });
  it('mid-month the MGH counts up to now only', () => {
    const c = mk();
    c.use[may] = { blockMin: 0, cycles: 0, shortCycles: 0 };
    g.now = fromUTC(2027, 5, 16);
    expect(earnedUnbilled(g)).toBe(Math.round(rate(c) * mghFor(c, may, g.now)));
    expect(mghFor(c, may, g.now)).toBeCloseTo(200 * 15 / 31, 1);
  });
  it('force majeure hours come off the guarantee with their own words', () => {
    const c = mk();
    c.use[may] = { blockMin: 150 * 60, cycles: 60, shortCycles: 0, lostMin: 10 * 60, lostFmMin: 20 * 60 };
    const ls = billContractMonth(g, c, may);
    expect(sum(ls)).toBe(Math.round(170 * rate(c)));
    expect(ls[0].desc).toContain('less 10.0 BH we cancelled');
    expect(ls[0].desc).toContain('less 20.0 BH cancelled by force majeure');
  });
});

describe('v0.12.1 on time = against the original schedule', () => {
  it('a leg ops moved +60 and flown at the new time is late; a leg the client moved and flown on time counts', () => {
    const g = newGame(42);
    const dep = g.now + 10 * DAY;
    const o = legsOffer(g, [['LIS', 'PMI', dep], ['PMI', 'LIS', dep + DAY], ['LIS', 'PMI', dep + 2 * DAY]]);
    const res = acceptOffer(g, o.id, [owned(g).id]);
    if (!res.ok) throw new Error(res.error);
    const c = g.contracts[res.data!.contractId];
    const legs = Object.values(g.flights).filter((f) => f.contractId === c.id && f.kind === 'revenue').sort((a, b) => a.std - b.std);
    const land = (f: (typeof legs)[number]) => {
      f.status = 'done';
      f.atd = f.std + f.delay;
      f.ata = f.atd + f.block;
      g.now = f.ata;
      onFlightArrivedContracts(g, { t: g.now, kind: 'flight.arr', id: f.id, v: f.ev } as never);
    };
    // Ops moved it an hour (fuelling): schedStd keeps the original.
    const a = legs[0];
    moveFlight(g, a, a.std + 60, 'Fuelling');
    land(a);
    expect(c.legsFlown).toBe(1);
    expect(c.legsOnTime ?? 0).toBe(0);
    // The client asked for 2 h later: the schedule is re-based, so it flies on time.
    const b = legs[1];
    moveFlight(g, b, b.std + 120, "Client's request (Condor)");
    clientMoved(b, 120, 'Condor');
    expect(b.schedStd).toBe(b.std);
    land(b);
    expect(c.legsOnTime).toBe(1);
    // A world wait excused in full keeps the client's month whole (the contract tally stays honest).
    const x = legs[2];
    moveFlight(g, x, x.std + 240, 'Waiting: Storm at HAM');
    x.excused = 240;
    land(x);
    expect(c.legsOnTime).toBe(1);
    const u = c.use[monthKey(g.now)]!;
    expect(u.onTime).toBeGreaterThanOrEqual(2);
  });
});

describe('v0.12.1 completion counts the legs that did not fly', () => {
  const setup = (seed: number) => {
    const g = newGame(seed);
    const dep = g.now + 5 * DAY;
    const o = legsOffer(g, [['LIS', 'PMI', dep], ['PMI', 'LIS', dep + DAY]]);
    o.archetype = 'evacuation';
    const res = acceptOffer(g, o.id, [owned(g).id]);
    if (!res.ok) throw new Error(res.error);
    return { g, c: g.contracts[res.data!.contractId] };
  };
  it('every leg cancelled by us: no completion credit, no job, no rescue counted, no repeat business', () => {
    const { g, c } = setup(43);
    const legs = Object.values(g.flights).filter((f) => f.contractId === c.id && f.kind === 'revenue');
    cancelLegs(g, legs, 'Crew shortage', 3);
    const rel = g.clients[c.clientId].relation;
    const done = g.stats.contractsDone;
    const safe = v09Stats(g).homeSafe ?? 0;
    run(g, c.end + DAY);
    expect(c.status).toBe('completed');
    expect(g.stats.contractsDone).toBe(done);
    expect(v09Stats(g).homeSafe ?? 0).toBe(safe);
    expect(g.clients[c.clientId].relation).toBeLessThanOrEqual(rel);
    expect(c.repeatRolled).toBeFalsy();
    expect(g.messages.some((m) => m.title === `Closed without flying: ${c.title}`)).toBe(true);
  });
  it('legs we cancelled count against the on-time score (1 flown of 2 = 50 %)', () => {
    const { g, c } = setup(43);
    const legs = Object.values(g.flights).filter((f) => f.contractId === c.id && f.kind === 'revenue').sort((a, b) => a.std - b.std);
    cancelLegs(g, [legs[1]], 'Crew shortage', 3);
    run(g, c.end + DAY);
    expect(c.legsFlown).toBe(1);
    const m = g.messages.find((x) => x.title === `Completed: ${c.title}`);
    expect(m?.body).toMatch(/1 leg flown, (0|50)% on time, 1 cancelled/);
  });
});

describe('v0.12.1 a contract ends with its last revenue leg', () => {
  it("a crew deadhead three days later does not hold it open", () => {
    const g = newGame(42);
    const dep = g.now + 5 * DAY;
    const o = legsOffer(g, [['LIS', 'PMI', dep], ['PMI', 'LIS', dep + DAY]]);
    const res = acceptOffer(g, o.id, [owned(g).id]);
    if (!res.ok) throw new Error(res.error);
    const c = g.contracts[res.data!.contractId];
    const last = Object.values(g.flights).filter((f) => f.contractId === c.id && f.kind === 'revenue').sort((a, b) => b.sta - a.sta)[0];
    const t = last.sta + 3 * DAY;
    addFlight(g, { no: 'TP1', aircraftId: null, contractId: c.id, kind: 'deadhead', from: 'PMI', to: 'LIS', std: t, sta: t + 150 });
    run(g, Math.max(c.end, last.sta) + 60);
    expect(c.status).toBe('completed');
  });
});
