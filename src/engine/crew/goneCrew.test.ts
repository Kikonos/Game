// v0.14 final build (bot seeds 3 and 4, --wide --inv): crew who had resigned and left the company flew weeks later. A
// finished tour ('done') at a base kept its seats as the record; the base programme's next days were chained into that
// tour again, which still held the leaver's id, and its later part was split off with them in a seat. Leaving
// (removeCrew) passes finished trips by. Now a tour that grows again is live again, a seat held by someone who has left
// is emptied wherever there is work still to fly, leaving takes them off every seat, ticket and ride, and a save in that
// state is repaired on load.
//
// Seed 1: a ticket home was checked against the 168 h between recovery rests (ORO.FTL.235(d)) for the first hour after
// rest, then moved to the first seat outside Hamburg's night ban, landing 170:25 after the last recovery rest.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, newGame, offer, run } from '../contracts/testkit';
import { DAY, localMinuteOfDay } from '../core/time';
import type { GameState, Pairing } from '../core/types';
import { deserialize, serialize } from '../save';
import { planAircraft, refreshPairing } from './duties';
import { dailyMorale } from './morale';
import { evalSegs } from './rules';
import { sendStrandedHome } from './roster';
import { crewIx, ctxOf, segsOf, touchCrew } from './timeline';
import { addDeadhead } from '../core/entities';

const H = 60;

const open = (g: GameState, p: Pairing) => p.dutyIds.some((id) => g.duties[id] && !g.duties[id].done);
/** Seats on trips with work still to fly, and flights still to leave, that carry someone with no crew record. */
function goneRefs(g: GameState): string[] {
  const out: string[] = [];
  for (const p of Object.values(g.pairings)) if (open(g, p)) for (const s of p.slots) if (s.crewId && !g.crew[s.crewId]) out.push(`${p.id} seat ${s.role} ${s.crewId}`);
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'scheduled') continue;
    for (const id of [...f.crewIds, ...(f.riders ?? [])]) if (!g.crew[id]) out.push(`${f.no} ${f.from}-${f.to} ${id}`);
  }
  return out;
}

/** A Dublin base under way with crewed tours (as tourStandby.test). */
function dublin(): { g: GameState; acId: string } {
  const g = newGame(21);
  const ac = leased(g);
  const o = offer(g, 'seasonBase', { airport: 'DUB', dests: ['LIS'], waves: 2, start: g.now + 3 * DAY, days: 60 });
  o.broker = undefined;
  const r = acceptOffer(g, o.id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  run(g, g.contracts[r.data!.contractId].start + 10 * DAY);
  return { g, acId: ac.id };
}

/**
 * A crewed tour under way whose days still to fly are taken off it (as if not generated yet): the tour is finished
 * ('done', as the roster marks a trip whose last open duty went) and one of its crew has left the company.
 */
function finishedTourWithLeaver(g: GameState): { p: Pairing; gone: string; flights: string[] } {
  const p = Object.values(g.pairings)
    .filter((q) => q.tour && q.status === 'active' && q.slots.filter((s) => s.crewId).length >= 3 && q.dutyIds.some((id) => g.duties[id]?.done) && q.dutyIds.some((id) => (g.duties[id]?.report ?? 0) > g.now + DAY))
    .sort((a, b) => a.start - b.start)[0];
  expect(p, 'a crewed tour under way').toBeTruthy();
  const later = p.dutyIds.map((id) => g.duties[id]).filter((d) => !d.done && d.report > g.now);
  const flights = later.flatMap((d) => d.flightIds);
  for (const d of later) {
    for (const id of d.flightIds) {
      g.flights[id].dutyId = null;
      g.flights[id].crewIds = [];
    }
    for (const id of d.deadheadIds) delete g.flights[id];
    delete g.duties[d.id];
  }
  p.dutyIds = p.dutyIds.filter((id) => g.duties[id]);
  expect(p.dutyIds.every((id) => g.duties[id].done), 'every duty left on it flown').toBe(true);
  p.status = 'done';
  const gone = p.slots.find((s) => s.crewId && s.role === 'CC')?.crewId ?? p.slots.find((s) => s.crewId)!.crewId!;
  delete g.crew[gone];
  touchCrew(g);
  return { p, gone, flights };
}

describe('crew who have left never hold a seat (seeds 3 and 4)', () => {
  it('a finished tour that takes the programme\'s next days again is live, and the leaver\'s seat is emptied and re-crewed', () => {
    const { g, acId } = dublin();
    const { p, gone, flights } = finishedTourWithLeaver(g);
    planAircraft(g, acId, g.now);
    // The days are back on a trip; whichever it is, nobody who left is on it.
    expect(flights.every((id) => g.flights[id].dutyId), 'the days are planned again').toBe(true);
    expect(goneRefs(g)).toEqual([]);
    if (g.pairings[p.id] && open(g, p)) expect(p.status).not.toBe('done');
    // A day of play later the seats are crewed and nothing flown carries the leaver.
    run(g, g.now + 2 * DAY);
    expect(goneRefs(g)).toEqual([]);
    for (const f of Object.values(g.flights)) if (f.status === 'done' && f.atd! > g.now - 2 * DAY) expect(f.crewIds).not.toContain(gone);
  });

  it('refreshPairing empties a seat held by someone who has left (and takes them off its flights)', () => {
    const { g } = dublin();
    const p = Object.values(g.pairings).find((q) => q.status === 'planned' && q.slots.filter((s) => s.crewId).length >= 3)!;
    expect(p).toBeTruthy();
    const gone = p.slots.find((s) => s.crewId)!.crewId!;
    delete g.crew[gone];
    refreshPairing(g, p);
    expect(p.slots.some((s) => s.crewId === gone)).toBe(false);
    expect(goneRefs(g)).toEqual([]);
  });

  it('leaving takes them off a trip even when it is marked finished, and off loose tickets', () => {
    const { g } = dublin();
    const p = Object.values(g.pairings).find((q) => q.status === 'planned' && q.start > g.now + DAY && q.slots.filter((s) => s.crewId).length >= 3)!;
    expect(p).toBeTruthy();
    const c = g.crew[p.slots.find((s) => s.crewId && g.crew[s.crewId].loc === g.crew[s.crewId].base)?.crewId ?? p.slots.find((s) => s.crewId)!.crewId!];
    // The trip mis-marked as finished (an older build's grown tour); a loose ticket in their name too.
    p.status = 'done';
    addDeadhead(g, { crewIds: [c.id], from: c.base, to: 'MAD', std: g.now + 2 * DAY, sta: g.now + 2 * DAY + 90, cost: 0 });
    c.loc = c.base;
    c.status = 'available';
    c.notice = { given: g.now - 30 * DAY, leaves: g.now };
    touchCrew(g);
    dailyMorale(g);
    expect(g.crew[c.id], 'they left').toBeUndefined();
    expect(goneRefs(g)).toEqual([]);
    expect(p.status).not.toBe('done');
  });

  it('a save in that state is repaired on load: live again, no leaver aboard, the seat re-crewed', () => {
    const { g, acId } = dublin();
    const { gone, flights } = finishedTourWithLeaver(g);
    // As the old build left it: the days chained back into the finished tour, the leaver still in a seat.
    const p = Object.values(g.pairings).find((q) => q.slots.some((s) => s.crewId === gone))!;
    const keep = p.slots.map((s) => s.crewId);
    planAircraft(g, acId, g.now);
    const q = g.pairings[g.duties[g.flights[flights[0]].dutyId!].pairingId];
    q.status = 'done';
    q.slots.forEach((s, i) => (s.crewId = keep[i] ?? s.crewId));
    for (const d of q.dutyIds.map((id) => g.duties[id])) if (!d.done) for (const id of d.flightIds) if (g.flights[id].status === 'scheduled') g.flights[id].crewIds = q.slots.filter((s) => s.crewId).map((s) => s.crewId!);
    expect(goneRefs(g).length).toBeGreaterThan(0);
    const h = deserialize(serialize(g));
    expect(goneRefs(h)).toEqual([]);
    const q2 = h.pairings[q.id];
    expect(q2.status).not.toBe('done');
    // Re-crewed: the seat the leaver held has someone (or the trip is short and on the crew desk's list).
    expect(q2.slots.filter((s) => !s.above && !s.crewId).length).toBe(0);
  });
});

describe('a ticket home moved to the first seat after a night ban (seed 1)', () => {
  it('still lands inside the 168 h since the last recovery rest, or waits for the recovery at the hotel', () => {
    const g = newGame(21);
    const c = Object.values(g.crew).find((x) => x.role === 'CC' && x.status === 'available' && x.loc === x.base)!;
    c.loc = 'HAM';
    c.standby = [];
    // Rested at 01:00 Hamburg time (inside its 23:00–06:00 night ban), two days on.
    let t0 = Math.ceil((g.now + 2 * DAY) / H) * H;
    while (localMinuteOfDay('HAM', t0) !== H) t0 += H;
    const ci = 60;
    const blk = 3 * H + 25;
    // The last recovery rest ended so that the 01:00 ticket would land an hour inside the 168 h, the 06:00 seat outside.
    const L = t0 + blk + H - 168 * H;
    c.lastRecovery = L;
    // Short days, one a day, since then (no 36 h free stretch; 7-day duty well inside 60 h).
    const rest = t0 - ci;
    c.log = [];
    for (let s = L + 2 * H; s + 5 * H <= rest - 13 * H; s += DAY) c.log.push({ start: s, end: s + 5 * H, fdp: 5 * H, block: 3 * H, sectors: 2, augmented: false, disruptive: false });
    c.restUntil = rest;
    touchCrew(g);
    sendStrandedHome(g);
    const t = (crewIx(g).tickets.get(c.id) ?? []).find((f) => f.status === 'scheduled' && f.to === c.base);
    expect(t, 'a ticket home').toBeDefined();
    // Not the 06:00 seat: it would land past the 168 h.
    expect(t!.std).toBeGreaterThan(t0 + 6 * H);
    const bad = evalSegs(ctxOf(g, c), segsOf(g, c)).filter((i) => i.level === 'illegal' && i.code === 'recovery');
    expect(bad.map((i) => i.text)).toEqual([]);
  });
});
