// Crew-planning round (26 Oct 2026): a trip that joins the empty leg of a mixed-crew job (the client staffs the cabin) to
// the next charter used to read the client's cabin crew from the trip's own (first) contract, so the charter flew with
// none of ours (bot seed 2: AWL329 ATH–ZRH with 0 cabin crew of the 4 required; seed 1 AWL156 with 2 of 4). The client's
// crew count only where every passenger leg is theirs.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, legsOffer, newGame } from '../contracts/testkit';
import { DAY } from '../core/time';
import { deserialize, serialize } from '../save';
import { legalMinimum, pairingSeats } from './duties';

describe('client cabin crew on a trip of two jobs', () => {
  it('count only when every passenger leg carries them', () => {
    const g = newGame(21);
    const t0 = Math.floor(g.now / DAY) * DAY + 4 * DAY;
    const o = legsOffer(g, [['LIS', 'FAO', t0 + 9 * 60], ['FAO', 'LIS', t0 + 12 * 60]], 150);
    o.broker = undefined;
    const r = acceptOffer(g, o.id, [leased(g).id]);
    if (!r.ok) throw new Error(r.error);
    const k = g.contracts[r.data!.contractId];
    const p = Object.values(g.pairings).find((x) => x.contractId === k.id)!;
    const roles = () => pairingSeats(g, p).map((s) => s.role);
    const full = roles();
    expect(full.filter((x) => x === 'PUR' || x === 'CC').length).toBeGreaterThanOrEqual(4);
    // The trip now reads as another job's, one whose client brings all four cabin crew (its empty leg came first).
    const mixed = { ...k, id: 'kmix', requirements: { ...k.requirements, clientCabin: { n: 4, of: 4, leads: true } } };
    g.contracts[mixed.id] = mixed;
    p.contractId = mixed.id;
    expect(roles()).toEqual(full);
    expect(legalMinimum(g, p).cabin).toBeGreaterThanOrEqual(4);
    // When its own legs are that job's too, the client's crew count.
    for (const f of Object.values(g.flights)) if (f.contractId === k.id) f.contractId = mixed.id;
    expect(roles().filter((x) => x === 'PUR' || x === 'CC').length).toBe(full.filter((x) => x === 'PUR' || x === 'CC').length - 4);
  });

  it('a save from before the fix gets the missing cabin seats on load (empty, for the roster)', () => {
    const g = newGame(21);
    const t0 = Math.floor(g.now / DAY) * DAY + 4 * DAY;
    const o = legsOffer(g, [['LIS', 'FAO', t0 + 9 * 60], ['FAO', 'LIS', t0 + 12 * 60]], 150);
    o.broker = undefined;
    const r = acceptOffer(g, o.id, [leased(g).id]);
    if (!r.ok) throw new Error(r.error);
    const k = g.contracts[r.data!.contractId];
    const p = Object.values(g.pairings).find((x) => x.contractId === k.id)!;
    const n = p.slots.length;
    // As the old game left it: the trip read as a mixed-crew job's, its cabin seats dropped.
    g.contracts.kmix = { ...k, id: 'kmix', requirements: { ...k.requirements, clientCabin: { n: 4, of: 4, leads: true } } };
    p.contractId = 'kmix';
    p.slots = p.slots.filter((s) => s.role === 'CPT' || s.role === 'FO');
    const h = deserialize(serialize(g));
    expect(h.pairings[p.id].slots.length).toBe(n);
  });
});
