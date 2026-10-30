// v0.7.2.1 Trip swap: tripOf, quoteTripMove and moveTrip (player request: drag a trip to another aircraft).

import { describe, expect, it } from 'vitest';
import { flightsOf } from '../core/entities';
import { DAY } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { acceptOffer } from '../contracts';
import { addAircraft, legsOffer, leased, newGame, offer, owned, run } from '../contracts/testkit';
import { crewIssuesFor, flightCrewStatus } from '../crew';
import { addCrew } from '../crew/fixtures';
import { deserialize, serialize } from '../save';
import { advanceTo, settle } from '../sim';
import { MONEY_LINES, moneyTotal, moveTrip, quoteTripMove, tripOf, tripTargets } from './tripMove';

const state = (g: GameState) => JSON.stringify((JSON.parse(serialize(g)) as { state: unknown }).state);
const live = (g: GameState, acId: string) => flightsOf(g, acId).filter((f) => f.status === 'scheduled');

/** A charter flying exactly these legs on aircraft `acId`; returns its scheduled revenue legs in order. */
function charter(g: GameState, acId: string, legs: [string, string, number][]): Flight[] {
  const o = legsOffer(g, legs, 150);
  const r = acceptOffer(g, o.id, [acId]);
  if (!r.ok) throw new Error(r.error);
  settle(g);
  return live(g, acId).filter((f) => f.contractId === r.data!.contractId && f.kind === 'revenue');
}

/** A DUB season base flying DUB–DUS–DUB rotations on the leased A320, a week in. */
function dubBase(seed = 3) {
  const g = newGame(seed);
  const a = owned(g);
  const b = leased(g);
  const o = offer(g, 'seasonBase', { airport: 'DUB', dests: ['DUS'], waves: 2, start: g.now + 6 * DAY, days: 30 });
  const r = acceptOffer(g, o.id, [b.id]);
  if (!r.ok) throw new Error(r.error);
  run(g, g.now + 7 * DAY);
  const rev = live(g, b.id).find((f) => f.kind === 'revenue' && f.from === 'DUB' && f.std > g.now + 2 * DAY)!;
  return { g, a, b, rev };
}

describe('tripOf', () => {
  it('a DUB–DUS–DUB rotation of a season base: either leg gives the out-and-back', () => {
    const { g, b, rev } = dubBase();
    const t = tripOf(g, rev.id);
    expect(t.ok).toBe(true);
    expect(t.label).toBe('DUB–DUS–DUB');
    expect(t.legs.map((f) => `${f.from}-${f.to}`)).toEqual(['DUB-DUS', 'DUS-DUB']);
    const back = t.legs[1];
    expect(tripOf(g, back.id).legs.map((f) => f.id)).toEqual(t.legs.map((f) => f.id));
    // The next wave is its own trip.
    const next = live(g, b.id).find((f) => f.std > back.sta && f.from === 'DUB')!;
    expect(tripOf(g, next.id).legs.map((f) => f.id)).not.toContain(rev.id);
  });

  it('a multi-day tour with night stops is one trip; a long break splits it', () => {
    const g = newGame(3);
    const a = owned(g);
    const d = g.now + 4 * DAY;
    const legs = charter(g, a.id, [
      ['LIS', 'MAD', d + 14 * 60], ['MAD', 'BCN', d + DAY + 8 * 60], ['BCN', 'FCO', d + DAY + 18 * 60], ['FCO', 'LIS', d + 2 * DAY + 10 * 60],
    ]);
    expect(legs.length).toBe(4);
    const t = tripOf(g, legs[2].id);
    expect(t.ok).toBe(true);
    expect(t.label).toBe('LIS–MAD–BCN–FCO–LIS');
    expect(t.moved.map((f) => f.id)).toEqual(legs.map((f) => f.id));
    // A second visit four days later is a different trip.
    const later = charter(g, a.id, [['LIS', 'OPO', d + 6 * DAY], ['OPO', 'LIS', d + 6 * DAY + 4 * 60]]);
    expect(tripOf(g, later[0].id).legs.map((f) => f.id)).toEqual(later.map((f) => f.id));
  });

  it('refuses a leg that has left, and the rest of its trip once under way', () => {
    const g = newGame(3);
    const a = owned(g);
    const legs = charter(g, a.id, [['LIS', 'DUS', g.now + DAY + 8 * 60], ['DUS', 'LIS', g.now + DAY + 13 * 60]]);
    advanceTo(g, legs[0].std + 40);
    expect(['enroute', 'done']).toContain(g.flights[legs[0].id].status);
    expect(tripOf(g, legs[0].id).ok).toBe(false);
    const t = tripOf(g, legs[1].id);
    expect(t.ok).toBe(false);
    expect(t.reason).toMatch(/under way: LIS–DUS left at/);
    const q = quoteTripMove(g, legs[1].id, leased(g).id);
    expect(q.ok).toBe(false);
    expect(q.reasons[0]).toMatch(/under way/);
  });
});

describe('quoteTripMove', () => {
  it('a free twin at the same airport: ok, no ferry, the net is the sum of its lines', () => {
    const g = newGame(3);
    const a = owned(g);
    const b = leased(g);
    const legs = charter(g, a.id, [['LIS', 'DUS', g.now + 3 * DAY + 8 * 60], ['DUS', 'LIS', g.now + 3 * DAY + 13 * 60]]);
    const before = state(g);
    const q = quoteTripMove(g, legs[0].id, b.id);
    expect(state(g)).toBe(before);
    expect(q.ok).toBe(true);
    expect(q.full).toBe(true);
    expect(q.label).toBe('LIS–DUS–LIS');
    expect(q.positioning.filter((x) => x.added)).toEqual([]);
    expect(q.before.revenue).toBeGreaterThan(0);
    // The charter pays the same whichever aircraft flies it.
    expect(q.after.revenue).toBe(q.before.revenue);
    expect(q.net).toBe(moneyTotal(q.diff));
    expect(q.net).toBe(moneyTotal(q.after) - moneyTotal(q.before));
    for (const l of MONEY_LINES) expect(q.diff[l.key]).toBe(q.after[l.key] - q.before[l.key]);
    expect(q.verdict).toBe(Math.abs(q.net) < 500 ? 'same' : q.net > 0 ? 'gain' : 'loss');
  });

  it('a DUB rotation to the A320 at home: ferries in and out (ours to pay), crew who come off and go on', () => {
    const { g, a, b, rev } = dubBase();
    const q = quoteTripMove(g, rev.id, a.id);
    expect(q.ok).toBe(true);
    const ferries = q.positioning.filter((x) => x.added && x.aircraftId === a.id);
    expect(ferries.map((x) => `${x.from}-${x.to}`)).toEqual(['LIS-DUB', 'DUB-LIS']);
    expect(q.after.ferry).toBeLessThan(0);
    expect(q.diff.revenue).toBe(0);
    expect(q.verdict).toBe('loss');
    expect(q.net).toBe(moneyTotal(q.diff));
    expect(q.crewOff.length + q.crewOn.length).toBeGreaterThan(0);
    expect(q.sourceFree).toMatch(new RegExp(`^${b.reg} is free at DUB`));
    expect(q.notes.some((n) => n.startsWith(`${a.reg} flies empty LIS–DUB`))).toBe(true);
  });

  it('refuses an overlap with the target’s own flying, in plain words', () => {
    const g = newGame(3);
    const a = owned(g);
    const b = leased(g);
    const t0 = g.now + 3 * DAY + 8 * 60;
    const legs = charter(g, a.id, [['LIS', 'DUS', t0], ['DUS', 'LIS', t0 + 5 * 60]]);
    charter(g, b.id, [['LIS', 'FCO', t0 + 60], ['FCO', 'LIS', t0 + 5 * 60]]);
    const q = quoteTripMove(g, legs[0].id, b.id);
    expect(q.ok).toBe(false);
    expect(q.reasons[0]).toMatch(new RegExp(`^${b.reg} is flying LIS–FCO \\d\\d:\\d\\d–\\d\\d:\\d\\d at that time$`));
    // The quick check (drag highlighting) says the same without a copy.
    expect(quoteTripMove(g, legs[0].id, b.id, { quick: true }).reasons[0]).toBe(q.reasons[0]);
  });

  it('refuses a target in a C-check', () => {
    const g = newGame(3);
    const a = owned(g);
    const b = leased(g);
    const t0 = g.now + 5 * DAY + 8 * 60;
    const legs = charter(g, a.id, [['LIS', 'DUS', t0], ['DUS', 'LIS', t0 + 5 * 60]]);
    // A C-check at a hub (booked as the C-check dialog does), the aircraft away for two weeks.
    g.maintenance.mc = { id: 'mc', aircraftId: b.id, kind: 'C', at: 'SOF', start: t0 - 2 * DAY, end: t0 + 12 * DAY, cost: 900_000, status: 'planned', planned: true, ev: 0 };
    const q = quoteTripMove(g, legs[0].id, b.id);
    expect(q.ok).toBe(false);
    expect(q.reasons[0]).toMatch(new RegExp(`^${b.reg} is in a C-check until \\d+ \\w+$`));
  });

  it('refuses a leg beyond the target type’s range', () => {
    const g = newGame(3);
    const a = owned(g);
    const c = addAircraft(g, 'a321ceo');
    c.reg = 'CS-TQB';
    // v0.12.1 the A321 reaches Amman now (2,600 nm with 220 seats); Libreville is within the A320's reach, not the A321's.
    const legs = charter(g, a.id, [['LIS', 'LBV', g.now + 3 * DAY + 8 * 60], ['LBV', 'LIS', g.now + 3 * DAY + 17 * 60]]);
    const q = quoteTripMove(g, legs[0].id, c.id);
    expect(q.ok).toBe(false);
    expect(q.reasons[0]).toMatch(/^An A321 can't fly this [\d,]+ km leg \(LIS–LBV\) without a fuel stop$/);
  });

  it('refuses a cabin the client did not ask for', () => {
    const g = newGame(3);
    const a = owned(g);
    const b = leased(g);
    const legs = charter(g, a.id, [['LIS', 'DUS', g.now + 3 * DAY + 8 * 60], ['DUS', 'LIS', g.now + 3 * DAY + 13 * 60]]);
    g.contracts[legs[0].contractId!].requirements.layouts = ['two-class'];
    const q = quoteTripMove(g, legs[0].id, b.id);
    expect(q.ok).toBe(false);
    expect(q.reasons).toContain(`The client asked for two-class seats; ${b.reg} is all-economy`);
  });

  it('refuses a type nobody is rated on', () => {
    const g = newGame(3);
    const a = owned(g);
    const w = addAircraft(g, 'a332');
    g.company.approvals.push('widebody');
    const legs = charter(g, a.id, [['LIS', 'DUS', g.now + 3 * DAY + 8 * 60], ['DUS', 'LIS', g.now + 3 * DAY + 13 * 60]]);
    const q = quoteTripMove(g, legs[0].id, w.id);
    expect(q.ok).toBe(false);
    expect(q.reasons).toContain('No crew rated on the A330 can take it');
  });

  it('lists every other aircraft as a target, workable ones first', () => {
    const g = newGame(3);
    const a = owned(g);
    const legs = charter(g, a.id, [['LIS', 'DUS', g.now + 3 * DAY + 8 * 60], ['DUS', 'LIS', g.now + 3 * DAY + 13 * 60]]);
    addAircraft(g, 'a332');
    const list = tripTargets(g, legs[0].id);
    expect(list.length).toBe(2);
    expect(list[0].ok).toBe(true);
    expect(list[1].ok).toBe(false);
  });
});

describe('moveTrip', () => {
  it('moves every leg, plans the ferry, crews it legally and re-queues the departures', () => {
    const { g, a, b, rev } = dubBase();
    const q = quoteTripMove(g, rev.id, a.id);
    const ids = q.legs.map((l) => l.id);
    const r = moveTrip(g, rev.id, a.id, q.net);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.msg).toBe(`DUB–DUS–DUB moved to ${a.reg}`);
    settle(g);
    for (const id of ids) {
      const f = g.flights[id];
      expect(f.aircraftId).toBe(a.id);
      expect(f.status).toBe('scheduled');
      // Its departure is queued at its current version (stale ones are ignored).
      expect(g.queue.some((e) => e.type === 'flight.dep' && e.id === id && e.v === f.ev && e.t === f.std)).toBe(true);
      expect(flightCrewStatus(g, id).level).not.toBe('illegal');
      const d = f.dutyId ? g.duties[f.dutyId] : undefined;
      if (d) expect(crewIssuesFor(g, d)).toEqual([]);
    }
    expect(live(g, b.id).some((f) => ids.includes(f.id))).toBe(false);
    // The ferry in: ours, landing before the first departure.
    const first = g.flights[ids[0]];
    const ferry = live(g, a.id).filter((f) => f.to === 'DUB' && f.sta <= first.std && (f.kind === 'ferry' || f.kind === 'positioning'));
    expect(ferry.length).toBe(1);
    expect(ferry[0].contractId).toBeNull();
    // Both aircraft's remaining duties stay legal.
    for (const ac of [a.id, b.id]) {
      for (const f of live(g, ac).filter((x) => x.std < g.now + 5 * DAY && x.dutyId)) expect(crewIssuesFor(g, g.duties[f.dutyId!])).toEqual([]);
    }
    // It plays on: the moved legs fly on the new aircraft.
    run(g, g.flights[ids[ids.length - 1]].sta + 6 * 60);
    for (const id of ids) {
      const f = g.flights[id];
      if (!f) continue;
      expect(f.status).toBe('done');
      expect(f.aircraftId).toBe(a.id);
    }
  }, 60_000);

  it('refuses what the quote refuses, and leaves the game alone', () => {
    const g = newGame(3);
    const a = owned(g);
    const b = leased(g);
    const t0 = g.now + 3 * DAY + 8 * 60;
    const legs = charter(g, a.id, [['LIS', 'DUS', t0], ['DUS', 'LIS', t0 + 5 * 60]]);
    charter(g, b.id, [['LIS', 'FCO', t0 + 60], ['FCO', 'LIS', t0 + 5 * 60]]);
    const before = state(g);
    const r = moveTrip(g, legs[0].id, b.id);
    expect(r.ok).toBe(false);
    expect(state(g)).toBe(before);
  });

  it('a saved game after a move plays on identically', () => {
    const { g, a, rev } = dubBase(5);
    const r = moveTrip(g, rev.id, a.id);
    expect(r.ok).toBe(true);
    settle(g);
    const h = deserialize(serialize(g));
    expect(state(h)).toBe(state(g));
    const end = g.now + 6 * DAY;
    run(g, end);
    run(h, end);
    expect(h.now).toBe(g.now);
    expect(state(h)).toBe(state(g));
  }, 60_000);
});

describe('v0.7.3 in-flight rest on the new aircraft', () => {
  /** Two A330-200s with A330 crew; a LIS–SCL charter (13:35 block: a 3-pilot day) on the first. */
  function longHaul() {
    const g = newGame(3);
    g.company.approvals.push('widebody', 'augmented', 'etops120', 'etops180', 'areaAmericas');
    const w1 = addAircraft(g, 'a332');
    const w2 = addAircraft(g, 'a332');
    addCrew(g, { CPT: 6, FO: 6, PUR: 3, CC: 24 }, 'A330/340');
    const legs = charter(g, w1.id, [['LIS', 'SCL', g.now + 4 * DAY + 10 * 60]]);
    delete g.contracts[legs[0].contractId!].requirements.body;
    return { g, w1, w2, leg: legs[0] };
  }

  it('a long-haul trip needs the rest it gets now: on economy seats (class 3) the quote says it needs a 4th pilot', () => {
    const { g, w2, leg } = longHaul();
    // v0.7.4 nothing fitted and all economy: the crew rest in curtained economy seats (class 3)
    w2.rest = { fc: null, cc: null };
    w2.cabin = { j: 0, w: 0, y: 330, total: 330, label: '330Y', layout: 'all-economy' };
    const q = quoteTripMove(g, leg.id, w2.id);
    expect(q.ok, q.reasons.join('; ')).toBe(true);
    expect(q.notes.some((n) => n.startsWith(`On ${w2.reg}: Economy seats (class 3) → needs a 4th pilot`))).toBe(true);
  });

  it('onto an aircraft with bunks: the quote says it is a 3-pilot day; after the move the duty is augmented and legal', () => {
    const { g, w2, leg } = longHaul();
    const q = quoteTripMove(g, leg.id, w2.id);
    expect(q.ok, q.reasons.join('; ')).toBe(true);
    expect(q.notes.some((n) => n.startsWith(`On ${w2.reg}: Bunks → 3 pilots`))).toBe(true);
    const r = moveTrip(g, leg.id, w2.id, q.net);
    if (!r.ok) throw new Error(r.error);
    settle(g);
    const f = g.flights[leg.id];
    expect(f.aircraftId).toBe(w2.id);
    const d = f.dutyId ? g.duties[f.dutyId] : undefined;
    expect(d?.augment ?? 0).toBeGreaterThanOrEqual(1);
    expect(d!.fdp).toBeLessThanOrEqual(d!.maxFdp);
    expect(['ok', 'tight']).toContain(flightCrewStatus(g, f.id).level);
  });
});
