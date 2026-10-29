// Crew-planning round (player: "not let me know 12 hrs before where I can't do much about it"): a trip the roster cannot
// crew is announced days ahead, once, calmly, with the options; then amber at 48 h and red at 12 h, one notice per stage;
// a seat emptied late by a sickness says so plainly.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { buildDuties } from './duties';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { autoRoster } from './roster';
import { escalateShortages, lateChangeNote } from './control';
import { touchCrew } from './timeline';

const H = 60;

/** A DUS–FNC trip 5 days out; every captain on leave (`leave`). */
function trip(leave = true): { g: GameState; flightId: string } {
  const g = fixtureGame(5);
  const ac = Object.values(g.fleet)[0];
  ac.at = 'DUS';
  addCrew(g, { CPT: 2, FO: 2, PUR: 1, CC: 4 });
  const std = Math.floor(g.now / DAY) * DAY + 5 * DAY + 17 * H;
  const b = blockMinutes(ac.typeId, 'DUS', 'FNC');
  const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [ac.id], start: std - DAY, end: std + 2 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false }, penalties: { cancelScale: [], perDelay: 2_500, perCancelledLeg: 15_000 } });
  const f = addFlight(g, { no: 'AW816', aircraftId: ac.id, contractId: k.id, kind: 'revenue', from: 'DUS', to: 'FNC', std, sta: std + b, pax: 170 });
  addFlight(g, { no: 'AW817', aircraftId: ac.id, contractId: k.id, kind: 'revenue', from: 'FNC', to: 'DUS', std: std + b + 50, sta: std + 2 * b + 50, pax: 160 });
  const caps = Object.values(g.crew).filter((c) => c.role === 'CPT');
  for (const c of leave ? caps : []) {
    c.blocks = [{ from: g.now - DAY, to: g.now + 20 * DAY, why: 'leave' }];
    c.status = 'leave';
  }
  buildDuties(g, ac.id, g.now, g.now + 8 * DAY);
  autoRoster(g);
  touchCrew(g);
  return { g, flightId: f.id };
}

const crewNotes = (g: GameState) => g.messages.filter((m) => m.cat === 'crew' && m.problem?.kind === 'crewShort');

describe('the early heads-up', () => {
  it('announces a trip the roster cannot crew days ahead, once; then amber at 48 h and red at 12 h, one notice each', () => {
    const { g, flightId } = trip();
    const f = g.flights[flightId];
    expect(f.crewAlert).toBeUndefined();
    escalateShortages(g, { reroster: true });
    const early = crewNotes(g);
    expect(early).toHaveLength(1);
    expect(early[0].title).toMatch(/^Heads-up: AW816 (is missing 1 captain|has no pilots|has no crew)/);
    expect(early[0].tone).toBe('info');
    expect(early[0].body).toMatch(/days to go: hire, fly someone in on a ticket or a private jet, swap crews, sub-lease the trip or move it/);
    expect(f.crewEarly).toBe(true);
    // Never twice for the same trip at the same stage.
    g.now += 7 * H;
    escalateShortages(g, { reroster: true });
    expect(crewNotes(g)).toHaveLength(1);
    // 48 h out: amber; 12 h out: red.
    g.now = f.std - 47 * H;
    escalateShortages(g, { reroster: true });
    expect(crewNotes(g)).toHaveLength(2);
    expect(f.crewAlert).toBe('amber');
    g.now = f.std - 11 * H;
    escalateShortages(g, { reroster: true });
    expect(crewNotes(g)).toHaveLength(3);
    expect(f.crewAlert).toBe('red');
    expect(crewNotes(g)[0].title).toMatch(/^CREW SHORTAGE: AW816/);
  });

  it('stays quiet about a trip the roster can crew', () => {
    const { g } = trip(false);
    escalateShortages(g, { reroster: true });
    expect(crewNotes(g).filter((m) => m.title.startsWith('Heads-up'))).toHaveLength(0);
  });

  it('a seat emptied late by a sickness reads as a late change, not a planning failure', () => {
    const { g, flightId } = trip();
    const f = g.flights[flightId];
    const c = Object.values(g.crew).find((x) => x.role === 'FO')!;
    f.crewLost = { crewId: c.id, why: 'sick', t: g.now };
    expect(lateChangeNote(g, f)).toBe(`Late change: ${c.first} ${c.last} fell sick on ${new Date(Date.UTC(2000, 0, 1) + g.now * 60000).getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][new Date(Date.UTC(2000, 0, 1) + g.now * 60000).getUTCMonth()]}. `);
    // (The roster's own run already gave the heads-up: read again as if the sickness came first.)
    for (const y of Object.values(g.flights)) delete y.crewEarly;
    g.messages = [];
    g.now += 7 * H;
    escalateShortages(g, { reroster: true });
    expect(crewNotes(g)[0].body).toMatch(/^Late change: .+ fell sick on /);
  });

  it('a leg added at short notice, or moved by a delay, reads as a late change too', () => {
    const g = fixtureGame(5);
    const ac = Object.values(g.fleet)[0];
    const std = g.now + 20 * H;
    const f = addFlight(g, { no: 'AW900', aircraftId: ac.id, contractId: null, kind: 'positioning', from: 'LIS', to: 'MAD', std, sta: std + 75 });
    expect(f.born).toBe(g.now);
    expect(lateChangeNote(g, f)).toMatch(/^Late change: this leg was only added on .+ UTC \(a schedule change at short notice\)\. $/);
    const far = addFlight(g, { no: 'AW902', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'MAD', std: g.now + 5 * DAY, sta: g.now + 5 * DAY + 75 });
    expect(far.born).toBeUndefined();
    expect(lateChangeNote(g, far)).toBe('');
    far.schedStd = far.std;
    far.std += 3 * H;
    far.delayReason = 'Late inbound aircraft';
    expect(lateChangeNote(g, far)).toBe('Late change: late inbound aircraft moved it 3h 00m later. ');
  });
});
