// v0.25 network lane: the business case and the planner's ideas priced on the aircraft and cabin we fly, the route
// P&L's aircraft time, the study's base kept from the day it was done.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import { createGame } from '../newGame';
import { hireHead, unlockHead } from '../ops/heads';
import { businessCase, caseDraft, customId, fleetLayout, routeIdeas, startStudy, studyBase } from '.';
import { fleetAcCostBH, project } from './launch';
import { aircraftCostBH } from './pnl';
import { customMarket } from './custom';
import type { GameState } from '../core/types';

const newGame = (base = 'MLA', seed = 7) => createGame({ name: 'Malta Test', code: 'MT', livery: { primary: '#c00', secondary: '#fff', tail: 'sweep' }, base, seed });

/** A study straight to its business case (as devLaunchRoute: the estimate at the study's base). */
function toCase(g: GameState, marketId: string): string {
  const id = startStudy(g, marketId, 'full').routeId!;
  const r = g.network!.routes[id];
  r.study!.est = { p10: 200, p50: 300, p90: 400 };
  const b = studyBase(g, r);
  r.study!.est = { p10: Math.round(b * 0.8), p50: Math.round(b), p90: Math.round(b * 1.2) };
  r.study!.done = g.now;
  r.status = 'case';
  return id;
}

describe('v0.25 the case and the ideas fly our own aircraft in our own cabin', () => {
  it('a new A320 airline: the case draft is on the A320 in its all-economy cabin, no warning', () => {
    const g = newGame();
    const types = [...new Set(Object.values(g.fleet).map((a) => a.typeId))];
    expect(types).toEqual(['a320ceo']);
    expect(fleetLayout(g, 'a320ceo')).toBe('all-economy');
    const id = toCase(g, customId({ from: 'MLA', to: 'ESB' }));
    const d = caseDraft(g, id)!;
    expect(d.typeId).toBe('a320ceo');
    expect(d.layout).toBe('all-economy');
    const c = businessCase(g, id, d)!;
    expect(c.fleetWarn).toEqual([]);
    // A type we do not have, or business seats our aircraft lack: said plainly at the case.
    expect(businessCase(g, id, { ...d, typeId: 'a321neo' })!.fleetWarn![0]).toMatch(/We have no A21N/);
    expect(businessCase(g, id, { ...d, layout: 'two-class' })!.fleetWarn![0]).toMatch(/no business seats/);
  });

  it("the planner's ideas are priced on the all-economy cabin", () => {
    const g = newGame();
    unlockHead(g, 'netPlanner', true);
    hireHead(g, 'netPlanner', 2);
    const ideas = routeIdeas(g);
    expect(ideas.length).toBeGreaterThan(0);
    for (const i of ideas.slice(0, 3)) {
      const m = customMarket({ from: i.from, to: i.to })!;
      const plan = { model: i.model, days: 0, every: 1, out: m.timetable.out, back: m.timetable.back, nights: m.timetable.nights, typeId: i.typeId, layout: 'all-economy' as const, fares: 'market' as const, marketing: 'normal' as const };
      // The idea's own plan, rebuilt: the spread of its flights a week from the market's day.
      const steps = i.perWeek >= 7 ? [0, 1, 2, 3, 4, 5, 6] : i.perWeek >= 4 ? [0, 2, 4, 6] : i.perWeek >= 3 ? [0, 2, 4] : i.perWeek === 2 ? [0, 3] : [0];
      plan.days = steps.reduce((mask, k) => mask | (1 << ((m.timetable.day + k) % 7)), 0);
      const p = project(g, { marketId: m.id, custom: m, model: i.model, reputation: 60 } as never, plan, g.now + 120 * DAY, 1, { mature: true });
      expect(Math.round(p.result)).toBe(i.result);
    }
  }, 60_000);
});

describe('v0.25 the case charges the aircraft time the route P&L will', () => {
  it('the average of our own aircraft of the type (an owned one costs its insurance only); list rent when we have none', () => {
    const g = newGame();
    const acs = Object.values(g.fleet);
    const avg = acs.reduce((a, x) => a + aircraftCostBH(g, x.id, x.typeId), 0) / acs.length;
    expect(fleetAcCostBH(g, 'a320ceo')).toBeCloseTo(avg, 6);
    expect(fleetAcCostBH(g, 'a320ceo')).toBeLessThan(aircraftCostBH(g, null, 'a320ceo') * 0.7);
    expect(fleetAcCostBH(g, 'a321neo')).toBe(aircraftCostBH(g, null, 'a321neo'));
    const id = toCase(g, customId({ from: 'MLA', to: 'ESB' }));
    const d = caseDraft(g, id)!;
    const r = g.network!.routes[id];
    const p = project(g, r, d, g.now + 120 * DAY, 1);
    expect(p.parts.aircraft).toBe(Math.round(p.bh * avg));
  });
});
