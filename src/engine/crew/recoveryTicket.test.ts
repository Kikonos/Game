// v0.18.2 (bot seed 2, v0.17 seed 3): a crew set sent home from a deployment after its last duty, on its days off, with
// a hotel standby planned after them. The 168 h since the last recovery rest (ORO.FTL.235(d)) ran out before the first
// seat home, so the ticket had to wait for a recovery rest at the hotel; but the search for that rest read the standby
// still to come as work, found no 60 h free stretch (four disruptive early starts) and kept the illegal hour: a ticket
// home landing 176 h after the last recovery rest. Standby not started gives way to the ticket (it is re-fitted after
// it), so the ticket now waits for the recovery at the hotel and lands inside the limit.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { hamBase, leased, newGame, run } from '../contracts/testkit';
import { BAL } from '../core/balance';
import { DAY, HOUR } from '../core/time';
import type { GameState, Pairing } from '../core/types';
import { LIMITS, recoveryAnchor } from './rules';
import { releaseCrew } from './roster';
import { ctxOf, segsOf, touchCrew } from './timeline';
import { rollingRoster } from '../../test/rolling';

rollingRoster();

function tourAtStation(): { g: GameState; p: Pairing; id: string } {
  const g = newGame(21, 'LIS');
  const o = hamBase(g, g.now + 3 * DAY, 40, 2);
  o.broker = undefined;
  expect(acceptOffer(g, o.id, [leased(g).id]).ok).toBe(true);
  run(g, g.now + 12 * DAY);
  for (const p of Object.values(g.pairings)) {
    if (!p.tour || p.status !== 'active') continue;
    for (const s of p.slots) {
      const c = s.crewId ? g.crew[s.crewId] : undefined;
      if (c && c.loc === 'HAM' && c.status !== 'onDuty' && c.restUntil <= g.now) return { g, p, id: c.id };
    }
  }
  throw new Error('no tour crew at the station');
}

describe('a ticket home past the weekly recovery', () => {
  it('waits for the recovery rest at the hotel even with standby planned after the days off', () => {
    const { g, p, id } = tourAtStation();
    const c = g.crew[id];
    // A disruptive week: four early starts since the last recovery rest, the last duty just ended; the 168 h run out
    // before the minimum rest is over (no seat home lands in time).
    const end = g.now - 30;
    c.log = [0, 1, 2, 3].map((k) => ({ start: end - (3 - k) * DAY - 7 * HOUR, end: end - (3 - k) * DAY, fdp: 7 * HOUR, block: 5 * HOUR, sectors: 2, augmented: false, disruptive: true }));
    c.lastRecovery = end - 165 * HOUR;
    c.restUntil = end + 12 * HOUR;
    // Hotel standby every day from 59 h after the last duty (one hour short of the 60 h recovery after 4 disruptive duties).
    c.standby = [0, 1, 2, 3, 4].map((k) => ({ from: end + 59 * HOUR + k * DAY, to: end + 71 * HOUR + k * DAY, kind: 'hotel' as const, at: 'HAM' }));
    touchCrew(g);
    releaseCrew(g, p, id, 'Test release');
    const tickets = Object.values(g.flights).filter((f) => f.kind === 'deadhead' && f.status === 'scheduled' && f.crewIds.includes(id));
    // Never a ticket landing past the 168 h: either none yet (they wait), or one after the recovery rest at the hotel.
    for (const f of tickets) {
      const segs = segsOf(g, c).filter((x) => x.kind !== 'sby');
      const anchor = recoveryAnchor(ctxOf(g, c), segs, f.std - BAL.deadheadCheckIn);
      expect(f.sta, `ticket ${f.from}–${f.to}`).toBeLessThanOrEqual(anchor + LIMITS.recoveryEvery);
      expect(f.std - BAL.deadheadCheckIn - end).toBeGreaterThanOrEqual(LIMITS.recoveryLong);
    }
    expect(tickets.length).toBeGreaterThan(0);
  }, 120_000);
});
