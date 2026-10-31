// v0.12.1 (Round F, C9 and C13): crew tickets flew into and out of airports a world event had closed (EV-S01: Lisbon–
// Goma during the fighting near Goma), and landed inside night curfews (EV-S04: 165 on seed 9). A ticket is now only
// an airline seat that exists: both airports open, no landing in the destination's curfew.

import { describe, expect, it } from 'vitest';
import { curfewOk } from '../core/curfew';
import { DAY } from '../core/time';
import type { GameState, Minute } from '../core/types';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { addFlight } from '../core/entities';
import { blockMinutes } from '../core/perf';
import { buildDuties } from './duties';
import { outTicket, setClosedCheck, slotAfter, ticketSlotOk } from './timeline';
import { closedAirport } from '../ops/world';

/** A trip from `dep` reporting around `hhmm` UTC two days out; crew at base (LIS). */
function trip(dep: string, hhmm: number) {
  const g = fixtureGame(5);
  const acId = Object.keys(g.fleet)[0];
  g.fleet[acId].at = dep;
  const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + hhmm;
  const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [acId], start: std - DAY, end: std + 2 * DAY });
  addFlight(g, { no: 'AW1', aircraftId: acId, contractId: k.id, kind: 'revenue', from: dep, to: 'PMI', std, sta: std + blockMinutes(g.fleet[acId].typeId, dep, 'PMI'), pax: 150 });
  const d = buildDuties(g, acId, g.now, g.now + 5 * DAY)[0];
  addCrew(g, { CPT: 1 });
  return { g, d, p: g.pairings[d.pairingId] };
}

describe('crew tickets are seats that exist (C9, C13)', () => {
  it('never land inside the night curfew (Frankfurt, an early report)', () => {
    // 04:30 UTC departure: the day-before ticket with its rest, or a same-day one, but never a landing 23:00-05:00 local.
    const { g, d, p } = trip('FRA', 4 * 60 + 30);
    const t = outTicket(g, p, d, 'LIS').plan;
    expect(curfewOk('FRA', t.sta)).toBe(true);
    for (let h = 0; h < 48; h++) {
      const std = Math.floor(g.now / DAY) * DAY + h * 60;
      const x = slotAfter(g, 'LIS', 'FRA', std, 180);
      expect(curfewOk('FRA', x + 180)).toBe(true);
    }
  });

  it('never fly into or out of an airport a world event has closed', () => {
    const { g, d, p } = trip('FRA', 14 * 60);
    const shut: [Minute, Minute] = [g.now, g.now + 3 * DAY];
    setClosedCheck((_g: GameState, code: string, t: Minute) => code === 'LIS' && t >= shut[0] && t < shut[1]);
    try {
      expect(ticketSlotOk(g, 'LIS', 'FRA', g.now + 60, g.now + 240)).toBe(false);
      expect(ticketSlotOk(g, 'MAD', 'FRA', g.now + 60, g.now + 240)).toBe(true);
      const t = outTicket(g, p, d, 'LIS');
      // No seat leaves Lisbon before the trip: the plan is no workable ticket (crew control looks elsewhere).
      expect(t.plan.std < shut[1] && t.why === null).toBe(false);
    } finally {
      setClosedCheck((h, code, t) => !!closedAirport(h, code, t));
    }
  });
});
