// v0.6 bulk type-rating conversion (UPDATE-0.6.md §F2): classes, staggering, costs, blocks, completion rules,
// refunds, warnings, purity and a save/load round trip mid-class.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY, fmtDate, fromUTC } from '../core/time';
import type { GameState } from '../core/types';
import { run } from '../contracts/testkit';
import { demoFlights } from '../dev';
import { deserialize, serialize } from '../save';
import { addCrew, fixtureGame } from './fixtures';
import {
  autoRoster, cancelConversion, classOf, conversionClasses, conversionEarliest, conversionPlan, crewCalendar, crewStatusView, familyLabel, rosterOf, startConversion, trainCrew,
} from '.';

const rich = (seed = 5): GameState => {
  const g = fixtureGame(seed);
  g.company.cash = 50_000_000;
  return g;
};
const start = (g: GameState) => conversionEarliest(g);
const training = (g: GameState) => g.finance.current.lines.training ?? 0;

describe('conversion classes', () => {
  it('labels: A330/340 → A330, B757/767 → B767', () => {
    expect(familyLabel('A330/340')).toBe('A330');
    expect(familyLabel('B757/767')).toBe('B767');
    expect(familyLabel('B777')).toBe('B777');
  });

  it('12 pilots + 33 cabin → P1 (12), C1 (17), C2 (16); pilots CPT/FO alternately', () => {
    const g = rich();
    const ids = [...addCrew(g, { CPT: 6, FO: 6 }), ...addCrew(g, { CSD: 3, SCC: 6, CC: 24 })];
    const plan = conversionPlan(g, { crewIds: ids, family: 'A330/340', start: start(g) });
    expect(plan.ok).toBe(true);
    expect(plan.classes.map((k) => [k.no, k.crewIds.length])).toEqual([['A330-P1', 12], ['A330-C1', 17], ['A330-C2', 16]]);
    const p1 = plan.classes[0];
    expect(p1.crewIds.slice(0, 4).map((id) => g.crew[id].role)).toEqual(['CPT', 'FO', 'CPT', 'FO']);
    expect(p1.end - p1.start).toBe(42 * DAY);
    expect(plan.classes[1].end - plan.classes[1].start).toBe(8 * DAY);
    expect(p1.phases.map((x) => x.label)).toEqual(['Ground school', 'Simulator', 'Skill test & base training', 'Line training & line check']);
    expect(plan.cost).toBe(12 * BAL.conv.pilotCost.wide + 33 * BAL.conv.cabinCost);
    // Seniors are spread over the cabin classes.
    for (const k of plan.classes.slice(1)) expect(k.crewIds.some((id) => g.crew[id].role !== 'CC')).toBe(true);
  });

  it('25 cabin → 13 + 12; 41 pilots → three classes staggered 14 days', () => {
    const g = rich();
    const cab = addCrew(g, { CC: 25 });
    expect(conversionPlan(g, { crewIds: cab, family: 'B737', start: start(g) }).classes.map((k) => k.crewIds.length)).toEqual([13, 12]);
    const pil = addCrew(g, { CPT: 20, FO: 21 }, 'B737');
    const plan = conversionPlan(g, { crewIds: pil, family: 'A320', start: start(g) });
    expect(plan.classes.map((k) => k.crewIds.length)).toEqual([14, 14, 13]);
    const s = plan.classes.map((k) => k.start);
    expect(Math.round((s[1] - s[0]) / DAY)).toBe(14);
    expect(Math.round((s[2] - s[1]) / DAY)).toBe(14);
  });

  it('a third cabin class waits for one to end; booked classes count', () => {
    const g = rich();
    const cab = addCrew(g, { CC: 45 });
    const plan = conversionPlan(g, { crewIds: cab, family: 'B737', start: start(g) });
    expect(plan.classes).toHaveLength(3);
    const [a, b, c] = plan.classes;
    expect(a.start).toBe(b.start);
    expect(c.start).toBe(a.end);
    // Two cabin classes booked: a new one starts when the first ends.
    expect(startConversion(g, { crewIds: cab.slice(0, 40), family: 'B737', start: start(g) }).ok).toBe(true);
    const more = addCrew(g, { CC: 5 });
    const p2 = conversionPlan(g, { crewIds: more, family: 'B737', start: start(g) });
    expect(p2.classes[0].start).toBe(conversionClasses(g)[0].end);
    expect(p2.classes[0].no).toBe('B737-C3');
  });

  it('class dates in the inbox and the calendar are home-base days (a summer start at LIS midnight)', () => {
    const g = rich();
    g.now = fromUTC(2027, 6, 1, 10);
    const ids = [...addCrew(g, { CPT: 2 }), ...addCrew(g, { CC: 4 })];
    const s0 = start(g);
    // LIS summer: local midnight of 4 Jun is 3 Jun 23:00 UTC.
    expect(fmtDate(s0)).toBe('3 Jun 2027');
    expect(startConversion(g, { crewIds: ids, family: 'A330/340', start: s0 }).ok).toBe(true);
    expect(g.messages[0].body).toMatch(/A330-P1 \(2\) 4 Jun – 15 Jul/);
    expect(g.messages[0].body).toMatch(/A330-C1 \(4\) 4 Jun – 11 Jun/);
    const b = crewCalendar(g, ids[0], s0, s0 + DAY).find((x) => x.kind === 'training')!;
    expect(b.detail).toMatch(/ends 15 Jul 2027/);
  });

  it('costs are posted once to training (narrowbody vs widebody pilot target)', () => {
    const g = rich();
    const [a, b] = addCrew(g, { FO: 2 }, 'B737');
    const t0 = training(g);
    expect(startConversion(g, { crewIds: [a], family: 'A320', start: start(g) }).ok).toBe(true);
    expect(training(g) - t0).toBe(-BAL.conv.pilotCost.narrow);
    expect(startConversion(g, { crewIds: [b], family: 'A330/340', start: start(g) }).ok).toBe(true);
    expect(training(g) - t0).toBe(-BAL.conv.pilotCost.narrow - BAL.conv.pilotCost.wide);
    run(g, g.now + 60 * DAY);
    expect(training(g) === 0 || g.finance.history.reduce((s, h) => s + (h.lines.training ?? 0), 0) + training(g) === -BAL.conv.pilotCost.narrow - BAL.conv.pilotCost.wide).toBe(true);
  });

  it('members are blocked and their duties re-crewed; skipped crew carry a reason', () => {
    const g = rich();
    demoFlights(g, undefined, 7, 'revenue');
    autoRoster(g);
    addCrew(g, { CC: 6 });
    autoRoster(g);
    const s0 = start(g);
    const busy = Object.values(g.crew).find((c) => c.role === 'CC' && rosterOf(g, c.id, s0, s0 + 8 * DAY).length > 0)!;
    expect(busy).toBeTruthy();
    const rated = addCrew(g, { CC: 1 }, 'B737')[0];
    const plan = conversionPlan(g, { crewIds: [busy.id, rated], family: 'B737', start: s0 });
    expect(plan.skipped).toEqual([{ crewId: rated, why: 'Already rated on the B737' }]);
    expect(plan.dutiesAffected).toBeGreaterThan(0);
    expect(plan.warnings.some((w) => /rostered dut/.test(w.text))).toBe(true);
    expect(startConversion(g, { crewIds: [busy.id], family: 'B737', start: s0 }).ok).toBe(true);
    const k = classOf(g, busy.id)!;
    expect(rosterOf(g, busy.id, k.start, k.end)).toEqual([]);
    expect(busy.blocks?.some((b) => b.why === 'training' && b.from === k.start && b.to === k.end)).toBe(true);
    // Shows as 'Conversion B737' on the strip; a second booking is refused.
    expect(crewCalendar(g, busy.id, k.start, k.end).find((b) => b.kind === 'training')?.label).toBe('Conversion B737');
    expect(conversionPlan(g, { crewIds: [busy.id], family: 'A330/340', start: s0 }).skipped[0].why).toBe(`Already booked on ${k.no}`);
  });

  it('completion: pilots drop the old type (not on a common type); cabin keep up to 3; salary, bond, morale', () => {
    const g = rich();
    const [fo] = addCrew(g, { FO: 1 });
    const [ccq] = addCrew(g, { CPT: 1 }, 'A330/340');
    const [cab] = addCrew(g, { CC: 1 });
    const [cab3] = addCrew(g, { CC: 1 }, 'B737');
    g.crew[cab3].ratings = ['B737', 'A320', 'B777'];
    const m0 = g.crew[fo].morale;
    const sal0 = g.crew[fo].salary;
    expect(startConversion(g, { crewIds: [fo], family: 'A330/340', start: start(g) }).ok).toBe(true);
    expect(startConversion(g, { crewIds: [ccq], family: 'A350', start: start(g) }).ok).toBe(true);
    // Default: the first type with no aircraft in the fleet; the player may pick another.
    expect(conversionPlan(g, { crewIds: [cab3], family: 'A330/340', start: start(g) }).dropDefault[cab3]).toBe('B737');
    const plan = conversionPlan(g, { crewIds: [cab, cab3], family: 'A330/340', start: start(g), drop: { [cab3]: 'B777' } });
    expect(plan.ratingsAfter[cab3]).toEqual(['B737', 'A320', 'A330/340']);
    expect(startConversion(g, { crewIds: [cab, cab3], family: 'A330/340', start: start(g), drop: { [cab3]: 'B777' } }).ok).toBe(true);
    const kc = classOf(g, ccq)!;
    expect(kc.course).toBe('ccq');
    expect(kc.end - kc.start).toBe(BAL.conv.pilotCcqDays * DAY);
    const kp = classOf(g, fo)!;
    run(g, kp.end + 60);
    const c = g.crew[fo];
    expect(c.ratings).toEqual(['A330/340']);
    expect(c.salary).toBeGreaterThan(sal0);
    expect(c.bondUntil).toBeGreaterThan(kp.end + 700 * DAY);
    expect(c.moraleWhy?.career).toBeGreaterThan(BAL.morale.career - 0.5);
    expect(Math.abs(c.morale - m0)).toBeLessThan(15);
    expect(g.crew[ccq].ratings).toEqual(['A330/340', 'A350']);
    expect(g.crew[ccq].bondUntil).toBeUndefined();
    expect(g.crew[cab].ratings).toEqual(['A320', 'A330/340']);
    expect(g.crew[cab3].ratings).toEqual(['B737', 'A320', 'A330/340']);
    expect(Object.values(g.classes!).every((k) => k.status === 'done')).toBe(true);
    expect(g.stats.conversions).toBe(3);
    expect(g.messages.some((m) => /^A330-P1 finished: 1 pilot now fly the A330/.test(m.title))).toBe(true);
    expect(g.messages.some((m) => /^A350-P1 finished/.test(m.title) && /keep the A330/.test(m.body))).toBe(true);
  });

  it('cancel refunds 100% early, 50% within 14 days, nothing once running', () => {
    const g = rich();
    const ids = addCrew(g, { CC: 3 }, 'B737');
    const s = g.now + 30 * DAY;
    expect(startConversion(g, { crewIds: ids, family: 'A320', start: s }).ok).toBe(true);
    const k = conversionClasses(g)[0];
    const r1 = cancelConversion(g, k.id, ids[0]);
    expect(r1.ok && r1.data!.refund).toBe(BAL.conv.cabinCost);
    expect(g.crew[ids[0]].blocks?.some((b) => b.why === 'training')).toBeFalsy();
    run(g, k.start - 10 * DAY);
    const r2 = cancelConversion(g, k.id, ids[1]);
    expect(r2.ok && r2.data!.refund).toBe(BAL.conv.cabinCost / 2);
    run(g, k.start + DAY);
    expect(k.status).toBe('running');
    expect(g.crew[ids[2]].status).toBe('training');
    expect(crewStatusView(g, ids[2]).text).toMatch(/^Conversion A320 · until /);
    const r3 = cancelConversion(g, k.id);
    expect(r3.ok && r3.data!.refund).toBe(0);
    expect(k.status).toBe('cancelled');
    expect(g.crew[ids[2]].status).not.toBe('training');
  });

  it('warns when the fleet would be short during and after the course, and about cash', () => {
    const g = rich();
    const cpts = Object.values(g.crew).filter((c) => c.role === 'CPT' && c.ratings.includes('A320')).map((c) => c.id);
    const plan = conversionPlan(g, { crewIds: cpts.slice(0, 4), family: 'A330/340', start: start(g) });
    expect(plan.warnings[0].level).toBe('bad');
    expect(plan.warnings.some((w) => /^A320 captains during the course: \d+ of \d+ needed$/.test(w.text))).toBe(true);
    expect(plan.warnings.some((w) => /^After the course: A320 captains \d+ of \d+$/.test(w.text))).toBe(true);
    expect(plan.warnings.some((w) => w.text === 'No A330 in the fleet or on order')).toBe(true);
    g.company.cash = 1_000;
    const poor = conversionPlan(g, { crewIds: cpts.slice(0, 1), family: 'A330/340', start: start(g) });
    expect(poor.ok).toBe(false);
    expect(poor.warnings.some((w) => w.level === 'bad' && /more than the cash/.test(w.text))).toBe(true);
    expect(startConversion(g, { crewIds: cpts.slice(0, 1), family: 'A330/340', start: start(g) }).ok).toBe(false);
  });

  it('the plan is pure; a save mid-class plays on identically; trainCrew books a one-person class', () => {
    const g = rich();
    demoFlights(g, undefined, 7, 'revenue');
    autoRoster(g);
    const ids = addCrew(g, { CPT: 2, FO: 2, CC: 6 }, 'B737');
    const before = JSON.stringify(g);
    conversionPlan(g, { crewIds: ids, family: 'A320', start: start(g) });
    conversionClasses(g);
    classOf(g, ids[0]);
    expect(JSON.stringify(g)).toBe(before);
    expect(startConversion(g, { crewIds: ids, family: 'A320', start: start(g) }).ok).toBe(true);
    run(g, conversionClasses(g)[0].start + 3 * DAY);
    const h = deserialize(serialize(g));
    const end = g.now + 50 * DAY;
    run(g, end);
    run(h, end);
    expect(JSON.stringify(h.crew)).toBe(JSON.stringify(g.crew));
    expect(JSON.stringify(h.classes)).toBe(JSON.stringify(g.classes));
    const [x] = addCrew(g, { SCC: 1 }, 'B737');
    expect(trainCrew(g, x, 'typeRating', 'A320').ok).toBe(true);
    expect(classOf(g, x)?.crewIds).toEqual([x]);
  });
});
