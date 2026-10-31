// v0.14 crew sets in plain words: the strip's sentence, the card's home fleet, the "i" lines.
import { describe, expect, it } from 'vitest';
import type { FamilyPlan, SetRole } from '../../engine/crew';
import { fleetShort, planSentence, ratingLine, roleCount, setsWhyLines } from './crewPlanLogic';

const role = (r: SetRole['role'], balance: number): SetRole => ({ role: r, perSet: 1, need: 5, have: 5 + balance, joining: 0, away: 0, shared: 0, balance, covered: 0, perSetAll: 1 });
const plan = (o: Partial<FamilyPlan>): FamilyPlan => ({
  family: 'A320', label: 'A320 family', aircraft: 1, types: [{ typeId: 'a320ceo', short: 'A320', aircraft: 1, set: {} }], setsPerAircraft: 5, setsNeeded: 5, setsNow: 5, setsComplete: 5,
  limiting: null, augmented: false, clientCabin: 0, dryLeased: 0, roles: [], verdict: '', alsoRated: [], backupFrom: [], ...o,
});

describe('v0.14 crew sets in plain words', () => {
  it('says one sentence per fleet in the strip', () => {
    expect(planSentence(plan({ setsComplete: 2, setsNow: 2, roles: [role('CPT', 0), role('CC', -6)] }))).toBe('A320: 2 of 5 full crews · short 6 cabin crew');
    expect(planSentence(plan({ setsComplete: 3, setsNow: 3, roles: [role('CPT', -1), role('FO', -2), role('PUR', -1)] }))).toBe('A320: 3 of 5 full crews · short 1 captain, 2 first officers, 1 purser');
    expect(planSentence(plan({ setsNeeded: 25, setsComplete: 31, setsNow: 22 }))).toBe('A320: 25 of 25 full crews · 6 spare · 3 joining');
    expect(planSentence(plan({ family: 'A330/340', types: [{ typeId: 'a332', short: 'A332', aircraft: 1, set: {} }], setsNeeded: 6, setsComplete: 6, setsNow: 6 }))).toBe('A330: 6 of 6 full crews');
    expect(planSentence(plan({ setsNeeded: 1, setsComplete: 1, setsNow: 1 }))).toBe('A320: 1 of 1 full crew');
  });

  it('names fleets as crews do', () => {
    expect(fleetShort('A320')).toBe('A320');
    expect(fleetShort('A330/340', ['a332'])).toBe('A330');
    expect(fleetShort('A330/340', ['a343', 'a346'])).toBe('A340');
    expect(fleetShort('B757/767')).toBe('757/767');
    expect(roleCount('CC', 1)).toBe('1 cabin crew');
    expect(roleCount('FO', 1)).toBe('1 first officer');
  });

  it("shows a dual-rated person's home fleet first, the others in brackets (cabin crew and CCQ pilots alike)", () => {
    expect(ratingLine(['A320', 'A330/340'], 'A320', ['a320ceo', 'a332'])).toBe('A320 (also A330)');
    // an Airbus CCQ pilot counted on the A330
    expect(ratingLine(['A320', 'A330/340'], 'A330/340', ['a320ceo', 'a332'])).toBe('A330 (also A320)');
    // no home known (not counted anywhere): the first rating
    expect(ratingLine(['B737', 'A320'])).toBe('737 (also A320)');
    expect(ratingLine(['A320'], 'A320')).toBe('A320');
    expect(ratingLine([])).toBe('no rating');
  });

  it('explains the sets in three short lines', () => {
    const l = setsWhyLines(plan({ limiting: 'CC' }));
    expect(l).toHaveLength(3);
    expect(l[0]).toMatch(/^5 crews per aircraft/);
    expect(l[1]).toMatch(/here, cabin crew/);
    expect(l[2]).toMatch(/captain can’t be planned as first officer/);
    expect(l[2]).toMatch(/spare pursers fill cabin crew seats/);
    expect(setsWhyLines(plan({ augmented: true }))[2]).toMatch(/spare first officers relief seats/);
    expect(l[2]).toMatch(/count once, in their home fleet/);
    expect(setsWhyLines(plan({ setsPerAircraft: 7 }))[0]).toMatch(/^7 crews per aircraft: on a detachment/);
    for (const x of [...l, ...setsWhyLines(plan({ augmented: true, setsPerAircraft: 7, limiting: 'FO' }))]) expect(x.length).toBeLessThan(170);
  });
});
