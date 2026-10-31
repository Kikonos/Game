// v0.11.2 crew sets review (29 Oct 2026, the player: "it still shows weird numbers and sets, especially when flight
// attendants hold multiple types"): built fleets where the Planning view, the Hire view, Round up, the peak forecast
// and the offer crew check must agree, each person counted once.

import { describe, expect, it } from 'vitest';
import { devMixedCrew } from '../contracts/missions';
import { addAircraft, newGame } from '../contracts/testkit';
import { DAY } from '../core/time';
import type { GameState, Role } from '../core/types';
import { planAircraft } from './duties';
import { crewDays } from './forecast';
import { addCrew, fixtureContract, fixtureGame, seasonBase } from './fixtures';
import { devAddType } from '../dev';
import { crewAvailability, staffing } from './hr';
import { crewPlan, familyNeeds, roundTargets, setsForStation, type FamilyPlan } from './sets';

/** Two A320s (180Y: 1 CPT + 1 FO + 1 PUR + 3 CC), no crew, no extra cabin crew. */
const twoA320 = (): GameState => {
  const g = newGame(11);
  for (const id of Object.keys(g.crew)) delete g.crew[id];
  for (const ac of Object.values(g.fleet)) ac.cabin = { j: 0, w: 0, y: 180, total: 180, label: '180Y', layout: 'all-economy' };
  g.company.policies.extraCabin = 0;
  g.company.cash = 50_000_000;
  return g;
};
/** Only aircraft of these types (each at home base, its default cabin). */
const fleetOf = (...types: string[]): GameState => {
  const g = twoA320();
  const old = Object.keys(g.fleet);
  for (const t of types) addAircraft(g, t);
  for (const id of old) delete g.fleet[id];
  return g;
};
const plan = (g: GameState, f: string): FamilyPlan => crewPlan(g).find((p) => p.family === f)!;
const row = (g: GameState, f: string, r: Role) => plan(g, f).roles.find((x) => x.role === r)!;
const line = (g: GameState, f: string, r: Role) => staffing(g).find((l) => l.family === f && l.role === r)!;
const rate = (ids: string[], g: GameState, ratings: string[]) => { for (const id of ids) g.crew[id].ratings = ratings as never; };

/** The Hire view's have per role is the Planning view's (relief pilots with the first officers), every family. */
function agree(g: GameState) {
  for (const p of crewPlan(g)) {
    const have = (r: Role) => p.roles.find((x) => x.role === r)?.have ?? 0;
    for (const r of ['CPT', 'PUR', 'CC'] as Role[]) {
      const l = staffing(g).find((x) => x.family === p.family && x.role === r);
      if (l) expect(l.have, `${p.family} ${r}`).toBe(have(r));
    }
    const fo = staffing(g).find((x) => x.family === p.family && x.role === 'FO');
    if (fo) expect(fo.have, `${p.family} FO`).toBe(have('FO') + have('CRP'));
  }
}

/** Fake augmented days on an aircraft: `n` duties over the next days, every other one with `level` relief pilots. */
function augmented(g: GameState, acId: string, level: 1 | 2, n = 10) {
  // v0.12.1 one trip per duty (relief pilots are counted by pairing: a trip with one augmented duty is all augmented).
  for (let i = 0; i < n; i++) {
    const id = `dx${i}`;
    const report = g.now + (i + 1) * DAY;
    (g.duties as Record<string, unknown>)[id] = { id, pairingId: `px${i}`, report, release: report + 600, augment: i % 2 ? level : 0, flightIds: [], deadheadIds: [] };
    (g.pairings as Record<string, unknown>)[`px${i}`] = { id: `px${i}`, aircraftId: acId, contractId: null, deploymentId: null, base: g.company.homeBase, start: report, end: report + 600, dutyIds: [id], slots: [], status: 'planned' };
  }
}

describe('sets review: 777 + 787 with pilots on both (common type rating)', () => {
  /** One 777 and one 787; 3 777-only captains and FOs, 4 of each on both types (hired for the 777). */
  const ccq = () => {
    const g = fleetOf('b772', 'b788');
    addCrew(g, { CPT: 3, FO: 3, PUR: 5, CC: 40 }, 'B777');
    addCrew(g, { PUR: 5, CC: 30 }, 'B787');
    rate(addCrew(g, { CPT: 4, FO: 4 }, 'B777'), g, ['B777', 'B787']);
    return g;
  };

  it('Planning: 7 captains for 10 seats: the 777 complete, the 787 short 3 captains and 3 first officers', () => {
    const g = ccq();
    expect(plan(g, 'B777')).toMatchObject({ setsNeeded: 5, setsComplete: 5 });
    expect(plan(g, 'B787')).toMatchObject({ setsNeeded: 5, setsComplete: 2, verdict: 'Short: 3 CPT, 3 FO' });
  });

  it('Hire view: each pilot counted once, as Planning (was in both families: "787 CPT 4 of 5" for 3 short)', () => {
    const g = ccq();
    agree(g);
    expect(line(g, 'B777', 'CPT')).toMatchObject({ have: 5, need: 5, shared: 2 });
    expect(line(g, 'B787', 'CPT')).toMatchObject({ have: 2, need: 5, shared: 2 });
    expect(staffing(g).filter((l) => l.role === 'CPT').reduce((s, l) => s + l.have, 0)).toBe(7);
  });

  it('peak forecast: each pilot gives their days to one family only', () => {
    const g = ccq();
    const from = g.now + 40 * DAY;
    const days = crewDays(g, from, from + DAY);
    const one = days.get('B777')!.CPT / 5;
    expect(days.get('B787')!.CPT).toBeCloseTo(one * 2, 5);
  });
});

describe('sets review: relief pilots on the books (augmented 777)', () => {
  it('Hire view counts the relief pilots in the first officers line, whose need holds their seats (was "FO 5 of 8")', () => {
    const g = fleetOf('b772');
    augmented(g, Object.keys(g.fleet)[0], 1);
    addCrew(g, { CPT: 5, FO: 5, CRP: 3, PUR: 5, CC: 35 }, 'B777');
    expect(plan(g, 'B777')).toMatchObject({ setsComplete: 5, verdict: 'Complete' });
    expect(row(g, 'B777', 'CRP')).toMatchObject({ have: 3, need: 3, balance: 0 });
    expect(line(g, 'B777', 'FO')).toMatchObject({ have: 8, need: 8 });
    agree(g);
  });
});

describe('sets review: A320 + A330 with cabin crew on both, hired for either', () => {
  /** A320 family 3 CC short and the A330 5 short of single-type crew; 5 A320 hires and 4 A330 hires hold both. */
  const both = () => {
    const g = twoA320();
    addAircraft(g, 'a332');
    addCrew(g, { CPT: 10, FO: 10, PUR: 10, CC: 27 });
    rate(addCrew(g, { CC: 5 }), g, ['A320', 'A330/340']);
    addCrew(g, { CPT: 5, FO: 5, PUR: 5, CC: 30 }, 'A330/340');
    rate(addCrew(g, { CC: 4 }, 'A330/340'), g, ['A330/340', 'A320']);
    return g;
  };

  it('Planning and the Hire view put each dual-rated person in the same family (were 31/35 vs 30/36)', () => {
    const g = both();
    expect(row(g, 'A320', 'CC')).toMatchObject({ have: 31, need: 30, shared: 4 });
    expect(row(g, 'A330/340', 'CC')).toMatchObject({ have: 35, need: 35, shared: 5 });
    agree(g);
    expect(line(g, 'A320', 'CC').shared).toBe(4);
    expect(line(g, 'A330/340', 'CC').shared).toBe(5);
    expect(staffing(g).filter((l) => l.role === 'CC').reduce((s, l) => s + l.have, 0)).toBe(66);
  });

  it('backup lines: one A320 hire counted on the A330 is shown as hired for the A320, not "where they were hired"', () => {
    const g = both();
    const wide = plan(g, 'A330/340');
    expect(wide.alsoRated).toEqual([
      { family: 'A320', label: 'A320 family', cabin: 4, pilots: 0 },
      { family: 'A320', label: 'A320 family', cabin: 1, pilots: 0, spill: true },
    ]);
    expect(plan(g, 'A320').backupFrom).toEqual([
      { family: 'A330/340', label: 'A330/A340', cabin: 4, pilots: 0 },
      { family: 'A330/340', label: 'A330/A340', cabin: 1, pilots: 0, spill: true },
    ]);
  });
});

describe('sets review: spare pursers fly cabin crew seats', () => {
  /** 12 pursers and 28 cabin crew for 10 A320 sets: complete (two pursers in cabin crew seats). */
  const pursers = () => {
    const g = twoA320();
    addCrew(g, { CPT: 10, FO: 10, PUR: 12, CC: 28 });
    return g;
  };

  it('the card is complete and the cabin crew row is not "short 2" (2 pursers fill the seats)', () => {
    const g = pursers();
    expect(plan(g, 'A320')).toMatchObject({ setsComplete: 10, verdict: 'Complete' });
    expect(row(g, 'A320', 'CC')).toMatchObject({ have: 28, need: 30, balance: 0, covered: 2 });
    expect(row(g, 'A320', 'PUR')).toMatchObject({ have: 12, balance: 2, covered: 2 });
    expect(line(g, 'A320', 'CC')).toMatchObject({ have: 28, need: 30, covered: 2 });
  });

  it('Round up has nothing to offer (was "Round up to 12 sets": 2 CPT, 2 FO and 8 CC for two pursers)', () => {
    const g = pursers();
    expect(roundTargets(plan(g, 'A320'))).toEqual({ complete: null, next: null, spare: 11 });
    // a captain and first officer more: the 11th set needs 4 cabin crew only
    addCrew(g, { CPT: 1, FO: 1 });
    expect(roundTargets(plan(g, 'A320')).next).toBe(11);
  });

  it('a dual-rated cabin crew member is not kept home for a seat a spare purser fills: they go to the A330 gap', () => {
    const g = pursers();
    addAircraft(g, 'a332');
    addCrew(g, { CPT: 5, FO: 5, PUR: 5, CC: 20 }, 'A330/340');
    rate(addCrew(g, { CC: 4 }), g, ['A320', 'A330/340']);
    expect(row(g, 'A320', 'CC')).toMatchObject({ have: 28, balance: 0, covered: 2 });
    expect(row(g, 'A330/340', 'CC')).toMatchObject({ have: 24, shared: 4 });
    agree(g);
  });

  it('"limited by" names the role that runs out with the pursers in cabin seats (was cabin crew, covered by pursers)', () => {
    const g = twoA320();
    addCrew(g, { CPT: 9, FO: 10, PUR: 13, CC: 26 });
    expect(plan(g, 'A320')).toMatchObject({ setsComplete: 9, limiting: 'CPT' });
  });
});

describe('sets review: a mixed-crew contract', () => {
  it('fully crewed for whole sets: Round up has nothing to offer (was "Round up to 14 sets" with 10 needed)', () => {
    const g = twoA320();
    addCrew(g, { CPT: 10, FO: 10, PUR: 10, CC: 30 });
    expect(devMixedCrew(g)).not.toBe('');
    const p = plan(g, 'A320');
    expect(p.roles.find((r) => r.role === 'CC')!.need).toBeLessThan(30);
    expect(p).toMatchObject({ setsNeeded: 10, setsComplete: 10 });
    expect(roundTargets(p)).toMatchObject({ complete: null, next: null });
  }, 120_000);
});

describe('sets review: the offer crew check counts dual-rated crew once', () => {
  it('A320 hires on both types the A320 family needs are not free crew for an A330 offer', () => {
    const g = twoA320();
    addAircraft(g, 'a332');
    addCrew(g, { CPT: 10, FO: 10, PUR: 10, CC: 26 });
    const duals = addCrew(g, { CC: 4 });
    addCrew(g, { CPT: 5, FO: 5, PUR: 5, CC: 20 }, 'A330/340');
    const from = g.now + 10 * DAY;
    const free = () => crewAvailability(g, 'A330/340', 'a332', from, from + 30 * DAY, 100).byRole.CC!.free;
    const single = free();
    rate(duals, g, ['A320', 'A330/340']);
    // counted in the A320 family's sets (it is short without them): no extra A330 supply
    expect(free()).toBe(single);
    // the A320 family full without them: they count for the A330
    addCrew(g, { CC: 4 });
    expect(free()).toBeGreaterThan(single);
  });
});

describe('v0.12.1 relief pilots counted by pairing', () => {
  it('a tour with one augmented duty carries its relief pilots on all of them: every duty of it counts as augmented', () => {
    const g = fixtureGame();
    const acId = Object.keys(g.fleet)[0];
    seasonBase(g, acId, 'HAM', 'PMI', [6 * 60, 12 * 60 + 30], 28);
    planAircraft(g, acId, g.now);
    const tours = Object.values(g.pairings).filter((p) => p.aircraftId === acId && p.tour && p.dutyIds.length >= 2);
    expect(tours.length).toBeGreaterThan(1);
    const live = (ids: string[]) => ids.filter((id) => g.duties[id] && !g.duties[id].done && g.duties[id].report <= g.now + 30 * DAY).length;
    const all = Object.values(g.pairings).filter((p) => p.aircraftId === acId && p.status !== 'done' && p.status !== 'broken').reduce((n, p) => n + live(p.dutyIds), 0);
    // One duty of each tour needs four pilots: its crew carry two captains and two first officers throughout.
    const before = familyNeeds(g).get('A320')!.need.CPT!;
    for (const t of tours) g.duties[t.dutyIds[0]].augment = 2;
    const after = familyNeeds(g).get('A320')!.need.CPT!;
    const sets = setsForStation(Math.max(0, ...Object.values(g.deployments).filter((d) => d.aircraftId === acId).map((d) => d.setsOnStation)));
    const share = tours.reduce((n, t) => n + live(t.dutyIds), 0) / all;
    // Was those duties' share alone (one per tour); now the whole tours'.
    expect(after - before).toBe(Math.ceil(sets * share - 1e-9));
    expect(after - before).toBeGreaterThan(Math.ceil(sets * (tours.length / all) - 1e-9));
  });
});

describe('v0.12.1 the offer crew check counts relief pilots', () => {
  it('augmented work needs its relief pilots: the offer’s own sets, and another programme’s held sets', () => {
    const g = fixtureGame();
    const acId = Object.keys(g.fleet)[0];
    const k = seasonBase(g, acId, 'HAM', 'PMI', [6 * 60, 12 * 60 + 30], 28);
    planAircraft(g, acId, g.now);
    addCrew(g, { CPT: 20, FO: 20, PUR: 10, CC: 30 });
    const t = g.fleet[acId].typeId;
    const win = [k.start + DAY, k.start + 15 * DAY] as const;
    // The offer itself: four pilots a set (200 BH a month: 6 captains with the reserve factor, not 4).
    const days = Math.ceil((win[1] - win[0]) / DAY);
    const two = crewAvailability(g, 'A320', t, win[0], win[1], 200);
    const four = crewAvailability(g, 'A320', t, win[0], win[1], 200, undefined, 0, undefined, 2);
    expect(two.byRole.CPT!.need).toBe(4 * days);
    expect(four.byRole.CPT!.need).toBe(6 * days);
    expect(four.byRole.FO!.need).toBe(6 * days);
    expect(four.byRole.PUR!.need).toBe(two.byRole.PUR!.need);
    // Another programme flown with four pilots holds its relief pilots too: fewer captains free for the offer.
    const h = structuredClone(g);
    for (const p of Object.values(h.pairings)) if (p.contractId === k.id) for (const id of p.dutyIds) if (h.duties[id]) h.duties[id].augment = 2;
    const held = crewAvailability(h, 'A320', t, win[0], win[1], 200);
    expect(held.byRole.CPT!.free).toBeLessThan(two.byRole.CPT!.free);
    expect(held.byRole.PUR!.free).toBe(two.byRole.PUR!.free);
  });
});

describe('v0.12.1 relief pilots of a base signed ahead', () => {
  /** A 747 base starting in 40 days: no flights or duties planned yet (they roll in 28 days ahead). */
  const ahead = (base: string, dest: string) => {
    const g = fixtureGame();
    const acId = devAddType(g, 'b744');
    if (!g.company.approvals.includes('augmented')) g.company.approvals.push('augmented');
    const pilots = () => {
      const n = familyNeeds(g).get('B747')!.need;
      return (n.CPT ?? 0) + (n.FO ?? 0) + (n.CRP ?? 0);
    };
    const before = pilots();
    const start = g.now + 40 * DAY;
    const k = fixtureContract(g, { aircraftIds: [acId], start, end: start + 60 * DAY, pattern: { kind: 'base', base, dests: [dest], from: start, to: start + 60 * DAY, targetBH: 300, waves: [8 * 60], prefix: 'NB', maintEvery: 7 } });
    expect(Object.values(g.flights).some((f) => f.contractId === k.id)).toBe(false);
    return { before, after: pilots(), aug: familyNeeds(g).get('B747')!.aug };
  };

  it('a base whose rotations need four pilots counts its relief pilots on every set before its duties roll in', () => {
    // Jeddah–Bangalore and back in one duty (seed 4 --b744 --aug): two captains and two first officers.
    const x = ahead('JED', 'BLR');
    expect(x.after).toBeGreaterThan(x.before);
    expect(x.aug).toBe(true);
  });

  it('a rotation no crew can fly as one duty is slipped at the far end: two pilots a set', () => {
    const x = ahead('LIS', 'EZE');
    expect(x.after).toBe(x.before);
    expect(x.aug).toBe(false);
  });
});
