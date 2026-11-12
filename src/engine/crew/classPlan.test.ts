// v0.23 the class planner (crew/classPlan.ts) on the player's own game ("Chevron", 1 Jun 2027: one 737 flying, one away
// on a dry lease, a first 757-200 on its way; 10 CPT / 10 FO / 10 PUR / 29 CC on the 737, the 757/767 short of 3
// pursers and 20 cabin crew) and Remove type rating for cabin crew.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { bookClassPlan, CLASS_PLAN, classCandidates, classPlanNeed, classProposal, classProposals, fleetChanges, removeRating, removeRatingPlan } from './classPlan';
import { rosterHorizon } from './dayPlan';
import { staffing } from './hr';
import { flightCrewStatus, rosterOf } from './roster';

const F = 'B757/767' as const;
const load = (): GameState => deserialize(fixture('v0221-chevron'));

/** Flights inside the published roster that are short of crew. */
function shortNow(g: GameState): string[] {
  const until = rosterHorizon(g);
  return Object.values(g.flights)
    .filter((f) => f.status === 'scheduled' && f.kind !== 'deadhead' && f.aircraftId && f.std >= g.now && f.std < until && ['missing', 'illegal'].includes(flightCrewStatus(g, f.id).level))
    .map((f) => f.id).sort();
}

describe('class planner: cabin crew onto the 757/767 (the player\'s save)', () => {
  const g = load();
  const before = JSON.stringify(g);
  const all = classProposals(g, { family: F, group: 'cabin', by: null });

  it('reads the need and the people from the game', () => {
    const need = classPlanNeed(g, F, 'cabin');
    expect(need.text).toBe('Short 3 pursers and 20 cabin crew');
    expect(need.arrival?.reg).toBe('CS-TTA');
    expect(classCandidates(g, F, 'cabin')).toHaveLength(39);
    expect(classCandidates(g, F, 'pilot')).toHaveLength(20);
  });

  it('proposes classes for everyone, sized as real classes, with nobody on leave in them', () => {
    expect(all).toHaveLength(CLASS_PLAN.stops);
    for (const p of all) {
      expect(p.ok).toBe(true);
      expect(p.asked).toBe(39);
      expect(p.trained).toBe(39);
      expect(p.trained + p.leftOut.length).toBe(39);
      expect(p.short).toEqual([]);
      expect(p.thin).toEqual([]);
      expect(p.fees).toBe(39 * BAL.conv.cabinCost);
      for (const k of p.classes) {
        expect(k.crewIds.length).toBeLessThanOrEqual(CLASS_PLAN.max.cabin);
        expect(k.end - k.start).toBe(BAL.conv.cabinDays * DAY);
        for (const id of k.crewIds) expect((g.crew[id].blocks ?? []).some((b) => b.from < k.end && b.to > k.start - DAY), `${id} on leave in ${k.no}`).toBe(false);
      }
      // As few classes as the room allows.
      expect(p.classes.length).toBe(Math.ceil(39 / CLASS_PLAN.max.cabin));
    }
  });

  it('is pure and deterministic', () => {
    expect(JSON.stringify(g) === before, 'the game is unchanged').toBe(true);
    expect(classProposals(g, { family: F, group: 'cabin', by: null })).toEqual(all);
    expect(classProposal(g, { family: F, group: 'cabin', by: null, balance: 2 })).toEqual(all[2]);
  });

  it('booked, it keeps every flight of the published roster crewed, as the dry run said', () => {
    const h = load();
    const was = shortNow(h);
    const cash = h.company.cash;
    const training = h.finance.current.lines.training ?? 0;
    const p = all[2];
    const r = bookClassPlan(h, p);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.data!.classIds).toHaveLength(p.classes.length);
    expect(shortNow(h).filter((id) => !was.includes(id))).toEqual([]);
    // Classes are the game's own conversion classes: blocks on the calendar, the fees on the training line.
    for (const [i, id] of r.data!.classIds.entries()) {
      const k = h.classes![id];
      expect(k.status).toBe('planned');
      expect(k.start).toBe(p.classes[i].start);
      expect([...k.crewIds].sort()).toEqual([...p.classes[i].crewIds].sort());
      for (const cid of k.crewIds) {
        expect(h.crew[cid].blocks?.some((b) => b.why === 'training' && b.from === k.start && b.to === k.end)).toBe(true);
        expect(rosterOf(h, cid, k.start, k.end).filter((d) => !d.done)).toEqual([]);
      }
    }
    expect((h.finance.current.lines.training ?? 0) - training).toBe(-p.fees);
    expect(cash - h.company.cash).toBe(p.fees + p.extra);
    // The 757/767 is no longer short once they are booked.
    expect(classPlanNeed(h, F, 'cabin').text).toBe('None short');
  });
});

describe('class planner: the slider', () => {
  const g = load();
  // Five weeks to do it in: not everyone is free in time, so bigger classes and a quiet roster pull apart.
  const all = classProposals(g, { family: F, group: 'cabin', by: g.now + 35 * DAY });
  const [big, calm] = [all[0], all[CLASS_PLAN.stops - 1]];

  it('fewer, bigger classes at one end, the roster untouched at the other', () => {
    expect(calm.duties).toBe(0);
    expect(big.duties).toBeGreaterThan(calm.duties);
    expect(big.trained).toBeGreaterThan(calm.trained);
    expect(big.classes.length).toBeLessThanOrEqual(calm.classes.length);
    const size = (p: typeof big) => p.trained / p.classes.length;
    expect(size(big)).toBeGreaterThan(size(calm));
  });

  it('moves one way only along the stops, and never leaves a flight short or runs past the date', () => {
    for (let i = 0; i < all.length; i++) {
      expect(all[i].short).toEqual([]);
      expect(all[i].late).toBe(false);
      expect(all[i].finish!).toBeLessThanOrEqual(g.now + 35 * DAY);
      if (i) expect(all[i].duties).toBeLessThanOrEqual(all[i - 1].duties);
    }
  });

  it('says why each person left out is not in a class', () => {
    expect(big.leftOut.length).toBe(39 - big.trained);
    for (const x of big.leftOut) expect(x.why.length).toBeGreaterThan(5);
  });

  it('takes the player\'s own moves: someone out, someone into another class', () => {
    const base = classProposal(g, { family: F, group: 'cabin', by: null, balance: 2 });
    const [a, b] = base.classes;
    const out = a.crewIds[0];
    const mover = a.crewIds[1];
    const p = classProposal(g, { family: F, group: 'cabin', by: null, balance: 2, pins: { [out]: 'out', [mover]: b.start } });
    expect(p.classes.some((k) => k.crewIds.includes(out))).toBe(false);
    expect(p.leftOut.find((x) => x.crewId === out)?.why).toBe('Taken out');
    expect(p.classes.find((k) => k.crewIds.includes(mover))?.start).toBe(b.start);
    expect(p.people[mover].pinned).toBe(true);
    expect(p.trained).toBe(38);
  });
});

describe('class planner: save and load, and the course itself', () => {
  it('a booked plan survives a save, and the class ends with the new rating whether or not the game was saved in between', () => {
    const g = load();
    // One class as soon as it fits.
    const p = classProposal(g, { family: F, group: 'cabin', by: g.now + 12 * DAY, balance: 0 });
    expect(p.classes).toHaveLength(1);
    expect(bookClassPlan(g, p).ok).toBe(true);
    const h = deserialize(serialize(g));
    expect(h.classes).toEqual(g.classes);
    expect(h.training).toEqual(g.training);
    const end = p.classes[0].end + DAY;
    advanceTo(g, end, new Set());
    advanceTo(h, end, new Set());
    for (const x of [g, h]) {
      const k = Object.values(x.classes!).find((c) => c.no === p.classes[0].no)!;
      expect(k.status).toBe('done');
      for (const id of p.classes[0].crewIds) {
        const c = x.crew[id];
        if (!c) continue;
        expect(c.ratings).toContain(F);
        expect(c.ratings).toContain('B737');
        expect(c.blocks?.some((b) => b.why === 'training' && b.to > x.now) ?? false).toBe(false);
      }
    }
    expect(JSON.stringify(h.crew) === JSON.stringify(g.crew), 'same crew after the class either way').toBe(true);
    expect(h.company.cash).toBe(g.company.cash);
  }, 120_000);
});

describe('class planner: pilots and the phase-out', () => {
  it('lets go only the pilots the old type can spare, and says which aircraft keeps the rest', () => {
    const g = load();
    // One 737 flies, CS-TDB comes back from its dry lease on 5 Jul: 8 + 8 pilots needed from then, of 10 + 10.
    expect(fleetChanges(g, 'B737')).toMatchObject({ now: 1, changes: [{ delta: 1, reg: 'CS-TDB', what: 'back from dry lease' }] });
    const p = classProposal(g, { family: F, group: 'pilot', by: null, balance: 2 });
    expect(p.trained).toBe(4);
    expect(p.classes).toHaveLength(1);
    const roles = p.classes[0].crewIds.map((id) => g.crew[id].role).sort();
    expect(roles).toEqual(['CPT', 'CPT', 'FO', 'FO']);
    expect(p.classes[0].end - p.classes[0].start).toBe(BAL.conv.pilotDays * DAY);
    expect(p.leftOut).toHaveLength(16);
    expect(p.leftOut[0].why).toMatch(/The B737 needs 8 (captains|first officers) from .* \(CS-TDB back from dry lease\)/);
    expect(p.pace[0]).toMatch(/^The B737 needs 8 captains and 8 first officers from /);
    expect(p.short).toEqual([]);
  });

  it('paces the conversion by the aircraft leaving: nobody starts before the 737 can spare them', () => {
    const g = load();
    // The 737s go: CS-TSM's lease ends in 40 days, CS-TDB (back on 5 Jul) is sold in 70.
    const tsm = Object.values(g.fleet).find((a) => a.reg === 'CS-TSM')!;
    const tdb = Object.values(g.fleet).find((a) => a.reg === 'CS-TDB')!;
    if (tsm.ownership.kind !== 'dryLeaseIn') throw new Error('fixture changed');
    tsm.ownership.leaseEnd = g.now + 40 * DAY;
    tdb.sale = { buyer: 'Test', price: 1, agreed: g.now, closes: g.now + 70 * DAY };
    g.company.cash = 5_000_000;
    const fc = fleetChanges(g, 'B737');
    expect(fc.changes.map((c) => c.delta)).toEqual([1, -1, -1]);
    const p = classProposal(g, { family: F, group: 'pilot', by: null, balance: 2 });
    expect(p.classes.length).toBeGreaterThan(1);
    expect(p.trained).toBeGreaterThan(4);
    // At every class start, the 737 still has the pilots its fleet needs from then on.
    const need = (t: number) => {
      let n = fc.now;
      let peak = 0;
      for (const c of fc.changes) if (c.at <= t) n += c.delta;
      peak = n;
      for (const c of fc.changes) if (c.at > t) peak = Math.max(peak, (n += c.delta));
      return peak * 4;
    };
    for (const role of ['CPT', 'FO'] as const) {
      let gone = 0;
      for (const k of p.classes) {
        gone += k.crewIds.filter((id) => g.crew[id].role === role).length;
        expect(10 - gone, `${role} left after ${k.no}`).toBeGreaterThanOrEqual(need(k.start));
      }
    }
    // Pilot classes start two weeks apart, in simulator pairs.
    for (let i = 1; i < p.classes.length; i++) expect(p.classes[i].start - p.classes[i - 1].start).toBeGreaterThanOrEqual(BAL.conv.pilotStaggerDays * DAY);
    for (const k of p.classes) expect(k.crewIds.length).toBeLessThanOrEqual(CLASS_PLAN.max.pilot);
  });
});

describe('class planner: the cash on hand', () => {
  it('plans only the courses the cash pays for, and says so for the rest', () => {
    const g = load();
    g.company.cash = 3 * BAL.conv.cabinCost + 500;
    const p = classProposal(g, { family: F, group: 'cabin', by: null, balance: 4 });
    expect(p.trained).toBe(3);
    expect(p.fees).toBe(3 * BAL.conv.cabinCost);
    expect(p.ok).toBe(true);
    expect(p.leftOut.filter((x) => x.why === 'Not enough cash for their course')).toHaveLength(36);
  });
});

describe('remove type rating (cabin crew)', () => {
  const twoTypes = (g: GameState, n: number): string[] => {
    const ids = Object.values(g.crew).filter((c) => c.role === 'CC' && c.ratings.length === 1 && c.ratings[0] === 'B737').sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, n).map((c) => c.id);
    for (const id of ids) g.crew[id].ratings.push(F);
    return ids;
  };

  it('shows who loses the type and what it does to its cover, and warns when it leaves the type short', () => {
    const g = load();
    const ids = twoTypes(g, 29);
    const cc = () => ({ have: Object.values(g.crew).filter((c) => c.role === 'CC' && c.ratings.includes('B737')).length });
    const have = cc().have;
    expect(have).toBe(29);
    const few = removeRatingPlan(g, ids.slice(0, 3), 'B737');
    expect(few.ok).toBe(true);
    expect(few.people.map((x) => x.crewId)).toEqual(ids.slice(0, 3));
    expect(few.people[0].keeps).toEqual([F]);
    expect(few.coverage.find((x) => x.role === 'CC')).toMatchObject({ have, after: have - 3, need: 12 });
    expect(few.warnings).toEqual([]);
    const many = removeRatingPlan(g, ids, 'B737');
    // (People flying the 737 right now keep it until they are back.)
    expect(many.people.length + many.skipped.length).toBe(29);
    for (const x of many.skipped) expect(x.why).toMatch(/^Flying the B737 until /);
    expect(many.coverage.find((x) => x.role === 'CC')!.after).toBe(have - many.people.length);
    // Spare pursers fill cabin crew seats, so the cabin crew alone may still be covered; with the pursers gone too it is short.
    const purs = Object.values(g.crew).filter((c) => c.role === 'PUR' && c.ratings.includes('B737')).map((c) => c.id);
    for (const id of purs) g.crew[id].ratings.push(F);
    const everyone = removeRatingPlan(g, [...ids, ...purs], 'B737');
    expect(everyone.coverage.find((x) => x.role === 'PUR')!.after).toBeLessThan(4);
    expect(everyone.warnings.some((w) => w.level === 'bad' && /Leaves the B737 short: \d+ of 4 pursers/.test(w.text))).toBe(true);
    expect(everyone.warnings.some((w) => w.level === 'bad' && /Leaves the B737 short: \d+ of 12 cabin crew/.test(w.text))).toBe(true);
    // The plan is a dry run: nothing changed.
    expect(cc().have).toBe(have);
  });

  it('removes it: the rating goes, the cover follows, their trips on the type go back to the roster', () => {
    const g = load();
    const ids = twoTypes(g, 20);
    const busy = ids.filter((id) => rosterOf(g, id, g.now, Infinity).some((d) => !d.done && g.pairings[d.pairingId]?.status === 'planned' && g.pairings[d.pairingId].start > g.now));
    expect(busy.length).toBeGreaterThan(0);
    const pick = [busy[0], ...ids.filter((id) => !busy.includes(id)).slice(0, 2)];
    const was = shortNow(g);
    const rated = () => Object.values(g.crew).filter((c) => c.role === 'CC' && c.ratings.includes('B737')).length;
    const have = rated();
    const plan = removeRatingPlan(g, pick, 'B737');
    const r = removeRating(g, pick, 'B737');
    if (!r.ok) throw new Error(r.error);
    expect(r.data!.trips).toBe(plan.trips);
    for (const id of plan.people.map((x) => x.crewId)) {
      expect(g.crew[id].ratings).toEqual([F]);
      expect(rosterOf(g, id, g.now, Infinity).filter((d) => !d.done && g.fleet[g.pairings[d.pairingId]?.aircraftId ?? '']?.typeId === 'b738')).toEqual([]);
    }
    expect(rated()).toBe(have - plan.people.length);
    expect(plan.coverage.find((x) => x.role === 'CC')).toMatchObject({ have, after: have - plan.people.length });
    // The Planning view counts them on the 757/767 only from now on.
    expect(staffing(g).filter((l) => l.family === 'B737').every((l) => l.have >= 0)).toBe(true);
    expect(shortNow(g).filter((id) => !was.includes(id))).toEqual(plan.short.length ? expect.anything() : []);
    // A place is free again: they can be booked onto a third type.
    expect(g.crew[pick[1]].ratings.length).toBeLessThan(3);
  });

  it('refuses the only type, a pilot, and someone who does not hold it', () => {
    const g = load();
    const cc = Object.values(g.crew).find((c) => c.role === 'CC' && c.ratings.length === 1)!;
    const cpt = Object.values(g.crew).find((c) => c.role === 'CPT')!;
    expect(removeRating(g, [cc.id], 'B737')).toMatchObject({ ok: false, error: expect.stringContaining('only type') });
    expect(removeRating(g, [cpt.id], 'B737')).toMatchObject({ ok: false, error: expect.stringContaining('conversion course') });
    expect(removeRating(g, [cc.id], 'A320')).toMatchObject({ ok: false, error: expect.stringContaining('Not rated') });
    const p = removeRatingPlan(g, [cc.id, cpt.id], 'B737');
    expect(p.ok).toBe(false);
    expect(p.skipped).toHaveLength(2);
  });
});
