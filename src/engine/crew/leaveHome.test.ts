// Crew-planning round (26 Oct 2026): annual leave starts at home. Bot seeds 2-5 and the player's save had crew fly a
// deadhead on the first morning of their leave (a ticket home after a late landing, or after the 36 h recovery at the
// hotel), and seed 3 an FO who sat out a ten-day leave in Hamburg and flew home in the middle of it (the planner had kept
// him there for a trip after the leave). v0.19.3 (the player: "they can deadhead home on the first day of leave and
// deadhead back on the last day"): an annual leave that begins away starts with its own trip home on its first day
// (travel on a leave day, the leave keeps its dates) and ends with one back out on its last to where the next work is.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, legsOffer, newGame } from '../contracts/testkit';
import { addDeadhead, retimeFlight } from '../core/entities';
import { advanceTo } from '../sim';
import { DAY } from '../core/time';
import type { CrewMember, Flight, GameState } from '../core/types';
import { dayIndex, midnight } from './dayPlan';
import { leaveAfterTicket, recheckAfterRelease, sendStrandedHome } from './roster';
import { touchCrew } from './timeline';

/** An FO away in Hamburg, rested, with annual leave from the local midnight `days` days ahead (10 days). */
function away(days: number): { g: GameState; c: CrewMember; from: number } {
  const g = newGame(21);
  const c = Object.values(g.crew).find((x) => x.role === 'FO' && x.status === 'available')!;
  c.loc = 'HAM';
  c.restUntil = g.now - 60;
  delete c.standby;
  const from = midnight(c.base, dayIndex(c.base, g.now) + days);
  c.blocks = [{ from, to: from + 10 * DAY, why: 'leave', annual: true }];
  touchCrew(g);
  return { g, c, from };
}

const ticketsOf = (g: GameState, id: string): Flight[] => Object.values(g.flights).filter((f) => f.kind === 'deadhead' && f.status === 'scheduled' && f.crewIds.includes(id));

describe('leave starts at home', () => {

  it('v0.12.1 (C4) a ticket home logged with the released duty is never bought twice, and the leave keeps its start', () => {
    const { g, c, from } = away(1);
    // Just released at Hamburg; the ticket home straight on is logged with the duty (S1027: a cabin crew member's
    // ticket home at 12:00 was bought again for the next morning at the release, 10:55).
    const t = addDeadhead(g, { crewIds: [c.id], from: 'HAM', to: c.base, std: g.now + 60, sta: g.now + 4 * 60, cost: 250 });
    c.log.push({ start: g.now - 8 * 60, end: g.now + 4 * 60, fdp: 8 * 60, block: 5 * 60, sectors: 2, augmented: false, disruptive: false });
    c.restUntil = g.now + 16 * 60;
    touchCrew(g);
    const cash = g.finance.current.lines.deadhead ?? 0;
    sendStrandedHome(g);
    const home = ticketsOf(g, c.id).filter((f) => f.to === c.base);
    expect(home.map((f) => f.id)).toEqual([t.id]);
    expect(g.finance.current.lines.deadhead ?? 0).toBe(cash);
    expect(c.blocks![0].from).toBe(from);
  });

  it('v0.12.1 (C4) one held on the leave\'s first day is its trip home (v0.19.3): still exactly one ticket home, nothing bought', () => {
    const { g, c, from } = away(1);
    const t = addDeadhead(g, { crewIds: [c.id], from: 'HAM', to: c.base, std: from + 6 * 60, sta: from + 9 * 60, cost: 0 });
    const cash = g.finance.current.lines.deadhead ?? 0;
    sendStrandedHome(g);
    const home = ticketsOf(g, c.id).filter((f) => f.to === c.base);
    expect(home.map((f) => f.id)).toEqual([t.id]);
    expect(home[0].leaveTrip).toBe('home');
    expect(g.finance.current.lines.deadhead ?? 0).toBe(cash);
    expect(c.blocks![0].from).toBe(from);
  });
  it('crew left at an outstation fly home on the first day of their leave and back out on its last for work after it', () => {
    const { g, c, from } = away(1);
    // A ticket on from Hamburg for work after the leave (the planner had kept them there).
    addDeadhead(g, { crewIds: [c.id], from: 'HAM', to: 'ZAG', std: from + 11 * DAY, sta: from + 11 * DAY + 120, cost: 0 });
    sendStrandedHome(g);
    const home = ticketsOf(g, c.id).find((f) => f.from === 'HAM' && f.to === c.base);
    expect(home, 'a ticket home').toBeDefined();
    // v0.19.3 on the leave's first day, inside it; the leave keeps its dates; back to Hamburg on its last day.
    const b = c.blocks!.find((x) => x.why === 'leave')!;
    expect(b.from).toBe(from);
    expect(home!.leaveTrip).toBe('home');
    expect(dayIndex(c.base, home!.std)).toBe(dayIndex(c.base, b.from));
    const back = ticketsOf(g, c.id).find((f) => f.leaveTrip === 'back')!;
    expect(back).toMatchObject({ from: c.base, to: 'HAM' });
    expect(dayIndex(c.base, back.std)).toBe(dayIndex(c.base, b.to - 1));
  });

  it('a ticket that can only land after the leave began moves its start to the landing, keeping the days', () => {
    const { g, c, from } = away(2);
    const days = (b: { from: number; to: number }) => {
      let n = 0;
      for (let k = dayIndex(c.base, b.from) - 1; k <= dayIndex(c.base, b.to) + 1; k++) {
        const a = midnight(c.base, k);
        if (b.from < a + DAY - 6 * 60 && b.to > a + 6 * 60) n++;
      }
      return n;
    };
    const before = days(c.blocks![0]);
    // Rebooked after a late landing: leaves at 22:00 the evening before, lands at 02:00 on the first day of leave.
    const std = from - 2 * 60;
    const sta = from + 2 * 60;
    leaveAfterTicket(g, [c.id], { std, sta, to: c.base });
    const b = c.blocks![0];
    expect(b.from).toBe(sta);
    expect(days(b)).toBe(before);
    // v0.19.3 a ticket that leaves inside an annual leave is travel on a leave day: the leave keeps its dates.
    const late = away(2);
    const b0 = { ...late.c.blocks![0] };
    leaveAfterTicket(late.g, [late.c.id], { std: late.from + 16 * 60, sta: late.from + 20 * 60, to: late.c.base });
    expect(late.c.blocks![0]).toEqual(b0);
    expect(std).toBeLessThan(b.from);
  });
  it('a ticket home moved by any other path (a retime) into the leave starts the leave at its landing (daily check)', () => {
    const { g, c, from } = away(2);
    const t = addDeadhead(g, { crewIds: [c.id], from: 'HAM', to: c.base, std: from - 8 * 60, sta: from - 5 * 60, cost: 0 });
    advanceTo(g, g.now + 1, new Set());
    expect(c.blocks![0].from).toBe(from);
    retimeFlight(g, t, from - 60, from + 2 * 60);
    // The daily crew run (at midnight UTC, before the leave starts at local midnight).
    advanceTo(g, Math.floor(g.now / DAY) * DAY + DAY + 1, new Set());
    expect(c.blocks![0].from).toBe(from + 2 * 60);
  });
  it('crew released away with their leave starting within hours go home after their rest, not on its second day', () => {
    const { g, c, from } = away(1);
    // Leave from the next local midnight; their duty in Hamburg has just been released (no ticket home: the trip
    // after the leave starts there).
    const o = legsOffer(g, [['LIS', 'FAO', g.now + 3 * DAY], ['FAO', 'LIS', g.now + 3 * DAY + 3 * 60]], 150);
    o.broker = undefined;
    const r = acceptOffer(g, o.id, [leased(g).id]);
    if (!r.ok) throw new Error(r.error);
    const p = Object.values(g.pairings).find((x) => x.contractId === r.data!.contractId)!;
    const slot = p.slots.find((x) => x.role === 'FO')!;
    slot.crewId = c.id;
    c.restUntil = g.now + 10 * 60;
    expect(from).toBeGreaterThan(g.now);
    recheckAfterRelease(g, p);
    const home = ticketsOf(g, c.id).find((f) => f.from === 'HAM' && f.to === c.base);
    expect(home, 'a ticket home').toBeDefined();
    // The leave starts when they land (its days kept).
    expect(c.blocks!.find((x) => x.why === 'leave')!.from).toBe(Math.max(from, home!.sta));
  });
});
