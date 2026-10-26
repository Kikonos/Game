// Crew-planning round (26 Oct 2026): a ticket out that the crew flew stays theirs on load. Their trip's first duty went
// with its aircraft's flights at the gate (sub-chartered), the flown ticket moved on to the next duty (from another
// station) and the crew flew on from the ticket's destination. The v0.10.1 load repair for crew who missed a ticket out
// (BLU511) read them as missed (not at its destination) and took them off it: save, load and save again differed.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, legsOffer, newGame, run } from '../contracts/testkit';
import { addFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { deserialize, serialize } from '../save';

function trip(onward: boolean): { g: GameState; ticket: string; crewId: string } {
  const g = newGame(21);
  const t0 = Math.floor(g.now / DAY) * DAY + 4 * DAY;
  const o = legsOffer(g, [['LIS', 'FAO', t0 + 9 * 60], ['FAO', 'LIS', t0 + 11 * 60]], 150);
  o.broker = undefined;
  const r = acceptOffer(g, o.id, [leased(g).id]);
  if (!r.ok) throw new Error(r.error);
  run(g, g.now + 60);
  const f0 = Object.values(g.flights).find((f) => f.contractId === r.data!.contractId && f.from === 'LIS')!;
  const d = g.duties[f0.dutyId!];
  const crewId = g.pairings[d.pairingId].slots.find((s) => s.crewId)!.crewId!;
  // Flown yesterday: out to Madrid on a ticket now held by this duty, then (if `onward`) on from Madrid home.
  const dh = (from: string, to: string, std: number) => {
    const f = addFlight(g, { no: 'TESTDH', aircraftId: null, contractId: null, kind: 'deadhead', from, to, std, sta: std + 90 });
    f.status = 'done';
    f.crewIds = [crewId];
    return f;
  };
  const t = dh('LIS', 'MAD', g.now - 20 * 60);
  d.deadheadIds.push(t.id);
  if (onward) dh('MAD', 'LIS', g.now - 10 * 60);
  g.crew[crewId].loc = 'LIS';
  return { g, ticket: t.id, crewId };
}

describe('a flown ticket out held by a later duty', () => {
  it('keeps its crew on load when they flew on from its destination', () => {
    const { g, ticket, crewId } = trip(true);
    const h = deserialize(serialize(g));
    expect(h.flights[ticket].crewIds).toEqual([crewId]);
    expect(serialize(deserialize(serialize(h)))).toBe(serialize(h));
  });

  it('still takes off crew who never got there (v0.10.1 repair)', () => {
    const { g, ticket } = trip(false);
    const h = deserialize(serialize(g));
    expect(h.flights[ticket].crewIds).toEqual([]);
  });
});
