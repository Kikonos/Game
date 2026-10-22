// Duties, deployments and the auto-roster (DESIGN §5.3; BUILD-PLAN B2 acceptance).

import { describe, expect, it } from 'vitest';
import { addFlight, retimeFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { Duty, GameState, Pairing } from '../core/types';
import { demoFlights, devFleet } from '../dev';
import { deserialize, serialize } from '../save';
import { settle } from '../sim';
import { evalSegs, LIMITS } from './rules';
import { ctxOf, segsOf } from './timeline';
import { addCrew, fixtureContract, fixtureGame, seasonBase } from './fixtures';
import { autoRoster, buildDuties, captainAsFo, crewWindows, dutyCandidates, flightCrewStatus, rosterOf } from '.';
import { canFill, seatLabel } from '../core/perf';

const scheduled = (g: GameState) => Object.values(g.flights).filter((f) => f.aircraftId && f.status === 'scheduled');
const crewedDuties = (g: GameState): Duty[] => Object.values(g.duties).filter((d) => g.pairings[d.pairingId]?.slots.some((s) => s.crewId));

/** Every crew member's planned timeline is legal (rest, FDP, windows, recovery). */
function allCrewLegal(g: GameState): string[] {
  const bad: string[] = [];
  for (const c of Object.values(g.crew)) {
    const issues = evalSegs(ctxOf(g, c), segsOf(g, c)).filter((i) => i.level === 'illegal');
    if (issues.length) bad.push(`${c.id}:${issues.map((i) => i.code).join(',')}`);
  }
  return bad;
}

/** Each crew member gets ≥ 36 h off (two local nights not checked here) in every 7 days of their planned roster. */
function weeklyRecovery(g: GameState, from: number, to: number): string[] {
  const bad: string[] = [];
  for (const c of Object.values(g.crew)) {
    const segs = segsOf(g, c).filter((s) => s.kind !== 'log' && s.end > from && s.start < to);
    if (segs.length < 2) continue;
    for (let w = from; w + 7 * DAY <= to; w += DAY) {
      const inW = segs.filter((s) => s.end > w && s.start < w + 7 * DAY);
      if (!inW.length) continue;
      let best = Math.max(inW[0].start - w, w + 7 * DAY - inW[inW.length - 1].end);
      for (let i = 1; i < inW.length; i++) best = Math.max(best, inW[i].start - inW[i - 1].end);
      if (best < LIMITS.recovery) {
        bad.push(c.id);
        break;
      }
    }
  }
  return bad;
}

describe('auto-roster: demo flights, 60 starting crew', () => {
  it('covers 100% of 14 days of flights with zero illegal duties, < 60 h/7 d and weekly recovery', () => {
    const g = fixtureGame();
    demoFlights(g, undefined, 14, 'revenue');
    const res = autoRoster(g, { to: g.now + 30 * DAY });
    expect(res.uncovered).toEqual([]);
    for (const f of scheduled(g)) expect(flightCrewStatus(g, f.id).level, f.no).toMatch(/ok|tight/);
    expect(Object.values(g.duties).filter((d) => d.legality === 'illegal')).toEqual([]);
    expect(Object.values(g.pairings).filter((p) => p.legality === 'illegal')).toEqual([]);
    expect(allCrewLegal(g)).toEqual([]);
    for (const c of Object.values(g.crew)) for (let d = 0; d < 21; d++) expect(crewWindows(g, c, g.now + d * DAY).duty7d).toBeLessThanOrEqual(60 * 60);
    expect(weeklyRecovery(g, g.now, g.now + 28 * DAY)).toEqual([]);
  });

  it('is deterministic', () => {
    const run = () => {
      const g = fixtureGame(9);
      demoFlights(g, undefined, 10, 'revenue');
      autoRoster(g);
      return JSON.stringify([g.pairings, g.duties, g.flights, g.queue]);
    };
    expect(run()).toBe(run());
  });

  it('survives a save round trip with the same roster reads', () => {
    const g = fixtureGame();
    demoFlights(g, undefined, 5, 'revenue');
    autoRoster(g);
    const h = deserialize(serialize(g));
    const c = Object.values(g.crew).find((x) => rosterOf(g, x.id, g.now, g.now + 7 * DAY).length)!;
    expect(rosterOf(h, c.id, h.now, h.now + 7 * DAY).map((d) => d.id)).toEqual(rosterOf(g, c.id, g.now, g.now + 7 * DAY).map((d) => d.id));
  });
});

describe('HAM–PMI season base (deployment)', () => {
  for (const [waves, sets] of [[[6 * 60, 12 * 60 + 30], 3], [[6 * 60, 12 * 60 + 30, 19 * 60], 4]] as const) {
    it(`${waves.length} waves, 28 days: HAM-only duties, ${sets} sets, tours rotate, full legal coverage`, () => {
      const g = fixtureGame();
      g.company.policies.rotationWeeks = 4;
      const ac = Object.keys(g.fleet)[0];
      const k = seasonBase(g, ac, 'HAM', 'PMI', [...waves], 28);
      const res = autoRoster(g, { to: g.now + 30 * DAY });
      const dep = Object.values(g.deployments).find((d) => d.contractId === k.id)!;
      expect(dep.setsOnStation).toBe(sets);
      const duties = Object.values(g.duties);
      expect(duties.length).toBeGreaterThan(20);
      for (const d of duties) {
        expect(g.flights[d.flightIds[0]].from).toBe('HAM');
        expect(d.restAt).toBe('HAM');
        expect(d.sectors).toBe(2);
      }
      expect(res.uncovered).toEqual([]);
      for (const f of scheduled(g)) expect(flightCrewStatus(g, f.id).level, `${f.no}`).toMatch(/ok|tight/);
      expect(duties.filter((d) => d.legality === 'illegal')).toEqual([]);
      expect(allCrewLegal(g)).toEqual([]);
      // Tours: ≤ rotationWeeks on station; sets change on different days; crews rotate (a set has 2 tours).
      const tours = dep.pairingIds.map((id) => g.pairings[id]);
      const R = 4 * 7 * DAY;
      for (const p of tours) {
        expect(p.tour!.to - p.tour!.from).toBeLessThanOrEqual(R);
        expect(p.end - p.start).toBeLessThanOrEqual(R);
      }
      const bySet = new Map<number, Pairing[]>();
      for (const p of tours) bySet.set(p.tour!.set, [...(bySet.get(p.tour!.set) ?? []), p]);
      expect([...bySet.values()].some((l) => l.length >= 2)).toBe(true);
      const changes = tours.filter((p) => p.tour!.from > dep.start).map((p) => p.tour!.from);
      expect(new Set(changes).size).toBe(changes.length);
      for (const l of bySet.values()) if (l.length >= 2) expect(l[0].slots.map((s) => s.crewId)).not.toEqual(l[1].slots.map((s) => s.crewId));
      // Crew are positioned to HAM by ticket (client-paid on a wet lease).
      const tickets = Object.values(g.flights).filter((f) => f.kind === 'deadhead');
      expect(tickets.some((f) => f.from === 'LIS' && f.to === 'HAM')).toBe(true);
      expect(tickets.every((f) => f.cost === 0)).toBe(true);
      expect(g.finance.current.lines.deadhead ?? 0).toBe(0);
    });
  }
});

describe('changes through core helpers', () => {
  it('retiming a flight moves its duty (settle), without any call from ops', () => {
    const g = fixtureGame();
    demoFlights(g, undefined, 4, 'revenue');
    autoRoster(g);
    const d = crewedDuties(g).sort((a, b) => a.report - b.report).find((x) => x.report > g.now + DAY)!;
    const { report, release, ev } = d;
    for (const id of d.flightIds) {
      const f = g.flights[id];
      retimeFlight(g, f, f.std + 30, f.sta + 30);
    }
    settle(g);
    expect(g.duties[d.id].report).toBe(report + 30);
    expect(g.duties[d.id].release).toBe(release + 30);
    expect(g.duties[d.id].ev).toBeGreaterThan(ev);
    expect(g.queue.some((e) => e.type === 'duty.release' && e.id === d.id && e.v === g.duties[d.id].ev && e.t === release + 30)).toBe(true);
  });

  /** One A320 set only; out-and-backs LIS–FAO at 14:00 (day 2) and 06:00 (day 3): 12 h 10 rest in between. */
  const tightPair = () => {
    const g = fixtureGame();
    const keep = new Set<string>();
    for (const role of ['CPT', 'FO', 'PUR', 'CC', 'CC', 'CC'] as const) keep.add(Object.values(g.crew).find((c) => c.role === role && !keep.has(c.id))!.id);
    for (const id of Object.keys(g.crew)) if (!keep.has(id)) delete g.crew[id];
    const ac = Object.values(g.fleet)[0];
    const day = Math.floor(g.now / DAY) * DAY;
    const legs: [number, string, string][] = [[2 * DAY + 14 * 60, 'LIS', 'FAO'], [2 * DAY + 15 * 60 + 35, 'FAO', 'LIS'], [3 * DAY + 6 * 60, 'LIS', 'FAO'], [3 * DAY + 7 * 60 + 35, 'FAO', 'LIS']];
    for (const [t, from, to] of legs) addFlight(g, { no: `AW${t}`, aircraftId: ac.id, contractId: null, kind: 'revenue', from, to, std: day + t, sta: day + t + 45 });
    autoRoster(g);
    const [d2, d3] = Object.values(g.duties).sort((a, b) => a.report - b.report);
    const crewOf = (d: Duty) => g.pairings[d.pairingId].slots.map((s) => s.crewId);
    expect(crewOf(d3)).toEqual(crewOf(d2));
    const delay = () => {
      for (const id of d2.flightIds) retimeFlight(g, g.flights[id], g.flights[id].std + 240, g.flights[id].sta + 240);
      settle(g);
    };
    return { g, d2, d3, delay, crewOf };
  };

  it('a 4 h delay rerosters: the next duty stays legal by swapping to standby crew', () => {
    const { g, d2, delay } = tightPair();
    const first = g.pairings[d2.pairingId].slots.map((s) => s.crewId);
    addCrew(g, { CPT: 1, FO: 1, PUR: 1, CC: 3 });
    delay();
    expect(g.duties[d2.id].report).toBe(d2.report);
    const [a, b] = Object.values(g.duties).sort((x, y) => x.report - y.report);
    expect(a.report).toBeGreaterThan(g.now + 2 * DAY + 14 * 60);
    const crewA = g.pairings[a.pairingId].slots.map((s) => s.crewId);
    const crewB = g.pairings[b.pairingId].slots.map((s) => s.crewId);
    expect(crewA.every(Boolean) && crewB.every(Boolean)).toBe(true);
    expect(crewB.some((id) => first.includes(id))).toBe(false);
    expect(allCrewLegal(g)).toEqual([]);
    for (const f of scheduled(g)) expect(flightCrewStatus(g, f.id).level).toMatch(/ok|tight/);
  });

  it('a 4 h delay with nobody to swap flags the next duty', () => {
    const { g, delay } = tightPair();
    delay();
    expect(allCrewLegal(g)).toEqual([]);
    const [, b] = Object.values(g.duties).sort((x, y) => x.report - y.report);
    expect(flightCrewStatus(g, b.flightIds[0]).level).toMatch(/missing|illegal/);
  });
});

describe('augmentation', () => {
  const longHaul = (approved: boolean) => {
    const g = fixtureGame();
    if (approved) g.company.approvals.push('augmented');
    const ac = Object.values(g.fleet)[0];
    ac.typeId = 'a333';
    ac.cabin = { ...ac.cabin, total: 300, y: 300, j: 0, w: 0 };
    ac.crewRest = { bunks: true, seats: 0 };
    addCrew(g, { CPT: 3, FO: 4, PUR: 4, CC: 14 }, 'A330/340');
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 20 * 60;
    fixtureContract(g, { aircraftIds: [ac.id], start: std, end: std + DAY, pattern: { kind: 'legs', legs: [] }, product: { kind: 'charter', price: 1, depositPct: 0, balanceDaysBefore: 0, fuelEscalation: false } });
    const f = { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue' as const, from: 'LIS', to: 'GRU', std, sta: std + 12 * 60 + 30 };
    return { g, ac, f };
  };
  it('a 12 h sector is augmented (CRP slot) with the approval and illegal without', () => {
    for (const approved of [true, false]) {
      const { g, ac, f } = longHaul(approved);
      addFlight(g, f);
      const [d] = buildDuties(g, ac.id, g.now, g.now + 5 * DAY);
      const p = g.pairings[d.pairingId];
      if (approved) {
        expect(d.augment).toBe(1);
        expect(d.legality).not.toBe('illegal');
        expect(p.slots.map((s) => s.role)).toContain('CRP');
        const res = autoRoster(g, { aircraftIds: [ac.id] });
        expect(res.uncovered).toEqual([]);
        expect(flightCrewStatus(g, d.flightIds[0]).level).toMatch(/ok|tight/);
      } else {
        expect(d.augment).toBe(0);
        expect(d.legality).toBe('illegal');
        expect(p.slots.map((s) => s.role)).not.toContain('CRP');
        expect(flightCrewStatus(g, d.flightIds[0]).level).toBe('illegal');
      }
    }
  });
});

describe('deadheads', () => {
  const awayTrip = (wet: boolean) => {
    const g = fixtureGame();
    const ac = Object.values(g.fleet)[0];
    ac.at = 'FAO';
    const k = wet ? fixtureContract(g, { aircraftIds: [ac.id], start: g.now, end: g.now + 5 * DAY, pattern: { kind: 'legs', legs: [] } }) : null;
    return { g, ac, k };
  };
  it('positions crew away from the first departure with one ticket per group and posts the cost', () => {
    const { g, ac } = awayTrip(false);
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * 60;
    addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FAO', to: 'FNC', std, sta: std + 110 });
    addFlight(g, { no: 'AW2', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FNC', to: 'FAO', std: std + 160, sta: std + 270 });
    const cash = g.company.cash;
    const res = autoRoster(g);
    expect(res.uncovered).toEqual([]);
    const tickets = Object.values(g.flights).filter((f) => f.kind === 'deadhead');
    const out = tickets.filter((f) => f.from === 'LIS' && f.to === 'FAO');
    const home = tickets.filter((f) => f.from === 'FAO' && f.to === 'LIS');
    expect(out).toHaveLength(1);
    expect(home).toHaveLength(1);
    expect(out[0].crewIds).toHaveLength(6);
    expect(out[0].sta).toBeLessThanOrEqual(std - 60 - 60);
    expect(res.cost).toBe(2 * 6 * 250);
    expect(g.finance.current.lines.deadhead).toBe(-res.cost);
    expect(g.company.cash).toBe(cash - res.cost);
    const d = Object.values(g.duties)[0];
    expect(d.deadheadIds).toContain(out[0].id);
  });

  it('a trip of empty legs flies with its pilots only (cabin crew only when passengers are carried)', () => {
    const { g, ac } = awayTrip(false);
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * 60;
    addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'FAO', to: 'LIS', std, sta: std + 70 });
    autoRoster(g);
    const d = Object.values(g.duties)[0];
    expect(g.pairings[d.pairingId].slots.map((s) => s.role)).toEqual(['CPT', 'FO']);
  });

  it('pilots stay at the hotel for a ferry out of the station next day instead of flying home and back out', () => {
    const g = fixtureGame();
    const ac = Object.values(g.fleet)[0];
    ac.at = 'LIS';
    const day = Math.floor(g.now / DAY) * DAY;
    // A short operating day into ZAG (its ticket home would leave the same evening), the ferry back 30 h later.
    const std = day + 2 * DAY + 8 * 60;
    addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'ZAG', std, sta: std + 185 });
    addFlight(g, { no: 'AW2', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'ZAG', to: 'LIS', std: std + 30 * 60, sta: std + 30 * 60 + 185 });
    const res = autoRoster(g);
    expect(res.uncovered).toEqual([]);
    const ps = Object.values(g.pairings).sort((a, b) => a.start - b.start);
    expect(ps).toHaveLength(2);
    const pilots = (p: Pairing) => p.slots.filter((x) => x.role === 'CPT' || x.role === 'FO').map((x) => x.crewId).sort();
    expect(pilots(ps[1])).toEqual(pilots(ps[0]));
    const tickets = Object.values(g.flights).filter((f) => f.kind === 'deadhead' && f.status !== 'cancelled');
    for (const id of pilots(ps[0])) expect(tickets.filter((f) => f.crewIds.includes(id!))).toEqual([]);
    // Cabin crew aren't needed on the ferry: they go home by ticket.
    expect(tickets.some((f) => f.from === 'ZAG' && f.to === 'LIS' && f.crewIds.length === 4)).toBe(true);
    expect(allCrewLegal(g)).toEqual([]);
  });

  it('wet leases: the client buys crew tickets (no cost to us)', () => {
    const { g, ac, k } = awayTrip(true);
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * 60;
    addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: k!.id, kind: 'revenue', from: 'FAO', to: 'FNC', std, sta: std + 110 });
    addFlight(g, { no: 'AW2', aircraftId: ac.id, contractId: k!.id, kind: 'revenue', from: 'FNC', to: 'FAO', std: std + 160, sta: std + 270 });
    const res = autoRoster(g);
    expect(res.deadheads).toBe(2);
    expect(res.cost).toBe(0);
    expect(g.finance.current.lines.deadhead ?? 0).toBe(0);
  });
});

describe('performance', () => {
  const month = () => {
    const g = fixtureGame();
    devFleet(g, 4);
    addCrew(g, { CPT: 10, FO: 10, PUR: 10, CC: 30 });
    demoFlights(g, undefined, 30, 'revenue');
    return g;
  };
  it('rosters a month of flights for 4 aircraft and ~120 crew quickly (50 ms target, 120 ms budget), deterministically', () => {
    // Best of 6 fresh games (the first is the JIT warm-up), so parallel test files don't make it flaky.
    const times: number[] = [];
    const sigs: string[] = [];
    for (let k = 0; k < 6; k++) {
      const g = month();
      const t0 = performance.now();
      const res = autoRoster(g, { to: g.now + 31 * DAY });
      times.push(performance.now() - t0);
      expect(res.uncovered).toEqual([]);
      expect(Object.keys(g.crew).length).toBe(120);
      sigs.push(JSON.stringify(Object.values(g.pairings).map((p) => p.slots.map((s) => s.crewId))));
    }
    console.log(`autoRoster (month, 4 aircraft, 120 crew): ${times.map((t) => t.toFixed(1)).join(' / ')} ms (target 50 ms)`);
    expect(new Set(sigs).size).toBe(1);
    // v0.7 C5: the 50 ms target stays in the log; the assertion budget is 120 ms (load from parallel files).
    expect(Math.min(...times)).toBeLessThan(120);
  });
});

describe('flights added outside an accept', () => {
  it('are planned and crewed at the next settle (auto-roster policy on), not only at midnight', () => {
    const g = fixtureGame();
    demoFlights(g, undefined, 2, 'revenue');
    expect(Object.keys(g.pairings)).toHaveLength(0);
    settle(g);
    expect(scheduled(g).filter((f) => !f.crewIds.length)).toEqual([]);
    const n = Object.keys(g.pairings).length;
    settle(g);
    expect(Object.keys(g.pairings)).toHaveLength(n);
    // Policy off: planned (visible as uncovered) but not crewed.
    const h = fixtureGame();
    h.company.policies.autoRoster = false;
    demoFlights(h, undefined, 2);
    settle(h);
    expect(Object.keys(h.pairings).length).toBeGreaterThan(0);
    expect(scheduled(h).every((f) => !f.crewIds.length)).toBe(true);
  });
});

describe('v0.7.2 captains flying as first officers', () => {
  const oneDay = (keepFo: boolean) => {
    const g = fixtureGame();
    for (const c of Object.values(g.crew)) if (c.role === 'FO' && !keepFo) delete g.crew[c.id];
    const ac = Object.values(g.fleet)[0];
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 8 * 60;
    addFlight(g, { no: 'AW7', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'FAO', std, sta: std + 60 });
    addFlight(g, { no: 'AW8', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FAO', to: 'LIS', std: std + 120, sta: std + 180 });
    const [d] = buildDuties(g, ac.id, g.now, g.now + 5 * DAY);
    autoRoster(g, { aircraftIds: [ac.id] });
    const p = g.pairings[g.duties[d.id].pairingId];
    return { g, p };
  };
  it('an FO seat with no FO free gets a captain (CPT (as FO)); with an FO free, the FO; never an FO as captain', () => {
    const none = oneDay(false);
    const fo = none.p.slots.find((s) => s.role === 'FO')!;
    expect(none.g.crew[fo.crewId!].role).toBe('CPT');
    expect(seatLabel(fo.role, none.g.crew[fo.crewId!].role)).toBe('CPT (as FO)');
    const cpt = none.p.slots.find((s) => s.role === 'CPT')!;
    expect(none.g.crew[cpt.crewId!].role).toBe('CPT');
    const some = oneDay(true);
    expect(some.g.crew[some.p.slots.find((s) => s.role === 'FO')!.crewId!].role).toBe('FO');
    expect(canFill('CPT', 'FO')).toBe(false);
    expect(canFill('FO', 'CPT')).toBe(true);
  });
  it('the duty picker lists captains for an FO seat after the first officers, labelled', () => {
    const { g, p } = oneDay(true);
    const list = dutyCandidates(g, p.dutyIds[0], 'FO');
    const caps = list.filter((c) => c.role === 'CPT');
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.every((c) => c.asFo && c.reasons.includes('Captain flying as FO'))).toBe(true);
    expect(list.filter((c) => c.role === 'FO').every((c) => !c.asFo)).toBe(true);
    // Within each legality level the first officers come first.
    for (const lv of ['legal', 'tight', 'illegal'] as const) {
      const row = list.filter((c) => c.level === lv);
      const k = row.findIndex((c) => c.asFo);
      if (k >= 0) expect(row.slice(k).every((c) => c.asFo)).toBe(true);
    }
  });
  it('morale: free twice in 30 days, −3 from the third time; counted in stats', () => {
    const g = fixtureGame();
    const c = Object.values(g.crew).find((x) => x.role === 'CPT')!;
    const m0 = c.morale;
    captainAsFo(g, c, g.now);
    captainAsFo(g, c, g.now);
    expect(c.morale).toBe(m0);
    captainAsFo(g, c, g.now);
    expect(c.morale).toBe(m0 - 3);
    expect(g.stats.asFo).toBe(3);
  });
});
