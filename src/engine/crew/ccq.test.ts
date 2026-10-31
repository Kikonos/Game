// v0.12.1 Airbus cross crew qualification (CCQ) between the A320 family and the A330/340 (both ratings kept, EASA
// Mixed Fleet Flying), what an old full A320 → A330 course does now, the load repair for pilots who lost the A320
// that way, and B757/767 pay following the fleet (widebody pay while a 767 is in it).

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { run } from '../contracts/testkit';
import { devAddType } from '../dev';
import { deserialize, serialize } from '../save';
import { addCrew, fixtureGame } from './fixtures';
import { classOf, conversionEarliest, conversionPlan, courseText, crewPay, payFor, salaryFor, staffing, startConversion } from '.';
import { dailyPay } from './hr';
import { makeCrewMember } from './generate';
import { restoreCcqRatings } from './conversion';

const rich = (seed = 5): GameState => {
  const g = fixtureGame(seed);
  g.company.cash = 50_000_000;
  return g;
};
const start = (g: GameState) => conversionEarliest(g);

describe('v0.12.1 CCQ A320 ↔ A330', () => {
  it('an A320 pilot onto the A330: a 10-day CCQ, keeps the A320, no bond; cabin crew a 3-day course', () => {
    const g = rich();
    const [fo] = addCrew(g, { FO: 1 });
    const [cc] = addCrew(g, { CC: 1 });
    const plan = conversionPlan(g, { crewIds: [fo, cc], family: 'A330/340', start: start(g) });
    const p = plan.classes.find((k) => k.group === 'pilot')!;
    const c = plan.classes.find((k) => k.group === 'cabin')!;
    expect(p.course).toBe('ccq');
    expect(p.end - p.start).toBe(10 * DAY);
    expect(p.costPerHead).toBe(BAL.conv.pilotCcqCost);
    expect(BAL.conv.pilotCcqCost).toBeGreaterThanOrEqual(15_000);
    expect(BAL.conv.pilotCcqCost).toBeLessThanOrEqual(20_000);
    expect(c.course).toBe('ccq');
    expect(c.end - c.start).toBe(3 * DAY);
    expect(plan.ratingsAfter[fo]).toEqual(['A320', 'A330/340']);
    expect(startConversion(g, { crewIds: [fo, cc], family: 'A330/340', start: start(g) }).ok).toBe(true);
    const k = classOf(g, fo)!;
    expect(courseText(g, k)).toBe('CCQ (keeps A320)');
    run(g, k.end + 60);
    expect(g.crew[fo].ratings).toEqual(['A320', 'A330/340']);
    expect(g.crew[fo].bondUntil).toBeUndefined();
    expect(g.crew[fo].salary).toBe(salaryFor('FO', 'A330/340'));
    expect(g.crew[cc].ratings).toEqual(['A320', 'A330/340']);
    expect(g.messages.some((m) => /^A330-P1 finished/.test(m.title) && /keep the A320 and fly both/.test(m.body))).toBe(true);
  });

  it('and back: an A330 captain onto the A320 is a CCQ too; a 777 captain is not', () => {
    const g = rich();
    const [a] = addCrew(g, { CPT: 1 }, 'A330/340');
    const [b] = addCrew(g, { CPT: 1 }, 'B777');
    const plan = conversionPlan(g, { crewIds: [a, b], family: 'A320', start: start(g) });
    expect(plan.classes.map((k) => k.course).sort()).toEqual(['ccq', 'full']);
    expect(plan.ratingsAfter[a]).toEqual(['A330/340', 'A320']);
    expect(plan.ratingsAfter[b]).toEqual(['A320']);
    expect(courseText(g, { ...plan.classes.find((k) => k.course === 'full')!, family: 'A320' })).toBe('Full course');
  });

  it('a pilot on both types counts once in staffing (no double count) and stays on the A320 line while converting', () => {
    const g = rich();
    devAddType(g, 'a332');
    const cpts = () => staffing(g).filter((l) => l.role === 'CPT').reduce((n, l) => n + l.have, 0);
    const n0 = Object.values(g.crew).filter((c) => c.role === 'CPT' && !c.notice).length;
    expect(cpts()).toBe(n0);
    const id = Object.values(g.crew).find((c) => c.role === 'CPT' && c.ratings.includes('A320'))!.id;
    const a320 = staffing(g).find((l) => l.family === 'A320' && l.role === 'CPT')!;
    expect(startConversion(g, { crewIds: [id], family: 'A330/340', start: start(g) }).ok).toBe(true);
    expect(staffing(g).find((l) => l.family === 'A320' && l.role === 'CPT')).toMatchObject({ have: a320.have, converting: 0 });
    run(g, classOf(g, id)!.end + 60);
    expect(g.crew[id].ratings).toEqual(['A320', 'A330/340']);
    expect(cpts()).toBe(n0);
  });

  it('a full A320 → A330 course booked before the CCQ keeps its dates and, at the end, the A320', () => {
    const g = rich();
    const [fo] = addCrew(g, { FO: 1 });
    expect(startConversion(g, { crewIds: [fo], family: 'A330/340', start: start(g) }).ok).toBe(true);
    // As an old save holds it: a 42-day full course.
    const k = classOf(g, fo)!;
    k.course = 'full';
    expect(staffing(g).find((l) => l.family === 'A320' && l.role === 'FO')?.converting ?? 0).toBe(0);
    run(g, k.end + 60);
    expect(g.crew[fo].ratings).toEqual(['A320', 'A330/340']);
    expect(g.crew[fo].bondUntil).toBeGreaterThan(k.end);
    expect(g.messages.some((m) => /^A330-P1 finished/.test(m.title) && /keep the A320 as well/.test(m.body))).toBe(true);
  });
});

describe('v0.12.1 load repair: the A320 rating back', () => {
  /** A pilot who finished a full A320 → A330 course before the CCQ (ratings: the A330 only). */
  const oldConversion = (withMessage: boolean) => {
    const g = rich();
    devAddType(g, 'a332');
    const [fo] = addCrew(g, { FO: 1 });
    const c = g.crew[fo];
    c.ratings = ['A330/340'];
    c.salary = salaryFor('FO', 'A330/340');
    g.classes = { tc1: { id: 'tc1', no: 'A330-P1', family: 'A330/340', group: 'pilot', course: 'full', start: g.now - 50 * DAY, end: g.now - 8 * DAY, crewIds: [fo], costPerHead: 52_000, status: 'done' } };
    if (withMessage) g.messages.unshift({ id: 'm1', t: g.now - 8 * DAY, tone: 'good', cat: 'crew', title: 'A330-P1 finished: 1 pilot now fly the A330', body: 'Their A320 rating is no longer current.', read: true } as GameState['messages'][number]);
    return { g, fo };
  };

  it('on load, from the class message: the A320 is back, nothing charged, one message; a second load changes nothing', () => {
    const { g, fo } = oldConversion(true);
    const cash = g.company.cash;
    const h = deserialize(serialize(g));
    expect(h.crew[fo].ratings).toEqual(['A320', 'A330/340']);
    expect(h.company.cash).toBe(cash);
    expect(h.messages[0].title).toBe('1 pilot get their A320 rating back');
    expect(h.messages[0].body).toMatch(/keeps both ratings/);
    const n = h.messages.length;
    const i = deserialize(serialize(h));
    expect(i.messages.length).toBe(n);
    expect(restoreCcqRatings(i)).toEqual([]);
  });

  it('without the message: from the fleet when the A320 is the only other family; never when it may have been another', () => {
    const { g, fo } = oldConversion(false);
    expect(restoreCcqRatings(g)).toEqual([fo]);
    const x = oldConversion(false);
    devAddType(x.g, 'b738');
    expect(restoreCcqRatings(x.g)).toEqual([]);
    expect(x.g.crew[x.fo].ratings).toEqual(['A330/340']);
  });
});

describe('v0.12.1 B757/767 pay follows the fleet', () => {
  it('757 only: narrowbody pay; a 767 joins: widebody pay as on the A330 (one message); it leaves: back', () => {
    const g = rich();
    const ac757 = devAddType(g, 'b752');
    const [cpt, cc] = addCrew(g, { CPT: 1, CC: 1 }, 'B757/767');
    expect(g.crew[cpt].salary).toBe(BAL.salary.CPT[0]);
    expect(payFor(g, 'CPT', 'B757/767')).toBe(BAL.salary.CPT[0]);
    expect(dailyPay(g)).toBe(0);
    const ac767 = devAddType(g, 'b763');
    expect(ac757 && ac767).toBeTruthy();
    expect(payFor(g, 'CPT', 'B757/767')).toBe(salaryFor('CPT', 'A330/340'));
    // (devAddType's own crew for the 767 joined on the widebody scale already.)
    const n = Object.values(g.crew).filter((c) => c.ratings.includes('B757/767') && c.salary !== crewPay(g, c)).length;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(dailyPay(g)).toBe(n);
    expect(g.crew[cpt].salary).toBe(BAL.salary.CPT[1]);
    expect(g.crew[cc].salary).toBe(BAL.salary.CC[1]);
    expect(g.messages[0].title).toBe('B757/767 crews move to widebody pay');
    // New hires on the family join on it.
    expect(makeCrewMember(g, 'FO', 'B757/767', g.company.homeBase).salary).toBe(BAL.salary.FO[1]);
    expect(dailyPay(g)).toBe(0);
    delete g.fleet[ac767];
    // v0.14 only the pilots move: cabin crew earn the same on every type.
    const back = Object.values(g.crew).filter((c) => c.ratings.includes('B757/767') && c.salary !== crewPay(g, c));
    expect(back.length).toBeGreaterThan(0);
    expect(back.every((c) => c.role === 'CPT' || c.role === 'FO' || c.role === 'CRP')).toBe(true);
    expect(dailyPay(g)).toBe(back.length);
    expect(g.crew[cpt].salary).toBe(BAL.salary.CPT[0]);
    expect(g.messages[0].title).toBe('B757/767 crews move to narrowbody pay');
  });

  it('salaryFor: widebody families pay widebody, narrowbody narrowbody, the B757/767 by the fleet; crewPay takes the best type', () => {
    expect(salaryFor('CPT', 'A320')).toBe(BAL.salary.CPT[0]);
    expect(salaryFor('CPT', 'A330/340')).toBe(BAL.salary.CPT[1]);
    expect(salaryFor('CPT', 'B757/767')).toBe(BAL.salary.CPT[0]);
    expect(salaryFor('CPT', 'B757/767', true)).toBe(BAL.salary.CPT[1]);
    const g = rich();
    expect(crewPay(g, { role: 'CC', ratings: ['A320', 'A330/340'] })).toBe(BAL.salary.CC[1]);
    expect(crewPay(g, { role: 'CC', ratings: ['A320', 'B757/767'] })).toBe(BAL.salary.CC[0]);
  });
});
