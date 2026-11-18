// v0.25 review (the Malteser save, 13 Sep 2027): 'Set 3 at DEL: 7 crew go home early' while all seven were taken off
// only a split-off part of the tour and put back on it, flying on out of DEL until the tour ended. Inside a re-roster
// the note now waits: only crew who no longer fly the set's tour get it. Also one line per person, plain reasons.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, newGame, offer, run } from '../contracts/testkit';
import { DAY } from '../core/time';
import type { GameState, Pairing } from '../core/types';
import { holdEarlyHome, releaseCrew } from './roster';
import { plainWhy } from './reasons';
import { openDuties } from './check';
import { touchCrew } from './timeline';

function tourGame(): { g: GameState; p: Pairing; id: string } {
  const g = newGame(21);
  const ac = leased(g);
  const o = offer(g, 'seasonBase', { airport: 'DUB', dests: ['LIS'], waves: 2, start: g.now + 3 * DAY, days: 60 });
  o.broker = undefined;
  const r = acceptOffer(g, o.id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  run(g, g.contracts[r.data!.contractId].start + 10 * DAY);
  const p = Object.values(g.pairings).filter((q) => q.tour && q.status === 'active' && openDuties(g, q).length > 2
    && q.slots.some((s) => s.crewId && g.crew[s.crewId].loc === 'DUB' && !s.guest && !s.locked)).sort((a, b) => a.start - b.start)[0];
  expect(p).toBeTruthy();
  const id = p.slots.find((s) => s.crewId && g.crew[s.crewId].loc === 'DUB' && !s.guest && !s.locked)!.crewId!;
  return { g, p, id };
}
const notes = (g: GameState) => g.messages.filter((m) => / go(es)? home early$/.test(m.title));

describe('v0.25 go home early: only those who really go', () => {
  it('a crew member taken off and put back on the tour within the re-roster gets no note', () => {
    const { g, p, id } = tourGame();
    const n0 = notes(g).length;
    holdEarlyHome(g, () => {
      const slot = p.slots.find((s) => s.crewId === id)!;
      releaseCrew(g, p, id, 'Ticket DUB–LIS clashes with the trip');
      slot.crewId = id;
      touchCrew(g);
    });
    expect(notes(g).length).toBe(n0);
    expect(g.crew[id].homeWhy).toBeUndefined();
  });
  it('one who stays off the tour gets the note, in plain words, once', () => {
    const { g, p, id } = tourGame();
    const n0 = notes(g).length;
    holdEarlyHome(g, () => {
      releaseCrew(g, p, id, 'Ticket DUB–LIS clashes with the trip');
      releaseCrew(g, p, id, 'Ticket DUB–LIS clashes with the trip');
    });
    const ns = notes(g);
    expect(ns.length).toBe(n0 + 1);
    expect(ns[0].body).toMatch(/^Their flight DUB to LIS no longer fits the trip\. Set \d at DUB/);
  });
  it('reads where-they-are reasons in plain words', () => {
    expect(plainWhy('Ticket DEL–MLA clashes with the trip')).toBe('Their flight DEL to MLA no longer fits the trip');
    expect(plainWhy('At MLA, not NTE')).toBe('Not in Nantes in time (planned to be in Valletta)');
  });
});
