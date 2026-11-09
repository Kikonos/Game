// v0.19.3 "Leave from away" (the player, a purser formerly at an ACMI operator: "Leave is SGN again. Tell you what: they
// can deadhead home on the first day of leave and deadhead back on the last day of leave. That's how we used to do it
// at Getjet. That way it doesn't affect the rostering."). Annual leave that begins away from base starts with a ticket
// home on its first day and ends with one back out on its last to the station of the next duty; travel on a leave day
// is not duty. Carolina Almeida (fixture v0182-leave, the player's save of 24 Nov 2028) is on set 3's tour at Manila,
// annual leave 4–14 Dec, her tour's next part on 21 Dec from Manila.

import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures/compatKit';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { DAY } from '../core/time';
import type { CrewMember, Flight, GameState } from '../core/types';
import { addDeadhead } from '../core/entities';
import { fixtureGame, addCrew } from './fixtures';
import { segsOf, locAt, ctxOf, crewIx } from './timeline';
import { evalSegs } from './rules';
import { dayIndex } from './dayPlan';
import { leaveTrips } from './roster';
import { leaveBackFor } from './leaveTrips';
import { judgePerson } from './selfCheck';
import { crewCalendar, crewStatusView } from './calendar';
import { leaveYearOf } from './leave';
import { yearOf } from '../core/time';
import { flightCrewStatus } from './roster';
import { monthGrid } from '../../ui/modals/personLogic';
import { midnight } from './dayPlan';

/** The save, played to just after the next daily run (it books the leave trips; a load books none of its own). */
const snap = () => {
  const g = deserialize(fixture('v0182-leave'));
  const t = Math.floor(g.now / DAY) * DAY + DAY + 30;
  while (g.now < t) advanceTo(g, Math.min(t, g.now + 12 * 60), new Set());
  return g;
};
const leaveOf = (c: CrewMember) => c.blocks!.find((b) => b.why === 'leave' && b.annual)!;
const tickets = (g: GameState, c: CrewMember, kind?: 'home' | 'back'): Flight[] =>
  Object.values(g.flights).filter((f) => f.kind === 'deadhead' && f.status !== 'cancelled' && f.crewIds.includes(c.id) && (kind ? f.leaveTrip === kind : true)).sort((a, b) => a.std - b.std);
const illegal = (g: GameState, c: CrewMember) => evalSegs(ctxOf(g, c), segsOf(g, c)).filter((i) => i.level === 'illegal');

describe('v0.19.3 annual leave that begins away', () => {
  it('Carolina: a deadhead home on the first day of the leave and back out on its last, to the next duty\'s station', () => {
    const g = snap();
    const c = g.crew.c32u5;
    const b = leaveOf(c);
    const home = tickets(g, c, 'home');
    const back = tickets(g, c, 'back');
    expect(home).toHaveLength(1);
    expect(back).toHaveLength(1);
    expect(home[0].from).toBe('MNL');
    expect(home[0].to).toBe('LIS');
    expect(dayIndex(c.base, home[0].std)).toBe(dayIndex(c.base, b.from));
    expect(back[0].from).toBe('LIS');
    expect(dayIndex(c.base, back[0].std)).toBe(dayIndex(c.base, b.to - 1));
    // Real tickets: a fare, the deadhead ledger, the deadhead colour (kind 'deadhead').
    expect(home[0].cost).toBeGreaterThan(0);
    expect(back[0].cost).toBeGreaterThan(0);
    // The return goes where the next duty leaves from (her tour's next part, 21 Dec from Manila).
    const segs = segsOf(g, c);
    const next = segs.find((s) => s.kind === 'duty' && s.start >= b.to)!;
    expect(next.from).toBe('MNL');
    expect(back[0].to).toBe(next.from);
    expect(locAt(c, segs, next.start)).toBe('MNL');
    // No trip home before the leave any more: she stays on station until it begins.
    expect(tickets(g, c).filter((f) => f.to === 'LIS' && f.sta <= b.from)).toHaveLength(0);
    expect(locAt(c, segs, b.from)).toBe('MNL');
    expect(locAt(c, segs, b.from + 2 * DAY)).toBe('LIS');
  });

  it('the leave keeps its days: same dates, same allowance booked, played through', () => {
    const g = snap();
    const c = g.crew.c32u5;
    const b = { ...leaveOf(c) };
    const y = yearOf(b.from + 720);
    const booked = leaveYearOf(g, c, y).booked;
    const logN = c.log.length;
    while (g.now < b.from + 36 * 60) advanceTo(g, Math.min(b.from + 36 * 60, g.now + 12 * 60), new Set());
    expect(leaveOf(c)).toMatchObject({ from: b.from, to: b.to });
    expect(leaveYearOf(g, c, y).booked).toBe(booked);
    expect(c.status).toBe('leave');
    expect(c.loc).toBe('LIS');
    // Travel on a leave day is no duty: nothing logged, no rest after it.
    expect(c.log.filter((e) => e.start >= b.from)).toHaveLength(0);
    expect(c.log.length).toBeLessThanOrEqual(logN + 3);
    expect(c.restUntil).toBeLessThanOrEqual(b.from);
    expect(c.flown?.some((x) => x.lv && x.s >= b.from)).toBe(true);
    // On through the leave (the flown ticket home leaves the flights after two days): one trip back on the last day,
    // nothing booked twice, back at Manila for her tour, the leave as it was.
    while (g.now < b.to + 2 * DAY) advanceTo(g, Math.min(b.to + 2 * DAY, g.now + 12 * 60), new Set());
    const lv = (c.flown ?? []).filter((x) => x.lv);
    expect(lv.map((x) => `${x.legs[0][1]}-${x.legs[x.legs.length - 1][2]}`)).toEqual(['MNL-LIS', 'LIS-MNL']);
    expect(tickets(g, c).filter((f) => f.leaveTrip && f.status === 'scheduled')).toEqual([]);
    expect(c.loc).toBe('MNL');
    expect(leaveOf(c)).toMatchObject({ from: b.from, to: b.to });
    expect(c.log.filter((e) => e.start >= b.from && e.start < b.to)).toHaveLength(0);
  }, 400_000);

  it('no FTL issue and no self-check alarm: the trips are not duty and break no rest', () => {
    const g = snap();
    const c = g.crew.c32u5;
    const b = leaveOf(c);
    expect(illegal(g, c)).toEqual([]);
    // Her tour's next part after the leave: legal, the independent evaluator finds her at Manila, rested.
    const p = g.pairings.p3tok;
    const d = p.dutyIds.map((id) => g.duties[id]).filter((x) => !!x && !x.done).sort((x, y) => x.report - y.report)[0];
    expect(d.report).toBeGreaterThan(b.to);
    const r = judgePerson(g, c, d, p);
    expect(r.other.location).toBeUndefined();
    expect(r.other.overlap).toBeUndefined();
    expect(r.other.status).toBeUndefined();
    if (r.values.rest) expect(r.values.rest[0]).toBeGreaterThanOrEqual(r.values.rest[1]);
    for (const k of ['duty7d', 'duty14d', 'duty28d'] as const) expect(r.values[k]![0]).toBeLessThanOrEqual(r.values[k]![1]);
    expect(flightCrewStatus(g, d.flightIds[0]).level).not.toBe('illegal');
    // The weekly rest: the leave trips count as no duty (the same timeline without them reads alike).
    const plain = segsOf(g, c).filter((s) => !s.leave);
    const codes = (x: ReturnType<typeof illegal>) => x.map((i) => i.code).sort();
    expect(codes(evalSegs(ctxOf(g, c), segsOf(g, c)).filter((i) => i.code === 'recovery' || i.code.startsWith('duty')))).toEqual(codes(evalSegs(ctxOf(g, c), plain).filter((i) => i.code === 'recovery' || i.code.startsWith('duty'))));
  });

  it('the calendar draws LEAVE with the trip on its first and last day; "Now at" follows the journey', () => {
    const g = snap();
    const c = g.crew.c32u5;
    const b = leaveOf(c);
    const k0 = dayIndex(c.base, b.from);
    const kz = dayIndex(c.base, b.to - 1);
    const from = midnight(c.base, k0 - 3);
    const to = midnight(c.base, kz + 3);
    const blocks = crewCalendar(g, c.id, from, to);
    expect(blocks.filter((x) => x.leaveTrip).map((x) => x.leaveTrip)).toEqual(['home', 'back']);
    const grid = monthGrid(blocks, {
      k1st: k0 - 3, nDays: kz - k0 + 7, wd1st: 0, midnight: (k) => midnight(c.base, k), dayOf: (t) => dayIndex(c.base, t), base: c.base, now: g.now, dateOf: (k) => k, keptFrom: undefined,
    });
    const cell = (k: number) => grid.cells.find((x) => x.k === k)!;
    expect(cell(k0).kind).toBe('leave');
    expect(cell(k0).code).toBe('LEAVE');
    expect(cell(k0).sub).toBe('MNL→LIS');
    expect(cell(kz).kind).toBe('leave');
    expect(cell(kz).sub).toBe('LIS→MNL');
    // Every leave day stays a leave day (no positioning span over it).
    for (let k = k0; k <= kz; k++) expect(cell(k).kind).toBe('leave');
    // Flying home on the first day: in the air, then at Lisbon.
    const t = tickets(g, c, 'home')[0];
    while (g.now < t.std + 60) advanceTo(g, Math.min(t.std + 60, g.now + 12 * 60), new Set());
    const v = crewStatusView(g, c.id);
    expect(v.label).toBe('Leave');
    expect(v.nowAt).toMatch(/in the air|connecting|check-in/);
    while (g.now < t.sta + 60) advanceTo(g, Math.min(t.sta + 60, g.now + 12 * 60), new Set());
    expect(crewStatusView(g, c.id).nowAt).toBe('LIS');
  }, 180_000);

  it('leave that begins at home base gets no trips', () => {
    const g = fixtureGame();
    const c = g.crew[addCrew(g, { CC: 1 })[0]];
    c.blocks = [{ from: midnight(c.base, dayIndex(c.base, g.now) + 5), to: midnight(c.base, dayIndex(c.base, g.now) + 12), why: 'leave', annual: true }];
    leaveTrips(g);
    expect(tickets(g, c)).toEqual([]);
  });

  it('away with nothing after the leave: home on its first day, no trip back; nothing for sick leave or a course', () => {
    const g = fixtureGame();
    const [a, s] = addCrew(g, { CC: 2 }).map((id) => g.crew[id]);
    const k = dayIndex(a.base, g.now);
    for (const c of [a, s]) {
      c.loc = 'HAM';
      c.awaySince = g.now - DAY;
    }
    a.blocks = [{ from: midnight(a.base, k + 5), to: midnight(a.base, k + 12), why: 'leave', annual: true }];
    s.blocks = [{ from: midnight(a.base, k + 5), to: midnight(a.base, k + 12), why: 'sick' }];
    leaveTrips(g);
    const t = tickets(g, a);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ from: 'HAM', to: 'LIS', leaveTrip: 'home' });
    expect(dayIndex(a.base, t[0].std)).toBe(k + 5);
    expect(tickets(g, s)).toEqual([]);
    // Run again: nothing more (one ticket per leave).
    leaveTrips(g);
    expect(tickets(g, a)).toHaveLength(1);
    // The leave withdrawn: its ticket goes.
    a.blocks = [];
    leaveTrips(g);
    expect(tickets(g, a)).toEqual([]);
  });

  it('the trip back goes to the station the next duty leaves from (and none when it leaves from base)', () => {
    const g = fixtureGame();
    const c = g.crew[addCrew(g, { CC: 1 })[0]];
    const k = dayIndex(c.base, g.now);
    const b = { from: midnight(c.base, k + 5), to: midnight(c.base, k + 12), why: 'leave' as const, annual: true as const };
    c.blocks = [b];
    c.loc = 'HAM';
    // Away at Hamburg with nothing before the leave: its trip home booked on its first day.
    leaveTrips(g);
    expect(tickets(g, c, 'home')).toHaveLength(1);
    const segs = segsOf(g, c);
    const report = midnight(c.base, k + 12) + 20 * 60;
    for (const dep of ['DXB', 'HAM']) {
      const back = leaveBackFor(g, c, segs, report, dep)!;
      expect(back.from).toBe('LIS');
      expect(back.to).toBe(dep);
      expect(dayIndex(c.base, back.std)).toBe(k + 11);
      expect(back.sta).toBeLessThanOrEqual(report - 180);
    }
    expect(leaveBackFor(g, c, segs, report, 'LIS')).toBeNull();
    // A next duty days later (not a tour): planned as a normal trip out, not on the leave.
    expect(leaveBackFor(g, c, segs, report + 5 * DAY, 'DXB')).toBeNull();
    expect(leaveBackFor(g, c, segs, report + 5 * DAY, 'DXB', true)?.to).toBe('DXB');
  });

  it('an older save\'s trip home before the leave (bug 1108b) becomes the leave\'s own trips on load', () => {
    const g = snap();
    const c = g.crew.c32u5;
    const b = leaveOf(c);
    // Rebuild the old form: no leave trips; a ticket home after her tour part's last duty before the leave.
    for (const f of tickets(g, c)) if (f.leaveTrip) {
      f.crewIds = [];
      delete g.flights[f.id];
    }
    const p = Object.values(g.pairings).find((q) => q.tour && q.slots.some((s) => s.crewId === c.id) && q.dutyIds.some((id) => g.duties[id] && !g.duties[id].done && g.duties[id].release <= b.from))!;
    const last = p.dutyIds.map((id) => g.duties[id]).filter((d) => !!d && !d.done && d.release <= b.from).sort((x, y) => x.release - y.release).pop()!;
    const old = addDeadhead(g, { crewIds: [c.id], from: 'MNL', to: 'LIS', std: Math.ceil((last.release + 3 * 60) / 60) * 60, sta: Math.ceil((last.release + 3 * 60) / 60) * 60 + 17 * 60, cost: 1500, contractId: p.contractId });
    old.why = 'Home for annual leave from 4 Dec';
    last.deadheadIds.push(old.id);
    const g2 = deserialize(serialize(g));
    const c2 = g2.crew.c32u5;
    expect(g2.flights[old.id]?.crewIds.includes(c2.id) ?? false).toBe(false);
    expect(tickets(g2, c2, 'home')).toHaveLength(1);
    expect(tickets(g2, c2, 'back')).toHaveLength(1);
    expect(locAt(c2, segsOf(g2, c2), b.from)).toBe('MNL');
    expect(illegal(g2, c2)).toEqual([]);
    expect(crewIx(g2).tickets.get(c2.id)?.some((f) => f.status === 'done' && f.leaveTrip)).toBe(false);
  });
});
