// Leftover-breach round (27 Oct 2026), invariant seed 5: a crew member on notice, left at an outstation on their last day,
// was deleted while the ticket home booked for them flew hours after their notice ended. Nobody leaves while away; the
// notice ends when they land (as annual leave starts on landing).

import { describe, expect, it } from 'vitest';
import { newGame, run } from '../contracts/testkit';
import { DAY, dayStart } from '../core/time';
import type { CrewMember, Flight, GameState } from '../core/types';
import { advanceTo } from '../sim';
import { touchCrew } from './timeline';

/** A rested cabin crew member at an outstation with nothing planned (and no standby yet). */
function awayAt(g: GameState, at: string): CrewMember {
  const c = Object.values(g.crew).find((x) => x.role === 'CC' && x.status === 'available')!;
  c.loc = at;
  c.awaySince = g.now - DAY;
  c.restUntil = g.now - 60;
  delete c.standby;
  touchCrew(g);
  return c;
}

const ticketsOf = (g: GameState, id: string): Flight[] => Object.values(g.flights).filter((f) => f.kind === 'deadhead' && f.crewIds.includes(id));

describe('a resignation away from base (seed 5)', () => {
  /** On notice, the last day ending at the next daily run, still at Hamburg (the trip that ended there was the last). */
  function leaving(g: GameState): { c: CrewMember; leaves: number } {
    const c = awayAt(g, 'HAM');
    const leaves = dayStart(g.now) + DAY;
    c.notice = { given: g.now - 30 * DAY, leaves };
    // As the resignation hook leaves it: everything from the last day on is blocked.
    c.blocks = [{ from: leaves, to: leaves + 3650 * DAY, why: 'leave' }];
    touchCrew(g);
    return { c, leaves };
  }

  it('is flown home first and leaves on landing: never deleted while away, never flying after the notice ended', () => {
    const g = newGame(21);
    const { c, leaves } = leaving(g);
    const id = c.id;
    let lastLoc = c.loc;
    let lastEnd = leaves;
    let gone = -1;
    const flewAfter: string[] = [];
    while (g.now < leaves + 3 * DAY && gone < 0) {
      // Every ticket of theirs that leaves does so before their notice ends (as it stands when it leaves).
      for (const f of ticketsOf(g, id)) if (f.status === 'scheduled' && f.std <= g.now + 30 && f.std >= lastEnd) flewAfter.push(`${f.from}-${f.to}`);
      advanceTo(g, g.now + 30);
      const x = g.crew[id];
      if (!x) gone = g.now;
      else {
        lastLoc = x.loc;
        lastEnd = x.notice?.leaves ?? lastEnd;
      }
    }
    const home = ticketsOf(g, id).find((f) => f.from === 'HAM' && f.to === c.base);
    expect(home, 'a ticket home').toBeDefined();
    expect(home!.status).toBe('done');
    expect(gone, 'they leave the company').toBeGreaterThan(0);
    expect(gone).toBeGreaterThanOrEqual(home!.ata ?? home!.sta);
    expect(lastLoc, 'where they were last seen').toBe(c.base);
    // The notice ended when they landed, not before.
    expect(lastEnd).toBeGreaterThanOrEqual(home!.ata ?? home!.sta);
    expect(flewAfter).toEqual([]);
  });

  it('with a day in hand they are home by their last day (the notice keeps its date)', () => {
    const g = newGame(21);
    const { c, leaves } = leaving(g);
    // The last day two daily runs ahead: the run before it books them home in time.
    const later = leaves + DAY;
    c.notice = { ...c.notice!, leaves: later };
    c.blocks = [{ from: later, to: later + 3650 * DAY, why: 'leave' }];
    touchCrew(g);
    run(g, leaves + 60);
    const home = ticketsOf(g, c.id).find((f) => f.from === 'HAM' && f.to === c.base);
    expect(home, 'a ticket home').toBeDefined();
    expect(home!.sta).toBeLessThanOrEqual(later);
    expect(g.crew[c.id]?.notice?.leaves).toBe(later);
  });
});

