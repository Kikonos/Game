// Leftover-breach round (27 Oct 2026), invariant seed 1: cabin crew sent home from Madrid kept the hotel standby planned
// there (0:50 after landing in Lisbon, and a window at Madrid while at home). A ticket home re-fits the standby after it,
// and a ticket landing clips standby to the rest it needs.

import { describe, expect, it } from 'vitest';
import { newGame } from '../contracts/testkit';
import { addDeadhead } from '../core/entities';
import { DAY, dayStart } from '../core/time';
import type { CrewMember, Flight, GameState } from '../core/types';
import { advanceTo } from '../sim';
import { minRest } from './rules';
import { sendStrandedHome } from './roster';
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

describe('standby after a ticket home (seed 1, Madrid)', () => {
  it('a ticket home drops the hotel standby planned at the station they leave', () => {
    const g = newGame(21);
    const c = awayAt(g, 'MAD');
    const from = dayStart(g.now) + DAY + 4 * 60;
    c.standby = [{ from, to: from + 12 * 60, kind: 'hotel', at: 'MAD' }];
    sendStrandedHome(g);
    const home = ticketsOf(g, c.id).find((f) => f.from === 'MAD' && f.to === c.base);
    expect(home, 'a ticket home').toBeDefined();
    expect(home!.sta).toBeLessThan(from);
    // The window at Madrid is gone (nobody can stand by in Madrid from Lisbon).
    expect((c.standby ?? []).filter((w) => w.at === 'MAD')).toEqual([]);
  });

  it('standby after a ticket that lands waits for the rest the ticket needs', () => {
    const g = newGame(21);
    const c = awayAt(g, 'MAD');
    const std = Math.ceil((g.now + 2 * 60) / 60) * 60;
    const sta = std + 70;
    addDeadhead(g, { crewIds: [c.id], from: 'MAD', to: c.base, std, sta, cost: 0 });
    // A home standby planned to start 50 min after the landing (the day was planned before the trip changed).
    c.standby = [{ from: sta + 50, to: sta + 50 + 12 * 60 }];
    touchCrew(g);
    advanceTo(g, sta + 30);
    expect(c.loc).toBe(c.base);
    const rest = minRest({ dutyMin: sta - std + 60, atHome: true, augmented: false, tzShift: 0 });
    for (const w of c.standby ?? []) if (w.from > std) expect(w.from - sta, 'rest before the standby').toBeGreaterThanOrEqual(rest);
  });
});

