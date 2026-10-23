// v0.9 commander's discretion is never planned (UPDATE-0.9.md §U; ORO.FTL.205(f)): offered only after report, for an
// unforeseen overrun, every seat filled, once; never counted by planning, pricing, offers, the roster or trip moves.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import type { ChainShape } from './duties';
import { crewCanFly } from '../contracts/offers';
import { ulrNeed } from '../contracts/feasibility';
import { devRestPlan } from '../dev';
import { quoteTripMove } from '../ops/tripMove';
import { applyDiscretion, crewControl, discretionCheck, dutyNeed, longestDay, restOf } from '.';
import { buildDuties, planAircraft } from './duties';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { DISCRETION } from './rules';
import { autoRoster } from './roster';

function trip(seed = 31) {
  const g = fixtureGame(seed);
  const acId = Object.keys(g.fleet)[0];
  const ac = g.fleet[acId];
  ac.at = 'LIS';
  const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * 60;
  const b = blockMinutes(ac.typeId, 'LIS', 'FNC');
  const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [acId], start: std - DAY, end: std + 2 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false } });
  const f = addFlight(g, { no: 'AW930', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'LIS', to: 'FNC', std, sta: std + b, pax: 170 });
  addFlight(g, { no: 'AW931', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'FNC', to: 'LIS', std: std + b + 50, sta: std + 2 * b + 50, pax: 160 });
  buildDuties(g, acId, g.now, g.now + 5 * DAY);
  for (const id of addCrew(g, { CPT: 2, FO: 2, PUR: 1, CC: 3 })) g.crew[id].off = [];
  autoRoster(g);
  const d = g.duties[g.flights[f.id].dutyId!];
  return { g, f, d };
}

describe('§U.3 discretionCheck', () => {
  it('refused before report, refused for a day already too long at report, ok for a gate hold after a legal report, refused over the maximum', () => {
    const { g, f, d } = trip();
    g.now = d.report - 60;
    d.fdp = d.maxFdp + 30;
    let c = discretionCheck(g, d.id);
    expect(c.ok).toBe(false);
    expect(c.why).toBe('Only after the crew has reported. For a planned day: a fresh crew, a delay or more pilots.');
    // Reported with a legal plan; the gate hold is unforeseen.
    g.now = d.report + 10;
    d.plannedFdp = d.maxFdp - 30;
    c = discretionCheck(g, d.id);
    expect(c.ok).toBe(true);
    expect(c.addMin).toBe(DISCRETION.basic);
    // A day already too long when they reported is planning, not an emergency.
    d.plannedFdp = d.maxFdp + 5;
    c = discretionCheck(g, d.id);
    expect(c.ok).toBe(false);
    expect(c.why).toMatch(/already too long when they reported/);
    expect(applyDiscretion(g, d.id).ok).toBe(false);
    // Over by more than discretion allows.
    d.plannedFdp = d.maxFdp - 30;
    d.fdp = d.maxFdp + 3 * 60 + 10;
    c = discretionCheck(g, d.id);
    expect(c.ok).toBe(false);
    expect(c.why).toBe('Over by 3:10: more than discretion allows.');
    // Crew Control shows the row greyed with the reason, never as the default.
    const v = crewControl(g, f.id);
    const row = v?.solutions.find((s) => s.id === 'discretion');
    if (row) {
      expect(row.available).toBe(false);
      expect(row.why).toBe('Over by 3:10: more than discretion allows.');
    }
    // Used once.
    d.fdp = d.maxFdp + 30;
    expect(applyDiscretion(g, d.id).ok).toBe(true);
    expect(g.stats.v09!.discretionUsed).toBe(1);
    expect(discretionCheck(g, d.id).why).toBe('Already used on this duty.');
    expect(g.stats.v09!.discretionPlanned ?? 0).toBe(0);
  });
});

describe('§U.1 planning never counts discretion', () => {
  it('longest day, duty need, ULR need, offer crewing, the roster and trip moves are the same with DISCRETION set to 10 h', () => {
    const g = fixtureGame(32);
    const fid = devRestPlan(g);
    const acId = g.flights[fid].aircraftId!;
    const ac = g.fleet[acId];
    const rest = restOf(g, acId);
    const t0 = Math.floor(g.now / DAY) * DAY + 3 * DAY;
    const chain = (h: number): ChainShape => ({ from: 'LIS', std: t0 + 8 * 60, legs: [{ std: t0 + 8 * 60, sta: t0 + 8 * 60 + h * 60, from: 'LIS', to: 'GRU' }] });
    const read = () => JSON.stringify([
      longestDay(g, rest, ac.typeId),
      [8, 12, 14, 16, 18].map((h) => dutyNeed(g, ac.typeId, rest, chain(h))),
      ulrNeed(g, 'LIS', 'SCL', t0, t0 + 3 * DAY),
      [12, 16, 19].map((h) => crewCanFly(g, ac.typeId, [chain(h)])),
      quoteTripMove(g, fid, Object.keys(g.fleet).find((id) => id !== acId) ?? acId, { quick: true }).ok ?? null,
    ]);
    const before = read();
    planAircraft(g, acId, g.now);
    const duties0 = JSON.stringify(Object.values(g.duties).map((d) => [d.flightIds, d.maxFdp, d.augment]));
    const save = { ...DISCRETION };
    const D = DISCRETION as unknown as { basic: number; augmented: number };
    D.basic = 10 * 60;
    D.augmented = 10 * 60;
    try {
      expect(read()).toBe(before);
      planAircraft(g, acId, g.now);
      expect(JSON.stringify(Object.values(g.duties).map((d) => [d.flightIds, d.maxFdp, d.augment]))).toBe(duties0);
    } finally {
      D.basic = save.basic;
      D.augmented = save.augmented;
    }
  });

  it('the longest-day popover says the extra hours are pilots resting on board and that discretion is never planned', () => {
    const g = fixtureGame(33);
    const fid = devRestPlan(g);
    const acId = g.flights[fid].aircraftId!;
    const ld = longestDay(g, restOf(g, acId), g.fleet[acId].typeId);
    expect(ld.detail).toMatch(/pilots who take turns to rest on board/);
    expect(ld.detail).toMatch(/Captain's discretion is never part of this/);
  });
});
