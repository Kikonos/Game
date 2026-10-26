// Debug round (26 Oct 2026): a bot game (seed 1, 24 Dec 00:19): A320 CS-TVQ diverted to Gatwick for the Heathrow
// curfew; its empty move LGW–LHR and its next departure LHR–CMN both leave at 01:20. Legs at the same minute were
// ordered by id, so delaying the departure (aircraft not there yet) pushed its own inbound move behind it; the move,
// now after the leg it feeds, was re-planned anew at 01:20, and so on until the safety net stopped it (500 copies).

import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures/compatKit';
import { safetyTrips } from '../core/safety';
import { deserialize } from '../save';
import { advanceTo } from '../sim';

describe('legs leaving at the same minute', () => {
  it('a delay never pushes the move that brings the aircraft behind the leg it feeds', () => {
    const g = deserialize(fixture('v011-churn'));
    const trips = safetyTrips.length;
    const seq0 = g.seq;
    const end = g.now + 4 * 60;
    while (g.now < end) advanceTo(g, Math.min(end, g.now + 15));
    expect(safetyTrips.length).toBe(trips);
    // A handful of new ids (legs, duties, messages), not hundreds of copies.
    expect(g.seq - seq0).toBeLessThan(150);
  }, 60_000);
});
