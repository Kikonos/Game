// v0.14.1 (CREW-3, S1027 BLU1573) crew standing at the gate are never taken off a reported duty because a ticket after
// it (home from where a re-plan no longer ends the trip) leaves from elsewhere: they are re-ticketed. Before, both
// pilots in Goma were released ('At NDJ, not MAN'), a red alarm fired 50 min out at a closed airport offering only
// Cancel, and the gate seated the same captain again 50 min later.

import { describe, expect, it } from 'vitest';
import { addFlight, touchTickets } from '../core/entities';
import { DAY } from '../core/time';
import { advanceTo } from '../sim';
import { openDuties } from './check';
import { addCrew, fixtureGame } from './fixtures';
import { autoRoster, rerosterFrom } from './roster';
import { touchCrew } from './timeline';

describe('v0.14.1 a stale ticket after a reported duty', () => {
  it('keeps the crew at the gate and re-tickets them from where the duty ends', () => {
    const g = fixtureGame();
    const ac = Object.values(g.fleet)[0];
    ac.at = 'GOM';
    const std = Math.floor(g.now / DAY) * DAY + DAY + 10 * 60;
    const f = addFlight(g, { no: 'AW1573', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'GOM', to: 'NDJ', std, sta: std + 195 });
    const here = addCrew(g, { CPT: 1, FO: 1 });
    for (const id of here) {
      const c = g.crew[id];
      c.loc = 'GOM';
      c.awaySince = g.now - DAY;
      c.off = (c.off ?? []).filter(() => false);
    }
    touchCrew(g);
    autoRoster(g, {});
    const d = g.duties[f.dutyId!];
    const p = g.pairings[d.pairingId];
    const seated = p.slots.filter((s) => s.crewId && (s.role === 'CPT' || s.role === 'FO')).map((s) => s.crewId!);
    expect(seated.sort()).toEqual([...here].sort());
    // Reported, not yet off blocks.
    advanceTo(g, d.report + 10);
    expect(g.flights[f.id].status).toBe('scheduled');
    // A re-plan left their ticket home leaving from somewhere the trip no longer ends.
    const home = openDuties(g, p).at(-1)!.deadheadIds.map((id) => g.flights[id]).find((t) => t?.kind === 'deadhead' && here.some((id) => t.crewIds.includes(id)))!;
    expect(home.from).toBe('NDJ');
    home.from = 'TUN';
    touchTickets(g);
    touchCrew(g);
    // Watch the seats: nobody may be taken off them, even for a moment (the roster could seat them again).
    const off: string[] = [];
    for (const s of p.slots) {
      if (!s.crewId || !here.includes(s.crewId)) continue;
      let v: string | null = s.crewId;
      Object.defineProperty(s, 'crewId', { get: () => v, set: (x: string | null) => { if (!x && v) off.push(v); v = x; }, enumerable: true, configurable: true });
    }
    rerosterFrom(g, ac.id, g.now);
    expect(off).toEqual([]);
    for (const id of here) expect(p.slots.some((s) => s.crewId === id)).toBe(true);
    expect(g.flights[f.id].crewIds).toEqual(expect.arrayContaining(here));
    // Their way home now leaves from N'Djamena.
    const tix = Object.values(g.flights).filter((t) => t.kind === 'deadhead' && t.status === 'scheduled' && here.some((id) => t.crewIds.includes(id)));
    expect(tix.some((t) => t.from === 'TUN')).toBe(false);
    expect(tix.some((t) => t.from === 'NDJ')).toBe(true);
  });
});
