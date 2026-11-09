// v0.19.2 custom routes (player: "why can't I also build my own route to any destination I like?"): a plausible
// market for any city pair, honest about what it does not know, realistic and not exploitable: strong pairs where
// people are tied, most others thin, crowded or both.

import { describe, expect, it } from 'vitest';
import { AIRPORTS } from '../../data/airports';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { createGame } from '../newGame';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import {
  businessCase, caseDraft, catalogueOf, chainProblem, customBlock, customFacts, customId, customMarket, customRange, customTruth, decideCase,
  devLaunchRoute, marketOfRoute, parseCustomId, recommendation, routeBases, startStudy, studyBase, suggestStops,
} from '.';

const newGame = (seed = 3) => createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });

/** The business case of the study's recommended plan at the model's own size (truth 1), or null when nothing flies it. */
function caseAtTruth(g: GameState, id: string): { margin: number; result: number; lf: number } | null {
  const res = startStudy(g, id, 'full');
  if (!res.routeId) return null;
  const r = g.network!.routes[res.routeId];
  r.study!.truth = 1;
  r.status = 'case';
  const base = studyBase(g, r);
  r.study!.est = { p10: Math.round(base * 0.85), p50: Math.round(base), p90: Math.round(base * 1.15) };
  const d = caseDraft(g, r.id);
  const bc = d ? businessCase(g, r.id, d) : null;
  delete g.network!.routes[r.id];
  return bc ? { margin: bc.p50.margin, result: bc.p50.result, lf: bc.p50.lf } : null;
}

describe('v0.19.2 a custom market', () => {
  it('ids round-trip, with fuel stops both ways', () => {
    for (const d of [{ from: 'LIS', to: 'BOS' }, { from: 'LIS', to: 'DIL', via: ['DXB'], viaBack: ['KUL', 'DXB'] }, { from: 'OPO', to: 'GVA', via: [], viaBack: ['MAD'] }]) {
      const id = customId(d);
      expect(id.startsWith('X:')).toBe(true);
      const back = parseCustomId(id)!;
      expect(customId(back)).toBe(id);
      expect(customMarket(back)!.id).toBe(id);
    }
    expect(parseCustomId('LIS-OXB')).toBeNull();
  });

  it('is pure and plausible: ties, rivals from the carriers data, fares, season, cargo, rights', () => {
    const m = customMarket({ from: 'LIS', to: 'BOS' })!;
    expect(customMarket({ from: 'LIS', to: 'BOS' })).toEqual(m);
    expect(m.custom).toBe(true);
    expect(m.city).toBe('Boston');
    expect(m.competitors.some((c) => c.stops === 0 && /TAP/.test(c.name))).toBe(true);
    expect(m.competitors.some((c) => c.stops === 1 && c.via)).toBe(true);
    expect(m.fareY[0]).toBeLessThan(m.fareY[1]);
    expect(m.fareJ[0]).toBeGreaterThan(m.fareY[0]);
    expect(m.season).toHaveLength(12);
    expect(m.rightsHard).toBeLessThanOrEqual(0.1);
    expect(Object.values(m.segments).reduce((s, x) => s + (x ?? 0), 0)).toBeCloseTo(1, 1);
    // Portuguese New England: the family tie is a real part of it.
    expect(customFacts('LIS', 'BOS')!.links).toBeGreaterThan(10_000);
    // Inside the EU: open skies; a hard regime is hard.
    expect(customMarket({ from: 'LIS', to: 'GVA' })!.rightsHard).toBe(0);
    expect(customMarket({ from: 'LIS', to: 'PEK' })!.rightsHard).toBeGreaterThan(0.5);
    // The spread before a study is wide and honest.
    const r = customRange(m);
    expect(r.lo).toBeLessThan(r.mid);
    expect(r.hi / r.lo).toBeGreaterThan(2);
  });

  it('agrees with the researched catalogue on its pairs (same scale), and sends the player there', () => {
    for (const [to, od] of [['OXB', 46_000], ['LAD', 260_000], ['MPM', 45_000], ['REC', 90_000], ['DIL', 6_000]] as [string, number][]) {
      const f = customFacts('LIS', to)!;
      expect(f.od / od, to).toBeGreaterThan(0.6);
      expect(f.od / od, to).toBeLessThan(1.6);
      expect(catalogueOf('LIS', to)?.id).toBe(`LIS-${to}`);
    }
  });

  it('closed countries, fuel-stop fields and hops are refused', () => {
    const ir = AIRPORTS.find((a) => a.country === 'IR' && !a.enroute)!;
    expect(customBlock({ from: 'LIS', to: ir.code })).toMatch(/sanctions/i);
    const enroute = AIRPORTS.find((a) => a.enroute)!;
    expect(customBlock({ from: 'LIS', to: enroute.code })).toMatch(/fuel stop/);
    expect(customBlock({ from: 'AMS', to: 'BRU' })).toMatch(/Too short/);
    expect(customBlock({ from: 'LIS', to: 'BOS' })).toBeNull();
  });

  it('fuel stops: suggested for the aircraft; a sector beyond its range is refused at Go', () => {
    const g = newGame(3);
    expect(chainProblem({ from: 'LIS', to: 'GRU' }, 'a320ceo')).toMatch(/range/);
    const s = suggestStops(g, 'a320ceo', 'LIS', 'GRU');
    expect('via' in s && s.via.length).toBeGreaterThan(0);
    if ('via' in s) expect(chainProblem({ from: 'LIS', to: 'GRU', via: s.via, viaBack: s.viaBack }, 'a320ceo')).toBeNull();
    expect(routeBases(g)[0]).toBe('LIS');
  });

  it('strong pairs exist where ties are real; random pairs are mostly thin or crowded; nonsense pairs lose heavily', () => {
    const g = newGame(5);
    const strong = caseAtTruth(g, customId({ from: 'LIS', to: 'BOS' }))!;
    expect(strong.margin).toBeGreaterThan(0.03);
    const crowded = caseAtTruth(g, customId({ from: 'LIS', to: 'CDG' }))!;
    expect(crowded.result).toBeLessThan(0);
    const nonsense = caseAtTruth(g, customId({ from: 'LIS', to: 'ANC' }))!;
    expect(nonsense.margin).toBeLessThan(-0.5);
    // A spread of destinations the 767 reaches nonstop: most lose money even at the model's own size.
    const picks = AIRPORTS.filter((a, i) => i % 23 === 7 && !a.enroute && !a.ice && a.country !== 'PT' && !catalogueOf('LIS', a.code) && !customBlock({ from: 'LIS', to: a.code })
      && !chainProblem({ from: 'LIS', to: a.code }, 'b763'));
    let losers = 0;
    let n = 0;
    for (const a of picks.slice(0, 14)) {
      const c = caseAtTruth(g, customId({ from: 'LIS', to: a.code }));
      if (!c) continue;
      n++;
      if (c.result <= 0) losers++;
    }
    expect(n).toBeGreaterThanOrEqual(8);
    expect(losers / n).toBeGreaterThanOrEqual(0.6);
  }, 120_000);

  it('the real size is fixed per game and pair: a new study finds the same market (no fishing)', () => {
    const g = newGame(7);
    const m = customMarket({ from: 'LIS', to: 'YYZ' })!;
    const t = customTruth(g, m);
    expect(customTruth(g, m)).toBe(t);
    const a = startStudy(g, m.id, 'full');
    const ra = g.network!.routes[a.routeId!];
    const ta = ra.study!.truth;
    ra.status = 'closed';
    const b = startStudy(g, customId({ from: 'LIS', to: 'YYZ', via: ['PDL'] }), 'full');
    const tb = g.network!.routes[b.routeId!].study!.truth;
    // Only the study's own noise (σ 10 %) between the two.
    expect(Math.abs(Math.log(ta / tb))).toBeLessThan(0.5);
    expect(Math.abs(Math.log(ta / t))).toBeLessThan(0.4);
    // Another game hides another size.
    const h = newGame(8);
    expect(customTruth(h, m)).not.toBe(t);
  });

  it('a custom route keeps its market through save and load, launches and flies like a catalogue one', () => {
    const g = newGame(11);
    const id = customId({ from: 'LIS', to: 'LUX' });
    const res = startStudy(g, id, 'desk');
    const r = g.network!.routes[res.routeId!];
    expect(r.custom?.id).toBe(id);
    expect(startStudy(g, id, 'desk').why).toMatch(/launching/);
    const back = deserialize(serialize(g));
    expect(marketOfRoute(back.network!.routes[r.id])?.city).toBe('Luxembourg');
    for (let i = 0; i < 30 && back.network!.routes[r.id].status === 'study'; i++) advanceTo(back, back.now + DAY, new Set());
    const r2 = back.network!.routes[r.id];
    expect(r2.status).toBe('case');
    expect(recommendation(back, r.id)).not.toBeNull();
    expect(decideCase(back, r.id, 'go', caseDraft(back, r.id)!)).toBeNull();
    expect(back.network!.routes[r.id].status).toBe('launching');
    // The dev hook takes a custom id too (bots and the invariant checker).
    const h = newGame(12);
    const rid = devLaunchRoute(h, customId({ from: 'LIS', to: 'BOS' }), Object.values(h.fleet).sort((x, y) => y.cabin.total - x.cabin.total)[0].id);
    expect(h.network!.routes[rid]?.rotations.length).toBeGreaterThan(0);
  });
});
