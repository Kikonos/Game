// v0.14.1 (player report, S0228 CS-TTL): a crewed trip's planned duty FRA–AMS + AMS–VRA that a client's retime made
// 17:40 of 12:15 was only flagged: the roster re-cut illegal duties of tours and one-duty trips, never of a longer trip,
// and a duty whose legs moved a night apart stayed one FDP. The flight sheet read "No in-flight rest needed: 17:40 of
// 12:15". Pinned here: the move goes the evening before and the duty is cut at the rest (same trip, same crew); a move
// that cannot go earlier has its illegal duty re-planned (a ferry crew, then the job's crew); the sheet's line is true.

import { describe, expect, it } from 'vitest';
import { addFlight, flightsOf, ownFlightNo, retimeFlight } from '../core/entities';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import type { Duty, GameState } from '../core/types';
import { addAircraft, newGame } from '../contracts/testkit';
import { relinkPositioning } from '../contracts/schedule';
import { autoRoster, onFlightsChanged } from './roster';
import { buildDuties, restNeedLine } from './duties';
import { addCrew } from './fixtures';
import { crewCount } from './timeline';

const H = 60;

/**
 * An A330 crewed LIS–FRA on day 3, then FRA–AMS 05:45 and AMS–VRA 08:30 on day 4 as one augmented duty (the plan the
 * player's trip had before Corendon's +3 h). `hard`: the move is a ferry (the relink keeps it where it is).
 */
function crewedTrip(hard = false) {
  const g = newGame(31);
  g.company.approvals.push('widebody', 'etops120', 'augmented');
  const ac = addAircraft(g, 'a332');
  addCrew(g, { CPT: 5, FO: 5, PUR: 3, CC: 24 }, 'A330/340');
  const day4 = Math.floor(g.now / DAY) * DAY + 4 * DAY;
  const blkIn = blockMinutes(ac.typeId, 'LIS', 'FRA');
  const inn = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'FRA', std: day4 - DAY + 4 * H, sta: day4 - DAY + 4 * H + blkIn, pax: 200 });
  const pos = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: hard ? 'ferry' : 'positioning', from: 'FRA', to: 'AMS', std: day4 + 5 * H + 45, sta: day4 + 6 * H + 40 });
  const op = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'AMS', to: 'VRA', std: day4 + 8 * H + 30, sta: day4 + 18 * H + 55, pax: 249 });
  buildDuties(g, ac.id, g.now, g.now + 10 * DAY);
  autoRoster(g, {});
  return { g, ac, inn, pos, op };
}
const dutyOf = (g: GameState, id: string): Duty => g.duties[g.flights[id].dutyId!];

describe('v0.14.1 a crewed positioning day the job moved past its limit', () => {
  it('before: one augmented duty, crewed, with the trip in to Frankfurt', () => {
    const { g, pos, op, inn } = crewedTrip();
    const d = dutyOf(g, op.id);
    expect(d.flightIds).toEqual([pos.id, op.id]);
    expect(d.augment).toBe(1);
    expect(d.legality).not.toBe('illegal');
    expect(crewCount(g.pairings[d.pairingId])).toBeGreaterThan(0);
    expect(dutyOf(g, inn.id).pairingId).toBe(d.pairingId);
  });

  it('the job +3 h: the move goes the evening before, the duty is cut at the rest, same trip and crew, both legal', () => {
    const { g, ac, pos, op } = crewedTrip();
    const p0 = dutyOf(g, op.id).pairingId;
    const crew0 = g.pairings[p0].slots.filter((s) => s.role === 'CPT' && s.crewId).map((s) => s.crewId);
    retimeFlight(g, op, op.std + 3 * H, op.sta + 3 * H);
    relinkPositioning(g, ac.id);
    onFlightsChanged(g, ac.id, g.now);
    const mv = flightsOf(g, ac.id).filter((f) => f.kind === 'positioning' && f.status === 'scheduled');
    expect(mv.map((f) => f.id)).toEqual([pos.id]);
    expect(op.std - pos.sta).toBeGreaterThanOrEqual(10 * H);
    const a = dutyOf(g, pos.id);
    const b = dutyOf(g, op.id);
    expect(a.id).not.toBe(b.id);
    expect(a.flightIds).toEqual([pos.id]);
    expect(b.flightIds).toEqual([op.id]);
    for (const d of [a, b]) expect(d.legality, `${d.id} ${d.fdp}/${d.maxFdp}`).not.toBe('illegal');
    expect(b.report - a.release).toBeGreaterThanOrEqual(10 * H);
    expect(b.pairingId).toBe(p0);
    expect(g.pairings[p0].slots.filter((s) => s.role === 'CPT' && s.crewId).map((s) => s.crewId)).toEqual(crew0);
  });

  it('a move that cannot go earlier (a ferry held where it is): the illegal duty is re-planned, never left crewed', () => {
    const { g, ac, pos, op } = crewedTrip(true);
    retimeFlight(g, op, op.std + 3 * H, op.sta + 3 * H);
    onFlightsChanged(g, ac.id, g.now);
    const a = dutyOf(g, pos.id);
    const b = dutyOf(g, op.id);
    // A ferry crew flies the empty leg, the job's crew report at Amsterdam: two duties, each legal.
    expect(a.id).not.toBe(b.id);
    for (const d of [a, b]) expect(d.legality, `${d.id} ${d.fdp}/${d.maxFdp}`).not.toBe('illegal');
    for (const d of Object.values(g.duties)) if (!d.done && crewCount(g.pairings[d.pairingId]) > 0) expect(d.legality).not.toBe('illegal');
    // The ferry is a pilots-only trip: no cabin crew on an empty aircraft.
    expect(g.pairings[a.pairingId].dutyIds).toEqual([a.id]);
    expect(g.pairings[a.pairingId].slots.map((s) => s.role).sort()).toEqual(['CPT', 'FO']);
  });
});

describe('v0.14.1 the flight sheet In-flight rest line', () => {
  it('over the limit it needs in-flight rest and says what this airframe allows; within it, not needed', () => {
    const { g, op } = crewedTrip();
    const d = dutyOf(g, op.id);
    const keep = { fdp: d.fdp, maxFdp: d.maxFdp, augment: d.augment };
    Object.assign(d, { fdp: 17 * H + 40, maxFdp: 12 * H + 15, augment: 0 });
    const over = restNeedLine(g, d);
    expect(over.needed).toBe(true);
    expect(over.text).toMatch(/^Needs in-flight rest: 17:40 of 12:15 with 2 pilots; /);
    expect(over.text).not.toMatch(/No in-flight rest needed/);
    Object.assign(d, { fdp: 10 * H + 40 });
    // BLU2032 round: the room left, and the rest facility in plain words.
    expect(restNeedLine(g, d)).toEqual({ needed: false, text: 'Not needed: 10:40 of 12:15 (1:35 spare)' });
    // 14:40 with 2 pilots: 3 pilots in this A330's bunks allow it.
    Object.assign(d, { fdp: 14 * H + 40 });
    expect(restNeedLine(g, d).text).toMatch(/3 pilots with class 1 (bunks|lower-deck bunks) allow 1[67]:00$/);
    Object.assign(d, keep);
  });
});

describe('v0.14.1 the day-length sheet (fdpWhy) on a day over its limit', () => {
  it('never says the cabin crew need no in-flight rest', async () => {
    const { fdpWhy } = await import('./explain');
    const { g, op } = crewedTrip();
    const d = dutyOf(g, op.id);
    const keep = { fdp: d.fdp, maxFdp: d.maxFdp, augment: d.augment, cabinEarly: d.cabinEarly };
    Object.assign(d, { fdp: 17 * H + 40, maxFdp: 12 * H + 15, augment: 0, cabinEarly: 15 });
    expect(fdpWhy(g, d.id)!.cabin).toBe('Cabin crew: 17:55 day (report 15 min earlier); over the limit: the day needs in-flight rest.');
    Object.assign(d, { fdp: 10 * H + 40 });
    expect(fdpWhy(g, d.id)!.cabin).toMatch(/no in-flight rest needed\.$/);
    Object.assign(d, keep);
  });
});

describe('v0.14.1 a trip dropped with a ride on our own leg', () => {
  it('keeps the leg (only its crew come off it); a ticket goes', async () => {
    const { removeFlights, addDeadhead } = await import('../core/entities');
    const { touchCrew } = await import('./timeline');
    const g = newGame(31);
    const ac = Object.values(g.fleet)[0];
    const c = Object.values(g.crew).find((x) => x.role === 'CPT')!;
    const t = Math.floor(g.now / DAY) * DAY + 3 * DAY;
    const pos = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'positioning', from: 'LIS', to: 'MAD', std: t + 8 * H, sta: t + 9 * H + 15 });
    const ride = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'MAD', to: 'LIS', std: t + 11 * H, sta: t + 12 * H + 15, pax: 150 });
    ride.riders = [c.id];
    const tkt = addDeadhead(g, { crewIds: [c.id], from: 'MAD', to: 'LIS', std: t + 14 * H, sta: t + 15 * H + 15, cost: 100, contractId: null });
    const d: Duty = { id: 'duX', pairingId: 'pX', report: pos.std - 60, release: pos.sta + 30, flightIds: [pos.id], deadheadIds: [ride.id, tkt.id], sectors: 1, fdp: 135, maxFdp: 780, augment: 0, restAt: 'MAD', legality: 'legal', ev: 0, flightsEv: pos.ev };
    g.duties[d.id] = d;
    pos.dutyId = d.id;
    pos.crewIds = [c.id];
    g.pairings.pX = { id: 'pX', aircraftId: ac.id, contractId: null, deploymentId: null, base: 'LIS', start: d.report, end: d.release, dutyIds: [d.id], slots: [{ role: 'CPT', crewId: c.id }], status: 'planned', legality: 'legal' };
    touchCrew(g);
    removeFlights(g, [pos.id]);
    onFlightsChanged(g, ac.id, g.now);
    expect(g.duties[d.id]).toBeUndefined();
    expect(g.flights[ride.id]?.kind).toBe('revenue');
    expect(g.flights[ride.id].riders ?? []).not.toContain(c.id);
    expect(g.flights[tkt.id]).toBeUndefined();
  });
});
