// v0.14.1 (h-crew suspect) the jet row said 'already at Lisbon: use Auto-fix or Call in' while both rows beside it
// were greyed out. It names only the fixes that are offered; with none, it says a jet would not help.

import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '../core/types';
import { demoFlights } from '../dev';
import { advanceTo } from '../sim';
import { crewControl, shortFlights } from '.';
import { fixtureGame } from './fixtures';
import { releaseCrew } from './roster';

// The roster refuses every placement: Call in's preview fails although the crew are at the airport.
const refuse = { on: false };
vi.mock('./rosterActions', async (orig) => {
  const m = await orig<typeof import('./rosterActions')>();
  return { ...m, assignCrew: (...a: Parameters<typeof m.assignCrew>) => (refuse.on ? { ok: false as const, error: 'refused' } : m.assignCrew(...a)) };
});

function short(): { g: GameState; id: string } {
  const g = fixtureGame(5);
  demoFlights(g, undefined, 4, 'revenue');
  advanceTo(g, g.now + 60);
  const f = Object.values(g.flights).filter((x) => x.status === 'scheduled' && x.dutyId && x.std > g.now + 20 * 60 && x.std < g.now + 40 * 60).sort((a, b) => a.std - b.std)[0];
  const d = g.duties[f.dutyId!];
  const p = g.pairings[d.pairingId];
  for (const s of [...p.slots]) if (s.crewId && (s.role === 'CPT' || s.role === 'FO')) releaseCrew(g, p, s.crewId);
  return { g, id: shortFlights(g).find((r) => g.flights[r.flightId].dutyId === d.id)!.flightId };
}

describe('v0.14.1 the jet row points only to fixes that are offered', () => {
  it('Call in offered: "use Call in"; Call in refused: "a jet would not help"', () => {
    const { g, id } = short();
    const jet = (on: boolean) => {
      refuse.on = on;
      try {
        const v = crewControl(g, id, { previews: true, noCard: true, only: ['callIn', 'jet'] })!;
        return { callIn: v.solutions.find((s) => s.id === 'callIn')!, jet: v.solutions.find((s) => s.id === 'jet')! };
      } finally {
        refuse.on = false;
      }
    };
    const a = jet(false);
    expect(a.callIn.available).toBe(true);
    expect(a.jet.why).toMatch(/already at .+: use Call in$/);
    const b = jet(true);
    expect(b.callIn.available).toBe(false);
    expect(b.jet.why).toMatch(/already at .+: a jet would not help$/);
    expect(b.jet.why).not.toMatch(/Auto-fix|Call in/);
  });
});
