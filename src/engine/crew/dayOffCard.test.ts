// v0.14.1 (CREW-5) the shortage card never tells the player to call in someone on a day off ('calling them in costs
// overtime and morale −6'): since v0.12.1 Call in never takes a day off, only the buy-back does. When the buy-back is
// not possible either (once a month each), the card says so.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { DAY, monthKey } from '../core/time';
import { crewControl, crewShortCard } from './control';
import { dayIndex } from './dayPlan';
import { buildDuties } from './duties';
import { addCrew, fixtureGame } from './fixtures';
import { touchCrew } from './timeline';

describe('v0.14.1 a day off on the shortage card', () => {
  it('pilots at the departure on a day off they already sold once this month: no "call them in", the reason instead', () => {
    const g = fixtureGame();
    g.company.policies.buyBack = 'ask';
    const ac = Object.values(g.fleet)[0];
    ac.at = 'GOM';
    const std = Math.floor(g.now / DAY) * DAY + 20 * 60;
    const f = addFlight(g, { no: 'AW1570', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'GOM', to: 'NDJ', std, sta: std + 195 });
    const here = addCrew(g, { CPT: 1, FO: 1 });
    for (const id of here) {
      const c = g.crew[id];
      c.loc = 'GOM';
      c.awaySince = g.now - DAY;
      c.off = [...new Set([...(c.off ?? []), dayIndex(c.base, std)])].sort((a, b) => a - b);
      c.boughtOff = [monthKey(std)];
    }
    // Every pilot has sold a day off this month already: no buy-back anywhere.
    // The rest of the pilots are on leave.
    for (const c of Object.values(g.crew)) if ((c.role === 'CPT' || c.role === 'FO') && !here.includes(c.id)) c.blocks = [...(c.blocks ?? []), { from: g.now - DAY, to: g.now + 5 * DAY, why: 'leave' }];
    touchCrew(g);
    buildDuties(g, ac.id, g.now, g.now + 3 * DAY);
    const card = crewShortCard(g, f.id)!;
    const v = crewControl(g, f.id, { previews: false, only: ['callIn', 'buyBack'] })!;
    expect(v.solutions.find((s) => s.id === 'callIn')!.available).toBe(false);
    expect(card.why).not.toMatch(/calling them in|overtime/);
    expect(card.why).toMatch(/on a day off at Goma and cannot be asked to work it: they already worked a day off this month/);
  });
});
