// Crew-planning round (26 Oct 2026): the weekly recovery rest (ORO.FTL.235(d), 36 h with 2 local nights, at most 168 h
// apart) is read from the time off before the crew member's own start. A ticket out merged into the FDP checks in hours
// before the duty's report: the time off ends at that check-in, not at the report, and the next 168 h run from there. (Seed 6: an FO ticketed out at 08:00
// for a 13:45 report, 33 h after a home standby, had the time off counted as a recovery rest up to 13:45; the next 168 h
// ran from there and a standby took her to 179 h.)

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { hamBase, leased, newGame, run } from '../contracts/testkit';
import { retimeFlight, touchTickets } from '../core/entities';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { Duty, Flight, GameState, Pairing } from '../core/types';
import { outStillFits, touchCrew } from './timeline';

const CI = BAL.deadheadCheckIn;
const sameDay = (d: Duty, t: Flight) => Math.floor((d.report - 60 - t.block) / 60) * 60;

/** A HAM base crewed from an hour away: a duty whose crew fly out the same morning (the ticket is part of the FDP). */
function trip(): { g: GameState; p: Pairing; d: Duty; t: Flight } {
  for (const [home, waves] of [['BER', 2], ['DUS', 2], ['AMS', 3]] as const) {
    const g = newGame(21, home);
    const o = hamBase(g, g.now + 3 * DAY, 30, waves);
    o.broker = undefined;
    if (!acceptOffer(g, o.id, [leased(g).id]).ok) continue;
    run(g, g.now + 60);
    for (const d of Object.values(g.duties).sort((a, b) => a.report - b.report)) {
      const p = g.pairings[d.pairingId];
      const t = d.deadheadIds.map((id) => g.flights[id]).find((x) => x?.kind === 'deadhead' && x.status === 'scheduled' && x.to === g.flights[d.flightIds[0]]?.from && x.std > g.now + DAY);
      if (p && t && outStillFits(g, p, d, t.from, sameDay(d, t), t.block)) return { g, p, d, t };
    }
  }
  throw new Error('no duty with a ticket out');
}

describe('weekly recovery rest and a ticket out on the day', () => {
  it('the time off ends at the ticket check-in, not at the report', () => {
    const { g, d, t } = trip();
    const std = sameDay(d, t);
    retimeFlight(g, t, std, std + t.block);
    touchTickets(g);
    touchCrew(g);
    const checkIn = std - CI;
    run(g, checkIn - 60);
    expect(g.duties[d.id].report).toBe(d.report);
    // Three days off before it, after a home standby: a recovery rest, which ends when they check in for the ticket.
    const end = checkIn - 3 * DAY;
    const old = end - 5 * DAY;
    for (const id of t.crewIds) {
      const c = g.crew[id];
      c.standby = [{ from: end - 12 * 60, to: end, kind: 'home', at: c.base }];
      c.log = c.log.filter((e) => e.end <= end - 12 * 60);
      c.lastRecovery = old;
    }
    touchCrew(g);
    run(g, g.duties[d.id].report + 30);
    for (const id of t.crewIds) {
      const c = g.crew[id];
      expect(c.status).toBe('onDuty');
      // The next 168 h run from the check-in (before: from the report, 3 h later).
      expect(c.lastRecovery, `${c.first} ${c.last}`).toBe(checkIn);
    }
  }, 120_000);
});
