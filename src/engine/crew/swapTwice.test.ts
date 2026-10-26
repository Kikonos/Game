// Debug round (26 Oct 2026): Crew Control's swap never seats someone already on the trip. A bot game (seed 1, 28 Nov):
// AWL298 BKO–DSS is short of a first officer; its captain is also rostered on AWL306, and the swap took "the crew of
// AWL306" for the empty seat: the same captain, now in both seats of AWL298.

import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures/compatKit';
import { deserialize } from '../save';
import { advanceTo } from '../sim';
import { applyCrewFix, crewControl } from './control';

describe('crew control swap', () => {
  it('takes nobody who already holds a seat on the trip', () => {
    const g = deserialize(fixture('v011-swap'));
    advanceTo(g, g.now + 24 * 60);
    const f = Object.values(g.flights).find((x) => x.no === 'AWL298' && x.status === 'scheduled')!;
    expect(f).toBeTruthy();
    const view = crewControl(g, f.id, { previews: false, only: ['swap'], noCard: true });
    const sw = view?.solutions.find((s) => s.id === 'swap');
    if (sw?.available) applyCrewFix(g, f.id, 'swap', { confirmed: true });
    const p = g.pairings[g.duties[f.dutyId!].pairingId];
    const ids = p.slots.map((s) => s.crewId).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  }, 60_000);
});
