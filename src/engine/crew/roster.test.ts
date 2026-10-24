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
import { recheckSoon } from './roster';
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

/**
 * ORO.FTL.235(d) recurrent extended recovery: a rest of ≥ 36 h (two local nights not checked here) at most 168 h after
 * the end of the previous one, over the planned roster (v0.9: standby is work, not rest). The roster's start counts as
 * the end of a rest.
 */
function weeklyRecovery(g: GameState, from: number, to: number): string[] {
  const bad: string[] = [];
  for (const c of Object.values(g.crew)) {
    const segs = segsOf(g, c).filter((s) => s.kind !== 'log' && s.end > from && s.start < to);
    if (segs.length < 2) continue;
    let lastEnd = Math.max(from, c.lastRecovery);
    let prev = from;
    for (const s of segs) {
      if (s.start - prev >= LIMITS.recovery) lastEnd = s.start;
      else if (s.start - lastEnd > LIMITS.recoveryEvery) {
        bad.push(c.id);
        break;
      }
      prev = Math.max(prev, s.end);
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
    // v0.9: no planned days off or standby in the way (roster planning: dayPlan.test.ts).
    for (const c of Object.values(g.crew)) {
      c.off = [];
      delete c.standby;
      delete c.blocks;
    }
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
    for (const id of addCrew(g, { CPT: 1, FO: 1, PUR: 1, CC: 3 })) g.crew[id].off = [];
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
    ac.rest = { fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 1, kind: 'ldmcr', places: 7 } };
    for (const id of addCrew(g, { CPT: 3, FO: 4, PUR: 4, CC: 14 }, 'A330/340')) g.crew[id].off = [];
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

describe('v0.9 round 3: the ticket home after a late release', () => {
  it('a release that leaves the free time before the ticket home short of the 60 h recovery (4 night duties) rebooks the ticket after it', async () => {
    const { recheckAfterRelease } = await import('./roster');
    const { BAL } = await import('../core/balance');
    const g = fixtureGame();
    const ac = Object.values(g.fleet)[0];
    ac.at = 'FAO';
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * 60;
    const a1 = addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FAO', to: 'FNC', std, sta: std + 110 });
    addFlight(g, { no: 'AW2', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FNC', to: 'FAO', std: std + 160, sta: std + 270 });
    autoRoster(g);
    const d = g.duties[a1.dutyId!];
    const p = g.pairings[d.pairingId];
    const home = Object.values(g.flights).find((f) => f.kind === 'deadhead' && f.from === 'FAO' && f.to === 'LIS' && f.status === 'scheduled')!;
    expect(home).toBeDefined();
    const c = g.crew[home.crewIds[0]];
    // Four night duties since the last recovery rest (the next one must be 60 h), then this duty, released at R.
    const R = d.release;
    const H = 60;
    c.lastRecovery = R - 5 * DAY;
    c.log = [1, 2, 3, 4].map((k) => ({ start: R - (5 - k) * DAY - 20 * H, end: R - (5 - k) * DAY - 14 * H, fdp: 6 * H, block: 4 * H, sectors: 2, augmented: false, disruptive: true }));
    c.log.push({ start: d.report, end: R, fdp: R - d.report, block: 220, sectors: 2, augmented: false, disruptive: false });
    d.done = true;
    for (const id of d.flightIds) g.flights[id].status = 'done';
    // The ticket home 59 h 40 m after the release (a 20 min late release ate the recovery) lands past the 168 h.
    const ci = BAL.deadheadCheckIn;
    const blk = home.sta - home.std;
    home.std = R + 59 * H + 40 + ci;
    home.sta = home.std + blk;
    g.now = R + 10;
    const { touchTickets } = await import('../core/entities');
    touchTickets(g);
    expect(evalSegs(ctxOf(g, c), segsOf(g, c)).some((i) => i.code === 'recovery' && i.level === 'illegal')).toBe(true);
    recheckAfterRelease(g, p);
    const mine = Object.values(g.flights).filter((f) => f.kind === 'deadhead' && f.status === 'scheduled' && f.crewIds.includes(c.id) && f.from === 'FAO');
    expect(mine).toHaveLength(1);
    expect(mine[0].std - ci - R).toBeGreaterThanOrEqual(LIMITS.recoveryLong);
    // Nothing but the standby windows the day planner re-fits (they give way to the later ticket) breaks the 168 h.
    const work = segsOf(g, c).filter((x) => !(x.kind === 'sby' && x.start > g.now));
    expect(evalSegs(ctxOf(g, c), work).filter((i) => i.code === 'recovery' && i.level === 'illegal')).toEqual([]);
    // The others aboard (no night duties behind them) keep their ticket.
    expect(home.crewIds.length).toBeGreaterThan(0);
    expect(home.crewIds).not.toContain(c.id);
  });
});

describe('v0.9.1: a stand-alone ticket home counts on the 168 h', () => {
  it('a ticket home no duty holds (its duty sub-chartered) landing past the 168 h is moved to the first seat after the rest', async () => {
    const { rebookLooseTickets } = await import('./roster');
    const { BAL } = await import('../core/balance');
    const { touchTickets } = await import('../core/entities');
    const { touchCrew } = await import('./timeline');
    const g = fixtureGame();
    const ac = Object.values(g.fleet)[0];
    ac.at = 'FAO';
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * 60;
    const a1 = addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FAO', to: 'FNC', std, sta: std + 110 });
    addFlight(g, { no: 'AW2', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FNC', to: 'FAO', std: std + 160, sta: std + 270 });
    autoRoster(g);
    const d = g.duties[a1.dutyId!];
    const home = Object.values(g.flights).find((f) => f.kind === 'deadhead' && f.from === 'FAO' && f.to === 'LIS' && f.status === 'scheduled')!;
    expect(home).toBeDefined();
    const c = g.crew[home.crewIds[0]];
    const R = d.release;
    const H = 60;
    // Seed 2: the last duty released 144 h after the last recovery rest; the trip's next duty went to a sub-charter
    // and its ticket home, the next day, stayed with nobody's duty (landing at 171 h).
    c.lastRecovery = R - 144 * H;
    c.log = [1, 2, 3].map((k) => ({ start: R - k * DAY - 14 * H, end: R - k * DAY - 6 * H, fdp: 8 * H, block: 6 * H, sectors: 2, augmented: false, disruptive: false }));
    c.log.push({ start: d.report, end: R, fdp: R - d.report, block: 220, sectors: 2, augmented: false, disruptive: false });
    c.restUntil = R + 10 * H;
    d.done = true;
    for (const id of d.flightIds) g.flights[id].status = 'done';
    d.deadheadIds = d.deadheadIds.filter((x) => x !== home.id);
    const ci = BAL.deadheadCheckIn;
    const blk = home.sta - home.std;
    home.std = R + 23 * H + ci;
    home.sta = home.std + blk;
    g.now = R + 10;
    touchTickets(g);
    touchCrew(g);
    expect(evalSegs(ctxOf(g, c), segsOf(g, c)).some((i) => i.code === 'recovery' && i.level === 'illegal')).toBe(true);
    rebookLooseTickets(g);
    const mine = Object.values(g.flights).filter((f) => f.kind === 'deadhead' && f.status === 'scheduled' && f.crewIds.includes(c.id) && f.from === 'FAO');
    expect(mine).toHaveLength(1);
    expect(mine[0].sta).toBeLessThanOrEqual(c.lastRecovery + LIMITS.recoveryEvery - 60);
    expect(mine[0].std).toBeGreaterThanOrEqual(c.restUntil);
    const work = segsOf(g, c).filter((x) => !(x.kind === 'sby' && x.start > g.now));
    expect(evalSegs(ctxOf(g, c), work).filter((i) => i.code === 'recovery' && i.level === 'illegal')).toEqual([]);
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
  /**
   * v0.9 round 3: a fixed pure-JS workload (allocate, sort, hash 20,000 records) timed next to each roster run. On an
   * idle machine it takes about CALIB_IDLE_MS (8–9 ms on the dev container); when parallel test files load the machine both slow down alike, so the
   * budget is scaled by how much slower the reference ran (never below the 120 ms budget itself).
   */
  const CALIB_IDLE_MS = 9;
  const calibrate = (): number => {
    const t0 = performance.now();
    let acc = 0;
    const a = Array.from({ length: 20_000 }, (_, i) => ({ k: (i * 7919) % 20_011, v: i }));
    a.sort((x, y) => x.k - y.k);
    const m = new Map(a.map((x) => [x.k, x.v]));
    for (const [k, v] of m) acc += k ^ v;
    if (acc === 42) throw new Error('unreachable');
    return performance.now() - t0;
  };
  it('rosters a month of flights for 4 aircraft and ~120 crew quickly (50 ms target, 120 ms budget scaled to the load), deterministically', () => {
    const measure = () => {
      // Best of 6 fresh games (the first is the JIT warm-up), so parallel test files don't make it flaky.
      const times: number[] = [];
      const ref: number[] = [];
      const sigs: string[] = [];
      for (let k = 0; k < 6; k++) {
        const g = month();
        ref.push(calibrate());
        const t0 = performance.now();
        const res = autoRoster(g, { to: g.now + 31 * DAY });
        times.push(performance.now() - t0);
        expect(res.uncovered).toEqual([]);
        expect(Object.keys(g.crew).length).toBe(120);
        sigs.push(JSON.stringify(Object.values(g.pairings).map((p) => p.slots.map((s) => s.crewId))));
      }
      expect(new Set(sigs).size).toBe(1);
      const load = Math.max(1, Math.min(...ref) / CALIB_IDLE_MS);
      return { best: Math.min(...times), budget: 120 * load, times, load };
    };
    // v0.7 C5: the 50 ms target stays in the log; the assertion budget is 120 ms on an idle machine. One retry: a
    // burst of load from another file can land on the roster runs and miss the reference.
    let r = measure();
    if (r.best >= r.budget) r = measure();
    console.log(`autoRoster (month, 4 aircraft, 120 crew): ${r.times.map((t) => t.toFixed(1)).join(' / ')} ms (target 50 ms, budget ${r.budget.toFixed(0)} ms at load ×${r.load.toFixed(2)})`);
    expect(r.best).toBeLessThan(r.budget);
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

describe('v0.9 round 5: a crewed tour never grows onto leave', () => {
  it('a duty on a tour crew member\'s leave goes to another set or flies as a trip; the crew member is not on it', () => {
    const g = fixtureGame();
    g.company.policies.rotationWeeks = 4;
    const ac = Object.keys(g.fleet)[0];
    seasonBase(g, ac, 'HAM', 'PMI', [6 * 60, 12 * 60 + 30], 28);
    // The first 16 days built and crewed; a tour crew member then takes leave over days 20–23.
    autoRoster(g, { to: g.now + 16 * DAY });
    const p = Object.values(g.pairings).filter((x) => x.tour && x.slots.every((s) => s.crewId)).sort((a, b) => a.start - b.start)[0];
    const c = g.crew[p.slots[0].crewId!];
    const day0 = Math.floor(g.now / DAY) * DAY;
    const leave = { from: day0 + 20 * DAY, to: day0 + 24 * DAY, why: 'leave' as const, annual: true as const };
    c.blocks = [...(c.blocks ?? []), leave];
    autoRoster(g, { to: g.now + 30 * DAY });
    // The daily re-check: a tour that grew past the leave splits at the first duty after it (that part re-crewed).
    recheckSoon(g);
    const onLeave = Object.values(g.duties).filter((d) => d.report < leave.to && d.release > leave.from);
    expect(onLeave.length).toBeGreaterThan(2);
    for (const d of onLeave) expect(g.pairings[d.pairingId]?.slots.some((s) => s.crewId === c.id), d.id).toBe(false);
    // Nor does any tour of theirs span the leave (the crew stay at the station from first duty to last).
    for (const q of Object.values(g.pairings)) {
      if (!q.slots.some((s) => s.crewId === c.id)) continue;
      expect(q.start < leave.to && q.end > leave.from, `${q.id} ${q.start}–${q.end}`).toBe(false);
    }
    expect(allCrewLegal(g).filter((x) => x.includes(c.id))).toEqual([]);
  });
});
