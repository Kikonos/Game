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
  it('crew at an outstation go home when their leave is hours away, even with a ticket out of there for after it', () => {
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
    let leaveFrom = from;
    const during: string[] = [];
    while (g.now < from + DAY) {
      for (const f of ticketsOf(g, c.id)) if (f.status === 'scheduled' && f.std <= g.now + 30 && f.std >= leaveFrom && f.std < leaveFrom + 10 * DAY) during.push(`${f.from}-${f.to}`);
      advanceTo(g, g.now + 30);
      leaveFrom = c.blocks?.find((b) => b.why === 'leave')?.from ?? leaveFrom;
    }
    expect(c.loc, 'home for the leave').toBe(c.base);
    expect(during).toEqual([]);
    const home = ticketsOf(g, c.id).find((f) => f.from === 'PRG' && f.to === c.base)!;
    expect(home.status).toBe('done');
    // The leave starts when she lands (no earlier), and keeps its days.
    expect(leaveFrom).toBeGreaterThanOrEqual(home.ata ?? home.sta);
  });
});

