// v0.25 parking for an aircraft left on the ground away from base (ops/parking.ts).

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { newGame, owned } from '../contracts/testkit';
import { dailyParking, parkPerDay, parksAt } from './parking';
import { quotePosition } from './position';
import { usd } from './util';

const fees = (g: GameState) => g.finance.current.lines.airportFees ?? 0;

describe('v0.25 parking away from base', () => {
  it('a day or more on the ground at an outstation costs a day of parking, twice at a slot hub; never at home', () => {
    const g = newGame(7);
    const ac = owned(g);
    for (const f of Object.values(g.flights)) if (f.aircraftId === ac.id) f.status = 'cancelled';
    ac.at = 'FAO';
    ac.deliveredAt = g.now - 2 * DAY;
    expect(parksAt(g, ac)).toBe(true);
    const f0 = fees(g);
    dailyParking(g);
    expect(fees(g) - f0).toBe(-parkPerDay(ac.typeId, 'FAO'));
    expect(parkPerDay(ac.typeId, 'LHR')).toBe(2 * parkPerDay(ac.typeId, 'FAO'));
    expect([BAL.delivery.parkPerDay[0], BAL.delivery.parkPerDay[1]]).toContain(parkPerDay(ac.typeId, 'FAO'));
    ac.at = g.company.homeBase;
    expect(parksAt(g, ac)).toBe(false);
    // Just landed: a night stop is in the job's price.
    ac.at = 'FAO';
    ac.deliveredAt = g.now - 60;
    expect(parksAt(g, ac)).toBe(false);
  });

  it('the Position quote says what a day there costs', () => {
    const g = newGame(3);
    const ac = owned(g);
    const q = quotePosition(g, ac.id, 'FRA', { from: g.now });
    expect(q.ok).toBe(true);
    expect(q.notes).toContain(`Parking about ${usd(parkPerDay(ac.typeId, 'FRA'))} a day there.`);
  });
});
