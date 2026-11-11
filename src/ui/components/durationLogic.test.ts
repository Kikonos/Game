import { describe, expect, it } from 'vitest';
import { fromUTC } from '../../engine/core/time';
import { durationView, spanDates, spanLength } from './durationLogic';

const d = (y: number, m: number, day: number, hh = 12) => fromUTC(y, m, day, hh);

describe('v0.20.1 the duration strip', () => {
  it('says the length in days and in months, with the dates', () => {
    const now = d(2029, 1, 18);
    expect(durationView(now, d(2029, 3, 21), d(2029, 5, 26)).text).toBe('67 days · about 2 months · 21 Mar – 26 May');
    expect(durationView(now, d(2029, 3, 3), d(2029, 3, 14)).text).toBe('12 days · 3–14 Mar');
    expect(durationView(now, d(2029, 3, 3), d(2029, 3, 3)).text).toBe('1 day · 3 Mar');
    expect(durationView(now, d(2029, 6, 1), d(2029, 8, 31)).text).toBe('92 days · 3 months · 1 Jun – 31 Aug');
    expect(durationView(now, d(2029, 11, 1), d(2030, 12, 30)).text).toBe('425 days · 14 months (1 year 2 months) · 1 Nov 2029 – 30 Dec 2030');
    expect(spanLength(d(2029, 1, 1), d(2029, 12, 31)).monthsText).toBe('12 months (1 year)');
    expect(spanLength(d(2029, 2, 1), d(2029, 3, 31)).monthsText).toBe('2 months');
  });

  it('names the year whenever the dates are not all in this year', () => {
    const now = d(2029, 11, 20);
    expect(spanDates(now, d(2029, 12, 20), d(2030, 1, 5))).toBe('20 Dec 2029 – 5 Jan 2030');
    expect(spanDates(now, d(2030, 2, 3), d(2030, 2, 14))).toBe('3–14 Feb 2030');
    expect(spanDates(now, d(2030, 2, 3), d(2030, 4, 14))).toBe('3 Feb – 14 Apr 2030');
    expect(spanDates(now, d(2029, 12, 3), d(2029, 12, 14))).toBe('3–14 Dec');
  });

  it('twelve month cells from this month, each year a labelled group', () => {
    const v = durationView(d(2029, 1, 18), d(2029, 3, 21), d(2029, 5, 26));
    expect(v.count).toBe(12);
    expect(v.years.map((y) => [y.year, y.cells.map((c) => c.initial).join('')])).toEqual([[2029, 'JFMAMJJASOND']]);
    const cells = v.years.flatMap((y) => y.cells);
    expect(cells.map((c) => (c.to > c.from ? 1 : 0)).join('')).toBe('001110000000');
    // March from the 21st (20 of 31 days gone), April whole, May to the 26th.
    expect(cells[2].from).toBeCloseTo(20 / 31);
    expect(cells[2].to).toBe(1);
    expect([cells[3].from, cells[3].to]).toEqual([0, 1]);
    expect(cells[4].to).toBeCloseTo(26 / 31);
    expect(v.today).toBeCloseTo(17.5 / 31);
    expect(v.more).toBe(0);
  });

  it('a job that crosses into another year shows both years; a short one is a sliver', () => {
    const v = durationView(d(2029, 11, 20), d(2029, 12, 20), d(2030, 1, 5));
    expect(v.years.map((y) => [y.year, y.cells.length])).toEqual([[2029, 2], [2030, 10]]);
    expect(v.aria).toBe('Runs 17 days: 20 Dec 2029 to 5 Jan 2030, from 2029 into 2030.');
    const s = durationView(d(2029, 1, 18), d(2029, 3, 3), d(2029, 3, 4));
    const c = s.years[0].cells[2];
    expect(c.to - c.from).toBeCloseTo(2 / 31);
  });

  it('a long job grows the strip to its last month, to 24 cells at most, then says how many months follow', () => {
    const v = durationView(d(2029, 1, 18), d(2029, 11, 1), d(2030, 12, 30));
    expect(v.count).toBe(24);
    expect(v.years.map((y) => [y.year, y.cells.length])).toEqual([[2029, 12], [2030, 12]]);
    expect(v.more).toBe(0);
    const far = durationView(d(2029, 1, 18), d(2029, 4, 1), d(2032, 3, 31));
    expect(far.count).toBe(24);
    expect(far.more).toBe(15);
    expect(far.text).toBe('1096 days · 36 months (3 years) · 1 Apr 2029 – 31 Mar 2032');
  });
});
