// v0.9 crew slip at a fuel stop (UPDATE-0.9.md §W): the best stop, feasibility's line, the price, offer generation and
// the roster's cut agree; a chain that would need two slips stays impossible.

import { describe, expect, it } from 'vitest';
import { acceptOffer, feasibility } from '../contracts';
import { offerRestLine, restNeed } from '../contracts/feasibility';
import { crewCanFly } from '../contracts/offers';
import { BAL } from '../core/balance';
import { complement, planSector, typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { AcRest } from '../core/types';
import { devAddType, devSlipOffer } from '../dev';
import { autoRoster, restOf } from '.';
import { dutyNeed, type ChainShape } from './duties';
import { fixtureGame } from './fixtures';
import { crewAvailability } from './hr';
import { bestSlip, slipCost, slipDetail, slipOfFlight, slipsOfAircraft } from './slip';

const NO_REST: AcRest = { fc: null, cc: null };

function chainOf(typeId: string, from: string, to: string, std: number): ChainShape {
  const sp = planSector(typeId, from, to);
  let t = std;
  const legs = sp.legs.map((l) => {
    const leg = { std: t, sta: t + l.block, from: l.from, to: l.to };
    t += l.block + 60;
    return leg;
  });
  return { from, std, legs };
}

describe('§W bestSlip', () => {
  it('Madrid–Singapore on an A330 without rest on board changes crews at Istanbul', () => {
    const g = fixtureGame(51);
    const std = Math.floor(g.now / DAY) * DAY + 3 * DAY + 9 * 60;
    const c = chainOf('a332', 'MAD', 'SIN', std);
    expect(c.legs.map((l) => l.to)).toEqual(['IST', 'SIN']);
    const s = bestSlip(g, 'a332', NO_REST, c)!;
    expect(s).not.toBeNull();
    expect(s.at).toBe('IST');
    expect(s.text).toBe('Crew change at IST (fresh crew flies in)');
    expect(s.first.mode).not.toBe('none');
    expect(s.second.mode).not.toBe('none');
    expect(s.tickets).toBeGreaterThan(0);
    expect(slipCost(s)).toBeGreaterThan(s.tickets);
    // Round 4: the heads priced are the crew the roster positions (complement: pilots, purser, cabin crew, the policy
    // extra cabin crew) at the policy hotel tier, so the chip's cost and the booked costs agree.
    const cab = typeOf('a332').cabins[0];
    expect(s.crewN).toBe(complement('a332', cab.j + cab.w + cab.y, { augment: 0, extraCabin: g.company.policies.extraCabin }).length);
    expect(s.hotelNight).toBe(BAL.hotelPerNight[g.company.policies.hotelTier]);
    expect(slipCost(s)).toBe(Math.round(s.tickets + s.hotelNights * s.hotelNight + s.crewN * BAL.perDiem.CC));
    g.company.policies.hotelTier = 5;
    g.company.policies.extraCabin = 1;
    const s5 = bestSlip(g, 'a332', NO_REST, c)!;
    expect(s5.crewN).toBe(s.crewN + 1);
    expect(s5.hotelNight).toBe(BAL.hotelPerNight[5]);
    // The detail says who pays: priced in on a charter, the client on a wet lease.
    expect(slipDetail(s, 'SIN')).toMatch(/priced in\.$/);
    expect(slipDetail(s, 'SIN', true)).toMatch(/The client pays the tickets and hotel \(about \$\d+K\)\.$/);
  });

  it('a chain one crew can fly needs no slip; one that would need two stays impossible', () => {
    const g = fixtureGame(52);
    const std = Math.floor(g.now / DAY) * DAY + 3 * DAY + 9 * 60;
    expect(bestSlip(g, 'a320ceo', NO_REST, { from: 'LIS', std, legs: [{ std, sta: std + 120, from: 'LIS', to: 'FAO' }, { std: std + 180, sta: std + 300, from: 'FAO', to: 'LIS' }] })).toBeNull();
    // Dili–Lisbon on an A321neo with three long legs: no single cut leaves two flyable halves without rest.
    const c = chainOf('a321neo', 'DIL', 'LIS', std);
    expect(c.legs.length).toBe(3);
    const long = { ...c, legs: c.legs.map((l, i) => ({ ...l, std: l.std + i * 0, sta: l.sta + (i === 1 ? 6 * 60 : 0) })) };
    expect(bestSlip(g, 'a321neo', NO_REST, long)).toBeNull();
  });
});

describe('§W offers, feasibility, pricing and the roster', () => {
  it('Dili–Lisbon: offered with the crew change priced in; feasibility warns; the roster cuts the duty at the same stop', () => {
    const g = fixtureGame(53);
    const id = devSlipOffer(g, 'DIL-LIS');
    expect(id).not.toBe('');
    const o = g.offers[id];
    expect(o.slip!.at.length).toBe(1);
    expect(o.slip!.cost).toBeGreaterThan(5_000);
    const at = o.slip!.at[0];
    // Offer generation counts the slip as a valid plan.
    const leg = o.pattern.kind === 'legs' ? o.pattern.legs[0] : null;
    expect(crewCanFly(g, 'a321neo', [chainOf('a321neo', leg!.from, leg!.to, o.start)])).toBe(true);
    // Feasibility on an A321neo of ours: the line and its plain detail.
    const acId = devAddType(g, 'a321neo');
    g.company.approvals.push('etops120', 'etops180');
    const rep = feasibility(g, id, acId);
    const rest = rep.checks.find((c) => c.id === 'rest');
    expect(rest?.label).toBe(`Crew change at ${at} (fresh crew flies in)`);
    expect(rest?.level).toBe('warn');
    expect(rest?.detail).toMatch(/A second crew flies to .* by airline the day before and rests; it takes over/);
    expect(rest?.detail).toMatch(/priced in/);
    // Signed and rostered: the duty is cut at the stop, both duties record it, nobody's day is illegal.
    g.company.cash = 50_000_000;
    const r = acceptOffer(g, id, [acId]);
    expect(r.ok ? '' : r.error).toBe('');
    autoRoster(g, { aircraftIds: [acId], to: g.now + 20 * DAY });
    const flights = Object.values(g.flights).filter((f) => f.aircraftId === acId && f.contractId && f.kind !== 'positioning');
    const took = flights.find((f) => f.from === at);
    expect(took).toBeTruthy();
    const d = g.duties[took!.dutyId!];
    expect(d.slipAt).toBe(at);
    expect(d.legality).not.toBe('illegal');
    const before = flights.find((f) => f.to === at)!;
    expect(g.duties[before.dutyId!].slipAt).toBe(at);
    expect(before.dutyId).not.toBe(took!.dutyId);
    const v = slipOfFlight(g, took!.id)!;
    expect(v.at).toBe(at);
    expect(v.text).toMatch(/^Crew change at /);
    expect(slipsOfAircraft(g, acId, g.now, g.now + 30 * DAY).length).toBe(1);
  });
});

describe('§W round 4: a stop hours from home, the second crew set, the lines', () => {
  it('Lisbon–Sydney via Chennai: the second half is judged on the stricter clock, the roster builds it legal at the same stop; the capacity line counts the second set', () => {
    const g = fixtureGame(54);
    const id = devSlipOffer(g, 'LIS-SYD');
    expect(id).not.toBe('');
    const o = g.offers[id];
    expect(o.slip!.at).toEqual(['MAA']);
    // The offer's rest line reads like its siblings.
    expect(offerRestLine(g, id)).toMatch(/^Longest day \d+:\d\d · crew change at MAA$/);
    const acId = devAddType(g, 'a332');
    g.company.approvals.push('etops120', 'etops180');
    const rest = restOf(g, acId);
    const leg = o.pattern.kind === 'legs' ? o.pattern.legs[0] : null;
    const chain = chainOf('a332', leg!.from, leg!.to, o.start);
    const s = bestSlip(g, 'a332', rest, chain)!;
    expect(s.at).toBe('MAA');
    // The fresh crew is less than 48 h away: the home clock applies too, never a looser limit than either clock alone.
    const half: ChainShape = { from: 'MAA', std: chain.legs[s.cutIndex].std, legs: chain.legs.slice(s.cutIndex) };
    expect(s.second.max).toBeLessThanOrEqual(dutyNeed(g, 'a332', rest, half).max);
    expect(s.second).toEqual(dutyNeed(g, 'a332', rest, half, { stricter: true }));
    // Feasibility: one slipping chain → one more crew set on the capacity line.
    const rn = restNeed(g, o, 'a332', rest, [chain]);
    expect(rn.extraSets).toBe(1);
    expect(rn.line).toBe('Crew change at MAA (fresh crew flies in)');
    const plain = crewAvailability(g, 'A330/340', 'a332', o.start - DAY, o.start + DAY, 20);
    const withSlip = crewAvailability(g, 'A330/340', 'a332', o.start - DAY, o.start + DAY, 20, undefined, 1);
    expect(withSlip.setsNeeded).toBe(plain.setsNeeded + 1);
    const rep = feasibility(g, id, acId);
    expect(rep.crew.setsNeeded).toBeGreaterThanOrEqual(2);
    expect(rep.checks.find((c) => c.id === 'crew')?.label).toMatch(/^Needs \d+ crew sets/);
    // Signed and rostered: the second duty starts at the chip's stop and is legal.
    g.company.cash = 50_000_000;
    const r = acceptOffer(g, id, [acId]);
    expect(r.ok ? '' : r.error).toBe('');
    autoRoster(g, { aircraftIds: [acId], to: g.now + 20 * DAY });
    const flights = Object.values(g.flights).filter((f) => f.aircraftId === acId && f.contractId && f.kind !== 'positioning');
    const took = flights.find((f) => f.from === 'MAA');
    expect(took).toBeTruthy();
    const d = g.duties[took!.dutyId!];
    expect(d.slipAt).toBe('MAA');
    expect(d.legality).not.toBe('illegal');
    // The roster's own limit (its acclimatisation state) is never below the offer's stricter one.
    expect(d.maxFdp).toBeGreaterThanOrEqual(s.second.max);
  });

  it('two slipping chains on different days name both stops; a 4-pilot day beside a slip keeps its own warning', () => {
    const g = fixtureGame(55);
    const id = devSlipOffer(g, 'LIS-SYD');
    const o = g.offers[id];
    const rest = restOf(g, devAddType(g, 'a332'));
    const leg = o.pattern.kind === 'legs' ? o.pattern.legs[0] : null;
    const c1 = chainOf('a332', leg!.from, leg!.to, o.start);
    const c2 = chainOf('a332', 'LIS', 'PER', o.start + 3 * DAY);
    expect(c2.legs.map((l) => l.to)).toEqual(['JED', 'PER']);
    const rn = restNeed(g, o, 'a332', rest, [c1, c2]);
    expect(rn.line).toBe('Crew change at MAA and JED (fresh crews fly in)');
    expect(rn.slips?.length).toBe(2);
    expect(rn.extraSets).toBe(1);
    expect(rn.detail).not.toMatch(/Another day/);
    // The same two on the same day: two crews in the air at once.
    expect(restNeed(g, o, 'a332', rest, [c1, chainOf('a332', 'LIS', 'PER', o.start)]).extraSets).toBe(2);
    // A 4-pilot day (Madrid–Singapore on business-seat rest) is not hidden by the slip line.
    const c3 = chainOf('a332', 'MAD', 'SIN', o.start + 5 * DAY);
    expect(dutyNeed(g, 'a332', rest, c3).mode).toBe('aug2');
    const mixed = restNeed(g, o, 'a332', rest, [c1, c3]);
    expect(mixed.line).toBe('Crew change at MAA (fresh crew flies in)');
    expect(mixed.detail).toMatch(/priced in\. Another day: Business seats \(class 2\) → needs a 4th pilot/);
  });
});
