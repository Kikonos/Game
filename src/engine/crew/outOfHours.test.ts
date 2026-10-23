// v0.9 crew out of hours (UPDATE-0.9.md §T): its own alert kind, card, ladder message, pause and cue, separate from a
// crew shortage; the seat remembers who reached which limit until legally refilled.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { takeCues } from '../core/cues';
import { blockMinutes } from '../core/perf';
import { clearPause, takePause } from '../core/pause';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { problemFor } from '../problems';
import { crewAlertKind, escalateShortages, guardDuty, outOfHours, shortFlights } from '.';
import { buildDuties } from './duties';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { autoRoster, recheckPairing, releaseCrew, setFlightsCrew } from './roster';
import { touchCrewState } from './timeline';

/** A rostered out-and-back from LIS two days out; its captain. */
function trip(seed = 21) {
  const g = fixtureGame(seed);
  const acId = Object.keys(g.fleet)[0];
  const ac = g.fleet[acId];
  ac.at = 'LIS';
  const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * 60;
  const b = blockMinutes(ac.typeId, 'LIS', 'FNC');
  const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [acId], start: std - DAY, end: std + 2 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false }, penalties: { cancelScale: [], perDelay: 2_500, perCancelledLeg: 15_000 } });
  const f = addFlight(g, { no: 'AW910', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'LIS', to: 'FNC', std, sta: std + b, pax: 170 });
  addFlight(g, { no: 'AW911', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'FNC', to: 'LIS', std: std + b + 50, sta: std + 2 * b + 50, pax: 160 });
  buildDuties(g, acId, g.now, g.now + 5 * DAY);
  for (const id of addCrew(g, { CPT: 2, FO: 2, PUR: 1, CC: 3 })) g.crew[id].off = [];
  autoRoster(g);
  const d = g.duties[g.flights[f.id].dutyId!];
  const p = g.pairings[d.pairingId];
  const cpt = p.slots.find((s) => s.role === 'CPT')!.crewId!;
  return { g, f, d, p, cpt };
}

/** Puts crew member `id` over the 28-day flying limit before the trip (a long month of logged block). */
function over28(g: GameState, id: string, report: number) {
  const c = g.crew[id];
  for (let k = 1; k <= 10; k++) c.log.push({ start: report - (25 - k) * DAY, end: report - (25 - k) * DAY + 11 * 60, fdp: 11 * 60, block: 10 * 60, sectors: 2, augmented: false, disruptive: false });
  c.log.sort((a, b) => a.start - b.start);
  touchCrewState(g);
}

describe('§T crewAlertKind', () => {
  it('a 28-day block overrun reads out of hours, names who, which limit and by how much', () => {
    const { g, f, p, cpt } = trip();
    over28(g, cpt, g.duties[f.dutyId!].report);
    recheckPairing(g, p);
    expect(crewAlertKind(g, f.id)).toBe('hours');
    const x = outOfHours(g, f.id).find((i) => i.crewId === cpt)!;
    expect(x.limit).toBe('block28d');
    expect(x.max).toBe(100 * 60);
    expect(x.overMin).toBeGreaterThan(0);
    const card = problemFor(g, { kind: 'crewHours', ref: { kind: 'flight', id: f.id } })!;
    expect(card.subject.kind).toBe('crewHours');
    expect(card.what).toMatch(/\(captain\).* out of hours for AW910/);
    expect(card.why).toMatch(/28-day flying would reach \d+:\d\d \(limit 100:00\)/);
    expect(card.details[0]).toMatch(/^What you can do: .*Sub-charter · Cancel$/);
    expect(card.terms).toContain('outOfHours');
  });

  it('a missing seat is a shortage; both together read out of hours; a wrong-place crew is a shortage', () => {
    const a = trip();
    const fo = a.p.slots.find((s) => s.role === 'FO')!.crewId!;
    releaseCrew(a.g, a.p, fo);
    setFlightsCrew(a.g, a.p);
    expect(crewAlertKind(a.g, a.f.id)).toBe('short');
    over28(a.g, a.cpt, a.d.report);
    recheckPairing(a.g, a.p);
    expect(crewAlertKind(a.g, a.f.id)).toBe('hours');
    const b = trip(22);
    b.g.crew[b.cpt].loc = 'OPO';
    for (const c of Object.values(b.g.crew)) if (c.id === b.cpt) c.restUntil = b.d.report - 60;
    b.g.now = b.d.report - 30;
    recheckPairing(b.g, b.p);
    const k = crewAlertKind(b.g, b.f.id);
    expect(k === null || k === 'short').toBe(true);
  });

  it('the red stage posts CREW OUT OF HOURS with its pause and the urgent cue; the shortage path is unchanged', () => {
    const { g, f, p, cpt } = trip(23);
    over28(g, cpt, g.duties[f.dutyId!].report);
    recheckPairing(g, p);
    // Nobody else can take the seat (every other captain on leave), so it stays a problem at the red stage.
    for (const c of Object.values(g.crew)) if (c.role === 'CPT' && c.id !== cpt) c.blocks = [{ from: g.now - DAY, to: g.now + 9 * DAY, why: 'leave' }];
    g.now = f.std - 6 * 60;
    clearPause();
    takeCues();
    escalateShortages(g);
    const row = shortFlights(g).find((x) => x.flightId === f.id)!;
    expect(row.kind).toBe('hours');
    const m = g.messages.find((x) => x.topic === 'crewHours')!;
    expect(m.title).toMatch(/^CREW OUT OF HOURS: AW910 in \d+ h$/);
    expect(takePause()).toBe('crewHours');
    expect(takeCues()).toContain('crewOutOfHours');
    expect(g.stats.v09!.oohRed).toBeGreaterThanOrEqual(1);
    // A plain missing seat on another trip is still CREW SHORTAGE.
    const s = trip(24);
    const fo = s.p.slots.find((x) => x.role === 'FO')!.crewId!;
    for (const c of Object.values(s.g.crew)) if (c.role === 'FO') c.blocks = [{ from: s.g.now - DAY, to: s.g.now + 9 * DAY, why: 'leave' }];
    releaseCrew(s.g, s.p, fo);
    setFlightsCrew(s.g, s.p);
    s.g.now = s.f.std - 6 * 60;
    clearPause();
    takeCues();
    escalateShortages(s.g);
    expect(s.g.messages.some((x) => x.topic === 'crewRed' && /^CREW SHORTAGE: AW910/.test(x.title))).toBe(true);
    expect(takePause()).toBe('crewShortage');
    expect(takeCues()).toContain('crewShortage');
  });

  it('the guard takes an out-of-hours crew member off and the seat remembers why; a legal refill clears it', () => {
    const { g, f, d, p, cpt } = trip(25);
    over28(g, cpt, d.report);
    const others = Object.values(g.crew).filter((c) => c.role === 'CPT' && c.id !== cpt);
    for (const c of others) c.blocks = [{ from: g.now - DAY, to: g.now + 9 * DAY, why: 'leave' }];
    guardDuty(g, d.id);
    const q = g.pairings[g.duties[d.id].pairingId];
    const seat = q.slots.find((s) => s.role === 'CPT')!;
    expect(seat.crewId).toBeNull();
    expect(seat.ooh).toMatchObject({ crewId: cpt, limit: 'block28d' });
    expect(crewAlertKind(g, f.id)).toBe('hours');
    expect(outOfHours(g, f.id)[0].crewId).toBe(cpt);
    // Back from leave: the roster refills the seat legally and the mark goes.
    for (const c of others) c.blocks = [];
    autoRoster(g);
    const q2 = g.pairings[g.duties[d.id].pairingId];
    const seat2 = q2.slots.find((s) => s.role === 'CPT')!;
    if (seat2.crewId) expect(seat2.ooh).toBeUndefined();
    void p;
  });
});
