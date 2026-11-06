// v0.17 review: money through the letter of intent. The exotic security is asked once (the offer's terms may already
// carry it), every reserves deposit is paid once at the signing and refunded once at the return, the cash check at the
// signing covers what is taken, and the minimum-hours reserves are posted once a month.

import { describe, expect, it } from 'vitest';
import { ACMI_TYPES } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { AircraftOffer, CreditGrade, GameState } from '../core/types';
import { newGame as kitGame, run } from '../contracts/testkit';
import { acquireAircraft, makeOffer } from '../ops/market';
import { lessorRating } from './credit';
import { cashToSign, dailyDeals, loiQuote, meetConditions, signLease, signLoi, transitionCost } from './deals';
import { newGame } from './deals017.helpers';
import { dailyRfps, sendRfp } from './rfp';

function ready(seed: number, grade: CreditGrade): GameState {
  const g = newGame(seed);
  g.company.approvals.push('widebody', 'augmented', 'etops120', 'etops180');
  g.company.standing = 2;
  g.company.cash = 400_000_000;
  setGrade(g, grade);
  return g;
}
const setGrade = (g: GameState, grade: CreditGrade) => {
  g.leasing!.credit = { ...lessorRating(g), grade };
};

/** An A380 lease proposal asked at `grade` (requests a month apart until one comes). */
function a380Lease(g: GameState, grade: CreditGrade): AircraftOffer {
  for (let i = 0; i < 30; i++) {
    setGrade(g, grade);
    const r = sendRfp(g, { typeId: 'a388', band: 'old', months: 36, count: 1, from: null, flex: true });
    if (!r.ok) throw new Error(r.error);
    const rfp = g.leasing!.rfps.find((x) => x.id === r.data!.rfpId)!;
    g.now = rfp.replyBy;
    dailyRfps(g);
    const o = g.market.aircraft.find((x) => x.rfpId === rfp.id && x.kind === 'dryLeaseIn');
    if (o) return o;
    g.now += (BAL.v017.rfp.quietDays + 1) * DAY;
  }
  throw new Error('no A380 lease proposal');
}

/** LOI → committee (the grade held at `grade`) → security met in cash → signed; the cash out and the lease. */
function signThrough(g: GameState, o: AircraftOffer, grade: CreditGrade) {
  const before = g.company.cash;
  const s = signLoi(g, o.id, { autoSign: false });
  if (!s.ok) throw new Error(s.error);
  const d = g.leasing!.deals.find((x) => x.id === s.data!.dealId)!;
  for (let k = 0; k < 60 && d.stage === 'committee'; k++) {
    g.now += DAY;
    setGrade(g, grade);
    dailyDeals(g);
  }
  if (d.stage === 'conditions') expect(meetConditions(g, d.id, 'cash').ok).toBe(true);
  expect(d.stage).toBe('approved');
  const due = cashToSign(g, d);
  const mid = g.company.cash;
  const r = signLease(g, d.id);
  if (!r.ok) throw new Error(r.error);
  const ac = g.fleet[r.data!.aircraftId];
  if (ac.ownership.kind !== 'dryLeaseIn') throw new Error('not a lease');
  return { paid: before - g.company.cash, atSign: mid - g.company.cash, due, own: ac.ownership, deal: d };
}

describe('v0.17 review: deposits through the letter of intent', () => {
  it('an A380 offered at C: the security in its terms is not asked twice; the signing takes what the cash check said', () => {
    const g = ready(72, 'C');
    const o = a380Lease(g, 'C');
    expect(o.exoticSecurity).toBeGreaterThan(0);
    const q = loiQuote(g, o.id)!;
    // The deposit at signing is the rest of the offer's deposit (its 4 months' security included), nothing more.
    expect(q.depositAtSign).toBe(o.deposit - q.holding);
    expect(q.exoticSecurity).toBe(o.exoticSecurity);
    expect(q.reservesDeposit).toBe(o.reservesDeposit ?? 0);
    const x = signThrough(g, o, 'C');
    expect(x.atSign).toBe(x.due);
    const refund = (x.own.deposit ?? 0) + (x.own.reservesDeposit ?? 0);
    expect(x.own.deposit).toBe(o.deposit);
    expect(refund).toBe(x.paid - transitionCost(g, o));
  });

  it('an A380 offered at B, the letter of intent at C: the security asked once, refunded once', () => {
    const g = ready(71, 'B');
    const o = a380Lease(g, 'B');
    expect(o.exoticSecurity ?? 0).toBe(0);
    setGrade(g, 'C');
    const q = loiQuote(g, o.id)!;
    expect(q.exoticSecurity).toBe(Math.round(BAL.v017.exotic.securityMonths * o.rentPerMonth));
    expect(q.reservesDeposit).toBeGreaterThan(0);
    const x = signThrough(g, o, 'C');
    expect(x.atSign).toBe(x.due);
    const extra = x.deal.conditions?.extraDeposit ?? 0;
    expect(x.own.deposit).toBe(o.deposit + q.exoticSecurity + extra);
    expect(x.own.reservesDeposit).toBe(q.reservesDeposit);
    expect((x.own.deposit ?? 0) + (x.own.reservesDeposit ?? 0)).toBe(x.paid - transitionCost(g, o));
  });
});

describe('v0.17 review: minimum-hours reserves', () => {
  it('a parked v0.17 lease is billed its minimum hours once a month (one message, no version number)', () => {
    const g = kitGame(10);
    g.company.cash = 50_000_000;
    const o = makeOffer(g, ACMI_TYPES.a320ceo, { source: 'call', lessorId: 'carlyle', band: 'mid' });
    g.market.aircraft.push(o);
    const r = acquireAircraft(g, o.id, { direct: true });
    if (!r.ok) throw new Error(r.error);
    const own = g.fleet[r.data!.aircraftId].ownership as Extract<GameState['fleet'][string]['ownership'], { kind: 'dryLeaseIn' }>;
    run(g, g.now + 100 * DAY);
    const full = Math.round((own.minFH ?? 0) * own.reservesPerFH);
    const res = g.finance.history.filter((s) => s.closed).map((s) => -(s.lines.reserves ?? 0));
    // Whole parked months: the minimum hours × the rate (it was posted twice: 2 × that).
    expect(res.filter((x) => x === full).length).toBeGreaterThanOrEqual(2);
    expect(res.every((x) => x < 2 * full)).toBe(true);
    const msgs = g.messages.filter((m) => /unflown hours|Minimum-hours/.test(m.title));
    expect(msgs.length).toBe(new Set(msgs.map((m) => m.t)).size);
    expect(msgs.every((m) => !/v0\.17/.test(m.body))).toBe(true);
  });
});
