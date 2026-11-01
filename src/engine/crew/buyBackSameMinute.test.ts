// v0.14.1 (h-crew suspect, proven in 9 player/fuzz saves) a day off bought and given back in the same minute (the
// roster re-planned the seat at once) posted 'X works the day off on Mon 29 Nov (+$1.0K)' and 'X keeps the day off on
// Mon 29 Nov' side by side. Nothing happened for the player: neither is posted, and the chime goes with its notice.
// Given back later, 'keeps the day off' is said as before.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { takeCueEvents } from '../core/cues';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { dayIndex } from './dayPlan';
import { buildDuties } from './duties';
import { addCrew, fixtureGame } from './fixtures';
import { autoRoster, releaseCrew } from './roster';
import { touchCrew } from './timeline';

function goma(): { g: GameState; dutyId: string; here: string[] } {
  const g = fixtureGame();
  g.company.policies.buyBack = 'auto';
  const ac = Object.values(g.fleet)[0];
  ac.at = 'GOM';
  const std = Math.floor(g.now / DAY) * DAY + 20 * 60;
  addFlight(g, { no: 'AW1570', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'GOM', to: 'NDJ', std, sta: std + 195 });
  const here = addCrew(g, { CPT: 1, FO: 1 });
  for (const id of here) {
    const c = g.crew[id];
    c.loc = 'GOM';
    c.awaySince = g.now - DAY;
    c.morale = 70;
    c.off = [...new Set([...(c.off ?? []), dayIndex(c.base, std)])].sort((a, b) => a - b);
  }
  touchCrew(g);
  const d = buildDuties(g, ac.id, g.now, g.now + 3 * DAY)[0];
  return { g, dutyId: d.id, here };
}

const notes = (g: GameState) => g.messages.filter((m) => /(works|keeps) the day off/.test(m.title)).map((m) => m.title);

describe('v0.14.1 a buy-back undone in the same minute', () => {
  it('posts nothing and takes its chime back', () => {
    const { g, dutyId, here } = goma();
    takeCueEvents();
    autoRoster(g, {});
    expect(notes(g).filter((t) => /works/.test(t)).length).toBe(2);
    const p = g.pairings[g.duties[dutyId].pairingId];
    for (const id of here) releaseCrew(g, p, id);
    expect(notes(g)).toEqual([]);
    expect(takeCueEvents().filter((e) => /day off/.test(e.title))).toEqual([]);
  });

  it('given back later, it says the day off is kept', () => {
    const { g, dutyId, here } = goma();
    autoRoster(g, {});
    const p = g.pairings[g.duties[dutyId].pairingId];
    g.now += 1;
    for (const id of here) releaseCrew(g, p, id);
    expect(notes(g).filter((t) => /keeps/.test(t)).length).toBe(2);
    expect(notes(g).filter((t) => /works/.test(t)).length).toBe(2);
  });
});
