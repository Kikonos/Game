// Crew-planning round (26 Oct 2026): after a late landing the duty ends at the real on-blocks (debug round), and now
// what comes after it moves too. Player's save: crew landed late at Rhodes and their ticket home, booked for after the
// rest, left 9:16 later (10:00 due); seed 1 the same at Riga (9:19). Crew control rebooks the ticket onto the first seat
// after the rest (ORO.FTL.235(b); commander's discretion never shortens it), and a ticket straight on that the crew can
// no longer check in for is rebooked rather than left to leave without them.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, dubBase, newGame, run } from '../contracts/testkit';
import { retimeFlight, touchTickets } from '../core/entities';
import { BAL } from '../core/balance';
import { schedule } from '../core/queue';
import { DAY } from '../core/time';
import type { Duty, Flight, GameState } from '../core/types';
import { minRest, tzDeltaH } from './rules';
import { cabinEarly, touchCrew } from './timeline';

const CI = BAL.deadheadCheckIn;

/** A Dublin base (v0.12.1: was Hamburg, whose night ban now trims the third wave) crewed from Lisbon: the first trip whose last duty has a ticket home on an airline. */
function trip(): { g: GameState; d: Duty; t: Flight } {
  const g = newGame(21);
  const o = dubBase(g, g.now + 3 * DAY, 30);
  o.broker = undefined;
  const r = acceptOffer(g, o.id, [leased(g).id]);
  if (!r.ok) throw new Error(r.error);
  run(g, g.contracts[r.data!.contractId].start - DAY);
  const duties = Object.values(g.duties).filter((d) => !d.done && d.report > g.now + 12 * 60).sort((a, b) => a.report - b.report);
  for (const d of duties) {
    const t = d.deadheadIds.map((id) => g.flights[id]).find((x) => x?.kind === 'deadhead' && x.status === 'scheduled' && x.std >= d.release && x.from === d.restAt && x.crewIds.length >= 2);
    if (t) return { g, d, t };
  }
  throw new Error('no duty with a ticket home');
}

/** Plays to the duty's last leg airborne, then holds it: it lands `late` minutes after its schedule. */
function landLate(g: GameState, d: Duty, late: number): Flight {
  const last = g.flights[d.flightIds[d.flightIds.length - 1]];
  for (let i = 0; i < 2000 && last.status === 'scheduled'; i++) run(g, g.now + 10);
  expect(last.status).toBe('enroute');
  last.eta = Math.max(last.eta ?? last.sta, last.sta) + late;
  last.ev++;
  schedule(g, last.eta, 'flight.arr', last.id, last.ev);
  return last;
}

/** Tickets the crew member holds out of `from` still to fly. */
const ticketsOf = (g: GameState, id: string, from: string) => Object.values(g.flights).filter((f) => f.kind === 'deadhead' && f.status === 'scheduled' && f.from === from && f.crewIds.includes(id));

describe('a late landing moves the ticket after the duty', () => {
  it('a ticket home booked for after the rest is rebooked once the longer rest is over', () => {
    const { g, d, t } = trip();
    const crew = [...t.crewIds];
    // Booked for after the rest the planned duty needs (as planHome books one for a long day).
    const early = cabinEarly(g, g.pairings[d.pairingId], d);
    const rest = minRest({ dutyMin: d.release - d.report + early, atHome: false, augmented: false, tzShift: tzDeltaH(t.to, t.from, d.release) });
    const std = Math.ceil((d.release + rest + CI) / 60) * 60;
    retimeFlight(g, t, std, std + t.block);
    touchTickets(g);
    touchCrew(g);
    const last = landLate(g, d, 75);
    run(g, (last.eta ?? last.sta) + 2 * 60);
    const d2 = g.duties[d.id];
    expect(d2.done).toBe(true);
    expect(d2.release).toBeGreaterThan(std - CI - rest);
    for (const id of crew) {
      const c = g.crew[id];
      const mine = ticketsOf(g, id, d2.restAt);
      expect(mine.length, `${c.first} ${c.last} has a ticket on`).toBe(1);
      // Checks in once the rest after the real release is over, and that rest is what they hold.
      expect(mine[0].std - CI).toBeGreaterThanOrEqual(c.restUntil);
      const need = minRest({ dutyMin: d2.release - d2.report, atHome: false, augmented: false, tzShift: 0 });
      expect(mine[0].std - CI - d2.release).toBeGreaterThanOrEqual(need);
      // The duty is logged to the real release (the rest is not hidden inside a duty running on to the ticket).
      expect(c.log[c.log.length - 1].end).toBe(d2.release);
    }
  }, 120_000);

  it('a ticket straight home the crew can no longer check in for is rebooked, not left to leave without them', () => {
    const { g, d, t } = trip();
    const crew = [...t.crewIds];
    // Straight on: leaves an hour after the planned release.
    const std = Math.ceil((d.release + 60) / 60) * 60;
    retimeFlight(g, t, std, std + t.block);
    touchTickets(g);
    touchCrew(g);
    const last = landLate(g, d, 150);
    run(g, (last.eta ?? last.sta) + 60);
    const d2 = g.duties[d.id];
    expect(d2.done).toBe(true);
    for (const id of crew) {
      const mine = ticketsOf(g, id, d2.restAt);
      expect(mine.length).toBe(1);
      expect(mine[0].std - CI).toBeGreaterThanOrEqual(d2.release);
      // Either straight on (a short wait at the airport) or after the full rest: never inside the rest.
      const c = g.crew[id];
      const wait = mine[0].std - CI - d2.release;
      if (wait > 3 * 60) expect(mine[0].std - CI).toBeGreaterThanOrEqual(c.restUntil);
    }
  }, 120_000);
});
