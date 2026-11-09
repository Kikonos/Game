// Leftover-breach round (27 Oct 2026), invariant seed 1 (365 d, after the peak round's changes): a cabin crew member at
// Prague sat out the start of her leave there. The night before, a duty held her (so the daily check let her stay); it
// was re-planned away at 02:30, and at the next daily run the leave had begun and her ticket out of Prague for a trip
// after the leave kept her there for 5 days of it. Crew away now go home when a leave starts within 3 hours (hourly),
// and the run at a leave's start counts it: the leave then starts when they land.

import { describe, expect, it } from 'vitest';
import { newGame } from '../contracts/testkit';
import { addDeadhead } from '../core/entities';
import { DAY } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { advanceTo } from '../sim';
import { touchCrew } from './timeline';

const ticketsOf = (g: GameState, id: string): Flight[] => Object.values(g.flights).filter((f) => f.kind === 'deadhead' && f.crewIds.includes(id));

describe('a leave that starts while away', () => {
  it('crew at an outstation fly home on the first day of their leave (v0.19.3), and back out on its last for work after it', () => {
    const g = newGame(21);
    const c = Object.values(g.crew).find((x) => x.role === 'CC' && x.status === 'available')!;
    c.loc = 'PRG';
    c.awaySince = g.now - DAY;
    c.restUntil = g.now - 60;
    delete c.standby;
    const from = g.now + 2 * 60;
    c.blocks = [{ from, to: from + 10 * DAY, why: 'leave', annual: true }];
    // The trip after the leave starts from Prague (the planner kept her there for it).
    addDeadhead(g, { crewIds: [c.id], from: 'PRG', to: 'FNC', std: from + 11 * DAY, sta: from + 11 * DAY + 240, cost: 0 });
    touchCrew(g);
    const during: string[] = [];
    while (g.now < from + 2 * DAY) {
      for (const f of ticketsOf(g, c.id)) if (f.status === 'scheduled' && f.std <= g.now + 30 && f.std >= from && f.std < from + 10 * DAY && !during.includes(`${f.from}-${f.to}`)) during.push(`${f.from}-${f.to}`);
      advanceTo(g, g.now + 30);
    }
    expect(c.loc, 'home for the leave').toBe(c.base);
    // Only the leave's own trip home flew inside it; the leave keeps its dates.
    expect(during).toEqual(['PRG-LIS']);
    expect(c.blocks?.find((b) => b.why === 'leave')?.from).toBe(from);
    expect(c.flown?.some((x) => x.lv)).toBe(true);
    // Back out to Prague on the leave's last day for the ticket on from there.
    const back = ticketsOf(g, c.id).find((f) => f.leaveTrip === 'back')!;
    expect(back).toMatchObject({ from: c.base, to: 'PRG' });
    expect(back.std).toBeLessThan(from + 10 * DAY);
    expect(back.std).toBeGreaterThanOrEqual(from + 8 * DAY);
  });
});
