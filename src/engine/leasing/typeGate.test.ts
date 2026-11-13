// v0.24 no crew for a type we may not crew: hiring and conversions refused for a family that is not on our AOC and has
// no variation filed (the manuals, MEL and training programme come with the variation); crew hired before the gate are
// put to the player once (keep them, or let them go at no cost).

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import { advanceTo } from '../sim';
import { hireCrew } from '../crew/hr';
import { conversionEarliest, conversionPlan, startConversion } from '../crew/conversion';
import { makeCrewMember } from '../crew/generate';
import { resolveDecision } from '../ops';
import { applyVariation, crewTypeBlock, waitingTypeCrew } from './aoc';
import { newGame } from './deals017.helpers';

describe('v0.24 crew hiring gate on the AOC', () => {
  it('refuses pilots and cabin crew for a family not on our AOC, with a plain reason', () => {
    const g = newGame(3);
    g.company.cash = 50_000_000;
    expect(g.company.aocFamilies).toContain('A320');
    expect(crewTypeBlock(g, 'A320')).toBeNull();
    for (const role of ['CPT', 'FO'] as const) {
      const r = hireCrew(g, { role, family: 'B737', base: 'LIS', count: 2 });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/B737 is not on our AOC: file the variation first/);
    }
    // Widebody: neither Widebody operations nor a variation.
    const w = hireCrew(g, { role: 'CPT', family: 'A330/340', base: 'LIS', count: 2 });
    expect(w.ok).toBe(false);
    expect(w.error).toMatch(/Widebody operations/);
    // Cabin crew: any type ticked that is not on the AOC refuses the whole order.
    const c = hireCrew(g, { role: 'CC', family: 'A320', families: ['A320', 'B737'], base: 'LIS', count: 4 });
    expect(c.ok).toBe(false);
    expect(hireCrew(g, { role: 'CC', family: 'A320', base: 'LIS', count: 4 }).ok).toBe(true);
  });

  it('allows the hire once the variation is filed (the manuals are written while the authority looks at it)', () => {
    const g = newGame(3);
    g.company.cash = 50_000_000;
    expect(applyVariation(g, 'B737').ok).toBe(true);
    expect(crewTypeBlock(g, 'B737')).toBeNull();
    expect(hireCrew(g, { role: 'CPT', family: 'B737', base: 'LIS', count: 2 }).ok).toBe(true);
  });

  it('allows the first widebody family once Widebody operations is held or filed', () => {
    const g = newGame(3);
    g.company.cash = 50_000_000;
    g.company.pendingApprovals.push({ id: 'widebody', started: g.now, done: g.now + 90 * DAY, cost: 0 });
    expect(crewTypeBlock(g, 'A330/340')).toBeNull();
    expect(hireCrew(g, { role: 'FO', family: 'A330/340', base: 'LIS', count: 2 }).ok).toBe(true);
  });

  it('refuses a conversion course onto a family not on our AOC', () => {
    const g = newGame(3);
    g.company.cash = 50_000_000;
    const ids = Object.values(g.crew).filter((c) => c.role === 'FO').slice(0, 2).map((c) => c.id);
    const plan = conversionPlan(g, { crewIds: ids, family: 'B737', start: conversionEarliest(g) });
    expect(plan.ok).toBe(false);
    expect(plan.warnings[0].text).toMatch(/B737 is not on our AOC/);
    const r = startConversion(g, { crewIds: ids, family: 'B737', start: conversionEarliest(g) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not on our AOC/);
  });

  it('an older save: crew hired on a type not on the AOC are kept and put to the player once', () => {
    const g = newGame(3);
    const before = Object.keys(g.crew).length;
    const ids: string[] = [];
    for (const role of ['CPT', 'CPT', 'FO', 'FO'] as const) {
      const c = makeCrewMember(g, role, 'A330/340', 'LIS');
      g.crew[c.id] = c;
      ids.push(c.id);
    }
    expect(waitingTypeCrew(g).get('A330/340')?.sort()).toEqual([...ids].sort());
    advanceTo(g, g.now + DAY + 60);
    // Kept (not deleted) and asked once.
    expect(Object.keys(g.crew).length).toBe(before + 4);
    const d = g.decisions.find((x) => x.kind === 'typeCrew');
    expect(d?.title).toMatch(/A330\/340 crew/);
    expect(d?.body).toMatch(/2 captains, 2 first officers/);
    expect(g.company.typeCrewAsked).toEqual(['A330/340']);
    expect(resolveDecision(g, d!.id, 'keep').ok).toBe(true);
    advanceTo(g, g.now + 2 * DAY);
    expect(g.decisions.some((x) => x.kind === 'typeCrew')).toBe(false);
    expect(ids.every((id) => g.crew[id])).toBe(true);
  });

  it('let them go: they leave at no cost, hiring fees back for those not yet joined', () => {
    const g = newGame(3);
    const c = makeCrewMember(g, 'CPT', 'A330/340', 'LIS', 'joining');
    g.crew[c.id] = c;
    g.hires.push({ id: 'hx', role: 'CPT', family: 'A330/340', base: 'LIS', crewId: c.id, ordered: g.now, ready: g.now + 40 * DAY, cost: 9000 });
    const f = makeCrewMember(g, 'FO', 'A330/340', 'LIS');
    g.crew[f.id] = f;
    advanceTo(g, g.now + DAY + 60);
    const d = g.decisions.find((x) => x.kind === 'typeCrew')!;
    const cash = g.company.cash;
    expect(resolveDecision(g, d.id, 'release').ok).toBe(true);
    expect(g.company.cash).toBe(cash + 9000);
    expect(g.hires.some((h) => h.crewId === c.id)).toBe(false);
    advanceTo(g, g.now + 2 * DAY);
    expect(g.crew[c.id]).toBeUndefined();
    expect(g.crew[f.id]).toBeUndefined();
  });
});
