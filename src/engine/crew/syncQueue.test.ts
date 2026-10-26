// Crew-planning round (26 Oct 2026): a crewed duty re-measured by a pairing refresh (a leg dropped from it) re-queues its
// report and release. Invariant seed 1: the fuel-stop leg of a STN–ALG–FIH duty was dropped overnight; the duty now
// ended at Algiers at 14:05 but its release stayed queued for 21:10. The crew flew home on their 16:00 ticket while
// still "on duty", and at 21:10 were logged off where the duty had ended: back in Algiers (a teleport).

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, legsOffer, newGame, run } from '../contracts/testkit';
import { DAY } from '../core/time';
import { refreshPairing } from './duties';
import { crewCount } from './timeline';

describe('a crewed duty re-measured by a refresh', () => {
  it('re-queues its release at the new time', () => {
    const g = newGame(21);
    const t0 = Math.floor(g.now / DAY) * DAY + 4 * DAY;
    const o = legsOffer(g, [['LIS', 'FAO', t0 + 9 * 60], ['FAO', 'LIS', t0 + 11 * 60]], 150);
    o.broker = undefined;
    const r = acceptOffer(g, o.id, [leased(g).id]);
    if (!r.ok) throw new Error(r.error);
    run(g, g.now + 60);
    const f1 = Object.values(g.flights).find((f) => f.contractId === r.data!.contractId && f.from === 'FAO')!;
    const d = g.duties[f1.dutyId!];
    const p = g.pairings[d.pairingId];
    expect(crewCount(p)).toBeGreaterThan(0);
    expect(d.flightIds.length).toBe(2);
    const old = d.release;
    // The second leg goes (cancelled by the client, say) and a refresh re-measures the duty before anything else.
    f1.status = 'cancelled';
    refreshPairing(g, p);
    expect(d.release).toBeLessThan(old);
    const rel = g.queue.filter((e) => e.type === 'duty.release' && e.id === d.id && e.v === d.ev);
    expect(rel.map((e) => e.t)).toEqual([d.release]);
  });
});
