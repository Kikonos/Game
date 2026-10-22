// v0.7.3 the in-flight rest plan (UPDATE-0.7.3.md §2.2–§2.4; CS FTL.1.205(c)(1), (c)(3)): pilots 90/120 consecutive
// minutes inside the cruise, at most 3 sectors, cabin crew per the cabin table with half the crew working, extra
// cabin crew, blocked seats only where someone rests, the longest-day texts.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { AcRest, RestFacility } from '../core/types';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { autoRoster, buildDuties } from '.';
import { restSeatsBlocked } from './crewRest';
import { syncDuty } from './duties';
import { setDutyAugment } from './explain';
import { longestDay, planRest, restNow, restPlan, restPlanForFlight, restText, restVerdict, slipShort, type RestLeg } from './restPlan';
import { touchCrew } from './timeline';
import { restTooShortCard } from '../problems/crew';

const H = 60;
const T = 1_000_000;
const FCRC: RestFacility = { cls: 1, kind: 'fcrc', places: 2 };
const LDMCR: RestFacility = { cls: 1, kind: 'ldmcr', places: 7 };
const J = (places: number): RestFacility => ({ cls: 2, kind: 'jSeats', places });
const REC = (places: number): RestFacility => ({ cls: 3, kind: 'recliners', places });
/** Legs of `block` minutes with `turn` minutes on the ground between them. */
const legs = (n: number, block: number, turn = 60): RestLeg[] => {
  const out: RestLeg[] = [];
  let t = T;
  for (let i = 0; i < n; i++) {
    out.push({ id: `f${i}`, std: t, sta: t + block });
    t += block + turn;
  }
  return out;
};
const bunks: AcRest = { fc: FCRC, cc: LDMCR };

describe('pilots (CS FTL.1.205(c)(1))', () => {
  it('one 12 h sector, 3 pilots, bunks: CRP then FO then CPT, landing pilots last with 2 h, all inside the cruise', () => {
    const L = legs(1, 12 * H);
    const p = planRest(L, bunks, 1, 14 * H, 6);
    expect(p.ok).toBe(true);
    expect(p.pilots.map((t) => t.seat)).toEqual(['CRP', 'FO', 'CPT']);
    expect(p.pilots.map((t) => !!t.landing)).toEqual([false, true, true]);
    for (const t of p.pilots) {
      expect(t.end - t.start).toBeGreaterThanOrEqual(t.need);
      expect(t.start).toBeGreaterThanOrEqual(L[0].std + 40);
      expect(t.end).toBeLessThanOrEqual(L[0].sta - 70);
      expect(t.where).toBe('fcrc');
    }
    // one at a time, back to back; the spare is shared (about 3:20 each, not just the minimum)
    expect(p.pilots[0].end).toBeLessThanOrEqual(p.pilots[1].start);
    expect(p.pilots[1].end).toBeLessThanOrEqual(p.pilots[2].start);
    expect(p.pilots[2].end).toBe(L[0].sta - 70);
    expect(p.pilots[2].end - p.pilots[2].start).toBeGreaterThanOrEqual(3 * H);
    expect(p.spareMin).toBeGreaterThanOrEqual(30);
    expect(restVerdict(p)).toEqual({ tone: 'good', text: 'Rest plan OK' });
  });
  it('3 × 3:10 sectors: the cruise is too short (no extension); 2 × 4:30 needs 4 pilots resting in pairs', () => {
    const short = planRest(legs(3, 190), bunks, 1, 14 * H, 6);
    expect(short.ok).toBe(false);
    expect(short.code).toBe('tooShort');
    expect(short.why).toMatch(/too short/);
    expect(restVerdict(short)).toEqual({ tone: 'bad', text: 'Not possible' });
    expect(planRest(legs(3, 190), bunks, 2, 14 * H, 6).code).toBe('tooShort');
    const two = legs(2, 4 * H + 30);
    expect(planRest(two, bunks, 1, 14 * H, 6).code).toBe('tooShort');
    const four = planRest(two, bunks, 2, 14 * H, 6);
    expect(four.ok).toBe(true);
    // relief pair on the first leg (90), landing pair on the last (120)
    expect(four.pilots.filter((t) => t.flightId === 'f0').map((t) => t.seat).sort()).toEqual(['CPT2', 'FO2']);
    expect(four.pilots.filter((t) => t.flightId === 'f1').map((t) => t.seat).sort()).toEqual(['CPT', 'FO']);
    // with one place the four rest one at a time
    const one = planRest(legs(1, 13 * H), { fc: { ...FCRC, places: 1 }, cc: LDMCR }, 2, 15 * H, 6);
    expect(one.ok).toBe(true);
    expect(one.pilots.map((t) => t.seat)).toEqual(['CPT2', 'FO2', 'FO', 'CPT']);
  });
  it('at most 3 sectors; no facility → noFacility', () => {
    expect(planRest(legs(4, 5 * H), bunks, 1, 14 * H, 6).code).toBe('sectors');
    expect(planRest(legs(1, 12 * H), { fc: null, cc: LDMCR }, 1, 14 * H, 6).code).toBe('noFacility');
    expect(planRest(legs(1, 12 * H), { fc: FCRC, cc: null }, 1, 14 * H, 6).code).toBe('noFacility');
  });
});

describe('cabin crew (CS FTL.1.205(c)(3))', () => {
  it('the table by cabin FDP and class: 16:10 on class 2 = 3:00 each; class 3 above 16:00 not allowed', () => {
    const p = planRest(legs(1, 14 * H), { fc: FCRC, cc: J(6) }, 2, 16 * H + 10, 8);
    expect(p.ok).toBe(true);
    expect(p.cabinNeed).toBe(180);
    expect(p.band).toBe('16:01–16:30');
    const c3 = planRest(legs(1, 14 * H), { fc: FCRC, cc: REC(6) }, 2, 16 * H + 15, 8);
    expect(c3.code).toBe('cabinClass');
    expect(c3.why).toMatch(/16:00 cabin crew day; this one is 16:15/);
  });
  it('half the crew stay in the cabin: groups one after another; one more crew member when it makes the turns fit', () => {
    // 9 crew, 6 places → 4 at a time, 3 groups × 3:00 = 9:00: a 7:00 cabin window fits only with 10 (2 groups of 5).
    const cabinWin = (w: number) => legs(1, w + 105 + 70);
    const tight = planRest(cabinWin(7 * H), { fc: FCRC, cc: J(6) }, 2, 16 * H + 10, 9);
    expect(tight.ok).toBe(true);
    expect(tight.extraCabin).toBe(1);
    expect(tight.cabin.map((t) => t.n)).toEqual([5, 5]);
    const roomy = planRest(cabinWin(9 * H), { fc: FCRC, cc: J(6) }, 2, 16 * H + 10, 9);
    expect(roomy.extraCabin).toBe(0);
    expect(roomy.cabin.map((t) => t.n)).toEqual([3, 3, 3]);
    for (const t of roomy.cabin) {
      expect(t.n).toBeLessThanOrEqual(4);
      expect(t.end - t.start).toBeGreaterThanOrEqual(180);
    }
    // places bind: adding crew can't help
    const no = planRest(cabinWin(6 * H + 30), { fc: FCRC, cc: J(4) }, 2, 16 * H + 10, 9);
    expect(no.code).toBe('cabinFit');
    expect(no.why).toBe("9 cabin crew with 4 business seats can't all get 3:00 rest in the 6:30 of cruise");
  });
  it('no rest in the first 105 min or the last 70 min', () => {
    const L = legs(1, 10 * H);
    const p = planRest(L, bunks, 1, 13 * H, 6);
    for (const t of p.cabin) {
      expect(t.start).toBeGreaterThanOrEqual(L[0].std + 105);
      expect(t.end).toBeLessThanOrEqual(L[0].sta - 70);
    }
  });
});

describe('seats out of sale', () => {
  it('only seat-based facilities, only on legs where someone rests in them', () => {
    // leg 1 short (nobody rests), leg 2 long
    const L: RestLeg[] = [{ id: 'a', std: T, sta: T + 100 }, { id: 'b', std: T + 160, sta: T + 160 + 11 * H }];
    const p = planRest(L, { fc: J(2), cc: J(5) }, 1, 14 * H, 6);
    expect(p.ok).toBe(true);
    expect(p.blocked).toEqual({ b: 7 });
    expect(planRest(L, bunks, 1, 14 * H, 6).blocked).toEqual({});
  });
  it('deterministic', () => {
    const a = planRest(legs(2, 6 * H), { fc: J(2), cc: J(5) }, 2, 15 * H, 8);
    const b = planRest(legs(2, 6 * H), { fc: J(2), cc: J(5) }, 2, 15 * H, 8);
    expect(a).toEqual(b);
  });
});

describe('texts', () => {
  it('restText', () => {
    expect(restText(FCRC, 'fc')).toBe('bunks by the cockpit (class 1, 2 bunks)');
    expect(restText({ cls: 1, kind: 'ccrc', places: 8 }, 'cc')).toBe('overhead bunks (class 1, 8 bunks)');
    expect(restText({ cls: 1, kind: 'ccrc', places: 14 }, 'cc', 'a388')).toBe('lower-deck bunks (class 1, 14 bunks)');
    expect(restText(LDMCR, 'cc')).toBe('lower-deck crew rest module (class 1, 7 bunks)');
    expect(restText(J(4), 'cc')).toBe('business seats, curtained (class 2, 4 seats)');
    expect(restText(REC(3), 'cc')).toBe('crew rest recliners (class 3, 3 seats)');
    expect(restText(null, 'fc')).toBe('none');
  });
  it('longestDay', () => {
    const g = fixtureGame();
    g.company.approvals.push('augmented');
    expect(longestDay(g, bunks, 'a333').text).toBe('Longest day: 16 h with 3 pilots · 17 h with 4 (18 h on one long sector)');
    expect(longestDay(g, { fc: J(2), cc: J(5) }, 'a333').text).toBe('Longest day: 15 h with 3 pilots · 16 h with 4 (17 h on one long sector)');
    expect(longestDay(g, { fc: REC(2), cc: REC(6) }, 'a333').text).toBe('Longest day: 14 h with 3 pilots · 15 h with 4 (16 h on one long sector)');
    expect(longestDay(g, { fc: FCRC, cc: J(5) }, 'a333').text).toBe("Longest day: 16 h with 3 pilots · 17 h with 4 (the cabin crew's business seats allow 17 h)");
    expect(longestDay(g, { fc: FCRC, cc: REC(6) }, 'a333').text).toBe("Longest day: 16 h with 3 or 4 pilots (the cabin crew's recliners allow 16 h)");
    expect(longestDay(g, { fc: FCRC, cc: null }, 'a333').text).toBe('Longest day: 13 h (14 h as a planned extension) · no in-flight rest for the cabin crew');
    expect(longestDay(g, { fc: null, cc: null }, 'a320ceo').text).toBe('Longest day: 13 h (14 h as a planned extension)');
    const ld = longestDay(g, bunks, 'a333');
    expect([ld.basic, ld.ext, ld.aug1, ld.aug2, ld.aug1Long, ld.aug2Long]).toEqual([13 * H, 14 * H, 16 * H, 17 * H, 17 * H, 18 * H]);
    g.company.approvals = g.company.approvals.filter((a) => a !== 'augmented');
    expect(longestDay(g, bunks, 'a333').text).toBe('Longest day: 13 h (14 h as a planned extension) · needs the Augmented crew approval');
  });
});

describe('the plan of a rostered duty', () => {
  it('names pilots by seat and cabin crew by group; restNow lists who rests', () => {
    const g = fixtureGame();
    g.company.approvals.push('augmented');
    const ac = Object.values(g.fleet)[0];
    ac.typeId = 'a333';
    ac.cabin = { ...ac.cabin, total: 300, y: 300, j: 0, w: 0 };
    ac.rest = bunks;
    addCrew(g, { CPT: 3, FO: 4, PUR: 4, CC: 14 }, 'A330/340');
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 20 * 60;
    fixtureContract(g, { aircraftIds: [ac.id], start: std, end: std + DAY, pattern: { kind: 'legs', legs: [] }, product: { kind: 'charter', price: 1, depositPct: 0, balanceDaysBefore: 0, fuelEscalation: false } });
    const f = addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'GRU', std, sta: std + 12 * H + 30 });
    const [d] = buildDuties(g, ac.id, g.now, g.now + 5 * DAY);
    expect(d.augment).toBe(1);
    expect(restPlan(g, d.id)!.pilots.every((t) => t.crewIds.length === 0)).toBe(true);
    autoRoster(g, { aircraftIds: [ac.id] });
    const p = restPlan(g, d.id)!;
    expect(p.ok).toBe(true);
    expect(p.pilots.every((t) => t.crewIds.length === 1)).toBe(true);
    expect(p.cabin.reduce((n, t) => n + t.crewIds.length, 0)).toBe(p.cabin.reduce((n, t) => n + t.n, 0));
    expect(restPlan(g, d.id, { augment: 2 })!.augment).toBe(2);
    // airborne in the CRP's turn
    ac.flightId = f.id;
    f.status = 'enroute';
    f.atd = f.std;
    const t = p.pilots[0];
    const now = restNow(g, ac.id, t.start + 10);
    expect(now.some((x) => x.where === 'fcrc' && x.until === t.end && x.names[0].startsWith('CRP'))).toBe(true);
  });
});

describe('market roll (UPDATE-0.7.3.md §2.1)', () => {
  it('per-type shares over 500 airframes within ±5 %, deterministic per id', async () => {
    const { ACMI_TYPES_LIST } = await import('../../data/acmiTypes');
    const { rollRestFor } = await import('./restPlan');
    for (const t of ACMI_TYPES_LIST.filter((x) => x.body === 'wide')) {
      const j = t.cabins[0].j;
      let fc = 0;
      let cc = 0;
      let curtain = 0;
      let open = 0;
      for (let i = 0; i < 500; i++) {
        const r = rollRestFor(`a${i}`, t.id, j);
        expect(rollRestFor(`a${i}`, t.id, j)).toEqual(r);
        if (r.fc?.kind === 'fcrc') fc++;
        if (r.cc?.cls === 1) {
          cc++;
          expect(r.cc.kind).toBe(t.rest.ccrcKind);
          expect(r.cc.places).toBe(t.rest.ccrcPlaces);
        }
        if (r.fc?.kind !== 'fcrc') {
          open++;
          if (r.fc?.kind === 'jSeats') curtain++;
        }
      }
      expect(Math.abs(fc / 500 - t.rest.fcrcShare), t.id).toBeLessThanOrEqual(0.05);
      expect(Math.abs(cc / 500 - t.rest.ccrcShare), t.id).toBeLessThanOrEqual(0.05);
      if (open > 50 && j >= 4) expect(Math.abs(curtain / open - t.rest.jCurtainShare), t.id).toBeLessThanOrEqual(0.1);
    }
    // narrowbodies never roll rest
    expect(rollRestFor('a1', 'a321neo', 16)).toEqual({ fc: null, cc: null });
  });
});

describe('v0.7.3 fixes', () => {
  const setup = () => {
    const g = fixtureGame();
    g.company.approvals.push('augmented');
    const ac = Object.values(g.fleet)[0];
    ac.typeId = 'a333';
    ac.cabin = { ...ac.cabin, total: 300, y: 270, j: 30, w: 0 };
    ac.rest = bunks;
    addCrew(g, { CPT: 3, FO: 4, PUR: 4, CC: 14 }, 'A330/340');
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 20 * 60;
    return { g, ac, std };
  };

  it('every leg of an augmented duty cancelled: no rest plan, no crash, the augmentation dropped', () => {
    const { g, ac, std } = setup();
    const f = addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'GRU', std, sta: std + 12 * H + 30 });
    const [d] = buildDuties(g, ac.id, g.now, g.now + 5 * DAY);
    expect(d.augment).toBe(1);
    f.status = 'cancelled';
    expect(planRest([], bunks, 1, 15 * H, 8).ok).toBe(false);
    expect(restPlan(g, d.id)).toBeNull();
    expect(restPlanForFlight(g, f.id)).toBeNull();
    expect(restSeatsBlocked(g, f.id)).toBe(0);
    expect(() => restNow(g, ac.id, std + 3 * H)).not.toThrow();
    syncDuty(g, d, g.pairings[d.pairingId]);
    expect(d.augment).toBe(0);
  });

  it('a pilots-only ferry: only the pilots rest, no cabin crew cap, no seats out of sale', () => {
    const J2: AcRest = { fc: J(2), cc: J(8) };
    const p = planRest(legs(1, 12 * H), J2, 1, 17 * H, 0);
    expect(p.ok).toBe(true);
    expect(p.cabin).toEqual([]);
    expect(p.blocked).toEqual({});
    const { g, ac, std } = setup();
    ac.rest = J2;
    const f = addFlight(g, { no: 'AW2', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'LIS', to: 'GRU', std, sta: std + 12 * H + 30 });
    const [d] = buildDuties(g, ac.id, g.now, g.now + 5 * DAY);
    expect(d.augment).toBe(1);
    const plan = restPlan(g, d.id)!;
    expect(plan.ok).toBe(true);
    expect(plan.cabin).toEqual([]);
    expect(restSeatsBlocked(g, f.id)).toBe(0);
  });

  it('two short duties on one aircraft with a crew change: no "rest too short" card when one crew could fly both without rest', () => {
    const { g, ac, std } = setup();
    const a = addFlight(g, { no: 'AW3', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'FCO', std, sta: std + 3 * H + 30 });
    addFlight(g, { no: 'AW4', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FCO', to: 'LIS', std: std + 4 * H + 30, sta: std + 8 * H });
    const [d] = buildDuties(g, ac.id, g.now, g.now + 5 * DAY);
    // Force a crew change at Rome: the second leg in a duty (and trip) of its own.
    const p = g.pairings[d.pairingId];
    const b = g.flights[d.flightIds[1]];
    const d2 = { ...d, id: 'dx', pairingId: 'px', flightIds: [b.id], report: b.std - 60 };
    d.flightIds = [a.id];
    g.duties.dx = d2;
    b.dutyId = 'dx';
    g.pairings.px = { ...p, id: 'px', dutyIds: ['dx'], slots: p.slots.map((s) => ({ ...s, crewId: null })), start: d2.report };
    touchCrew(g);
    expect(slipShort(g, d.id)).toBeNull();
    expect(restTooShortCard(g, a.id)).toBeNull();
  });

  it('4 pilots on a duty planned before the rules: re-planned under them, refused when the rest plan fails', () => {
    const { g, ac, std } = setup();
    addFlight(g, { no: 'AW5', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'GRU', std, sta: std + 12 * H + 30 });
    const [d] = buildDuties(g, ac.id, g.now, g.now + 5 * DAY);
    d.legacyRest = true;
    expect(setDutyAugment(g, d.id, 2).ok).toBe(true);
    expect(d.augment).toBe(2);
    expect(d.legacyRest).toBeUndefined();
    setDutyAugment(g, d.id, null);
    d.legacyRest = true;
    ac.rest = { fc: null, cc: null };
    expect(setDutyAugment(g, d.id, 2).ok).toBe(false);
    expect(restVerdict(restPlan(g, d.id))?.text).toBe('Planned before the new rules');
  });
});
