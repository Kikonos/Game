// v0.20.1 Crew › Utilisation › Measures in place (report bmwba4v0r3aj): unpaid leave, furlough, redundancy notice and
// conversions from the engine's own records, the saving a month, the costs, and the unpaid leave really off the payroll.

import { describe, expect, it } from 'vitest';
import { run } from '../contracts/testkit';
import { BAL } from '../core/balance';
import { DAY, monthKey, monthStart } from '../core/time';
import { furloughCrew } from '../finance/distress';
import { deserialize, serialize } from '../save';
import { addCrew, fixtureGame } from './fixtures';
import { crewMeasures } from './measures';
import { crewUtilisation, makeRedundant, offerUnpaidLeave, redundancyQuote, unpaidQuote } from './utilisation';
import { rollingRoster } from '../../test/rolling';

rollingRoster();

const spare = () => {
  const g = fixtureGame();
  addCrew(g, { CPT: 6, FO: 6, CC: 12 });
  for (const c of Object.values(g.crew)) c.hired = g.now - 3 * 365 * DAY;
  return g;
};

describe('v0.20.1 measures in place', () => {
  it('nothing in place: an empty list and no saving', () => {
    const m = crewMeasures(fixtureGame());
    expect(m.list).toEqual([]);
    expect(m.monthly).toBe(0);
    expect(m.costs).toBe(0);
  });

  it('unpaid leave: by rank, until when, the saving a month; not offered twice and no longer spare', () => {
    const g = spare();
    const s0 = crewUtilisation(g).surplus.find((x) => x.role === 'CPT')!;
    const q = unpaidQuote(g, 'A320', 'CPT', 3, 3);
    expect(q.ids.length).toBeGreaterThan(0);
    expect(offerUnpaidLeave(g, 'A320', 'CPT', 3, 3).ok).toBe(true);
    const m = crewMeasures(g);
    expect(m.list.map((x) => x.kind)).toEqual(['unpaid']);
    const u = m.list[0];
    expect(u.byRole).toEqual({ CPT: q.ids.length, FO: 0, PUR: 0, CC: 0 });
    expect(u.running).toBe(false);
    expect(u.starts).toBe(q.from);
    expect(u.soonest).toBe(q.to);
    const pay = Math.round(q.ids.reduce((t, id) => t + Math.round(g.crew[id].salary * (1 + BAL.onCosts)), 0));
    expect(u.monthly).toBe(pay);
    expect(m.monthly).toBe(pay);
    // About the quote's saving over the three months.
    expect(Math.abs(u.total - q.saved) / q.saved).toBeLessThan(0.02);
    expect(u.groups[0].people.map((p) => p.id).sort()).toEqual([...q.ids].sort());
    expect(u.morale).toContain('+1');
    // Before it starts (two days), the same people are not asked again, and they no longer count as spare.
    const again = unpaidQuote(g, 'A320', 'CPT', 3, 1);
    for (const id of again.ids) expect(q.ids).not.toContain(id);
    const s1 = crewUtilisation(g).surplus.find((x) => x.role === 'CPT');
    expect(s1?.n ?? 0).toBe(Math.max(0, s0.n - q.ids.length));
    // Once it runs: away, off every trip.
    run(g, q.from + DAY);
    for (const id of q.ids) expect(g.crew[id].status).toBe('leave');
    expect(crewMeasures(g).list[0].running).toBe(true);
  }, 120_000);

  it('unpaid leave is off the month-end payroll: the salaries line is lower by their pay for the days away', () => {
    const g = spare();
    const k = monthKey(g.now);
    const end = monthStart(k + 1) + 60;
    const b = deserialize(serialize(g));
    const q = unpaidQuote(g, 'A320', 'CPT', 3, 1);
    expect(offerUnpaidLeave(g, 'A320', 'CPT', 3, 1).ok).toBe(true);
    run(g, end);
    run(b, end);
    const sal = (x: typeof g) => x.finance.history.find((st) => st.month === k)!.lines.salaries ?? 0;
    const a0 = monthStart(k), a1 = monthStart(k + 1);
    const days = Math.max(0, Math.min(a1, q.to) - Math.max(a0, q.from)) / (a1 - a0);
    const expected = Math.round(q.ids.reduce((t, id) => t + g.crew[id].salary, 0) * (1 + BAL.onCosts) * days);
    expect(Math.abs(sal(g) - sal(b) - expected)).toBeLessThanOrEqual(2);
  }, 120_000);

  it('the furlough is its own row; redundancy shows the severance paid and the saving once they leave', () => {
    const g = spare();
    expect(furloughCrew(g, BAL.v0163.furlough.shares[0], BAL.v0163.furlough.weeks[0]).ok).toBe(true);
    const rq = redundancyQuote(g, 'A320', 'FO', 2);
    expect(rq.ids.length).toBeGreaterThan(0);
    expect(makeRedundant(g, 'A320', 'FO', 2).ok).toBe(true);
    const m = crewMeasures(g);
    const f = m.list.find((x) => x.kind === 'furlough')!;
    expect(f).toBeDefined();
    expect(m.list.some((x) => x.kind === 'unpaid')).toBe(false);
    expect(f.soonest).toBe(g.treasury!.distress!.furlough!.until);
    expect(f.morale).toContain(String(Math.abs(BAL.v0163.furlough.morale)));
    {
      const n = m.list.find((x) => x.kind === 'notice')!;
      expect(n.byRole.FO).toBe(rq.ids.length);
      expect(n.cost).toBe(rq.severance);
      expect(n.monthly).toBe(rq.ids.reduce((t, id) => t + Math.round(g.crew[id].salary * (1 + BAL.onCosts)), 0));
      expect(n.soonest).toBe(rq.leaves);
      expect(m.later).toBe(n.monthly);
      expect(m.costs).toBeGreaterThanOrEqual(rq.severance);
    }
  });
});
