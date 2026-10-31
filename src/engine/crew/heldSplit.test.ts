// v0.12.1 (Round F, C2): a leg held "Waiting for a rescue crew" at an outstation kept its own crew on duty at the gate for
// 2.5 days (seed 9: EI4023 at Gatwick, FDP 60 h of 11 h), because the duty was only split for a hotel rest when its flights
// changed unseen: the guard had already re-synced it. A duty under way whose next leg leaves after a night's rest now
// ends at the last landing whichever path moved the leg, and the hourly check makes sure nobody stays on duty past it.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, legsOffer, newGame } from '../contracts/testkit';
import { retimeFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { Duty, Flight, GameState, Pairing } from '../core/types';
import { advanceTo } from '../sim';
import { syncDuty } from './duties';
import { splitOverlong } from './roster';

/** A LIS–PMI–LIS day trip, flown to PMI; the crew are at Palma, the return still to go. */
function atPalma(): { g: GameState; p: Pairing; d: Duty; back: Flight } {
  const g = newGame(21);
  const ac = leased(g);
  const dep = Math.ceil(g.now / DAY) * DAY + DAY + 8 * 60;
  const r = acceptOffer(g, legsOffer(g, [['LIS', 'PMI', dep], ['PMI', 'LIS', dep + 4 * 60]]).id, [ac.id]);
  expect(r.ok).toBe(true);
  advanceTo(g, g.now + 1, new Set());
  const back = Object.values(g.flights).find((f) => f.contractId === (r.ok ? r.data?.contractId : '') && f.from === 'PMI')!;
  const out = Object.values(g.flights).find((f) => f.contractId === back.contractId && f.to === 'PMI')!;
  advanceTo(g, out.sta + 30, new Set());
  expect(out.status).toBe('done');
  const d = g.duties[back.dutyId!];
  const p = g.pairings[d.pairingId];
  expect(d.report).toBeLessThan(g.now);
  expect(p.slots.some((s) => s.crewId)).toBe(true);
  return { g, p, d, back };
}

const onDuty = (g: GameState, p: Pairing) => p.slots.filter((s) => s.crewId && g.crew[s.crewId]?.status === 'onDuty').length;

describe('a leg held overnight at an outstation (C2)', () => {
  it('ends the duty at the last landing even when the duty was already re-synced', () => {
    const { g, p, d, back } = atPalma();
    // Held 30 h (a rescue crew); the guard re-syncs the duty before the crew's settle sees the change.
    retimeFlight(g, back, back.std + 30 * 60, back.sta + 30 * 60);
    syncDuty(g, d, p);
    advanceTo(g, g.now + 1, new Set());
    expect(back.dutyId).not.toBe(d.id);
    const d2 = g.duties[back.dutyId!];
    expect(d2.report).toBeGreaterThan(g.now);
    expect(d.flightIds).not.toContain(back.id);
    // The crew go to the hotel: nobody on duty for more than the limit.
    advanceTo(g, d.report + d.maxFdp + 3 * 60, new Set());
    expect(onDuty(g, p)).toBe(0);
  });

  it('the hourly check splits a duty kept past its limit', () => {
    const { g, p, d, back } = atPalma();
    retimeFlight(g, back, back.std + 30 * 60, back.sta + 30 * 60);
    syncDuty(g, d, p);
    // Past the limit with the leg still in the duty (as the seed 9 save stood).
    g.now = d.report + d.maxFdp + (d.discretion ?? 0) + 90;
    splitOverlong(g);
    expect(back.dutyId).not.toBe(d.id);
    expect(g.duties[back.dutyId!].report).toBeGreaterThan(g.now);
  });
});
