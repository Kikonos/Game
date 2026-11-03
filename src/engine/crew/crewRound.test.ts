// Crew round (Nov 2026): the crew & FTL bug hunt's regression tests: a planned duty cut when a change moves its legs a
// night apart however the duty was re-synced; standby matched only for a report inside the window; a crew held at the
// gate keeps its day until the 6 h stand-down; candidates for a reported duty are judged from the held departure, and
// the gate's wait reads the same clock as the stand-down.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, legsOffer, newGame } from '../contracts/testkit';
import { retimeFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { Duty, Flight, GameState, Pairing } from '../core/types';
import { advanceTo } from '../sim';
import { delayChain } from '../ops/flights';
import { applyCrewFix, crewControl } from './control';
import { syncDuty } from './duties';
import { fixtureGame, addCrew } from './fixtures';
import { dutyCandidates } from './rosterActions';
import { callIfOnStandby, standbyFor } from './standby';

const H = 60;

/** A crewed LIS–PMI–LIS day trip the day after tomorrow, 08:00 out, not yet reported. */
function trip(seed = 21): { g: GameState; p: Pairing; d: Duty; out: Flight; back: Flight } {
  const g = newGame(seed);
  const ac = leased(g);
  const dep = Math.ceil(g.now / DAY) * DAY + DAY + 8 * H;
  const r = acceptOffer(g, legsOffer(g, [['LIS', 'PMI', dep], ['PMI', 'LIS', dep + 4 * H]]).id, [ac.id]);
  expect(r.ok).toBe(true);
  advanceTo(g, g.now + 1, new Set());
  const cid = r.ok ? r.data?.contractId : '';
  const back = Object.values(g.flights).find((f) => f.contractId === cid && f.from === 'PMI')!;
  const out = Object.values(g.flights).find((f) => f.contractId === cid && f.to === 'PMI')!;
  const d = g.duties[out.dutyId!];
  const p = g.pairings[d.pairingId];
  expect(p.slots.every((s) => s.crewId)).toBe(true);
  expect(back.dutyId).toBe(d.id);
  return { g, p, d, out, back };
}

describe('a planned duty whose legs are moved a night apart (seed 4, AWL119: a 28 h "day")', () => {
  it('is cut in two by the crew settle even when the duty was re-synced before it saw the change', () => {
    const { g, d, p, out, back } = trip();
    // The return moves 20 h (a permit delay); another path re-syncs the duty first, as the daily roster did.
    retimeFlight(g, back, back.std + 20 * H, back.sta + 20 * H);
    syncDuty(g, d, p);
    expect(d.flightIds).toContain(back.id);
    expect(d.fdp).toBeGreaterThan(20 * H);
    advanceTo(g, g.now + 1, new Set());
    expect(out.dutyId).toBe(d.id);
    expect(back.dutyId).not.toBe(d.id);
    const d2 = g.duties[back.dutyId!];
    expect(d2.report).toBeGreaterThan(d.release);
    expect(d.legality).toBe('legal');
    expect(p.dutyIds).toContain(d2.id);
  });
});

describe('standby matched for a report (CS FTL.1.225)', () => {
  it('only inside the window or its wake-up hour: a window starting 5 h after the report is no call-out', () => {
    const g = fixtureGame(3);
    const [id] = addCrew(g, { CPT: 1 });
    const c = g.crew[id];
    c.standby = [{ from: g.now + 8 * H, to: g.now + 20 * H }];
    expect(standbyFor(g, c, g.now + 3 * H)).toBeNull();
    expect(callIfOnStandby(g, c.id, g.now + 3 * H)).toBe(false);
    expect(standbyFor(g, c, g.now + 7 * H + 30)?.kind).toBe('home');
    expect(standbyFor(g, c, g.now + 10 * H)?.kind).toBe('home');
  });
});

/** The trip reported and held at the gate: the first leg moved `hours` later (nothing flown), the duty re-synced. */
function heldAtGate(hours: number): { g: GameState; p: Pairing; d: Duty; out: Flight; report: number } {
  const { g, p, d, out } = trip();
  advanceTo(g, d.report + 5, new Set());
  expect(p.status).toBe('active');
  const report = d.report;
  delayChain(g, out, out.std + hours * H, 'Aircraft unserviceable');
  syncDuty(g, d, p);
  return { g, p, d, out, report };
}

describe('a crew held at the gate after reporting (v0.9 stand-down rule)', () => {
  it('keeps its day running through a 5 h hold', () => {
    const { d, report } = heldAtGate(5);
    expect(d.report).toBe(report);
    expect(d.fdp).toBeGreaterThan(10 * H);
  });
  it('stood down 6 h after reporting, the crew report afresh for the moved departure', () => {
    const { d, report } = heldAtGate(7);
    expect(d.report).toBe(report + 7 * H);
    expect(d.fdp).toBeLessThan(8 * H);
    expect(d.legality).toBe('legal');
  });
});

describe('a reported crew out of hours at an outstation (BLU2032 at Heathrow)', () => {
  /**
   * A crew flown to Athens the day before for an Athens–Rome–Athens–Lisbon day (report 06:00, 11:00 of a 12:30 limit),
   * held 5 h at the gate by an AOG found just before departure: 15:20, more than discretion covers. A crew flown in from
   * Lisbon would have the ticket in their day (ORO.FTL.215) and run over the limit too, so the day waits.
   */
  function heldAtAthens(): { g: GameState; p: Pairing; d: Duty; first: Flight } {
    const g = newGame(21);
    const ac = leased(g);
    const day1 = Math.ceil(g.now / DAY) * DAY + DAY + 8 * H;
    const day2 = day1 + DAY - H;
    const legs: [string, string, number][] = [['LIS', 'ATH', day1], ['ATH', 'FCO', day2], ['FCO', 'ATH', day2 + 170], ['ATH', 'LIS', day2 + 340]];
    const r = acceptOffer(g, legsOffer(g, legs).id, [ac.id]);
    expect(r.ok).toBe(true);
    advanceTo(g, g.now + 1, new Set());
    const cid = r.ok ? r.data?.contractId : '';
    const first = Object.values(g.flights).find((f) => f.contractId === cid && f.from === 'ATH' && f.std === day2)!;
    const d = g.duties[first.dutyId!];
    const p = g.pairings[d.pairingId];
    expect(d.flightIds.length).toBeGreaterThanOrEqual(2);
    expect(p.slots.every((s) => s.crewId)).toBe(true);
    advanceTo(g, d.report + 55, new Set());
    expect(p.status).toBe('active');
    expect(first.status).toBe('scheduled');
    expect(p.slots.every((s) => s.crewId && g.crew[s.crewId].loc === 'ATH')).toBe(true);
    delayChain(g, first, first.std + 5 * H, 'Aircraft unserviceable');
    syncDuty(g, d, p);
    expect(d.legality).toBe('illegal');
    return { g, p, d, first };
  }

  it('candidates for the held duty are judged from their own check-in for the held departure, not the report hours ago', () => {
    const { g, d } = heldAtAthens();
    // Departure held to 12:00: a fresh crew's report is 11:00 and a ticket must land by 10:00 (it read "report 06:00").
    const cands = dutyCandidates(g, d.id, 'CPT').filter((c) => c.loc === 'LIS');
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) expect(c.reasons.some((t) => /must land by 10:00 \(report 11:00\)/.test(t))).toBe(true);
  });

  it('the ladder: discretion refused (over by more than 2 h), nobody at Athens, no ticket in time, the day waits', () => {
    const { g, d, first } = heldAtAthens();
    const v = crewControl(g, first.id, { previews: true })!;
    const by = (id: string) => v.solutions.find((s) => s.id === id)!;
    expect(by('discretion').why).toMatch(/^Over by 2:\d\d: more than discretion allows$/);
    expect(by('callIn').why).toBe('Nobody is free at Athens today');
    expect(by('deadhead').why).toBe('Nobody can get there for this departure: Delay waits for one');
    const delay = by('delay');
    expect(delay.available).toBe(true);
    expect(delay.preview.after.level).not.toBe('illegal');
    // The soonest legal departure: the held crew stood down and reporting afresh 6 h after their report (the gate's
    // crewReadyAt reads the same clock as syncDuty), a fresh day.
    const report0 = d.report;
    expect(delay.newDeparture).toBe(report0 + 6 * H + H);
    const r = applyCrewFix(g, first.id, 'delay', { confirmed: true });
    expect(r.ok).toBe(true);
    const d2 = g.duties[first.dutyId!];
    expect(d2.report).toBe(report0 + 6 * H);
    expect(d2.legality).not.toBe('illegal');
    expect(g.pairings[d2.pairingId].slots.every((s) => s.crewId)).toBe(true);
  });
});
