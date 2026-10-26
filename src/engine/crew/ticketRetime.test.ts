// v0.11 debug round (found playing the v0.5.2 and v0.6 saves 60 days with the Operations update on): a crew's ticket
// must still fit its duty after the schedule moves, and a ticket home waits for the rest after a standby.
// (Before: the ticket out stayed at its old early time, its crew waiting at the gate past one FDP, and a crew member
// sent home from a hotel standby checked in 9 h after it ended, short of the 10 h rest.)

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { hamBase, leased, newGame } from '../contracts/testkit';
import { retimeFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { Duty, Flight, GameState, Pairing } from '../core/types';
import { advanceTo } from '../sim';
import { sendStrandedHome } from './roster';
import { evalSegs } from './rules';
import { ctxOf, outStillFits, segsOf } from './timeline';

/** Leaves `from` on the hour so as to land an hour before the duty's report. */
const sameDay = (d: Duty, t: Flight) => Math.floor((d.report - 60 - t.block) / 60) * 60;

/** A HAM base crewed from Berlin (an hour away): a duty whose crew fly out on an airline ticket that could leave the same morning. */
function hamTrip(): { g: GameState; p: Pairing; d: Duty; t: Flight } {
  for (const [home, waves] of [['BER', 2], ['DUS', 2], ['AMS', 3]] as const) {
    const g = newGame(21, home);
    const o = hamBase(g, g.now + 3 * DAY, 30, waves);
    o.broker = undefined;
    const r = acceptOffer(g, o.id, [leased(g).id]);
    if (!r.ok) continue;
    advanceTo(g, g.now + 60, new Set());
    for (const d of Object.values(g.duties).sort((a, b) => a.report - b.report)) {
      const p = g.pairings[d.pairingId];
      const t = d.deadheadIds.map((id) => g.flights[id]).find((x) => x?.kind === 'deadhead' && x.status === 'scheduled' && x.to === g.flights[d.flightIds[0]]?.from && x.std > g.now + 6 * 60);
      // A duty short enough for that ticket and the duty to fit one FDP.
      if (p && t && outStillFits(g, p, d, t.from, sameDay(d, t), t.block)) return { g, p, d, t };
    }
  }
  throw new Error('no duty with a ticket out');
}

describe('tickets follow a moved duty', () => {
  it('a duty moved later re-plans a same-day ticket out that would take its crew past one FDP', () => {
    const { g, p, d, t } = hamTrip();
    // Booked the same morning, landing an hour before report: ticket and duty one FDP, within the limit.
    const std = sameDay(d, t);
    retimeFlight(g, t, std, std + t.block);
    expect(outStillFits(g, p, d, t.from, t.std, t.block)).toBe(true);
    // The client moves the duty 3 h later (the departure check moves the legs, as a client request does).
    for (const id of d.flightIds) retimeFlight(g, g.flights[id], g.flights[id].std + 180, g.flights[id].sta + 180);
    advanceTo(g, g.now + 1, new Set());
    const d2 = g.duties[d.id];
    expect(d2.report).toBeGreaterThanOrEqual(d.report);
    // The ticket followed (or the crew changed): nobody on it waits at the gate past one FDP.
    if (d2.deadheadIds.includes(t.id) && t.status === 'scheduled') expect(outStillFits(g, g.pairings[d2.pairingId], d2, t.from, t.std, t.block)).toBe(true);
    for (const id of t.crewIds) {
      const c = g.crew[id];
      expect(evalSegs(ctxOf(g, c), segsOf(g, c)).filter((i) => i.code === 'fdp' && i.level === 'illegal').map((i) => i.text), id).toEqual([]);
    }
  });
});

describe('a ticket home after a standby away', () => {
  it('checks in only once the rest after a hotel standby is over', () => {
    const g = newGame(21);
    const c = Object.values(g.crew).find((x) => x.role === 'FO' && x.status === 'available')!;
    // In Hamburg with no trip ahead; a hotel standby there ended an hour ago (no duty since its last rest).
    c.loc = 'HAM';
    c.standby = [{ from: g.now - 9 * 60, to: g.now - 60, kind: 'hotel', at: 'HAM' }];
    sendStrandedHome(g);
    const t = Object.values(g.flights).find((f) => f.kind === 'deadhead' && f.status === 'scheduled' && f.crewIds.includes(c.id));
    expect(t?.from).toBe('HAM');
    expect(evalSegs(ctxOf(g, c), segsOf(g, c)).filter((i) => i.level === 'illegal').map((i) => i.text)).toEqual([]);
  });
});
