// BLU2032 round (player's save, 29 Mar 2028): CS-TTL (A330-200, class 1 bunks for both crews) flew LHR–SAN as a 2-pilot
// planned extension (13:15 of 14:00) with four pilots aboard for the trip's later augmented days. An APU fault after
// report moved the departure 1:04: the day read 14:19. The re-measure dropped the extension (the limit fell to the basic
// 13:00), discretion was refused as 'already too long when they reported' and the crew went out of hours. Pinned here:
// 1. a reported duty keeps its planned extension when a delay runs it over (applyPick / keepMode);
// 2. a reported day over its limit before the first take-off goes on augmented with the relief pilots aboard (augAboard);
// 3. without them, the commander's discretion covers the overrun at once (coverByDiscretion), on the basic day + 2 h;
// 4. the planner itself plans such a day with in-flight rest instead of an extension (augmentWithPilots);
// 5. the flight sheet's words; 6. a save in the broken state is repaired on load.

import { describe, expect, it } from 'vitest';
import { addFlight, retimeFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { onLoad } from '../sim';
import { advanceTo } from '../sim';
import { buildDuties, restNeedLine, syncDuty } from './duties';
import { addCrew, fixtureGame } from './fixtures';
import { discretionCheck, flightCrewStatus } from './roster';
import { autoRoster } from '.';

const H = 60;

/** An A330-200 with class 1 bunks at Heathrow: LHR–SAN 09:45 (11:45 block), then a 16:00 day two days later (4 pilots). */
function ttl(onward = true): GameState {
  const g = fixtureGame(7);
  const ac = Object.values(g.fleet)[0];
  ac.typeId = 'a332';
  ac.cabin = { ...ac.cabin, total: 263, y: 263, j: 0, w: 0 };
  ac.rest = { fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 1, kind: 'ldmcr', places: 7 } };
  ac.at = 'LHR';
  g.company.approvals.push('widebody', 'etops120', 'augmented');
  const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * H + 45;
  addFlight(g, { no: 'AW2032', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LHR', to: 'SAN', std, sta: std + 11 * H + 45, pax: 263 });
  if (onward) addFlight(g, { no: 'AW2034', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'SAN', to: 'CMN', std: std + 2 * DAY, sta: std + 2 * DAY + 16 * H, pax: 263 });
  addCrew(g, { CPT: 4, FO: 4, PUR: 2, CC: 14 }, 'A330/340');
  for (const c of Object.values(g.crew)) c.off = [];
  return g;
}

const first = (g: GameState) => g.duties[Object.values(g.flights).find((f) => f.no === 'AW2032')!.dutyId!];
const flight = (g: GameState) => Object.values(g.flights).find((f) => f.no === 'AW2032')!;

/** The duty as the save had it: a 2-pilot planned extension, 13:15 of 14:00. */
function asExtension(g: GameState): void {
  const d = first(g);
  d.augment = 0;
  d.ext = true;
  d.maxFdp = 14 * H;
  d.basicFdp = 13 * H;
  d.cabinEarly = 15;
  delete d.restExtra;
  d.legality = 'legal';
}

/** Reported crew, then the APU delay: the flight leaves `min` later; the engine re-measures the duty (settle). */
function reportThenDelay(g: GameState, min: number): void {
  const d = first(g);
  run(g, d.report + 5);
  expect(d.plannedFdp).toBe(13 * H + 15);
  const f = flight(g);
  g.now = f.std - 60;
  retimeFlight(g, f, f.std + min, f.sta + min);
  run(g, g.now + 1);
}

const titles = (g: GameState) => g.messages.map((m) => m.title);

/** Runs the clock to t through every pause (the bot's way). */
function run(g: GameState, t: number): void {
  while (g.now < t) advanceTo(g, t);
}

describe('BLU2032: planning', () => {
  it('a trip whose later day carries 4 pilots flies LHR–SAN with in-flight rest, not a 2-pilot extension', () => {
    const g = ttl();
    const ac = Object.values(g.fleet)[0];
    const ds = buildDuties(g, ac.id, g.now, g.now + 6 * DAY);
    const d = ds.find((x) => g.flights[x.flightIds[0]].no === 'AW2032')!;
    const d2 = ds.find((x) => g.flights[x.flightIds[0]].no === 'AW2034')!;
    expect(d.pairingId).toBe(d2.pairingId);
    expect(d2.augment).toBe(2);
    expect(d.ext).toBeUndefined();
    expect(d.augment).toBe(1);
    expect(d.maxFdp).toBe(17 * H);
    expect(d.legality).toBe('legal');
    // Alone (no relief pilots on the trip) the same day is still the cheaper planned extension.
    const h = ttl(false);
    const [one] = buildDuties(h, Object.values(h.fleet)[0].id, h.now, h.now + 6 * DAY);
    expect(one.ext).toBe(true);
    expect([one.fdp, one.maxFdp]).toEqual([13 * H + 15, 14 * H]);
    expect(restNeedLine(h, one).text).toBe('Not needed: 13:15 of 14:00 (0:45 spare)');
  });
});

describe('BLU2032: the APU delay after report', () => {
  it('keeps the extension and goes on augmented with the four pilots aboard; no out-of-hours alarm', () => {
    const g = ttl();
    const ac = Object.values(g.fleet)[0];
    buildDuties(g, ac.id, g.now, g.now + 6 * DAY);
    autoRoster(g);
    asExtension(g);
    const d = first(g);
    const p = g.pairings[d.pairingId];
    expect(p.slots.filter((s) => s.crewId && (s.role === 'CPT' || s.role === 'FO')).length).toBe(4);
    syncDuty(g, d, p);
    expect([d.ext, d.maxFdp, d.augment]).toEqual([true, 14 * H, 0]);
    // The flight sheet before the delay.
    expect(restNeedLine(g, d).text).toBe('Not needed: 13:15 of 14:00 (0:45 spare)');
    reportThenDelay(g, 64);
    const f = flight(g);
    // The FDP counts from the original report (the crew were already on duty): 14:19.
    expect(d.fdp).toBe(14 * H + 19);
    expect(d.augment).toBeGreaterThanOrEqual(1);
    expect(d.maxFdp).toBeGreaterThanOrEqual(17 * H);
    expect(d.legality).toBe('legal');
    expect(d.discretion).toBeUndefined();
    expect(flightCrewStatus(g, f.id).level).not.toBe('illegal');
    expect(titles(g).some((t) => /OUT OF HOURS/.test(t))).toBe(false);
    const note = g.messages.find((m) => m.title === 'In-flight rest on AW2032');
    expect(note?.body).toMatch(/delayed after the crew reported.*14:19, over the 13:00 planned with 2 pilots\. The [34] pilots aboard rest in turns in the bunks; the limit is now 1[78]:00\./);
    // It leaves on time with the delay and lands legal.
    run(g, f.std + 30);
    expect(f.status).toBe('enroute');
    expect(d.legality).toBe('legal');
  });

  it('with two pilots only, the commander extends the day at once: +1:00 on the basic day after the extension', () => {
    const g = ttl(false);
    const ac = Object.values(g.fleet)[0];
    buildDuties(g, ac.id, g.now, g.now + 6 * DAY);
    autoRoster(g);
    const d = first(g);
    const p = g.pairings[d.pairingId];
    expect(p.slots.filter((s) => s.crewId && (s.role === 'CPT' || s.role === 'FO')).length).toBe(2);
    expect([d.ext, d.maxFdp]).toEqual([true, 14 * H]);
    reportThenDelay(g, 64);
    const f = flight(g);
    expect(d.fdp).toBe(14 * H + 19);
    // Bug 1: the extension (and its 14:00) stays on the reported duty.
    expect([d.ext, d.maxFdp, d.augment]).toEqual([true, 14 * H, 0]);
    // Bug 2: discretion on the basic day (GM1 ORO.FTL.205(f)(1)(i)): 13:00 + 2:00 = 15:00, so +1:00 here.
    expect(d.discretion).toBe(60);
    expect(d.legality).toBe('legal');
    expect(flightCrewStatus(g, f.id).level).not.toBe('illegal');
    expect(titles(g).some((t) => /OUT OF HOURS/.test(t))).toBe(false);
    const note = g.messages.find((m) => m.title === 'Commander\'s discretion on AW2032');
    expect(note?.body).toBe('AW2032 was delayed after the crew reported: the day runs 14:19 of 14:00. The commander extends it to finish LHR–SAN; the limit is now 15:00. The crew will want their rest.');
    expect(discretionCheck(g, d.id).why).toBe('Already used on this duty');
    run(g, f.std + 30);
    expect(f.status).toBe('enroute');
    expect(d.legality).toBe('legal');
  });

  it('a delay discretion cannot cover (1:30 over the 15:00) still goes out of hours', () => {
    const g = ttl(false);
    const ac = Object.values(g.fleet)[0];
    buildDuties(g, ac.id, g.now, g.now + 6 * DAY);
    autoRoster(g);
    const d = first(g);
    reportThenDelay(g, 90 + 45);
    expect(d.fdp).toBe(15 * H + 30);
    expect([d.ext, d.maxFdp, d.discretion]).toEqual([true, 14 * H, undefined]);
    expect(d.legality).toBe('illegal');
    expect(discretionCheck(g, d.id).why).toBe('Over by 1:30: more than discretion allows');
    expect(restNeedLine(g, d).text).toBe('Needs in-flight rest: 15:30 of 14:00 with 2 pilots; 3 pilots with class 1 bunks allow 17:00');
  });

  it('the flight sheet names the pilots aboard when they are there', () => {
    const g = ttl();
    const ac = Object.values(g.fleet)[0];
    buildDuties(g, ac.id, g.now, g.now + 6 * DAY);
    autoRoster(g);
    asExtension(g);
    const d = first(g);
    d.fdp = 14 * H + 19;
    expect(restNeedLine(g, d).text).toBe('Needs in-flight rest: 14:19 of 14:00 with 2 pilots; the 4 pilots aboard and class 1 bunks allow 18:00');
  });
});

describe('BLU2032: a save in the broken state', () => {
  it('gets its extension back on load and the day goes on augmented', () => {
    const g = ttl();
    const ac = Object.values(g.fleet)[0];
    buildDuties(g, ac.id, g.now, g.now + 6 * DAY);
    autoRoster(g);
    asExtension(g);
    const d = first(g);
    syncDuty(g, d, g.pairings[d.pairingId]);
    expect([d.ext, d.maxFdp, d.augment]).toEqual([true, 14 * H, 0]);
    run(g, d.report + 5);
    expect(d.plannedFdp).toBe(13 * H + 15);
    const f = flight(g);
    g.now = f.std - 60;
    // As saved: the delay applied, the extension lost, the basic limit, illegal.
    f.schedStd = f.std;
    f.std += 64;
    f.sta += 64;
    f.delayReason = 'Technical: APU';
    f.ev++;
    d.fdp = 14 * H + 19;
    d.flightsEv = f.ev;
    delete d.ext;
    d.maxFdp = 13 * H;
    d.legality = 'illegal';
    f.crewAlert = 'red';
    onLoad(g);
    expect(d.augment).toBeGreaterThanOrEqual(1);
    expect(d.legality).toBe('legal');
    expect(flightCrewStatus(g, f.id).level).not.toBe('illegal');
    expect(g.messages.find((m) => m.title === 'In-flight rest on AW2032')?.body).toMatch(/Technical: APU/);
  });
});
