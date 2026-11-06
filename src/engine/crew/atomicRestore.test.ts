// Rotations round (Nov 2026), bot seed 1: a change undone by atomic() put back a ticket it had deleted, but the deadhead
// index had already dropped its id, so the crew read as holding no ticket home until a reload. The roster kept their
// tour's ticket out from Nantes and the day planner put a hotel standby there while they were home in Lisbon (and a
// game played on in memory no longer matched the same game saved and loaded).

import { describe, expect, it } from 'vitest';
import { newGame } from '../contracts/testkit';
import { addDeadhead, deadheadFlights } from '../core/entities';
import { DAY } from '../core/time';
import { atomic } from './atomic';
import { crewIx, touchCrew } from './timeline';

describe('atomic() undo and the ticket index', () => {
  it('a ticket deleted inside an undone change is a ticket again afterwards', () => {
    const g = newGame(21);
    const c = Object.values(g.crew).find((x) => x.status === 'available')!;
    const f = addDeadhead(g, { crewIds: [c.id], from: 'NTE', to: c.base, std: g.now + DAY, sta: g.now + DAY + 115, cost: 0 });
    touchCrew(g);
    expect((crewIx(g).tickets.get(c.id) ?? []).map((x) => x.id)).toContain(f.id);
    atomic(g, 'test', () => false, () => {
      delete g.flights[f.id];
      deadheadFlights(g); // the index notices it is gone
      return false;
    }, () => true);
    expect(g.flights[f.id]).toBeDefined();
    touchCrew(g);
    expect(deadheadFlights(g).map((x) => x.id)).toContain(f.id);
    expect((crewIx(g).tickets.get(c.id) ?? []).map((x) => x.id)).toContain(f.id);
  });
});
