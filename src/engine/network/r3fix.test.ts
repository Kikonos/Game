// r3-fix (v0.24.1 sign-off): the tour case's fares, the case's first-flight lead, rolling series, the route P&L's
// passenger costs on a cancel or move, the running month on the route card, a C-check over route rotations.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { flightsOf } from '../core/entities';
import { typeOf } from '../core/perf';
import { DAY, monthKey, nextMonthStart } from '../core/time';
import type { GameState } from '../core/types';
import { C_HUBS } from '../../data/mro';
import { createGame } from '../newGame';
import { advanceTo } from '../sim';
import { bookCCheck } from '../ops/cHub';
import { planChecks } from '../ops/maintenance';
import {
  cancelRotation, caseDraft, devLaunchRoute, fileRotations, firstFlightOf, loadNetwork, monthSoFar, moveRotation, project, quoteCancelRotation,
  quoteMoveRotation, studyBase,
} from '.';
import type { Route } from './types';

const newGame = (seed = 3) => createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });
const biggest = (g: GameState) => Object.values(g.fleet).sort((a, b) => b.cabin.total - a.cabin.total)[0];
const run = (g: GameState, days: number) => {
  const end = g.now + days * DAY;
  while (g.now < end) advanceTo(g, Math.min(end, g.now + DAY), new Set());
};
const setup = (seed: number, days = 21) => {
  const g = newGame(seed);
  const id = devLaunchRoute(g, 'LIS-OXB', biggest(g).id);
  run(g, days);
  return { g, r: g.network!.routes[id], id };
};
const bookedRot = (r: Route) => r.rotations.find((x) => (x.status === 'planned' || x.status === 'flights') && x.sectors.some((s) => s.bookedJ + s.bookedY > 0));

describe('r3-fix route economics and operations', () => {
  it('the case prices a tour series at the open bucket times the tour cut, as sales charge it', () => {
    const g = newGame(31);
    const id = devLaunchRoute(g, 'LIS-OXB', biggest(g).id);
    const r = g.network!.routes[id];
    const p = caseDraft(g, id)!;
    const x = r.study!.est!.p50 / Math.max(1, studyBase(g, r));
    const own = project(g, { ...r, model: 'own' }, { ...p, model: 'own' }, g.now + 120 * DAY, x);
    const tour = project(g, { ...r, model: 'tour' }, { ...p, model: 'tour' }, g.now + 120 * DAY, x);
    const A = BAL.v019.sales.anchors;
    // Same demand and seats: the tour's tickets are the own brand's less the tour operators' cut, both on the bucket mix.
    expect(tour.pax).toBe(own.pax);
    expect(tour.parts.tickets / own.parts.tickets).toBeCloseTo(1 - A.share * A.fareCut, 3);
    expect(tour.parts.tickets).toBeLessThan(own.parts.tickets);
  });

  it('a Go plans the first flight after the stages usually take (by model), not the fastest 16 weeks', () => {
    const g = newGame(32);
    const id = devLaunchRoute(g, 'LIS-OXB', biggest(g).id);
    const r = g.network!.routes[id];
    const p = caseDraft(g, id)!;
    const W = BAL.v019.launch.caseLeadWeeks;
    for (const model of ['own', 'tour', 'partner'] as const) {
      const lead = (firstFlightOf(g, r, { ...p, model }) - g.now) / DAY;
      expect(lead).toBeGreaterThanOrEqual(W[model] * 7 - 1);
      expect(lead).toBeLessThan(W[model] * 7 + 8);
    }
    expect(W.own * 7).toBeGreaterThan(16 * 7);
  });

  it('the launch series rolls on past its first year; a series the player ends stops', () => {
    const { g, r } = setup(33, 3);
    const s = r.series[0];
    expect(s.roll).toBe(true);
    const end0 = s.to;
    // Near the end of its year: the series moves on and new dates are filed past the old end.
    s.to = g.now + 20 * DAY;
    fileRotations(g, r);
    expect(s.to).toBeGreaterThan(g.now + BAL.v019.ops.horizonDays * DAY);
    expect(r.rotations.some((x) => x.dep > g.now + 30 * DAY)).toBe(true);
    void end0;
    // A save from before: its launch series (365 days, untouched) rolls on after load; one with a changed end does not.
    delete s.roll;
    s.to = s.from + 365 * DAY;
    loadNetwork(g);
    expect(s.roll).toBe(true);
    delete s.roll;
    s.to = s.from + 200 * DAY;
    loadNetwork(g);
    expect(s.roll).toBeUndefined();
  });

  it('a cancel and a move put their passenger costs on the route P&L too', () => {
    const { g, r } = setup(34);
    const k = monthKey(g.now);
    const rot = bookedRot(r)!;
    expect(rot).toBeTruthy();
    const q = quoteCancelRotation(g, rot.id);
    expect(q.ok).toBe(true);
    expect(q.cost).toBeGreaterThan(0);
    const before = r.pnl[k]?.direct ?? 0;
    expect(cancelRotation(g, rot.id)).toBe(true);
    expect(r.pnl[k].direct).toBe(before + q.cost);
    const rot2 = r.rotations.find((x) => x !== rot && x.status === 'flights' && x.sectors.some((s) => s.bookedJ + s.bookedY > 0) && x.dep < g.now + 10 * DAY);
    if (rot2) {
      const mq = quoteMoveRotation(g, rot2.id, 60);
      if (mq.ok && mq.cost > 0) {
        const b2 = r.pnl[k].direct;
        expect(moveRotation(g, rot2.id, 60)).toBe(true);
        expect(r.pnl[k].direct).toBe(b2 + mq.cost);
      }
    }
  });

  it('the route card shows the running month (not $0 until month end), and month end books the same', () => {
    const { g, r } = setup(35, 40);
    const k = monthKey(g.now);
    const p = r.pnl[k];
    expect(p?.sectors).toBeGreaterThan(0);
    expect(p.result).toBe(0);
    const now = monthSoFar(g, r);
    expect(now).not.toBeNull();
    expect(now).not.toBe(0);
    expect(now!).toBeLessThan(p.rev);
    // The last minute of the month: within a few dollars of what the month closes at.
    advanceTo(g, nextMonthStart(g.now) - 1, new Set());
    const last = monthSoFar(g, r)!;
    advanceTo(g, nextMonthStart(g.now) + 60, new Set());
    expect(Math.abs(r.pnl[k].result - last)).toBeLessThan(Math.max(500, Math.abs(r.pnl[k].result) * 0.01));
  });

  it('an overdue C-check hands the route rotations to another aircraft or a sub-charter, none cancelled with EU261', () => {
    const { g, r } = setup(36);
    const ac = g.fleet[r.series[0].tail!];
    const onAc = () => r.rotations.filter((x) => x.status === 'flights' && x.aircraftId === ac.id && x.dep < g.now + 20 * DAY);
    // Wait until it is on the ground at home with route rotations ahead.
    for (let i = 0; i < 20 && (ac.flightId || ac.at !== g.company.homeBase || !onAc().length); i++) advanceTo(g, g.now + 6 * 60, new Set());
    expect(ac.flightId).toBeFalsy();
    const ahead = onAc().map((x) => x.id);
    expect(ahead.length).toBeGreaterThan(0);
    const cancelled0 = r.rotations.filter((x) => x.status === 'cancelled').length;
    ac.maint.lastC = g.now - typeOf(ac.typeId).cCheckMonths * 30.44 * DAY * 1.3;
    planChecks(g);
    const m = Object.values(g.maintenance).find((x) => x.aircraftId === ac.id && x.kind === 'C' && x.status === 'planned');
    expect(m).toBeTruthy();
    expect(r.rotations.filter((x) => x.status === 'cancelled').length).toBe(cancelled0);
    for (const id of ahead) {
      const rot = r.rotations.find((x) => x.id === id)!;
      if (rot.dep > m!.end + DAY) continue;
      expect(rot.aircraftId).not.toBe(ac.id);
      expect(rot.status === 'flights' || rot.status === 'planned').toBe(true);
    }
    expect(g.messages.some((x) => x.ref?.id === r.id && /C-check/.test(x.title))).toBe(true);
    // The aircraft's flights in the check: none left but the check's own ferries.
    expect(flightsOf(g, ac.id).filter((f) => f.status === 'scheduled' && f.sched && f.std < m!.end && f.sta > m!.start).length).toBe(0);
  });

  it('a C-check booked over route rotations takes them off the aircraft instead of refusing', () => {
    const { g, r } = setup(37, 30);
    const ac = g.fleet[r.series[0].tail!];
    const hub = C_HUBS[typeOf(ac.typeId).family].find((h) => h.code === g.company.homeBase) ?? C_HUBS[typeOf(ac.typeId).family][0];
    const rot = r.rotations.find((x) => x.status === 'flights' && x.aircraftId === ac.id && x.dep > g.now + 40 * DAY)!;
    expect(rot).toBeTruthy();
    const start = rot.dep - DAY;
    const res = bookCCheck(g, ac.id, hub.code, start);
    if (!res.ok) throw new Error(res.error);
    const m = g.maintenance[res.data!.maintId];
    expect(rot.aircraftId).not.toBe(ac.id);
    expect(['planned', 'flights']).toContain(rot.status);
    expect(flightsOf(g, ac.id).filter((f) => f.status === 'scheduled' && f.sched && f.std < m.end && f.sta > m.start).length).toBe(0);
  });
});
