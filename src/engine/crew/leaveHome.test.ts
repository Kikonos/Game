// Crew-planning round (26 Oct 2026): annual leave starts at home. Bot seeds 2-5 and the player's save had crew fly a
// deadhead on the first morning of their leave (a ticket home after a late landing, or after the 36 h recovery at the
// hotel), and seed 3 an FO who sat out a ten-day leave in Hamburg and flew home in the middle of it (the planner had kept
// him there for a trip after the leave).

import { describe, expect, it } from 'vitest';
import { newGame } from '../contracts/testkit';
import { addDeadhead, retimeFlight } from '../core/entities';
import { advanceTo } from '../sim';
import { DAY } from '../core/time';
import type { CrewMember, Flight, GameState } from '../core/types';
import { dayIndex, midnight } from './dayPlan';
import { leaveAfterTicket, sendStrandedHome } from './roster';
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
  it('crew left at an outstation go home before their leave, even with a ticket out of there for a trip after it', () => {
    const { g, c, from } = away(1);
    // A ticket on from Hamburg for work after the leave (the planner had kept them there).
    addDeadhead(g, { crewIds: [c.id], from: 'HAM', to: 'ZAG', std: from + 12 * DAY, sta: from + 12 * DAY + 120, cost: 0 });
    sendStrandedHome(g);
    const home = ticketsOf(g, c.id).find((f) => f.from === 'HAM' && f.to === c.base);
    expect(home, 'a ticket home').toBeDefined();
    // Lands before the leave starts (or the leave starts when it lands); never a flight inside the leave.
    const b = c.blocks!.find((x) => x.why === 'leave')!;
    expect(home!.std).toBeLessThan(b.from);
    expect(home!.sta).toBeLessThanOrEqual(b.from);
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
    // A late evening landing loses the first day: the leave runs a day longer.
    const late = away(2);
    const b0 = { ...late.c.blocks![0] };
    leaveAfterTicket(late.g, [late.c.id], { std: late.from + 16 * 60, sta: late.from + 20 * 60, to: late.c.base });
    expect(late.c.blocks![0].from).toBe(late.from + 20 * 60);
    expect(days(late.c.blocks![0])).toBe(days(b0));
    expect(late.c.blocks![0].to).toBe(b0.to + DAY);
    expect(std).toBeLessThan(b.from);
  });
  it('a ticket home moved by any other path (a retime) into the leave starts the leave at its landing', () => {
    const { g, c, from } = away(2);
    const t = addDeadhead(g, { crewIds: [c.id], from: 'HAM', to: c.base, std: from - 8 * 60, sta: from - 5 * 60, cost: 0 });
    advanceTo(g, g.now + 1, new Set());
    expect(c.blocks![0].from).toBe(from);
    retimeFlight(g, t, from - 60, from + 2 * 60);
    advanceTo(g, g.now + 1, new Set());
    expect(c.blocks![0].from).toBe(from + 2 * 60);
  });
});
