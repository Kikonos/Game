// v0.25 network lane: the business case and the planner's ideas priced on the aircraft and cabin we fly, the route
// P&L's aircraft time, the study's base kept from the day it was done.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import { createGame } from '../newGame';
import { hireHead, unlockHead } from '../ops/heads';
import { businessCase, caseDraft, customId, fleetLayout, recommendation, routeIdeas, startStudy, studyBase } from '.';
import { businessCaseX, fleetAcCostBH, project, rivalOf, studyBaseNow } from './launch';
import { advanceTo } from '../sim';
import { deserialize, serialize } from '../save';
import { acmiCompare, aircraftCostBH, closePnlMonth, crewCostBH } from './pnl';
import { monthKey } from '../core/time';
import { devLaunchRoute } from './launch';
import { customMarket } from './custom';
import { cabinFor, freqPerWeek, marketOfRoute, seasonMonths } from './model';
import type { GameState } from '../core/types';

const newGame = (base = 'MLA', seed = 7) => createGame({ name: 'Malta Test', code: 'MT', livery: { primary: '#c00', secondary: '#fff', tail: 'sweep' }, base, seed });

/** A study straight to its business case (as devLaunchRoute: the estimate at the study's base). */
function toCase(g: GameState, marketId: string): string {
  const id = startStudy(g, marketId, 'full').routeId!;
  const r = g.network!.routes[id];
  r.study!.est = { p10: 200, p50: 300, p90: 400 };
  const b = studyBase(g, r);
  r.study!.est = { p10: Math.round(b * 0.8), p50: Math.round(b), p90: Math.round(b * 1.2) };
  r.study!.base = b;
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

describe('v0.25 the study keeps the base it was measured against', () => {
  it('done in play: the base is stored, and the case\'s demand view stays put 60 days on', () => {
    const g = newGame('RIX', 9);
    const id = startStudy(g, customId({ from: 'RIX', to: 'FRA' }), 'desk').routeId!;
    const r = g.network!.routes[id];
    for (let i = 0; i < 120 && r.status === 'study'; i++) advanceTo(g, g.now + DAY, new Set());
    expect(r.status).toBe('case');
    const base = r.study!.base!;
    expect(base).toBeGreaterThan(0);
    const x = businessCaseX(g, r);
    expect(studyBase(g, r)).toBe(base);
    advanceTo(g, g.now + 60 * DAY, new Set());
    expect(r.study!.base).toBe(base);
    expect(businessCaseX(g, r)).toBe(x);
    // An older save (no base): fixed once on load, then kept.
    delete r.study!.base;
    const back = deserialize(serialize(g));
    const rb = back.network!.routes[id];
    expect(rb.study!.base).toBe(studyBaseNow(back, rb));
    expect(deserialize(serialize(back)).network!.routes[id].study!.base).toBe(rb.study!.base);
  }, 120_000);
});

describe('v0.25 the route P&L charges each aircraft its own hours', () => {
  it('an owned jet and a leased one in the same month: each at its own rate (not all at the last one\'s)', () => {
    const g = newGame('LIS', 11);
    const id = devLaunchRoute(g, customId({ from: 'LIS', to: 'FRA' }), 'a1');
    const r = g.network!.routes[id];
    const k = monthKey(g.now - 1);
    r.pnl[k] = { rev: 100_000, tickets: 0, cargo: 0, ancillary: 0, direct: 0, acTime: 0, result: 0, pax: 0, seats: 0, bh: 10, sectors: 4, onTime: 4, cargoKg: 0, launch: 0, acBh: { a1: 6, a2: 4 } };
    // The last rotation flown was the leased one's: the whole month used to go at its rate.
    const rot = r.rotations[0];
    rot.status = 'flown';
    rot.aircraftId = 'a2';
    closePnlMonth(g, r);
    const rate = (ac: string) => aircraftCostBH(g, ac, 'a320ceo') + crewCostBH('a320ceo', g.fleet[ac].cabin.total);
    expect(g.fleet.a1.ownership.kind).toBe('owned');
    expect(r.pnl[k].acTime).toBe(Math.round(6 * rate('a1') + 4 * rate('a2')));
    expect(r.pnl[k].acTime).toBeLessThan(Math.round(10 * rate('a2')) * 0.7);
  });
});

describe('v0.25 wording', () => {
  it('"An A320 on ACMI", not "A A320"', () => {
    const g = newGame('LIS', 11);
    const id = devLaunchRoute(g, customId({ from: 'LIS', to: 'FRA' }), 'a1');
    const r = g.network!.routes[id];
    r.pnl[monthKey(g.now) - 1] = { rev: 100_000, tickets: 0, cargo: 0, ancillary: 0, direct: 50_000, acTime: 0, result: 0, pax: 0, seats: 0, bh: 10, sectors: 4, onTime: 4, cargoKg: 0, launch: 0 };
    expect(acmiCompare(g, id)).toMatch(/An A320 on ACMI/);
  });
});

describe('v0.25 the study\'s peak and off-peak words', () => {
  it('peak by the market\'s own season, loads of a known route; the size sentence never contradicts them', () => {
    for (const [base, to] of [['RIX', 'TFS'], ['MLA', 'ESB'], ['RIX', 'FRA']] as const) {
      const g = newGame(base, 4);
      const id = toCase(g, customId({ from: base, to }));
      const r = g.network!.routes[id];
      const d = caseDraft(g, id)!;
      const p = project(g, r, d, g.now + 120 * DAY, 1);
      // Peak months are the busiest: a known route is at least as full then as off-peak.
      expect(p.lfPeak, `${base}-${to}`).toBeGreaterThanOrEqual(p.lfOff - 0.001);
      const rec = recommendation(g, id)!;
      const words = rec.why.join(' ');
      const sellable = (p.sellSeats ?? cabinFor(d.typeId, d.layout ?? 'two-class').total) / cabinFor(d.typeId, d.layout ?? 'two-class').total;
      if (/turns away/.test(words)) expect(p.lfPeak / sellable, `${base}-${to}: ${words}`).toBeGreaterThan(0.85);
      if (p.sellSeats !== undefined && /turns away/.test(words)) expect(words).toMatch(/can sell only \d+ seats here/);
      expect(words, `${base}-${to}`).not.toMatch(/fits the off-peak months; at peak it turns people away/);
    }
  }, 60_000);
});

describe('v0.25 the rival named', () => {
  it('nonstop first, else the one-stop carrier by its hub', () => {
    const c = (name: string, stops: number, via?: string) => ({ name, perWeek: 7, stops, hours: 5, fareX: 1, seats: 20, ...(via ? { via } : {}) });
    expect(rivalOf({ competitors: [c('Turkish Airlines via Istanbul', 1, 'IST'), c('Air Malta', 0)] })).toEqual({ who: 'Air Malta' });
    expect(rivalOf({ competitors: [c('Turkish Airlines via Istanbul', 1, 'IST')] })).toEqual({ who: 'Turkish Airlines', via: 'Istanbul' });
    expect(rivalOf({ competitors: [c('Connections via Frankfurt', 1)] })).toEqual({ who: 'The airlines connecting', via: 'Frankfurt', plural: true });
    expect(rivalOf({ competitors: [] })).toEqual({ who: 'A rival' });
    const m = customMarket({ from: 'MLA', to: 'ESB' })!;
    expect(rivalOf(m).who).not.toBe('A rival');
  });
});

describe('v0.25 the case counts calendar months', () => {
  it('a seasonal plan flies its season\'s months exactly (a 7-month winter season is 7, not 8)', () => {
    const g = newGame('RIX', 4);
    const id = toCase(g, 'RIX-TFS');
    const r = g.network!.routes[id];
    const m = marketOfRoute(r)!;
    expect(seasonMonths(m)).not.toBeNull();
    const season = seasonMonths(m)!;
    const n = [...Array(12).keys()].filter((i) => season & (1 << i)).length;
    const d = { ...caseDraft(g, id)!, season: true as const };
    // A first flight mid-month in season, as the hunter's 1 October 04:00.
    for (const start of [g.now + 120 * DAY, g.now + 200 * DAY, g.now + 287 * DAY]) {
      const p = project(g, r, d, start, 1);
      const per = (freqPerWeek(d) * 52) / 12;
      expect(Math.abs(p.rotations - per * n), `start ${start}`).toBeLessThanOrEqual(1);
      expect(p.months.reduce((a, x) => a + (x.pax > 0 ? 1 : 0), 0)).toBeLessThanOrEqual(n + 1);
    }
  });
});

describe('v0.25 the idea\'s pitch carries into the case', () => {
  it('a study of an idea: the case starts on its aircraft and the verdict sets the guess against the study', () => {
    const g = newGame();
    unlockHead(g, 'netPlanner', true);
    hireHead(g, 'netPlanner', 2);
    const i = routeIdeas(g)[0];
    const id = startStudy(g, i.marketId, 'full', i.model, { typeId: i.typeId, perWeek: i.perWeek, model: i.model, margin: i.margin }).routeId!;
    const r = g.network!.routes[id];
    expect(r.pitch).toEqual({ typeId: i.typeId, perWeek: i.perWeek, model: i.model, margin: i.margin });
    r.study!.est = { p10: 200, p50: 300, p90: 400 };
    r.study!.base = studyBase(g, r);
    r.status = 'case';
    const d = caseDraft(g, id)!;
    expect(d.typeId).toBe(i.typeId);
    const c = businessCase(g, id, d)!;
    expect(c.verdict!.reasons.at(-1)).toMatch(new RegExp(`planner guessed a ${Math.round(i.margin * 100)} % margin`));
  });
});
