// v0.9 crew out of hours (UPDATE-0.9.md §T): its own alert kind, card, ladder message, pause and cue, separate from a
// crew shortage; the seat remembers who reached which limit until legally refilled.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { takeCues } from '../core/cues';
import { blockMinutes } from '../core/perf';
import { clearPause, takePause } from '../core/pause';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { problemAt, problemFor, problems } from '../problems';
import { v09Stats } from './dayPlan';
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
    // v0.9 round 4 (§T): the fixes are the fourth line itself, cheapest first, each opening Crew Control on its row.
    const labels = card.actions.map((a) => a.label);
    expect(labels[0]).toMatch(/^Replace \S+: .+ \((home|hotel|airport) standby at \w{3}|free at \w{3}|flies in .+\)$/);
    expect(labels.slice(-2)).toEqual(['Sub-charter', 'Cancel']);
    expect(card.actions.every((a) => 'modal' in a.open && a.open.modal === 'crewControl' && !!a.open.fix)).toBe(true);
    expect(card.details.some((x) => x.startsWith('What you can do'))).toBe(false);
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
    // v0.9 round 4 (§5.7): a red warning is not an illegal duty: the clean-sheet streak stands.
    v09Stats(g).legalStreak = 10;
    escalateShortages(g);
    expect(v09Stats(g).legalStreak).toBe(10);
    const row = shortFlights(g).find((x) => x.flightId === f.id)!;
    expect(row.kind).toBe('hours');
    // v0.9 round 4 (§T): the global problems list carries the out-of-hours card, not a shortage card.
    const pc = problems(g).find((c) => c.subject.ref.id === f.id)!;
    expect(pc.subject.kind).toBe('crewHours');
    expect(problemAt(g, { kind: 'flight', id: f.id })?.subject.kind).toBe('crewHours');
    expect(pc.what).toMatch(/\(captain\) is out of hours for AW910$/);
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
    escalateShortages(s.g, { freeFix: false });
    expect(s.g.messages.some((x) => x.topic === 'crewRed' && /^CREW SHORTAGE: AW910/.test(x.title))).toBe(true);
    expect(takePause()).toBe('crewShortage');
    expect(takeCues()).toContain('crewShortage');
  });

  it('the guard takes an out-of-hours crew member off and the seat remembers why; a legal refill clears it', () => {
    const { g, f, d, p, cpt } = trip(25);
    over28(g, cpt, d.report);
    const others = Object.values(g.crew).filter((c) => c.role === 'CPT' && c.id !== cpt);
    for (const c of others) c.blocks = [{ from: g.now - DAY, to: g.now + 9 * DAY, why: 'leave' }];
    clearPause();
    takeCues();
    guardDuty(g, d.id);
    const q = g.pairings[g.duties[d.id].pairingId];
    const seat = q.slots.find((s) => s.role === 'CPT')!;
    expect(seat.crewId).toBeNull();
    expect(seat.ooh).toMatchObject({ crewId: cpt, limit: 'block28d' });
    expect(crewAlertKind(g, f.id)).toBe('hours');
    const x = outOfHours(g, f.id)[0];
    expect(x.crewId).toBe(cpt);
    // v0.9 round 4 (§T): taken off for a limit is out of hours: its own problem kind and pause; the WHY keeps 'by how much'.
    const off = g.messages.find((m) => /taken off AW910$/.test(m.title))!;
    expect(off.problem?.kind).toBe('crewHours');
    expect(takePause()).toBe('crewHours');
    expect(takeCues()).not.toContain('crewOutOfHours');
    expect(x.value).toBe(0);
    expect(x.overMin).toBeGreaterThan(0);
    expect(problemFor(g, { kind: 'crewHours', ref: { kind: 'flight', id: f.id } })!.why).toMatch(/28-day flying is \d+:\d\d over the 100 h limit\./);
    expect(x.limitText).toBe('has reached the 28-day flying limit (100 h)');
    // Back from leave: the roster refills the seat legally and the mark goes.
    for (const c of others) c.blocks = [];
    autoRoster(g);
    const q2 = g.pairings[g.duties[d.id].pairingId];
    const seat2 = q2.slots.find((s) => s.role === 'CPT')!;
    if (seat2.crewId) expect(seat2.ooh).toBeUndefined();
    void p;
  });
});

describe('§T Crew Control replaces crew out of hours (fix round 1)', () => {
  it('an out-of-hours captain and a legal home standby at base: Call in standby crew is offered first, costs $0 and seats them', async () => {
    const { crewControl, applyCrewFix } = await import('.');
    const { g, f, d, p, cpt } = trip();
    over28(g, cpt, d.report);
    recheckPairing(g, p);
    expect(crewAlertKind(g, f.id)).toBe('hours');
    const other = Object.values(g.crew).find((c) => c.role === 'CPT' && c.id !== cpt && !p.slots.some((s) => s.crewId === c.id))!;
    other.loc = other.base;
    other.standby = [{ from: d.report - 6 * 60, to: d.report + 6 * 60, kind: 'home', at: other.base }];
    touchCrewState(g);
    g.now = d.report - 8 * 60;
    const v = crewControl(g, f.id)!;
    expect(v.card.subject.kind).toBe('crewHours');
    expect(v.card.what).toMatch(/\(captain\).* out of hours for AW910/);
    const call = v.solutions.find((s) => s.id === 'callIn')!;
    expect(call.available).toBe(true);
    expect(call.cost).toBe(0);
    expect(v.solutions.filter((s) => s.available)[0].id).toBe('callIn');
    expect(call.preview.changes.join(' ')).toMatch(/comes off \(out of hours\)/);
    const r = applyCrewFix(g, f.id, 'callIn');
    expect(r.ok).toBe(true);
    const q = g.pairings[g.duties[g.flights[f.id].dutyId!].pairingId];
    expect(r.ok && r.data!.changes.join(' ')).toMatch(/called from standby: no overtime/);
    expect(q.slots.some((s) => s.crewId === cpt)).toBe(false);
  });
});

describe('v0.12.1 (C11) the crew desk says why the crew member comes off', () => {
  it("a captain gone on leave comes off '(on leave)', not '(out of hours)'", async () => {
    const { crewControl } = await import('.');
    const { g, f, d, p, cpt } = trip();
    const c = g.crew[cpt];
    c.blocks = [{ from: d.report - 2 * DAY, to: d.report + 5 * DAY, why: 'leave' }];
    c.status = 'leave';
    touchCrewState(g);
    recheckPairing(g, p);
    g.now = d.report - 8 * 60;
    const v = crewControl(g, f.id)!;
    const lines = v.solutions.filter((s) => s.available).flatMap((s) => s.preview.changes).filter((l) => /comes off/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/comes off \(on leave\)/);
  });
});

describe('Crew Control beside an Auto-fix that replaces crew out of hours (code review)', () => {
  it('Delay is not offered and says Auto-fix crews it on time, never "nobody can take it"', async () => {
    const { crewControl } = await import('.');
    const { g, f, d, p, cpt } = trip();
    over28(g, cpt, d.report);
    recheckPairing(g, p);
    expect(crewAlertKind(g, f.id)).toBe('hours');
    g.now = d.report - 8 * 60;
    const v = crewControl(g, f.id)!;
    const auto = v.solutions.find((s) => s.id === 'autoFix')!;
    expect(auto.available).toBe(true);
    expect(auto.preview.after.level).toBe('ok');
    const delay = v.solutions.find((s) => s.id === 'delay')!;
    expect(delay.available).toBe(false);
    expect(delay.why).toBe('A crew can take it on time: use Auto-fix');
  });
});
