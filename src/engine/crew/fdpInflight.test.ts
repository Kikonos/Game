// Leftover-breach round (27 Oct 2026), widebody bot seed 1: a 747 day planned 11:55 of 12:00 landed 9 min late (headwinds,
// the ETA drawn at take-off) and its 12:04 FDP stood on record with no discretion; the checker read 3 such duties over
// their limit. An overrun on the final sector after take-off is the commander's discretion (ORO.FTL.205(f)(2)),
// recorded on the duty.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { blockMinutes } from '../core/perf';
import { schedule } from '../core/queue';
import { DAY } from '../core/time';
import { advanceTo } from '../sim';
import { buildDuties, syncDuty } from './duties';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { autoRoster } from './roster';

/** A two-sector day LIS–FNC–LIS crewed by the roster, flown to just after the final sector's take-off. */
function finalSectorAirborne() {
  const g = fixtureGame(31);
  const acId = Object.keys(g.fleet)[0];
  const ac = g.fleet[acId];
  ac.at = 'LIS';
  const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * 60;
  const b = blockMinutes(ac.typeId, 'LIS', 'FNC');
  const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [acId], start: std - DAY, end: std + 2 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false } });
  addFlight(g, { no: 'AW930', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'LIS', to: 'FNC', std, sta: std + b, pax: 170 });
  const back = addFlight(g, { no: 'AW931', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'FNC', to: 'LIS', std: std + b + 50, sta: std + 2 * b + 50, pax: 160 });
  buildDuties(g, acId, g.now, g.now + 5 * DAY);
  for (const id of addCrew(g, { CPT: 2, FO: 2, PUR: 1, CC: 3 })) g.crew[id].off = [];
  autoRoster(g);
  const f = g.flights[back.id];
  const d = g.duties[f.dutyId!];
  expect(d.legality).not.toBe('illegal');
  expect(d.flightIds[d.flightIds.length - 1]).toBe(f.id);
  while (f.status === 'scheduled' && g.now < std + DAY) advanceTo(g, g.now + 10);
  expect(f.status).toBe('enroute');
  return { g, f, d, std };
}

describe('an FDP overrun after take-off on the final sector (widebody seed 1)', () => {
  it('is recorded as commander’s discretion on the duty: the FDP on record never exceeds its limit plus discretion', () => {
    const { g, f, d, std } = finalSectorAirborne();
    expect(d.discretion ?? 0).toBe(0);
    // Headwinds: the ETA now lands the day 9 min past its limit.
    f.eta = d.report + d.maxFdp + 9;
    f.ev++;
    schedule(g, f.eta, 'flight.arr', f.id, f.ev);
    syncDuty(g, d, g.pairings[d.pairingId]);
    expect(d.fdp).toBe(d.maxFdp + 9);
    expect(d.discretion).toBe(9);
    expect(d.legality).not.toBe('illegal');
    // Landed and released: still on record, and the duty never reads over its limit plus discretion.
    while (!d.done && g.now < std + DAY) advanceTo(g, g.now + 10);
    expect(d.done).toBe(true);
    expect(d.fdp).toBeLessThanOrEqual(d.maxFdp + (d.discretion ?? 0));
    expect(d.discretion ?? 0).toBeGreaterThanOrEqual(9);
  });

  it('a duty already over its limit at that take-off is not covered after the fact', () => {
    const { g, f, d } = finalSectorAirborne();
    // As if it had left over its limit (the gate counted it flown illegally).
    d.legality = 'illegal';
    f.eta = d.report + d.maxFdp + 20;
    syncDuty(g, d, g.pairings[d.pairingId]);
    expect(d.discretion ?? 0).toBe(0);
    expect(d.legality).toBe('illegal');
  });
});
