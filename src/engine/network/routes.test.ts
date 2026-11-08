// v0.19 scheduled routes (UPDATE-0.19.md §P): the launch, sales, revenue at departure, costs, conflicts, moves and
// cancels on a real game.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import { createGame } from '../newGame';
import { advanceTo } from '../sim';
import { legCostEstimate } from '../ops/flights';
import {
  businessCase, cancelRotation, caseDraft, decideCase, devLaunchRoute, materialise, moveRotation, quoteCancelRotation, quoteMoveRotation,
  recommendation, routeConflicts, rotationChoices, routeLegCost, sectorLive, startStudy,
} from '.';
import type { GameState } from '../core/types';

const newGame = (seed = 3) => createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });
const biggest = (g: GameState) => Object.values(g.fleet).sort((a, b) => b.cabin.total - a.cabin.total)[0];
const run = (g: GameState, days: number) => {
  const end = g.now + days * DAY;
  while (g.now < end) advanceTo(g, Math.min(end, g.now + DAY), new Set());
};

describe('v0.19 the launch', () => {
  it('the study, the recommendation and the business case; Go starts the stages; sales open; costs are booked', () => {
    const g = newGame(11);
    const cash0 = g.company.cash;
    const res = startStudy(g, 'LIS-OXB', 'desk');
    expect(res.routeId).toBeTruthy();
    const r = g.network!.routes[res.routeId!];
    expect(r.status).toBe('study');
    expect(g.finance.current.lines.marketing).toBe(-15_000);
    expect(startStudy(g, 'LIS-OXB', 'desk').why).toMatch(/launching/);
    run(g, 20);
    expect(r.status).toBe('case');
    expect(r.study!.est!.p10).toBeLessThan(r.study!.est!.p50);
    expect(r.study!.est!.p50).toBeLessThan(r.study!.est!.p90);
    const rec = recommendation(g, r.id)!;
    expect(rec.why.length).toBeGreaterThan(0);
    expect(rec.months).toHaveLength(12);
    const d = caseDraft(g, r.id)!;
    d.typeId = biggest(g).typeId;
    d.layout = biggest(g).cabin.layout;
    const bc = businessCase(g, r.id, d)!;
    // Less demand earns less (a full aircraft at P50 and P90 earns about the same: the payload goes to people, not cargo).
    expect(bc.p10.rev).toBeLessThanOrEqual(bc.p50.rev + 0.02 * bc.p50.rev);
    expect(bc.p10.result).toBeLessThanOrEqual(bc.p90.result + 0.02 * bc.p90.rev);
    expect(bc.launchCost).toBeGreaterThan(50_000);
    // A deviation says what it does.
    const two = businessCase(g, r.id, { ...d, days: d.days | (1 << 1) })!;
    expect(two.notes.join(' ')).toMatch(/flights|Tuesday|load/i);
    expect(decideCase(g, r.id, 'go', d)).toBeNull();
    expect(r.status).toBe('launching');
    const go = g.now;
    run(g, 200);
    expect(['onSale', 'operating']).toContain(r.status);
    const filed = r.stages.find((s) => s.id === 'filing')!;
    expect(filed.state).toBe('done');
    expect((r.firstFlight! - go) / (7 * DAY)).toBeGreaterThanOrEqual(10);
    expect((r.firstFlight! - go) / (7 * DAY)).toBeLessThanOrEqual(30);
    const spent = r.stages.reduce((a, s) => a + s.cost, 0);
    expect(spent).toBeGreaterThan(30_000);
    expect(g.company.cash).toBeLessThan(cash0 + r.unearned);
  });

  it('shelve keeps the study a year: a new study of the market reopens the case at once', () => {
    const g = newGame(12);
    const id = startStudy(g, 'LIS-RAI', 'desk').routeId!;
    run(g, 20);
    expect(decideCase(g, id, 'shelve')).toBeNull();
    const again = startStudy(g, 'LIS-RAI', 'desk').routeId!;
    expect(g.network!.routes[again].status).toBe('case');
  });
});

describe('v0.19 sales, revenue and costs', () => {
  it('ticket cash is held as unearned and earned at departure; route sectors cost by station; other legs as before', () => {
    const g = newGame(13);
    const ac = biggest(g);
    const id = devLaunchRoute(g, 'LIS-OXB', ac.id);
    const r = g.network!.routes[id];
    run(g, 2);
    const sold = r.rotations.reduce((a, x) => a + x.sectors.reduce((b, s) => b + (s.sold ?? 0), 0), 0);
    expect(r.unearned).toBeGreaterThan(0);
    expect(Math.abs(r.unearned - sold)).toBeLessThan(r.rotations.length * 4);
    const flightIds = r.rotations.flatMap((x) => x.sectors.map((s) => s.flightId)).filter((x): x is string => !!x);
    expect(flightIds.length).toBeGreaterThan(0);
    const f = g.flights[flightIds[0]];
    const rc = routeLegCost(g, f, ac);
    expect(rc.fuel).toBeGreaterThan(0);
    expect(rc.handling).toBeGreaterThan(0);
    expect(rc.navCharges).toBeGreaterThan(0);
    const est = legCostEstimate(g, f, ac);
    expect(est.fees).toBeCloseTo(rc.fees + rc.handling + rc.catering + rc.paxServices + rc.navCharges + rc.distribution, 0);
    const other = Object.values(g.flights).find((x) => !x.sched && x.aircraftId && x.kind === 'revenue');
    if (other) {
      const o = legCostEstimate(g, other, g.fleet[other.aircraftId!]);
      expect(o.fees).toBeGreaterThanOrEqual(0);
    }
    const live = sectorLive(g, f.id)!;
    expect(live.paxY).toBeGreaterThanOrEqual(0);
    expect(live.next).toBeDefined();
    const unearned0 = r.unearned;
    const tickets0 = g.finance.current.lines.ticketRevenue ?? 0;
    run(g, 20);
    const flown = r.rotations.filter((x) => x.status === 'flown');
    expect(flown.length).toBeGreaterThan(0);
    const earned = (g.finance.current.lines.ticketRevenue ?? 0) + g.finance.history.slice(-1).reduce((a, s) => a + (s.lines.ticketRevenue ?? 0), 0) - tickets0;
    expect(earned).toBeGreaterThan(0);
    expect(r.unearned).toBeGreaterThanOrEqual(0);
    void unearned0;
    for (const x of flown) for (const s of x.sectors) {
      expect(s.accrued).toBe(true);
      expect(s.cost).toBeGreaterThan(0);
      expect((s.flownJ ?? 0) + (s.flownY ?? 0)).toBeLessThanOrEqual(s.capJ + s.capY);
    }
  });

  it('determinism: the same seed gives the same route', () => {
    const play = () => {
      const g = newGame(14);
      const id = devLaunchRoute(g, 'LIS-OXB', biggest(g).id);
      run(g, 30);
      const r = g.network!.routes[id];
      return JSON.stringify({ u: r.unearned, rep: r.reputation, pnl: r.pnl, cash: g.company.cash });
    };
    expect(play()).toBe(play());
  });
});

describe('v0.19 moves, cancels and conflicts', () => {
  it('a move retimes every sector by the same minutes; a cancel refunds the tickets; the conflict lists four choices', () => {
    const g = newGame(15);
    const ac = biggest(g);
    const id = devLaunchRoute(g, 'LIS-OXB', ac.id);
    const r = g.network!.routes[id];
    run(g, 1);
    materialise(g, r);
    const rot = r.rotations.find((x) => x.status === 'flights' && x.dep > g.now + 20 * DAY)!;
    expect(rot).toBeDefined();
    const before = rot.sectors.map((s) => g.flights[s.flightId!].std);
    const q = quoteMoveRotation(g, rot.id, 120);
    expect(q.ok).toBe(true);
    expect(moveRotation(g, rot.id, 120)).toBe(true);
    rot.sectors.forEach((s, i) => expect(g.flights[s.flightId!].std).toBe(before[i] + 120));
    const confl = routeConflicts(g, ac.id, rot.dep - DAY, rot.dep + DAY);
    expect(confl.map((c) => c.rotId)).toContain(rot.id);
    const ch = rotationChoices(g, rot.id, { aircraftId: ac.id, from: rot.dep - 60, to: rot.dep + 600 });
    expect(ch.map((c) => c.choice).sort()).toEqual(['cancel', 'move', 'sub', 'swap']);
    expect(ch.find((c) => c.choice === 'sub')!.why).toMatch(/no penalty/);
    const cq = quoteCancelRotation(g, rot.id);
    const cash0 = g.company.cash;
    const unearned0 = r.unearned;
    expect(cancelRotation(g, rot.id)).toBe(true);
    expect(rot.status).toBe('cancelled');
    expect(Math.round(unearned0 - r.unearned)).toBe(cq.refunds);
    expect(Math.round(cash0 - g.company.cash)).toBe(cq.refunds + cq.cost);
    expect(rot.sectors.every((s) => !s.flightId)).toBe(true);
  });

  it('a rotation half flown cannot be cancelled (the aircraft and its passengers are away)', () => {
    const g = newGame(15);
    const id = devLaunchRoute(g, 'LIS-OXB', biggest(g).id);
    const r = g.network!.routes[id];
    run(g, 1);
    const rot = r.rotations.find((x) => x.status === 'flights')!;
    expect(quoteCancelRotation(g, rot.id).ok).toBe(true);
    rot.sectors[0].accrued = true;
    const q = quoteCancelRotation(g, rot.id);
    expect(q.ok).toBe(false);
    expect(q.why).toMatch(/flies as planned/);
    expect(cancelRotation(g, rot.id)).toBe(false);
  });

  it('business class lost at departure: refunds, a J dent and a note', () => {
    const g = newGame(16);
    const ac = biggest(g);
    const id = devLaunchRoute(g, 'LIS-OXB', ac.id);
    const r = g.network!.routes[id];
    run(g, 1);
    // Sell business seats the aircraft does not have.
    const rot = r.rotations.find((x) => x.status === 'flights')!;
    for (const s of rot.sectors) {
      s.capJ = 16;
      s.bookedJ = 10;
    }
    ac.cabin = { ...ac.cabin, j: 0, w: 0 };
    run(g, 10);
    expect(g.network!.stats.downgrades).toBeGreaterThan(0);
    expect(r.dents?.some((d) => d.cls === 'J')).toBe(true);
    expect(g.messages.some((m) => m.topic === 'network' && /downgraded/.test(m.title))).toBe(true);
  });
});
