// v0.17 merge (UPDATE-0.17.md §T, acceptance 17–19, the player's addition): an A380 or a 747 is hard and expensive,
// never impossible. With every requirement met, requests to the lessors that hold one bring a proposal at B, a lease
// with the big security at C, and at D the airline retiring one sells it for cash (no lessor credit check).

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { AircraftOffer, CreditGrade, GameState } from '../core/types';
import { acquireAircraft } from '../ops/market';
import { lessorRating } from './credit';
import { loiQuote, signLoi, usesLoi } from './deals';
import { newGame } from './deals017.helpers';
import { exoticPath } from './exotic';
import { dailyRfps, rfpPreview, sendRfp, type RfpDraft } from './rfp';

/** A company that holds every approval an A380 or a 747 needs, judged at `grade`, with the cash for anything. */
function ready(seed: number, grade: CreditGrade): GameState {
  const g = newGame(seed);
  g.company.approvals.push('widebody', 'augmented', 'etops120', 'etops180');
  g.company.standing = 2;
  g.company.cash = 400_000_000;
  g.leasing!.credit = { ...lessorRating(g), grade };
  return g;
}

/** Requests sent a month apart (each lessor looks again after 30 days) until a proposal comes; the proposals. */
function ask(g: GameState, typeId: string, tries = 20): AircraftOffer[] {
  const d: RfpDraft = { typeId, band: 'old', months: 36, count: 1, from: null, flex: true };
  for (let i = 0; i < tries; i++) {
    const r = sendRfp(g, d);
    if (!r.ok) throw new Error(r.error);
    const rfp = g.leasing!.rfps.find((x) => x.id === r.data!.rfpId)!;
    g.now = rfp.replyBy;
    dailyRfps(g);
    const got = g.market.aircraft.filter((o) => o.rfpId === rfp.id && o.typeId === typeId);
    if (got.length) return got;
    g.now += (BAL.v017.rfp.quietDays + 1) * DAY;
  }
  return [];
}

describe('v0.17 §T exotic types: never impossible', () => {
  it('at B: an A380 and a 747-400 request brings a lease proposal, signed through a letter of intent with no extra security', () => {
    for (const typeId of ['a388', 'b744']) {
      const g = ready(71, 'B');
      expect(rfpPreview(g, { typeId, band: 'old', months: 36, count: 1, from: null, flex: true }).goesTo).toBeGreaterThan(0);
      const got = ask(g, typeId);
      expect(got.length, typeId).toBeGreaterThan(0);
      const o = got.find((x) => x.kind === 'dryLeaseIn')!;
      expect(o).toBeDefined();
      expect(usesLoi(g, o)).toBe(true);
      const q = loiQuote(g, o.id)!;
      expect(q.why).toBeNull();
      expect(q.exoticSecurity).toBe(0);
      expect(signLoi(g, o.id).ok).toBe(true);
    }
  });

  it('at C: Amedeo still places an A380, with 4 more months of deposit and 3 months of reserves up front', () => {
    const g = ready(72, 'C');
    const got = ask(g, 'a388');
    const o = got.find((x) => x.kind === 'dryLeaseIn')!;
    expect(o, 'a lease proposal at C').toBeDefined();
    const q = loiQuote(g, o.id)!;
    expect(q.why).toBeNull();
    expect(q.exoticSecurity).toBe(Math.round(BAL.v017.exotic.securityMonths * o.rentPerMonth));
    expect(q.reservesDeposit).toBeGreaterThan(0);
  });

  it('at D: no lessor leases one, but the airline retiring an A380 sells it for cash; What it takes says so', () => {
    const g = ready(73, 'D');
    const p = rfpPreview(g, { typeId: 'a388', band: 'old', months: 36, count: 1, from: null, flex: true });
    expect(p.blocked).toBeNull();
    expect(p.lessors.filter((l) => l.ok).map((l) => l.id)).toEqual(['exop']);
    expect(exoticPath(g, 'a388').steps.find((s) => s.key === 'security')?.text).toMatch(/buy one with the cash/);
    const got = ask(g, 'a388', 30);
    expect(got.length).toBeGreaterThan(0);
    const o = got[0];
    expect(o.kind).toBe('buy');
    expect(o.price).toBeGreaterThan(0);
    expect(usesLoi(g, o)).toBe(false);
    const cash = g.company.cash;
    const r = acquireAircraft(g, o.id);
    if (!r.ok) throw new Error(r.error);
    expect(g.fleet[r.data!.aircraftId].typeId).toBe('a388');
    expect(g.company.cash).toBeLessThan(cash - o.price + 1);
  });

  it('a 747 classic is a sale from storage at any rating', () => {
    const g = ready(74, 'D');
    const got = ask(g, 'b742', 40);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((o) => o.kind === 'buy')).toBe(true);
  });
});
