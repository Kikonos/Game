// v0.21 "Stopovers and route advice" (player reports bmwbiobsokzf4, bmwbir591j4cw, bmwbjlg2n93bp): a stop where some
// passengers get off, others get on and others stay on; fifth-freedom rights; the three markets share the seats; the
// fuel stop and the stopover side by side; studies kept, shown and reopened; the verdict, the analyst's and the
// planner's advice; the planner as a hire.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { devAddType } from '../dev';
import { createGame } from '../newGame';
import { checkAchievements } from '../ops/achievements';
import { hireHead, unlockHead } from '../ops/heads';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import {
  bcCapOf, businessCase, caseAdvice, caseDraft, caseVerdict, customId, customMarket, decideCase, devLaunchRoute, fifthOdds, marketOfRoute, parseCustomId,
  plannerStudyX, project, reopenStudy, routeIdeas, setStop, sharedStop, shareSeats, startStudy, stopoverCompare, studyAccuracy, studyBase, studyList,
  validStudyFor,
} from '.';
import type { RoutePlan } from './types';

const newGame = (seed = 5) => createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });
const plan = (typeId: string, over: Partial<RoutePlan> = {}): RoutePlan => ({ model: 'own', days: 1 << 4, every: 1, out: 600, back: 600, nights: 1, typeId, layout: 'two-class', fares: 'market', marketing: 'normal', ...over });
const view = (id: string) => ({ marketId: id, custom: customMarket(parseCustomId(id)!)!, model: 'own' as const, reputation: 60 });
/** A studied route waiting at its business case, the study reading the model's own size. */
function atCase(g: GameState, id: string): string {
  const res = startStudy(g, id, 'full');
  const r = g.network!.routes[res.routeId!];
  r.study!.truth = 1;
  r.status = 'case';
  const base = studyBase(g, r);
  r.study!.est = { p10: Math.round(base * 0.85), p50: Math.round(base), p90: Math.round(base * 1.15) };
  r.study!.done = g.now;
  r.study!.validUntil = g.now + BAL.v019.launch.validDays * DAY;
  const cs = r.stages.find((s) => s.id === 'case')!;
  cs.state = 'waiting';
  cs.start = g.now;
  return r.id;
}
const hire = (g: GameState, id: 'analyst' | 'netPlanner') => { unlockHead(g, id, true); hireHead(g, id, 2); };

describe('v0.21 the seats of a stopover', () => {
  it('through passengers sit on both sectors; each leg’s locals fill what is left; nobody is sold twice', () => {
    const c = { j: 12, y: 150 };
    const a = shareSeats({ j: 4, y: 60 }, { j: 2, y: 50 }, { j: 1, y: 30 }, c, c, true);
    expect(a.thr).toEqual({ j: 4, y: 60 });
    expect(a.l1.y).toBe(50);
    expect(a.l2.y).toBe(30);
    expect(a.spill).toBe(0);
    // Short of seats: the through passengers keep theirs, the locals share the rest, no sector is oversold.
    const b = shareSeats({ j: 0, y: 120 }, { j: 0, y: 120 }, { j: 0, y: 40 }, c, c, true);
    expect(b.thr.y + b.l1.y).toBeLessThanOrEqual(150 + 1e-6);
    expect(b.thr.y + b.l2.y).toBeLessThanOrEqual(150 + 1e-6);
    expect(b.thr.y).toBe(120);
    expect(b.l1.y).toBe(30);
    expect(b.l2.y).toBe(30);
    expect(b.spill).toBeGreaterThan(0);
    // Limited rights cap the B–C locals; no business cabin sends most business travellers elsewhere.
    const cap = bcCapOf('limited', 162);
    expect(cap).toBe(Math.floor(162 * BAL.v019.stop.limitedShare));
    expect(shareSeats({ j: 0, y: 10 }, { j: 0, y: 10 }, { j: 0, y: 100 }, c, c, true, cap).l2.y).toBeCloseTo(cap, 5);
    const y = shareSeats({ j: 10, y: 0 }, { j: 0, y: 0 }, { j: 0, y: 0 }, { j: 0, y: 150 }, { j: 0, y: 150 }, true);
    expect(y.thr).toEqual({ j: 0, y: 10 * BAL.v019.demand.jToY });
  });

  it('fifth-freedom rights: free inside the EU, never for domestic legs, hard elsewhere', () => {
    expect(fifthOdds('LIS', 'FCO', 'ATH').full).toBe(1);
    const us = fifthOdds('LIS', 'JFK', 'LAX');
    expect(us.full + us.limited).toBe(0);
    expect(us.why).toMatch(/cabotage/);
    const hard = fifthOdds('LIS', 'DXB', 'BOM');
    expect(hard.full).toBeLessThan(0.3);
    expect(hard.full + hard.limited).toBeLessThan(0.7);
    expect(hard.full + hard.limited).toBeGreaterThan(0);
  });

  it('a stopover market: its id round-trips, the legs are markets of their own, a researched pair keeps its numbers', () => {
    const id = customId({ from: 'LIS', to: 'LAX', stop: 'JFK' });
    expect(id).toBe('X:LIS-LAX@JFK');
    expect(customId(parseCustomId(id)!)).toBe(id);
    const m = customMarket(parseCustomId(id)!)!;
    expect(m.stopover?.at).toBe('JFK');
    expect(m.via).toEqual(['JFK']);
    expect(m.stopover!.ab.to).toBe('JFK');
    expect(m.stopover!.bc.from).toBe('JFK');
    expect(sharedStop(m)).toBe('JFK');
    // A researched pair with a fuel stop or a stopover: the catalogue's travellers and its realised fares.
    const cat = customMarket({ from: 'LIS', to: 'MPM', via: ['JNB'], viaBack: ['JNB'] })!;
    const so = customMarket({ from: 'LIS', to: 'MPM', stop: 'JNB' })!;
    expect(cat.odPerYear).toBe(so.odPerYear);
    expect(cat.fareY).toEqual(so.fareY);
    expect(cat.custom).toBe(true);
    // A stop with no market of its own is refused.
    expect(customMarket({ from: 'LIS', to: 'LAX', stop: 'LIS' })).toBeNull();
  });

  it('the business case of a stopover: seats split by market, rights add the B–C passengers, the stop costs time and a turn', () => {
    const g = newGame();
    const v = view('X:LIS-ATH@FCO');
    const none = project(g, v, plan('a320ceo'), g.now + 60 * DAY, 1, { fifth: 'none' });
    const full = project(g, v, plan('a320ceo'), g.now + 60 * DAY, 1, { fifth: 'full' });
    expect(none.split!.bc).toBe(0);
    expect(full.split!.bc).toBeGreaterThan(1);
    expect(full.split!.ab).toBeGreaterThan(1);
    expect(full.rev).toBeGreaterThan(none.rev);
    expect(full.paxSec).toBeLessThanOrEqual(full.seatSec + 1e-6);
    expect(full.sectors).toBeCloseTo(none.sectors, 6);
    // The money by kind adds up to the result.
    const p = full.parts;
    const rev = p.tickets + p.cargo + p.extras + p.fee;
    const cost = p.fuel + p.airport + p.service + p.sales + p.disruption + p.maint + p.overheads + p.aircraft + p.crew;
    expect(Math.abs(rev - full.rev)).toBeLessThan(20);
    expect(Math.abs(rev - cost - full.result)).toBeLessThan(40);
    // Side by side: the player's Los Angeles via New York is a bad one (no New York–Los Angeles seats, a long detour).
    const c = stopoverCompare(g, 'LIS', 'LAX', 'JFK', 'a332')!;
    expect(c.plain.mode).toBe('nonstop');
    expect(c.withRights).toBeNull();
    expect(c.stopover.hours).toBeGreaterThan(c.plain.hours + 1);
    expect(c.stopover.result).toBeLessThan(c.plain.result);
    expect(c.cons.join(' ')).toMatch(/cabotage/);
    expect(c.pros.length).toBeGreaterThan(0);
    // And Maputo via Johannesburg is a good one: Lisbon–Johannesburg passengers fill a thin route, more so with rights.
    const good = stopoverCompare(g, 'LIS', 'MPM', 'JNB', 'a332')!;
    expect(good.stopover.result).toBeGreaterThan(good.plain.result);
    expect(good.withRights!.result).toBeGreaterThan(good.stopover.result + 500_000);
    // A long route that must land for fuel anyway: selling seats at the stop helps.
    const far = stopoverCompare(g, 'LIS', 'SIN', 'DXB', 'a332')!;
    expect(far.plain.mode).toBe('fuel');
    expect(far.stopover.result).toBeGreaterThan(far.plain.result);
    // A type that cannot fly it nonstop: the plain way is the fuel stop.
    expect(stopoverCompare(g, 'LIS', 'LAX', 'JFK', 'a320ceo')!.plain.mode).toBe('fuel');
  });

  it('a stopover route sells, flies and earns: locals off and on at the stop, ticket cash held until each sector flies, the same after a save', () => {
    const run = () => {
      const g = newGame(21);
      const ac = Object.values(g.fleet)[0];
      const rid = devLaunchRoute(g, 'X:LIS-ATH@FCO', ac.id);
      expect(g.network!.routes[rid]?.fifth).toBe('full');
      let h = deserialize(serialize(g));
      for (let i = 0; i < 70; i++) {
        advanceTo(h, h.now + DAY, new Set());
        if (i === 30) h = deserialize(serialize(h));
      }
      return h;
    };
    const g = run();
    const r = Object.values(g.network!.routes)[0];
    const flown = r.rotations.filter((x) => x.status === 'flown' && !x.operatedBy);
    expect(flown.length).toBeGreaterThan(3);
    let locals = 0;
    for (const rot of flown) {
      expect(rot.sectors.map((s) => `${s.from}-${s.to}`)).toEqual(['LIS-FCO', 'FCO-ATH', 'ATH-FCO', 'FCO-LIS']);
      for (const [a, b] of [[0, 1], [2, 3]]) {
        const s1 = rot.sectors[a];
        const s2 = rot.sectors[b];
        const thr = (s1.thruJ ?? 0) + (s1.thruY ?? 0);
        expect(thr).toBeLessThanOrEqual((s1.flownJ ?? 0) + (s1.flownY ?? 0));
        expect((s2.flownJ ?? 0) + (s2.flownY ?? 0)).toBeGreaterThanOrEqual(thr);
        expect((s2.flownJ ?? 0) + (s2.flownY ?? 0)).toBeLessThanOrEqual(s2.capJ + s2.capY);
        locals += (s1.localJ ?? 0) + (s1.localY ?? 0) + (s2.localJ ?? 0) + (s2.localY ?? 0);
      }
    }
    expect(locals).toBeGreaterThan(0);
    // Unearned cash is exactly what the unflown sectors hold.
    let held = 0;
    for (const rot of r.rotations) for (const s of rot.sectors) if (!s.accrued && !s.voided) held += s.sold ?? 0;
    expect(Math.abs(held - r.unearned)).toBeLessThan(50 + r.rotations.length * 2);
    // The load factor counts passengers on every sector they sit on.
    const months = Object.values(r.pnl).filter((p) => p.sectors > 0);
    expect(months.length).toBeGreaterThan(0);
    for (const p of months) {
      expect(p.paxSec).toBeDefined();
      expect(p.paxSec!).toBeLessThanOrEqual(p.seats);
      expect(p.paxSec!).toBeGreaterThanOrEqual(p.pax * 0.99);
    }
    // Determinism: the same seed, the same route.
    const h = run();
    expect(JSON.stringify(Object.values(h.network!.routes)[0].rotations)).toBe(JSON.stringify(r.rotations));
    expect(h.company.cash).toBe(g.company.cash);
  }, 240_000);
});

describe('v0.21 studies: kept, shown, reopened', () => {
  it('a shelved study stays good until its date; the market shows it instead of selling a new one', () => {
    const g = newGame(8);
    const id = atCase(g, 'LIS-MPM');
    const r = g.network!.routes[id];
    const until = r.study!.validUntil!;
    expect(studyList(g).map((x) => x.state)).toEqual(['waiting']);
    expect(decideCase(g, id, 'shelve')).toBeNull();
    expect(r.study!.validUntil).toBe(until);
    expect(validStudyFor(g, 'LIS-MPM')?.id).toBe(id);
    expect(studyList(g)[0]).toMatchObject({ routeId: id, state: 'shelved', validUntil: until });
    // Asking again costs nothing and opens the same record at its business case.
    const cash = g.company.cash;
    const n = Object.keys(g.network!.routes).length;
    expect(startStudy(g, 'LIS-MPM', 'survey').routeId).toBe(id);
    expect(g.company.cash).toBe(cash);
    expect(Object.keys(g.network!.routes).length).toBe(n);
    expect(r.status).toBe('case');
    expect(businessCase(g, id, caseDraft(g, id)!)).not.toBeNull();
    // Shelved again and run out: a new study is needed; the old one is listed as run out.
    decideCase(g, id, 'shelve');
    expect(reopenStudy(g, id)).toBeNull();
    decideCase(g, id, 'shelve');
    g.now = until + DAY;
    expect(validStudyFor(g, 'LIS-MPM')).toBeUndefined();
    expect(reopenStudy(g, id)).toMatch(/run out/);
    expect(studyList(g)[0].state).toBe('expired');
    expect(startStudy(g, 'LIS-MPM', 'desk').routeId).not.toBe(id);
  });

  it('a save from before v0.21 (no fifth rights, no sector passengers) loads and keeps flying', () => {
    const g = newGame(9);
    const rid = devLaunchRoute(g, 'LIS-OXB', Object.values(g.fleet)[0].id);
    for (let i = 0; i < 20; i++) advanceTo(g, g.now + DAY, new Set());
    const r = g.network!.routes[rid];
    for (const p of Object.values(r.pnl)) delete p.paxSec;
    const h = deserialize(serialize(g));
    for (let i = 0; i < 25; i++) advanceTo(h, h.now + DAY, new Set());
    const r2 = h.network!.routes[rid];
    expect(r2.fifth).toBeUndefined();
    expect(r2.rotations.filter((x) => x.status === 'flown').length).toBeGreaterThan(3);
  }, 120_000);
});

describe('v0.21 the verdict, the analyst and the planner', () => {
  it('worth it, marginal, not worth it: the words follow the money', () => {
    const band = (result: number, rev = 1_000_000) => ({ paxPerSector: 100, lf: 0.8, rev, cost: rev - result, result, margin: result / rev });
    const base = { breakEvenLf: 0.7, paybackWeeks: 40, launchCost: 250_000 };
    expect(caseVerdict({ ...base, p10: band(20_000), p50: band(150_000), p90: band(250_000) }).word).toBe('Worth it');
    expect(caseVerdict({ ...base, p10: band(-60_000), p50: band(50_000), p90: band(120_000) }).word).toBe('Marginal');
    const no = caseVerdict({ ...base, breakEvenLf: 0.9, paybackWeeks: null, p10: band(-300_000), p50: band(-100_000), p90: band(10_000) });
    expect(no.word).toBe('Not worth it');
    expect(no.tone).toBe('bad');
    expect(no.reasons.length).toBeGreaterThanOrEqual(2);
    expect(no.reasons.length).toBeLessThanOrEqual(3);
  });

  it('good choices pay, bad ones lose: the calibration in one place', () => {
    const g = newGame(4);
    const margin = (id: string, typeId: string, over: Partial<RoutePlan> = {}) => {
      const rid = atCase(g, id);
      const d = { ...caseDraft(g, rid)!, typeId, ...over };
      const bc = businessCase(g, rid, d)!;
      delete g.network!.routes[rid];
      return { m: bc.p50.margin, word: bc.verdict!.word };
    };
    // The strong ethnic route on the right size of aircraft: about 10–20 %, no longer richer.
    const oxb = margin('LIS-OXB', 'a320ceo');
    expect(oxb.m).toBeGreaterThan(0.1);
    expect(oxb.m).toBeLessThan(0.215);
    expect(oxb.word).toBe('Worth it');
    // The same route on an aircraft too big for it: thin.
    expect(margin('LIS-OXB', 'a332').m).toBeLessThan(0.05);
    // A full widebody to Luanda or Recife: a healthy margin.
    for (const id of ['LIS-LAD', 'LIS-REC']) {
      const x = margin(id, 'a332');
      expect(x.m).toBeGreaterThan(0.06);
      expect(x.m).toBeLessThan(0.2);
    }
    // Bad choices lose money.
    expect(margin('LIS-MPM', 'a332').m).toBeLessThan(0);
    expect(margin('X:LIS-EWR', 'a332').m).toBeLessThan(0);
    expect(margin('X:LIS-LAX@JFK', 'a332').word).toBe('Not worth it');
    // The best unresearched find is rich but no goldmine.
    expect(margin('X:LIS-BOM', 'a332').m).toBeLessThan(0.3);
  }, 120_000);

  it('the analyst names changes that earn more, each a patch to the plan; nobody hired, no advice', () => {
    const g = newGame(6);
    devAddType(g, 'a332');
    const rid = atCase(g, 'LIS-MPM');
    const d = { ...caseDraft(g, rid)!, typeId: 'a332' };
    const none = caseAdvice(g, rid, d);
    expect(none.list).toEqual([]);
    expect(none.analyst.hired).toBe(false);
    hire(g, 'analyst');
    const a = caseAdvice(g, rid, d);
    expect(a.analyst.hired).toBe(true);
    expect(a.list.length).toBeGreaterThan(0);
    const cur = businessCase(g, rid, d)!.p50.result;
    for (const x of a.list) {
      expect(x.who).toBe('analyst');
      expect(x.patch).toBeDefined();
      const next = { ...d, ...x.patch } as RoutePlan;
      if ('monthly' in x.patch! && !x.patch!.monthly) delete next.monthly;
      const better = businessCase(g, rid, next)!.p50.result;
      // The campaign's own cost is taken off its gain; every other lever shows in the year's result.
      if (x.key !== 'campaign') expect(better - cur).toBeGreaterThan(x.gain * 0.9);
      expect(x.gain).toBeGreaterThan(10_000);
    }
  }, 120_000);

  it('the planner weighs the stop, switches it in one step, sharpens studies and lists routes worth a study', () => {
    const g = newGame(7);
    devAddType(g, 'a332');
    expect(plannerStudyX(g)).toBe(1);
    expect(routeIdeas(g)).toEqual([]);
    const rid = atCase(g, 'X:LIS-LAX@JFK');
    const r = g.network!.routes[rid];
    const d = { ...caseDraft(g, rid)!, typeId: 'a332' };
    hire(g, 'netPlanner');
    expect(plannerStudyX(g)).toBeLessThan(0.8);
    expect(studyAccuracy('full', false, g)).toBeLessThan(studyAccuracy('full', false));
    const stop = caseAdvice(g, rid, d).list.find((x) => x.key === 'stop')!;
    expect(stop.who).toBe('planner');
    expect(stop.stop).toEqual({ mode: 'nonstop', at: 'JFK' });
    // One step: the same study, re-read for the new shape.
    const est = r.study!.est!.p50;
    expect(setStop(g, rid, 'nonstop')).toBeNull();
    expect(r.marketId).toBe('X:LIS-LAX');
    expect(marketOfRoute(r)!.stopover).toBeUndefined();
    expect(r.study!.est!.p50).toBeLessThan(est);
    expect(caseAdvice(g, rid, { ...caseDraft(g, rid)!, typeId: 'a332' }).list.find((x) => x.key === 'stop' && x.stop?.at === 'JFK')).toBeUndefined();
    // And back to a stopover, or a fuel stop only.
    expect(setStop(g, rid, 'stopover', 'JFK')).toBeNull();
    expect(r.marketId).toBe('X:LIS-LAX@JFK');
    expect(r.study!.est!.p50).toBe(est);
    expect(setStop(g, rid, 'fuel')).toBeNull();
    expect(r.marketId).toBe('X:LIS-LAX~JFK');
    // Only at the business case.
    r.status = 'launching';
    expect(setStop(g, rid, 'stopover')).toMatch(/business case/);
    // Ideas: unresearched pairs from our bases with a healthy first guess, best first, flown by a type of ours.
    const ideas = routeIdeas(g);
    expect(ideas.length).toBeGreaterThan(0);
    expect(ideas.length).toBeLessThanOrEqual(BAL.v019.planner.ideas);
    for (const x of ideas) {
      expect(x.margin).toBeGreaterThanOrEqual(0.06);
      expect(Object.values(g.fleet).some((a) => a.typeId === x.typeId)).toBe(true);
    }
    expect([...ideas].sort((p, q) => q.result - p.result)).toEqual(ideas);
  }, 120_000);

  it('with no planner yet, the analyst still weighs a stop the route already has', () => {
    const g = newGame(12);
    devAddType(g, 'a332');
    const rid = atCase(g, 'X:LIS-LAX@JFK');
    hire(g, 'analyst');
    const stop = caseAdvice(g, rid, { ...caseDraft(g, rid)!, typeId: 'a332' }).list.find((x) => x.key === 'stop')!;
    expect(stop.who).toBe('analyst');
    expect(stop.stop?.mode).toBe('nonstop');
  });

  it('the first finished study earns the network planner: candidates with a real salary', () => {
    const g = newGame(10);
    expect(g.heads!.netPlanner.unlockedAt).toBeNull();
    atCase(g, 'LIS-OXB');
    checkAchievements(g);
    const h = g.heads!.netPlanner;
    expect(h.unlockedAt).not.toBeNull();
    expect(h.candidates!.length).toBe(3);
    for (const c of h.candidates!) expect(c.salary).toBeGreaterThan(3_000);
    expect(hireHead(g, 'netPlanner', 1).ok).toBe(true);
    expect(g.heads!.netPlanner.hired!.salary).toBeGreaterThan(3_000);
  });
});
