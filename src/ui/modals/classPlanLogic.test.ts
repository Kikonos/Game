import { describe, expect, it } from 'vitest';
import { DAY } from '../../engine/core/time';
import type { ClassProposal, PlannedClass } from '../../engine/crew';
import { byChoices, samePlan, sizesText, stripView } from './classPlanLogic';

// 1 Jun 2027 00:00 UTC.
const JUN1 = Date.UTC(2027, 5, 1) / 60000 - Date.UTC(2000, 0, 1) / 60000;
const cls = (no: string, startDay: number, days: number, n: number): PlannedClass => ({ no, group: 'cabin', course: 'full', start: JUN1 + startDay * DAY, end: JUN1 + (startDay + days) * DAY, crewIds: Array.from({ length: n }, (_, i) => `${no}${i}`), fees: 0, duties: 0, phases: [] });

describe('class planner strip', () => {
  it('lays whole months out and puts overlapping classes in their own rows', () => {
    const classes = [cls('C1', 25, 8, 13), cls('C2', 28, 8, 13), cls('C3', 40, 8, 13)];
    const v = stripView('LHR', JUN1 + 8 * 60, { classes, rosterEnd: JUN1 + 30 * DAY, by: null, finish: classes[2].end });
    expect(v.months.map((m) => m.label)).toEqual(['Jun', 'Jul']);
    expect(v.months.reduce((s, m) => s + m.width, 0)).toBeCloseTo(1, 6);
    expect(v.blocks.map((b) => b.lane)).toEqual([0, 1, 0]);
    expect(v.lanes).toBe(2);
    expect(v.blocks[0].left).toBeGreaterThan(0.38);
    expect(v.blocks[0].left).toBeLessThan(0.45);
    expect(v.roster).not.toBeNull();
    expect(v.by).toBeNull();
    expect(v.today).toBeLessThan(0.02);
  });

  it('v0.23.1 shows the classes not bookable yet as next blocks, the strip running on to them (at most nine months)', () => {
    const classes = [cls('P1', 24, 42, 4)];
    const next = [{ group: 'pilot' as const, course: 'full' as const, start: JUN1 + 156 * DAY, end: JUN1 + 198 * DAY, crewIds: ['a', 'b'], bookFrom: JUN1 + 36 * DAY }];
    const v = stripView('LHR', JUN1 + 8 * 60, { classes, next, rosterEnd: JUN1 + 30 * DAY, by: null, finish: classes[0].end });
    expect(v.months.map((m) => m.label)).toEqual(['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
    expect(v.blocks.map((b) => [b.no, b.n, b.next ?? false])).toEqual([['P1', 4, false], ['next-1', 2, true]]);
    expect(v.blocks[1].left + v.blocks[1].width).toBeLessThanOrEqual(1);
  });

  it('names the class sizes, tells when every stop shows one plan, and offers month ends a course still fits in', () => {
    expect(sizesText({ classes: [cls('a', 0, 8, 13), cls('b', 9, 8, 13)] })).toBe('13 each');
    expect(sizesText({ classes: [cls('a', 0, 8, 13), cls('b', 9, 8, 12)] })).toBe('13 · 12');
    expect(sizesText({ classes: [cls('a', 0, 8, 7)] })).toBe('7 people');
    const p = { classes: [cls('a', 0, 8, 3)] } as ClassProposal;
    const q = { classes: [cls('a', 1, 8, 3)] } as ClassProposal;
    expect(samePlan([p, p, p])).toBe(true);
    expect(samePlan([p, q])).toBe(false);
    const by = byChoices('LHR', JUN1 + 26 * DAY, JUN1 + 28 * DAY, 8);
    expect(by.map((x) => x.label)).toEqual(['End of Jul', 'End of Aug', 'End of Sep', 'End of Oct']);
  });
});
