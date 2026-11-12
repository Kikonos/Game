// v0.23.1 the class planner on the player's own game ("Chevron", 1 Jun 2027: one 737 flying, CS-TDB away on a dry lease
// until 5 Jul, a first 757-200 on its way): cabin crew at three types (each gives a type up), the classes beyond the
// 120-day booking window (instalments, with a reminder), no pilot hires a phase-out makes needless, and the speed work
// (a step at a time, the same result).

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { Aircraft, GameState } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { hireHead, monthlyHeads, rollCandidates, setHeadRules, unlockHead } from '../ops/heads';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { bookClassPlan, classPlanDefaultBy, classPlanSteps, classProposals, dailyClassReminders } from './classPlan';
import { classOf, dropChoices, dropDefaultFor, startConversion } from './conversion';
import { rosterHorizon } from './dayPlan';
import { flightCrewStatus, rosterOf } from './roster';
import { crewPlan, roundTargets, roundUpRoles } from './sets';
import { typeIdOf } from './timeline';

const F = 'B757/767' as const;
const load = (): GameState => deserialize(fixture('v0221-chevron'));
const reg = (g: GameState, r: string): Aircraft => Object.values(g.fleet).find((a) => a.reg === r)!;

/** Flights inside the published roster that are short of crew. */
function shortNow(g: GameState): string[] {
  const until = rosterHorizon(g);
  return Object.values(g.flights)
    .filter((f) => f.status === 'scheduled' && f.kind !== 'deadhead' && f.aircraftId && f.std >= g.now && f.std < until && ['missing', 'illegal'].includes(flightCrewStatus(g, f.id).level))
    .map((f) => f.id).sort();
}

/** A trip's type. */
const familyOn = (g: GameState, pairingId: string) => typeOf(typeIdOf(g, g.pairings[pairingId])).family;

/** An aircraft of another type in the fleet (a copy of CS-TSM's record: enough for the fleet's counts). */
function addAircraft(g: GameState, typeId: string, r: string, leaseEnd?: number): void {
  const base = reg(g, 'CS-TSM');
  const id = `ac-${r}`;
  g.fleet[id] = { ...base, id, reg: r, typeId, ownership: leaseEnd ? { ...base.ownership, kind: 'dryLeaseIn', leaseEnd } as Aircraft['ownership'] : { kind: 'owned' } as Aircraft['ownership'] };
}

describe('cabin crew at three types: the planner takes them, each giving a type up', () => {
  it('the type given up by default: one with no aircraft, else one being phased out, else the one they fly least', () => {
    const g = load();
    const c = g.crew.c14;
    c.ratings = ['B737', 'A320', 'A330/340'];
    // Pilots, crew under three types and crew already rated give nothing up; a CCQ keeps the type it builds on.
    expect(dropChoices(g.crew.c10, F)).toEqual([]);
    expect(dropChoices(Object.values(g.crew).find((x) => x.role === 'CPT')!, F)).toEqual([]);
    expect(dropChoices(c, F)).toEqual(['B737', 'A320', 'A330/340']);
    expect(dropChoices(c, 'A350')).toEqual(['B737', 'A320']);
    // No A320 or A330 in the fleet: the first of those.
    expect(dropDefaultFor(g, c, F)).toBe('A320');
    // An A320 flies for us: the A330 (still none).
    addAircraft(g, 'a320ceo', 'CS-AAA');
    expect(dropDefaultFor(g, c, F)).toBe('A330/340');
    // An A330 too: they fly the 737 every week and neither of the others: the A320 (fewer aircraft a year on, then the order held).
    addAircraft(g, 'a332', 'CS-BBB');
    expect(rosterOf(g, c.id, g.now, Infinity).length).toBeGreaterThan(0);
    expect(dropDefaultFor(g, c, F)).toBe('A320');
    // The A330 leaves in three months (a phase-out): that one.
    g.fleet['ac-CS-BBB'].ownership = { ...reg(g, 'CS-TSM').ownership, kind: 'dryLeaseIn', leaseEnd: g.now + 90 * DAY } as Aircraft['ownership'];
    expect(dropDefaultFor(g, c, F)).toBe('A330/340');
    // The 737s are the ones going (lease ends, sale): the 737, though they fly it most.
    g.fleet['ac-CS-BBB'].ownership = { kind: 'owned' } as Aircraft['ownership'];
    const tsm = reg(g, 'CS-TSM');
    if (tsm.ownership.kind !== 'dryLeaseIn') throw new Error('fixture changed');
    tsm.ownership.leaseEnd = g.now + 100 * DAY;
    reg(g, 'CS-TDB').sale = { buyer: 'Test', price: 1, agreed: g.now, closes: g.now + 200 * DAY };
    expect(dropDefaultFor(g, c, F)).toBe('B737');
  });

  it('plans them in, says which type each gives up, and takes the player\'s choice', () => {
    const g = load();
    const three = ['c10', 'c11', 'c12', 'c13', 'c14', 'c15'];
    for (const id of three) g.crew[id].ratings = ['B737', 'A320', 'A330/340'];
    const p = classProposals(g, { family: F, group: 'cabin', by: null })[2];
    expect(p.trained).toBe(39);
    for (const id of three) {
      expect(p.drops[id]).toBe('A320');
      expect(p.people[id]?.drop).toBe('A320');
    }
    const q = classProposals(g, { family: F, group: 'cabin', by: null, drops: { c10: 'A330/340', c11: 'B737', c12: 'B757/767' as never } })[2];
    expect(q.drops.c10).toBe('A330/340');
    expect(q.drops.c11).toBe('B737');
    // Not a type they hold: the default.
    expect(q.drops.c12).toBe('A320');
    expect(q.trained).toBe(39);
  });

  it('a type given up that they are rostered on: its trips after the class go through the dry run, then to others', () => {
    const g = load();
    const id = 'c14';
    g.crew[id].ratings = ['B737', 'A320', 'A330/340'];
    const start = classProposals(g, { family: F, group: 'cabin', by: null })[2].earliest;
    // In the first class (3 Jun – 10 Jun): a few 737 duties in the way, more after it.
    const keep = classProposals(g, { family: F, group: 'cabin', by: null, pins: { [id]: start }, drops: { [id]: 'A320' } })[2];
    const drop = classProposals(g, { family: F, group: 'cabin', by: null, pins: { [id]: start }, drops: { [id]: 'B737' } })[2];
    const k = drop.classes.find((x) => x.crewIds.includes(id))!;
    const after = rosterOf(g, id, k.end, Infinity).filter((d) => !d.done && familyOn(g, d.pairingId) === 'B737').length;
    expect(after).toBeGreaterThan(3);
    expect(drop.people[id]).toMatchObject({ drop: 'B737', pinned: true });
    expect(drop.people[id].duties).toBe(keep.people[id].duties + after);
    expect(drop.short).toEqual([]);
    expect(drop.ok).toBe(true);
    // Booked: those trips went to others and every flight stays crewed, as the dry run said.
    const was = shortNow(g);
    expect(bookClassPlan(g, drop).ok).toBe(true);
    expect(shortNow(g).filter((f) => !was.includes(f))).toEqual([]);
    expect(rosterOf(g, id, k.start - DAY, Infinity).filter((d) => !d.done)).toEqual([]);
    expect(classOf(g, id)?.drop?.[id]).toBe('B737');
    // The auto-roster does not put them on a 737 after the class starts; at its end the 737 is gone and the 757/767 is theirs.
    advanceTo(g, k.end + DAY, new Set());
    expect(g.crew[id].ratings).toEqual(['A320', 'A330/340', F]);
    expect(rosterOf(g, id, g.now, Infinity).filter((d) => familyOn(g, d.pairingId) === 'B737')).toEqual([]);
  }, 120_000);
});

describe('classes beyond the 120-day booking window: the next instalment', () => {
  /** The 737s go: CS-TSM's lease ends in 150 days, CS-TDB (back on 5 Jul) is sold in 220. */
  const phaseOut = (): GameState => {
    const g = load();
    const tsm = reg(g, 'CS-TSM');
    if (tsm.ownership.kind !== 'dryLeaseIn') throw new Error('fixture changed');
    tsm.ownership.leaseEnd = g.now + 150 * DAY;
    reg(g, 'CS-TDB').sale = { buyer: 'Test', price: 1, agreed: g.now, closes: g.now + 220 * DAY };
    return g;
  };

  it('shows the classes it can\'t book yet as next, with the first day each can be booked, paced by the aircraft leaving', () => {
    const g = phaseOut();
    const ps = classProposals(g, { family: F, group: 'pilot', by: null });
    for (const p of ps) {
      expect(p.trained).toBe(4);
      expect(p.leftOut).toEqual([]);
      expect(p.next.length).toBeGreaterThanOrEqual(2);
      expect(p.trained + p.next.reduce((n, k) => n + k.crewIds.length, 0)).toBe(20);
      for (const k of p.next) {
        expect(k.start).toBeGreaterThan(p.horizon);
        expect(k.bookFrom).toBe(k.start - BAL.conv.maxAheadDays * DAY);
        expect(k.end - k.start).toBe(BAL.conv.pilotDays * DAY);
      }
      // Nobody leaves the 737 before an aircraft has gone with them: the first instalment after CS-TSM, the last after CS-TDB.
      expect(p.next[0].start).toBeGreaterThanOrEqual(g.now + 150 * DAY);
      expect(p.next[p.next.length - 1].start).toBeGreaterThanOrEqual(g.now + 220 * DAY);
    }
    // A date asked within the window: nothing beyond it.
    expect(classProposals(g, { family: F, group: 'pilot', by: g.now + 60 * DAY }).every((p) => p.next.length === 0)).toBe(true);
    // Cabin crew keep the 737: all of them now, nothing next.
    expect(classProposals(g, { family: F, group: 'cabin', by: null })[2].next).toEqual([]);
  });

  it('the first finish date: the new type\'s next aircraft, but none for a pilot phase-out or an instalment still to come', () => {
    const g = load();
    const arrival = classPlanDefaultBy(g, F, 'cabin');
    expect(arrival).not.toBeNull();
    // No 737 leaving: pilots too get the 757's arrival.
    expect(classPlanDefaultBy(g, F, 'pilot')).toBe(arrival);
    const h = phaseOut();
    expect(classPlanDefaultBy(h, F, 'pilot')).toBeNull();
    // Cabin crew keep the 737: the arrival, until a booked plan has a next instalment for them.
    expect(classPlanDefaultBy(h, F, 'cabin')).toBe(arrival);
    h.classNext = [{ family: F, group: 'cabin', at: h.now + 30 * DAY, crewIds: ['c10'] }];
    expect(classPlanDefaultBy(h, F, 'cabin')).toBeNull();
  });

  it('booked, the Inbox says when the next instalment can be booked (once, and only for people still to train)', () => {
    const g = phaseOut();
    const p = classProposals(g, { family: F, group: 'pilot', by: null })[2];
    expect(bookClassPlan(g, p).ok).toBe(true);
    const at = Math.min(...p.next.map((k) => k.bookFrom));
    expect(g.classNext).toEqual([{ family: F, group: 'pilot', at, crewIds: p.next.flatMap((k) => k.crewIds) }]);
    // Kept in the save.
    const h = deserialize(serialize(g));
    expect(h.classNext).toEqual(g.classNext);
    const lines = (x: GameState) => x.messages.filter((m) => m.title === 'Next 757/767 classes can be booked');
    dailyClassReminders(g);
    expect(lines(g)).toEqual([]);
    g.now = at;
    dailyClassReminders(g);
    expect(lines(g)).toHaveLength(1);
    expect(lines(g)[0].body).toBe('16 pilots still to train. Plan classes on the 757/767 card in Crew › Planning.');
    expect(lines(g)[0].ref).toEqual({ kind: 'crew', id: 'classes:B757/767:pilot' });
    expect(g.classNext).toBeUndefined();
    dailyClassReminders(g);
    expect(lines(g)).toHaveLength(1);
    // Everyone in it booked already (or gone): no line.
    for (const id of h.classNext![0].crewIds) h.crew[id].ratings.push(F);
    h.now = at;
    dailyClassReminders(h);
    expect(lines(h)).toEqual([]);
    expect(h.classNext).toBeUndefined();
  });
});

describe('a phase-out: no hire for the pilots it lets go, nor for those already in class', () => {
  /** Both 737s home (CS-TDB's dry lease ended), CS-TSM's lease ends in 40 days. */
  const twoHome = (): GameState => {
    const g = load();
    const tdb = reg(g, 'CS-TDB');
    tdb.status = 'available';
    for (const k of Object.values(g.contracts)) if (k.dry && k.aircraftIds.includes(tdb.id)) k.dry.returnedAt = g.now;
    const tsm = reg(g, 'CS-TSM');
    if (tsm.ownership.kind !== 'dryLeaseIn') throw new Error('fixture changed');
    tsm.ownership.leaseEnd = g.now + 40 * DAY;
    return g;
  };
  const card = (g: GameState, f: string) => crewPlan(g).find((p) => p.family === f)!;
  const pilotHires = (g: GameState, f: string) => {
    const p = card(g, f);
    const t = roundTargets(p).complete;
    return t === null ? [] : roundUpRoles(p, t).filter((r) => r.role === 'CPT' || r.role === 'FO');
  };
  const desk = (x: GameState) => {
    unlockHead(x, 'crewDesk');
    const head = x.heads!.crewDesk;
    if (!head.hired) {
      if (!head.candidates?.length) head.candidates = rollCandidates(x, 'crewDesk', 0);
      const r = hireHead(x, 'crewDesk', 0);
      if (!r.ok) throw new Error(r.error);
    }
    setHeadRules(x, 'crewDesk', { autoHire: false });
    monthlyHeads(x);
    return x.heads!.crewDesk.proposals.filter((q) => q.kind === 'hire' && /CPT|FO/.test(q.text));
  };

  it('pilots booked to leave the 737 after an aircraft goes still count on it: no 737 pilot hire on the card or from the crew desk', () => {
    const g = twoHome();
    expect(pilotHires(g, 'B737')).toEqual([]);
    const p = classProposals(g, { family: F, group: 'pilot', by: null })[2];
    expect(p.classes.length).toBeGreaterThan(0);
    for (const k of p.classes) expect(k.start).toBeGreaterThanOrEqual(g.now + 40 * DAY);
    expect(bookClassPlan(g, p).ok).toBe(true);
    // Was: 'Short: 3 CPT, 3 FO' and Hire to complete.
    expect(card(g, 'B737').verdict).toMatch(/^Complete/);
    expect(pilotHires(g, 'B737')).toEqual([]);
    // The 757/767 counts them as pilots on the way: no pilot hire there either.
    expect(card(g, F).roles.find((r) => r.role === 'CPT')!.inClass).toBe(p.classes.flatMap((k) => k.crewIds).filter((id) => g.crew[id].role === 'CPT').length);
    expect(pilotHires(g, F)).toEqual([]);
    expect(desk(g)).toEqual([]);
  }, 60_000);

  it('a class that takes them before the aircraft goes still asks for the hires', () => {
    const g = twoHome();
    const cpt = Object.values(g.crew).filter((c) => c.role === 'CPT' && c.ratings[0] === 'B737').slice(0, 2).map((c) => c.id);
    const fo = Object.values(g.crew).filter((c) => c.role === 'FO' && c.ratings[0] === 'B737').slice(0, 2).map((c) => c.id);
    g.company.cash = 5_000_000;
    expect(startConversion(g, { crewIds: [...cpt, ...fo], family: F, start: g.now + 5 * DAY }).ok).toBe(true);
    expect(pilotHires(g, 'B737')).toEqual([{ role: 'CPT', count: 1 }, { role: 'FO', count: 1 }]);
  });
});

describe('the planner a step at a time', () => {
  it('yields between its searches and dry runs and ends with the same proposals; asked again, the same', () => {
    const g = load();
    const req = { family: F, group: 'cabin' as const, by: g.now + 29 * DAY };
    const it = classPlanSteps(deserialize(serialize(g)), req);
    let steps = 0;
    let r = it.next();
    while (!r.done) {
      steps++;
      r = it.next();
    }
    expect(steps).toBeGreaterThan(5);
    const once = classProposals(g, req);
    expect(r.value).toEqual(once);
    // (The second time reads the dry runs kept from the first.)
    expect(classProposals(g, req)).toEqual(once);
  }, 60_000);
});
