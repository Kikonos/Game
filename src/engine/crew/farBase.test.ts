// v0.12.1 far bases (crew/farBase.ts): sized on the programme, a reserve with every crew set, priced honestly.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import type { Contract, GameState } from '../core/types';
import { feasibility } from '../contracts/feasibility';
import { offer } from '../contracts/testkit';
import { dailyCrewCosts } from './costs';
import { deletePairing, pairingSeats, planAircraft } from './duties';
import { farBase, farTourBase, patternSets, reserveRoles } from './farBase';
import { addCrew, fixtureGame, seasonBase } from './fixtures';
import { reserveHolders } from './control';
import { crewAvailability } from './hr';
import { autoRoster, removeCrew } from './roster';
import { offsetAt } from './rules';

/** A base programme whose flights roll in after signing: only the positioning in exists at first (planned once). */
function signedAhead(g: GameState, base: string, dest: string, waves: number[]): { k: Contract; acId: string; later: () => void } {
  const acId = Object.keys(g.fleet)[0];
  const k = seasonBase(g, acId, base, dest, waves, 28);
  const prog = Object.values(g.flights).filter((f) => f.contractId === k.id);
  for (const f of prog) f.status = 'cancelled';
  g.fleet[acId].at = 'LIS';
  const blk = blockMinutes(g.fleet[acId].typeId, 'LIS', base);
  const std = k.start - blk - 14 * 60;
  addFlight(g, { no: 'AWL1', aircraftId: acId, contractId: k.id, kind: 'positioning', from: 'LIS', to: base, std, sta: std + blk });
  planAircraft(g, acId, g.now);
  return {
    k, acId,
    later: () => {
      for (const f of prog) f.status = 'scheduled';
      planAircraft(g, acId, g.now);
    },
  };
}

const depOf = (g: GameState, k: Contract) => Object.values(g.deployments).find((d) => d.contractId === k.id)!;

describe('v0.12.1 far bases', () => {
  it('a base over 12 h by air or 4+ time zones from home is far', () => {
    const t = Date.UTC(2027, 0, 10) / 60_000;
    expect(farBase('LIS', 'SGN', t)).toBe(true);
    expect(farBase('LIS', 'DAC', t)).toBe(true);
    expect(farBase('LIS', 'DUB', t)).toBe(false);
    expect(farBase('LIS', 'HAM', t)).toBe(false);
    expect(farBase('LIS', 'LIS', t)).toBe(false);
  });

  it('a far base signed ahead is sized again on its programme, not on its positioning alone', () => {
    const g = fixtureGame();
    const { k, later } = signedAhead(g, 'DAC', 'CCU', [6 * 60, 12 * 60 + 30, 19 * 60]);
    const before = depOf(g, k);
    expect(before.work).toBeUndefined();
    const sized = before.sized!;
    later();
    const dep = depOf(g, k);
    expect(dep.work).toBe(true);
    expect(dep.sized!).toBeGreaterThan(sized);
    // Three waves a day out of Dhaka: four sets on station, none of its duties flown as trips from Lisbon.
    expect(dep.setsOnStation).toBeGreaterThanOrEqual(4);
    const trips = Object.values(g.pairings).filter((p) => p.contractId === k.id && !p.deploymentId && p.dutyIds.some((id) => g.duties[id]?.flightIds.some((f) => g.flights[f].kind === 'revenue')));
    expect(trips).toEqual([]);
  });

  it('v0.12.1 a near base signed ahead is sized again on its programme too (was: its positioning alone, 2 sets)', () => {
    const g = fixtureGame();
    const { k, later } = signedAhead(g, 'HAM', 'PMI', [6 * 60, 12 * 60 + 30, 19 * 60]);
    const before = depOf(g, k);
    expect(before.work).toBeUndefined();
    // On its pattern until the flights come: three waves, at least 3 sets (was 2: the positioning duty alone).
    expect(before.sized!).toBeGreaterThanOrEqual(3);
    const sized = before.sized!;
    later();
    const dep = depOf(g, k);
    expect(dep.work).toBe(true);
    expect(dep.sized!).toBeGreaterThanOrEqual(sized);
    expect(dep.setsOnStation).toBeGreaterThanOrEqual(4);
    // None of its duties flown as trips from Lisbon; and a near base's tours carry no reserve.
    const trips = Object.values(g.pairings).filter((p) => p.contractId === k.id && !p.deploymentId && p.dutyIds.some((id) => g.duties[id]?.flightIds.some((f) => g.flights[f].kind === 'revenue')));
    expect(trips).toEqual([]);
    for (const id of dep.pairingIds) expect(g.pairings[id].slots.some((s) => s.reserve)).toBe(false);
  });

  it('v0.12.1 a deployment already under way (an older save, no work mark) keeps its sizing', () => {
    const g = fixtureGame();
    const { k, later } = signedAhead(g, 'HAM', 'PMI', [6 * 60, 12 * 60 + 30, 19 * 60]);
    const dep = depOf(g, k);
    const sized = dep.sized;
    // The planner has dropped its planned tours, and the deployment started: not re-sized.
    for (const id of [...dep.pairingIds]) deletePairing(g, g.pairings[id]);
    g.now = k.start + 60;
    later();
    expect(depOf(g, k).sized).toBe(sized);
    expect(depOf(g, k).work).toBeUndefined();
  });

  it('v0.12.1 the offer crew check holds a base\'s stationed sets for it, not only its block hours\' worth', () => {
    const g = fixtureGame();
    const { k, acId, later } = signedAhead(g, 'HAM', 'PMI', [6 * 60, 12 * 60 + 30, 19 * 60]);
    later();
    addCrew(g, { CPT: 12, FO: 12, PUR: 12, CC: 24 });
    const t = g.fleet[acId].typeId;
    const free = () => crewAvailability(g, 'A320', t, k.start + DAY, k.start + 8 * DAY, 50).byRole.CPT!.free;
    const dep = depOf(g, k);
    dep.setsOnStation = 3;
    const few = free();
    dep.setsOnStation = 9;
    // Nine crews stationed at Hamburg hold nine captains (its 220 BH alone size five).
    expect(free()).toBeLessThan(few);
  });

  it('v0.12.1 patternSets: one set per 85 BH a month, at least 2 (3 with three waves)', () => {
    const p = { base: 'HAM', dests: ['PMI'], waves: [360, 750], targetBH: 150 };
    expect(patternSets(p)).toBe(2);
    expect(patternSets({ ...p, waves: [360, 750, 1140] })).toBe(3);
    expect(patternSets({ ...p, waves: [360], targetBH: 300 })).toBe(4);
    // Never more hours than its waves fly: one wave of HAM–PMI on an A320 is about 160 BH a month, so 2 sets, not 5.
    expect(patternSets({ ...p, waves: [360], targetBH: 400 }, 'a320ceo')).toBe(2);
    expect(patternSets({ ...p, waves: [360, 750], targetBH: 300 }, 'a320ceo')).toBe(4);
  });

  it('every crew set at a far base carries its reserve: a spare captain and purser above the minimum', () => {
    const g = fixtureGame();
    const { k, later } = signedAhead(g, 'DAC', 'CCU', [6 * 60, 12 * 60 + 30]);
    later();
    const tours = depOf(g, k).pairingIds.map((id) => g.pairings[id]).filter((p) => p.dutyIds.some((id) => g.duties[id]?.flightIds.some((f) => g.flights[f].kind === 'revenue')));
    expect(tours.length).toBeGreaterThan(0);
    for (const p of tours) {
      expect(farTourBase(g, p)).toBe('DAC');
      const res = p.slots.filter((s) => s.reserve);
      expect(res.map((s) => s.role).sort()).toEqual(['CPT', 'PUR']);
      expect(res.every((s) => s.above)).toBe(true);
      expect(pairingSeats(g, p).filter((s) => s.reserve).length).toBe(2);
    }
    expect(reserveRoles('b744')).toEqual(['CPT', 'PUR', 'CC']);
    // A near base's tours carry none.
    const h = fixtureGame();
    const near = signedAhead(h, 'HAM', 'PMI', [6 * 60, 12 * 60 + 30]);
    near.later();
    for (const id of depOf(h, near.k).pairingIds) expect(h.pairings[id].slots.some((s) => s.reserve)).toBe(false);
  });

  it('the reserve is crewed after every required seat, and only while the family has the crew for it', () => {
    const g = fixtureGame();
    const { k, later } = signedAhead(g, 'DAC', 'CCU', [6 * 60, 12 * 60 + 30]);
    later();
    autoRoster(g, { to: g.now + 14 * DAY });
    const tours = depOf(g, k).pairingIds.map((id) => g.pairings[id]).filter((p) => p.slots.some((s) => s.reserve));
    // The startup crew cover the sets but not the reserve on top: required seats crewed, the reserve waits for hires.
    const started = tours.filter((p) => p.start < g.now + 14 * DAY);
    expect(started.length).toBeGreaterThan(0);
    for (const p of started) expect(p.slots.filter((s) => !s.above && !s.crewId)).toEqual([]);
    expect(started.flatMap((p) => p.slots.filter((s) => s.reserve && s.crewId))).toEqual([]);
    // Hired: the reserve is crewed too, and flies with its set.
    addCrew(g, { CPT: 12, FO: 6, PUR: 12, CC: 12 });
    autoRoster(g, { to: g.now + 14 * DAY });
    const filled = started.filter((p) => g.pairings[p.id]).flatMap((p) => g.pairings[p.id].slots.filter((s) => s.reserve && s.crewId));
    expect(filled.length).toBeGreaterThan(0);
  });

  it('a far base reserve stays at our cost: hotels on a wet lease too', () => {
    const g = fixtureGame();
    const { k, later } = signedAhead(g, 'DAC', 'CCU', [6 * 60, 12 * 60 + 30]);
    later();
    addCrew(g, { CPT: 12, FO: 6, PUR: 12, CC: 12 });
    autoRoster(g, { to: g.now + 14 * DAY });
    const p = depOf(g, k).pairingIds.map((id) => g.pairings[id]).find((x) => x.slots.some((s) => s.reserve && s.crewId))!;
    expect(p).toBeDefined();
    expect(k.product.kind).toBe('wet');
    const res = p.slots.find((s) => s.reserve && s.crewId)!;
    const crew = p.slots.find((s) => !s.above && s.crewId)!;
    g.now = Math.max(g.now, p.start + 60);
    for (const id of [res.crewId!, crew.crewId!]) {
      const c = g.crew[id];
      c.loc = 'DAC';
      c.awaySince = p.start;
      c.status = 'available';
    }
    // Only the two away: the reserve's night is ours, the operating crew's the client's.
    for (const c of Object.values(g.crew)) if (c.id !== res.crewId && c.id !== crew.crewId) c.awaySince = null;
    const before = g.finance.current.lines.hotels ?? 0;
    dailyCrewCosts(g);
    const night = g.finance.current.lines.hotels! - before;
    expect(night).toBeLessThan(0);
    res.reserve = undefined;
    const before2 = g.finance.current.lines.hotels ?? 0;
    dailyCrewCosts(g);
    expect((g.finance.current.lines.hotels ?? 0) - before2).toBe(0);
  });

  it('a crew member who falls sick is replaced on the spot by the reserve with their crew; Crew Control sees the reserve first', () => {
    const g = fixtureGame();
    const { k, later } = signedAhead(g, 'DAC', 'CCU', [6 * 60, 12 * 60 + 30]);
    later();
    addCrew(g, { CPT: 12, FO: 6, PUR: 12, CC: 12 });
    autoRoster(g, { to: g.now + 14 * DAY });
    const p = depOf(g, k).pairingIds.map((id) => g.pairings[id]).find((x) => x.slots.some((s) => s.reserve && s.role === 'CPT' && s.crewId))!;
    expect(p).toBeDefined();
    const spare = p.slots.find((s) => s.reserve && s.role === 'CPT')!.crewId!;
    expect(reserveHolders(g).has(spare)).toBe(true);
    const sick = p.slots.find((s) => !s.above && s.role === 'FO')!.crewId!;
    const covered = g.stats.sparesCovered ?? 0;
    const from = g.pairings[p.id].start;
    const res = removeCrew(g, sick, from, from + 3 * DAY);
    expect(res.uncovered).toEqual([]);
    expect(g.stats.sparesCovered ?? 0).toBe(covered + 1);
    // The spare captain sits in the first officer's seat (no ticket from Lisbon); their reserve seat is open, no amber.
    const q = Object.values(g.pairings).find((x) => x.slots.some((s) => s.crewId === spare && !s.above && s.role === 'FO'));
    expect(q).toBeDefined();
  });

  it("an empty leg back to a far base mid-programme is the tour's to fly, not a ferry crew's from home", () => {
    const g = fixtureGame();
    const { k, acId, later } = signedAhead(g, 'DAC', 'CCU', [6 * 60, 12 * 60 + 30]);
    // Day 4: the afternoon wave stays at Calcutta overnight (its way back handed to a rival), day 5's morning wave goes.
    const fl = Object.values(g.flights).filter((f) => f.contractId === k.id && f.kind === 'revenue').sort((a, b) => a.std - b.std);
    const day = (f: { std: number }) => Math.floor((f.std + offsetAt('DAC', f.std) - (k.start + offsetAt('DAC', k.start))) / DAY);
    const d4 = fl.filter((f) => day(f) === 4);
    const d5 = fl.filter((f) => day(f) === 5);
    const gone = [d4[d4.length - 1], d5[0], d5[1]];
    expect(gone.map((f) => f.from)).toEqual(['CCU', 'DAC', 'CCU']);
    later();
    for (const f of gone) f.status = 'cancelled';
    addCrew(g, { CPT: 12, FO: 6, PUR: 12, CC: 12 });
    planAircraft(g, acId, g.now);
    autoRoster(g, { to: g.now + 14 * DAY });
    const blk = blockMinutes(g.fleet[acId].typeId, 'CCU', 'DAC');
    const std = d5[1].std;
    const e = addFlight(g, { no: 'AWL9', aircraftId: acId, contractId: k.id, kind: 'positioning', from: 'CCU', to: 'DAC', std, sta: std + blk });
    planAircraft(g, acId, g.now);
    const d = g.duties[g.flights[e.id].dutyId!];
    expect(d).toBeDefined();
    const p = g.pairings[d.pairingId];
    expect(p.deploymentId).toBe(depOf(g, k).id);
  });

  it('an offer for a far base says how many reserve crew it stations there and prices them', () => {
    const g = fixtureGame();
    const acId = Object.keys(g.fleet)[0];
    const start = g.now + 40 * DAY;
    const far = offer(g, 'seasonBase', { airport: 'DAC', dests: ['CCU'], waves: 2, start, days: 45 });
    const rep = feasibility(g, far.id, acId);
    const line = rep.checks.find((c) => c.id === 'farBase');
    expect(line?.label).toMatch(/^Far base: \d+ reserve crew stationed at DAC$/);
    expect(Number(/(\d+) reserve/.exec(line!.label)![1]) % 2).toBe(0);
    // The reserve's hotels are ours (the crew's are the client's on a wet lease): a dearer hotel costs the far base more.
    const cost = (id: string, tier: number) => {
      g.company.policies.hotelTier = tier as typeof g.company.policies.hotelTier;
      return feasibility(g, id, acId).estCost;
    };
    expect(cost(far.id, 5) - cost(far.id, 3)).toBeGreaterThan(0);
    // (A new test offer of the kind replaces the open one.)
    const near = offer(g, 'seasonBase', { airport: 'HAM', dests: ['PMI'], waves: 2, start, days: 45 });
    expect(feasibility(g, near.id, acId).checks.some((c) => c.id === 'farBase')).toBe(false);
    expect(cost(near.id, 5) - cost(near.id, 3)).toBe(0);
  });
});
