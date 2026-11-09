// v0.19.4 fix (seed 2 --wide --inv, 3 recovery-rest errors): a crew's ticket out goes where their trip starts. When a new
// job re-plans an aircraft and the trip's first duty (its empty legs out of the old station) goes, the trip starts
// somewhere else; the re-check re-tickets its crew, and a ticket to the old station is no ticket out any more.
// (Before: retick kept it as "still fits" from its timing alone; the crew stayed on the trip flagged 'At VNO, not BVC',
// flew LIS–VNO for nothing two days later, then home again, 203 h without a recovery rest.)

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { legsOffer, newGame } from '../contracts/testkit';
import { DAY } from '../core/time';
import type { GameState, Pairing } from '../core/types';
import { advanceTo } from '../sim';
import { recheckPairing } from './roster';
import { crewIx } from './timeline';

/** The departure of a trip's first open duty. */
function firstDep(g: GameState, p: Pairing): string | undefined {
  const d = p.dutyIds.map((id) => g.duties[id]).find((x) => x && !x.done);
  return d ? g.flights[d.flightIds[0]]?.from ?? d.restAt : undefined;
}

/** Crew of planned trips holding a ticket out (landing before the trip's first report) that goes somewhere else. */
function staleOuts(g: GameState): string[] {
  const out: string[] = [];
  for (const p of Object.values(g.pairings)) {
    if (p.status !== 'planned') continue;
    const dep = firstDep(g, p);
    const d0 = p.dutyIds.map((id) => g.duties[id]).find((x) => x && !x.done);
    if (!dep || !d0) continue;
    for (const s of p.slots) {
      if (!s.crewId) continue;
      for (const f of crewIx(g).tickets.get(s.crewId) ?? []) {
        if (f.kind !== 'deadhead' || f.status !== 'scheduled' || f.leaveTrip || f.std <= g.now || f.sta > d0.report || f.std < p.start - 2 * DAY) continue;
        if (!d0.deadheadIds.includes(f.id)) continue;
        if (f.to !== dep) out.push(`${g.crew[s.crewId].last} on ${p.id}: ticket ${f.from}–${f.to}, trip starts at ${dep}`);
      }
    }
  }
  return out;
}

describe('a ticket out follows the trip when its first duty goes', () => {
  it('re-tickets (or replaces) crew whose trip no longer starts where their ticket lands', () => {
    let found = false;
    for (const seed of [2, 3, 5, 7, 11]) {
      const g = newGame(seed);
      const ac = Object.values(g.fleet)[0];
      const t0 = Math.floor(g.now / DAY) * DAY + 2 * DAY;
      // Job 1 leaves the aircraft at Vilnius; job 2 starts at Madrid early four days later: one trip of an empty VNO–MAD
      // positioning duty the evening before and the job, its crew flown out to Vilnius on an airline ticket.
      if (!acceptOffer(g, legsOffer(g, [['LIS', 'VNO', t0 + 9 * 60]]).id, [ac.id]).ok) continue;
      if (!acceptOffer(g, legsOffer(g, [['MAD', 'FCO', t0 + 4 * DAY + 6 * 60], ['FCO', 'MAD', t0 + 4 * DAY + 10 * 60]]).id, [ac.id]).ok) continue;
      advanceTo(g, g.now + 60, new Set());
      const trip = Object.values(g.pairings).find((p) => p.status === 'planned' && p.aircraftId === ac.id && firstDep(g, p) === 'VNO' && p.slots.some((s) => s.crewId && (crewIx(g).tickets.get(s.crewId) ?? []).some((f) => f.kind === 'deadhead' && f.to === 'VNO' && f.status === 'scheduled')));
      if (!trip) continue;
      expect(staleOuts(g)).toEqual([]);
      // Job 3 (signed now): Vilnius–Amsterdam the morning before; the aircraft now positions AMS–MAD, the VNO–MAD duty goes.
      if (!acceptOffer(g, legsOffer(g, [['VNO', 'AMS', t0 + 3 * DAY + 8 * 60]]).id, [ac.id]).ok) continue;
      advanceTo(g, g.now + 60, new Set());
      if (!g.pairings[trip.id] || firstDep(g, g.pairings[trip.id]) === 'VNO') continue;
      found = true;
      // Nobody keeps a ticket to Vilnius for a trip that starts elsewhere; the trip is not left flagged for its place.
      expect(staleOuts(g)).toEqual([]);
      const rc = recheckPairing(g, g.pairings[trip.id]);
      expect([...rc.issue.values()].filter((i) => i.code === 'location').map((i) => i.text)).toEqual([]);
      break;
    }
    expect(found).toBe(true);
  });
});
