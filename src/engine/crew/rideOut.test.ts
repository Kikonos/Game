// Crew-planning round (26 Oct 2026): crew ride our own empty legs out to a trip in preference to an airline ticket,
// but only when the ride works like a ticket would: they rest after it, or the ride and the duty fit one FDP. The 747 run
// had crew riding a LIS–LIM positioning flight that landed 10:30 before a Lima report (14 h rest due after it): every
// crew member read a 33 h day, the duty stayed empty for days and was sub-chartered again and again.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, legsOffer, newGame, owned } from '../contracts/testkit';
import { addFlight } from '../core/entities';
import { DAY } from '../core/time';
import { outTicket } from './timeline';

describe('riding our own empty leg out to a trip', () => {
  it('is taken when the crew rest after it or it fits the day, never when it leaves neither', () => {
    const g = newGame(21);
    const t0 = Math.floor(g.now / DAY) * DAY + 4 * DAY;
    // Out to Madrid, three days there, then a Palma round trip: its duty starts in Madrid.
    const o = legsOffer(g, [['LIS', 'MAD', t0 + 9 * 60], ['MAD', 'PMI', t0 + 3 * DAY + 15 * 60], ['PMI', 'MAD', t0 + 3 * DAY + 18 * 60]], 150);
    o.broker = undefined;
    const r = acceptOffer(g, o.id, [leased(g).id]);
    if (!r.ok) throw new Error(r.error);
    const f0 = Object.values(g.flights).find((f) => f.contractId === r.data!.contractId && f.from === 'MAD' && f.to === 'PMI')!;
    const f1 = Object.values(g.flights).find((f) => f.contractId === r.data!.contractId && f.from === 'PMI')!;
    const p = g.pairings[g.duties[f0.dutyId!].pairingId];
    // The Palma round trip as a duty of its own from Madrid (as at a deployment base), its crew coming out from Lisbon.
    const d = { ...g.duties[f0.dutyId!], flightIds: [f0.id, f1.id], report: f0.std - 60, release: f1.sta + 30, fdp: f1.sta - f0.std + 60, sectors: 2 };
    const ac = owned(g);
    // Another aircraft's empty leg LIS–MAD landing `before` minutes ahead of the report.
    const ride = (before: number) => {
      for (const f of Object.values(g.flights)) if (f.no === 'TESTRIDE') delete g.flights[f.id];
      const sta = d.report - before;
      return addFlight(g, { no: 'TESTRIDE', aircraftId: ac.id, contractId: null, kind: 'positioning', from: 'LIS', to: 'MAD', std: sta - 80, sta });
    };
    // Lands 13 h before report: the crew rest at the hotel, then fly.
    const rested = ride(13 * 60);
    expect(outTicket(g, p, d, 'LIS', g.now).plan.rideId).toBe(rested.id);
    // Lands 2 h before report: the ride and the duty are one short day.
    const sameDay = ride(2 * 60);
    expect(outTicket(g, p, d, 'LIS', g.now).plan.rideId).toBe(sameDay.id);
    // Lands 7 h before report: too little rest, and the day from the ride's check-in through the duty is too long.
    const neither = ride(7 * 60);
    const plan = outTicket(g, p, d, 'LIS', g.now).plan;
    expect(plan.rideId).not.toBe(neither.id);
  });
});
