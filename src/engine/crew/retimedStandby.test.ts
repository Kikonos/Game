// v0.23.2 (routes for every base, sign-off): a duty moved to other hours takes them from its crew's standby. A bot game
// from Sofia (seed 1, 4 Aug): another job took the aircraft and its positioning to Budapest came forward four weeks,
// to 14:05 that day. The crew kept their 09:00-21:00 home standby, flew the leg from it never called, and were still
// "standing by at Sofia" that evening in Budapest. New work has always taken the standby it clashes with
// (standby.dropStandby); a retimed duty now does too.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, legsOffer, newGame } from '../contracts/testkit';
import { retimeFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { CrewMember, Duty, Flight, GameState } from '../core/types';
import { advanceTo } from '../sim';

const H = 60;

/** A LIS–PMI–LIS day trip six days out, crewed. */
function trip(): { g: GameState; d: Duty; legs: Flight[]; crew: CrewMember[]; day: number } {
  const g = newGame(21);
  const ac = leased(g);
  const day = Math.ceil(g.now / DAY) * DAY;
  const dep = day + 6 * DAY + 8 * H;
  const r = acceptOffer(g, legsOffer(g, [['LIS', 'PMI', dep], ['PMI', 'LIS', dep + 4 * H]]).id, [ac.id]);
  expect(r.ok).toBe(true);
  advanceTo(g, g.now + 1, new Set());
  const legs = Object.values(g.flights).filter((f) => f.contractId === (r.ok ? r.data?.contractId : '') && f.kind === 'revenue').sort((a, b) => a.std - b.std);
  const d = g.duties[legs[0].dutyId!];
  const crew = g.pairings[d.pairingId].slots.map((s) => (s.crewId ? g.crew[s.crewId] : undefined)).filter((c): c is CrewMember => !!c);
  expect(crew.length).toBeGreaterThanOrEqual(2);
  return { g, d, legs, crew, day };
}

const move = (g: GameState, legs: Flight[], std: number) => {
  const by = std - legs[0].std;
  for (const f of legs) retimeFlight(g, f, f.std + by, f.sta + by);
  advanceTo(g, g.now + 1, new Set());
};

describe('a retimed duty and its crew\'s standby', () => {
  it('a window not yet begun gives way to a duty moved onto it', () => {
    const { g, legs, crew, day } = trip();
    // Home standby 09:00-21:00 in two days, and one the day after.
    for (const c of crew) c.standby = [{ from: day + 2 * DAY + 9 * H, to: day + 2 * DAY + 21 * H }, { from: day + 4 * DAY + 9 * H, to: day + 4 * DAY + 21 * H }];
    // The trip comes forward four days, into the first window.
    move(g, legs, day + 2 * DAY + 14 * H);
    const d = g.duties[legs[0].dutyId!];
    expect(d.report).toBeLessThan(day + 2 * DAY + 14 * H);
    const on = g.pairings[d.pairingId].slots.map((s) => (s.crewId ? g.crew[s.crewId] : undefined)).filter((c): c is CrewMember => !!c);
    expect(on.length).toBeGreaterThanOrEqual(2);
    for (const c of on) {
      // No uncalled window over the duty; the window two days later stays.
      expect((c.standby ?? []).filter((w) => w.calledAt === undefined && w.from < d.release && w.to > d.report - H), `${c.first} ${c.last}`).toEqual([]);
      expect((c.standby ?? []).some((w) => w.from === day + 4 * DAY + 9 * H), `${c.first} ${c.last}`).toBe(true);
    }
  });

  it('a window running at the new report is a call-out, and the crew never stand by where they are not', () => {
    const { g, legs, crew, day } = trip();
    advanceTo(g, day + 2 * DAY + 10 * H, new Set());
    const d0 = g.duties[legs[0].dutyId!];
    const on0 = g.pairings[d0.pairingId].slots.map((s) => (s.crewId ? g.crew[s.crewId] : undefined)).filter((c): c is CrewMember => !!c);
    for (const c of on0) c.standby = [{ from: g.now - H, to: g.now + 11 * H }];
    // Brought forward to this afternoon, three hours from now.
    move(g, legs, g.now + 3 * H);
    const d = g.duties[legs[0].dutyId!];
    const on = g.pairings[d.pairingId].slots.map((s) => (s.crewId ? g.crew[s.crewId] : undefined)).filter((c): c is CrewMember => !!c);
    for (const c of on.filter((x) => on0.includes(x))) expect(c.standby?.[0]?.calledAt, `${c.first} ${c.last}`).toBeDefined();
    // Flown to Palma and on: nobody on an uncalled window away from where it is.
    const end = legs[1].sta + 2 * H;
    while (g.now < end) {
      advanceTo(g, g.now + 30, new Set());
      for (const c of [...on0, ...crew]) {
        const w = c.standby?.find((x) => x.from <= g.now && g.now < x.to && x.calledAt === undefined);
        if (w && c.status !== 'onDuty') expect(w.at ?? c.base, `${c.first} ${c.last}`).toBe(c.loc);
      }
    }
  });
});
