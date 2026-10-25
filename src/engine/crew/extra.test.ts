// v0.6 extra crew above the legal minimum (UPDATE-0.6.md §F4): precedence, optional seats, on-board spare,
// staffing, the client's paid option.

import { describe, expect, it } from 'vitest';
import { deadheadFlights } from '../core/entities';
import { DAY } from '../core/time';
import type { GameState, Pairing } from '../core/types';
import { acceptOffer } from '../contracts';
import { legsOffer } from '../contracts/testkit';
import { demoFlights } from '../dev';
import { crewBlocked } from '../ops/flights';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { autoRoster, crewExtraFor, crewExtraQuote, dutyCrew, dutyLegality, flightCrewStatus, removeCrew, setCrewExtra, staffing, unassignCrew } from '.';

const acOf = (g: GameState) => Object.keys(g.fleet)[0];

function rostered(seed = 5): GameState {
  const g = fixtureGame(seed);
  demoFlights(g, undefined, 6, 'revenue');
  return g;
}

const crewed = (g: GameState, acId: string): Pairing[] =>
  Object.values(g.pairings).filter((p) => p.aircraftId === acId && p.start > g.now + DAY && p.status === 'planned').sort((a, b) => a.start - b.start);

describe('extra crew settings', () => {
  it('precedence: client request, contract, aircraft, company default; paid minimum', () => {
    const g = fixtureGame();
    const ac = acOf(g);
    expect(crewExtraFor(g, ac, null)).toMatchObject({ cabin: 0, pilot: 0, source: 'company' });
    g.company.policies.extraCabin = 1;
    expect(crewExtraFor(g, ac, null)).toMatchObject({ cabin: 1, source: 'company' });
    g.fleet[ac].crewExtra = { cabin: 2, pilot: 1 };
    expect(crewExtraFor(g, ac, null)).toMatchObject({ cabin: 2, pilot: 1, source: 'aircraft' });
    const k = fixtureContract(g, { aircraftIds: [ac], start: g.now, end: g.now + 10 * DAY, pattern: { kind: 'legs', legs: [] } });
    k.crewExtra = { cabin: 3, pilot: 0 };
    // v0.10 optional extras stop at the crew seats: an A320 has 6, the minimum takes 4
    expect(crewExtraFor(g, ac, k.id)).toMatchObject({ cabin: 2, pilot: 0, source: 'contract' });
    k.requirements.extraCabin = 4;
    expect(crewExtraFor(g, ac, k.id)).toMatchObject({ cabin: 4, source: 'client' });
    k.requirements.extraCabin = 0;
    k.crewExtra = { cabin: 0, pilot: 0 };
    k.requirements.extraCabinPaid = { n: 2, pct: 0.015 };
    k.extraPaid = true;
    expect(crewExtraFor(g, ac, k.id)).toMatchObject({ cabin: 2, paidMin: 2 });
  });

  it('the complement gains optional seats (extra CC, spare pilot as CRP) filled after the required ones', () => {
    const g = rostered();
    const ac = acOf(g);
    addCrew(g, { CC: 12, FO: 6 });
    expect(setCrewExtra(g, { aircraftId: ac }, { cabin: 2, pilot: 1 }).ok).toBe(true);
    const p = crewed(g, ac)[0];
    const above = p.slots.filter((s) => s.above);
    expect(above.map((s) => s.role).sort()).toEqual(['CC', 'CC', 'CRP']);
    // Required seats first, the optional ones last.
    const firstAbove = p.slots.findIndex((s) => s.above);
    expect(p.slots.slice(firstAbove).every((s) => s.above)).toBe(true);
    expect(p.slots.filter((s) => !s.above).every((s) => s.crewId)).toBe(true);
    expect(above.every((s) => s.crewId)).toBe(true);
    const view = dutyCrew(g, p.dutyIds[0])!;
    expect(view.slots.filter((s) => s.above)).toHaveLength(3);
    // Back to the legal minimum: optional seats go, their crew released.
    expect(setCrewExtra(g, { aircraftId: ac }, null).ok).toBe(true);
    expect(g.pairings[p.id].slots.some((s) => s.above)).toBe(false);
  });

  it('an empty optional seat never makes a flight uncovered or illegal (amber only)', () => {
    const g = rostered();
    const ac = acOf(g);
    autoRoster(g);
    setCrewExtra(g, { aircraftId: ac }, { cabin: 2, pilot: 0 });
    const p = crewed(g, ac).find((x) => x.slots.some((s) => s.above && s.crewId))!;
    // Taking someone off an optional seat needs no force, and leaves it empty.
    const off = p.slots.find((s) => s.above && s.crewId)!.crewId!;
    expect(unassignCrew(g, p.dutyIds[0], off).ok).toBe(true);
    expect(p.slots.some((s) => s.above && !s.crewId)).toBe(true);
    const d = g.duties[p.dutyIds[0]];
    const f = g.flights[d.flightIds[0]];
    const st = flightCrewStatus(g, f.id);
    expect(st.missing).toEqual([]);
    expect(st.level).toBe('tight');
    const lg = dutyLegality(g, d.id);
    expect(lg.legal).toBe(true);
    expect(lg.warnings.some((w) => w.code === 'extraEmpty' && w.level === 'tight')).toBe(true);
    expect(crewBlocked(g, f)).toBe(false);
  });

  it('a sick required crew member is replaced by the spare on board: no ticket', () => {
    const g = rostered();
    const ac = acOf(g);
    addCrew(g, { CC: 12 });
    setCrewExtra(g, { aircraftId: ac }, { cabin: 1, pilot: 0 });
    const p = crewed(g, ac).find((x) => x.slots.some((s) => s.above && s.crewId))!;
    const spare = p.slots.find((s) => s.above)!.crewId!;
    const sick = p.slots.find((s) => !s.above && s.role === 'CC')!.crewId!;
    const tickets = deadheadFlights(g).length;
    removeCrew(g, sick, p.start - 60, p.end + DAY);
    const q = Object.values(g.pairings).find((x) => x.slots.some((s) => s.crewId === spare))!;
    const seat = q.slots.find((s) => s.crewId === spare)!;
    expect(seat.above).toBeFalsy();
    expect(seat.role).toBe('CC');
    expect(q.slots.some((s) => s.crewId === sick)).toBe(false);
    // The spare took the seat; no new ticket was bought for it.
    expect(deadheadFlights(g).filter((f) => f.crewIds.includes(spare)).length).toBe(0);
    expect(deadheadFlights(g).length).toBeLessThanOrEqual(tickets + 1);
  });

  it('staffing need and the quote include the extras', () => {
    const g = fixtureGame();
    const ac = acOf(g);
    const cc = () => staffing(g).find((l) => l.role === 'CC')?.need ?? 0;
    const fo = () => staffing(g).find((l) => l.role === 'FO')!.need;
    const [cc0, fo0] = [cc(), fo()];
    g.fleet[ac].crewExtra = { cabin: 2, pilot: 1 };
    expect(cc() - cc0).toBe(2 * 5);
    expect(fo() - fo0).toBe(5);
    const q = crewExtraQuote(g, ac, { cabin: 2, pilot: 1 });
    expect(q.extraPeople).toBe(15);
    expect(q.perMonth).toBeGreaterThan(15 * 1_900);
    expect(q.morale).toBe('up');
    expect(q.service).toBeCloseTo(0.4);
    expect(q.minimum).toEqual({ pilots: 2, cabin: 4 });
    expect(crewExtraQuote(g, ac, { cabin: 0, pilot: 0 }).perMonth).toBe(0);
  });

  it('the paid option raises the price only when met, and locks the contract at n', () => {
    const mk = (cabin: number) => {
      const g = fixtureGame(9);
      const t = g.now + 5 * DAY;
      const o = legsOffer(g, [['LIS', 'FNC', t], ['FNC', 'LIS', t + 6 * 60]]);
      o.requirements.extraCabinPaid = { n: 1, pct: 0.0075 };
      const price = o.product.kind === 'charter' ? o.product.price : 0;
      const r = acceptOffer(g, o.id, [acOf(g)], { crewExtra: { cabin, pilot: 0 } });
      if (!r.ok) throw new Error(r.error);
      return { g, k: g.contracts[r.data!.contractId], price };
    };
    const paid = mk(1);
    expect(paid.k.extraPaid).toBe(true);
    expect(paid.k.product.kind === 'charter' && paid.k.product.price).toBe(Math.round(paid.price * 1.0075));
    expect(setCrewExtra(paid.g, { contractId: paid.k.id }, { cabin: 0, pilot: 0 }).ok).toBe(false);
    expect(setCrewExtra(paid.g, { contractId: paid.k.id }, { cabin: 2, pilot: 0 }).ok).toBe(true);
    const plain = mk(0);
    expect(plain.k.extraPaid).toBeFalsy();
    expect(plain.k.product.kind === 'charter' && plain.k.product.price).toBe(plain.price);
  });

  it('paid extra crew fly above the client\'s required extra (a required +2 does not meet a paid +1)', () => {
    const mk = (cabin: number) => {
      const g = fixtureGame(9);
      const t = g.now + 5 * DAY;
      const o = legsOffer(g, [['LIS', 'FNC', t], ['FNC', 'LIS', t + 6 * 60]]);
      o.requirements.extraCabin = 2;
      o.requirements.extraCabinPaid = { n: 1, pct: 0.0075, perBH: 75 };
      const r = acceptOffer(g, o.id, [acOf(g)], { crewExtra: { cabin, pilot: 0 } });
      if (!r.ok) throw new Error(r.error);
      const k = g.contracts[r.data!.contractId];
      return { g, k };
    };
    expect(mk(2).k.extraPaid).toBeFalsy();
    const paid = mk(3);
    expect(paid.k.extraPaid).toBe(true);
    expect(crewExtraFor(paid.g, acOf(paid.g), paid.k.id)).toMatchObject({ cabin: 3, paidMin: 3 });
    expect(setCrewExtra(paid.g, { contractId: paid.k.id }, { cabin: 2, pilot: 0 }).ok).toBe(false);
  });
});
