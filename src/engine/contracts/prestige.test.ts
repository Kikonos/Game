// v0.16 the client prestige ladder (UPDATE-0.16.md §B): client levels, the offer draw by level, stretch offers, pay and
// penalties by level, the visibility credit, level-ups (never down) and an older save's derived record.

import { describe, expect, it, onTestFinished } from 'vitest';
import { BAL } from '../core/balance';
import { takeCues } from '../core/cues';
import { DAY } from '../core/time';
import type { Client, GameState, Prestige } from '../core/types';
import { bumpClient } from './relations';
import {
  clientPrestige, contractVisibility, dailyPrestige, derivePrestige, levelReached, loadPrestige, markStretch, noteStretch, onContractDoneVisibility, playerLevel, prestigeOfferWeight,
  prestigePayPct, prestigePenaltyX, prestigeRequirements, prestigeView, seedPrestige, stretchOpen, PRESTIGE_GATE, PRESTIGE_NAME,
  clientStars, LEVEL_OF_STARS, levelUpText, nextStars, playerPrestige, playerStars, seedStars, starsLabel, starsText,
} from './prestige';
import { newGame, offer } from './testkit';

const P = BAL.v016.prestige;

/** A test game with the ladder's market effects ON (the test kit switches them off for the offer-flow tests). */
const game = (seed = 3, base = 'LIS', newcomer = false): GameState => {
  const g = newGame(seed, base, newcomer);
  PRESTIGE_GATE.on = true;
  return g;
};

/** A client of the given level (a copy of one in the game, re-levelled). */
function clientAt(g: GameState, level: Prestige, jobs = 0): Client {
  const c = Object.values(g.clients).find((x) => x.kind === 'airline' && !x.rivalId)!;
  const k: Client = { ...c, id: `t${level}${jobs}`, name: `Test ${level}`, prestige: level, jobs, relation: 0 };
  g.clients[k.id] = k;
  return k;
}

const setLevel = (g: GameState, level: Prestige) => {
  g.company.prestige = { level, visibility: 0, levelAt: { 1: g.started } };
};

describe('client levels', () => {
  it('every client of a new game has a level; the rules by kind hold', () => {
    const g = game();
    for (const c of Object.values(g.clients)) expect([1, 2, 3, 4]).toContain(c.prestige);
    expect(seedPrestige({ name: 'Some Tours', kind: 'tourOperator', country: 'DE' })).toBe(1);
    expect(seedPrestige({ name: 'Some Air', kind: 'airline', country: 'FR' })).toBe(3);
    expect(seedPrestige({ name: 'Ministry', kind: 'government', country: 'FR' })).toBe(4);
    expect(seedPrestige({ name: 'Ministry', kind: 'government', country: 'PT' }, 'defence')).toBe(3);
    expect(seedPrestige({ name: 'Club', kind: 'sports', country: 'ES' })).toBe(2);
    expect(seedPrestige({ name: 'Rival', kind: 'operator', country: 'LT', rivalId: 'r1' })).toBe(2);
  });

  it('a new game starts at level 1 with nothing earned', () => {
    const g = game(3, 'LIS', true);
    (g.company as { prestige?: unknown }).prestige = undefined;
    loadPrestige(g);
    expect(playerLevel(g)).toBe(1);
    expect(g.company.prestige?.visibility).toBe(0);
    expect(prestigeView(g).next?.level).toBe(2);
  });
});

describe('the offer draw by level', () => {
  it('weighs clients by their level against ours: 1 at ours, less below, a stretch one up, never two up', () => {
    const g = game();
    setLevel(g, 2);
    expect(prestigeOfferWeight(g, clientAt(g, 2))).toBe(1);
    expect(prestigeOfferWeight(g, clientAt(g, 1))).toBe(P.weight['-1']);
    // v0.24 a level 3–4 airline up shows itself at iosaShow (iosa.test.ts); any other client keeps the ladder.
    const notAirline = (lv: Prestige) => {
      const c = { ...clientAt(g, lv), id: `ta${lv}`, kind: 'agency' as const };
      g.clients[c.id] = c;
      return c;
    };
    expect(prestigeOfferWeight(g, notAirline(3))).toBe(P.weight['1']);
    expect(prestigeOfferWeight(g, notAirline(4))).toBe(0);
    expect(prestigeOfferWeight(g, clientAt(g, 3))).toBe(Math.max(P.weight['1'], P.iosaShow));
    expect(prestigeOfferWeight(g, clientAt(g, 4))).toBe(P.iosaShow);
    setLevel(g, 4);
    expect(prestigeOfferWeight(g, clientAt(g, 1))).toBe(P.weight['-3']);
    expect(prestigeOfferWeight(g, clientAt(g, 2))).toBe(P.weight['-2']);
  });

  it('one stretch offer a month: after one is made the level above weighs nothing until the window passes', () => {
    const g = game();
    setLevel(g, 1);
    g.company.pendingApprovals.push({ id: 'iosa', started: g.now, done: g.now + 240 * DAY, cost: 0 });
    const up = clientAt(g, 2);
    expect(stretchOpen(g)).toBe(true);
    const d = { client: up, req: { approvals: [] } };
    markStretch(g, d as never);
    expect((d as { stretch?: true }).stretch).toBe(true);
    const made = g.stats.v016?.stretchOffers ?? 0;
    noteStretch(g, { stretch: true });
    expect(stretchOpen(g)).toBe(false);
    expect(prestigeOfferWeight(g, up)).toBe(0);
    expect(g.stats.v016?.stretchOffers).toBe(made + 1);
    // Asked for by name inside the window (a lead, a tender): the offer comes, unlabelled; a rival hiring us is never a stretch.
    const d2 = { client: up, req: { approvals: [] } };
    markStretch(g, d2 as never);
    expect((d2 as { stretch?: true }).stretch).toBeUndefined();
    g.now += P.stretchDays * DAY;
    const rival = { ...up, id: 'rv', rivalId: 'r1' };
    g.clients.rv = rival;
    const d3 = { client: rival, req: { approvals: [] } };
    markStretch(g, d3 as never);
    expect((d3 as { stretch?: true }).stretch).toBeUndefined();
    g.now -= P.stretchDays * DAY;
    g.now += P.stretchDays * DAY;
    expect(stretchOpen(g)).toBe(true);
    expect(prestigeOfferWeight(g, up)).toBe(P.weight['1']);
  });

  it('a client we have flown for keeps calling whatever its level, and is no stretch', () => {
    const g = game();
    setLevel(g, 1);
    const known = clientAt(g, 4, 2);
    expect(prestigeOfferWeight(g, known)).toBe(1);
    const d = { client: known, req: { approvals: [] as string[] } };
    markStretch(g, d as never);
    expect((d as { stretch?: true }).stretch).toBeUndefined();
    expect(d.req.approvals).toEqual([]);
  });

  it('a national carrier asks for IOSA (filed is enough); a major wants it held', () => {
    const g = game();
    setLevel(g, 2);
    // v0.24 every ask kept for this check (iosa.test.ts covers the thinning before IOSA is filed).
    const keep = P.iosaKeep;
    (P as { iosaKeep: number }).iosaKeep = 1;
    onTestFinished(() => {
      (P as { iosaKeep: number }).iosaKeep = keep;
    });
    const d3 = { client: clientAt(g, 3), req: { approvals: [] as string[] } };
    markStretch(g, d3 as never);
    expect(d3.req.approvals).toEqual(['iosa']);
    g.company.pendingApprovals.push({ id: 'iosa', started: g.now, done: g.now + 240 * DAY, cost: 0 });
    const d3b = { client: clientAt(g, 3), req: { approvals: [] as string[] } };
    markStretch(g, d3b as never);
    expect(d3b.req.approvals).toEqual([]);
    setLevel(g, 3);
    const d4 = { client: clientAt(g, 4), req: { approvals: [] as string[] } };
    markStretch(g, d4 as never);
    expect(d4.req.approvals).toEqual(['iosa']);
    g.company.approvals.push('iosa');
    const d4b = { client: clientAt(g, 4), req: { approvals: [] as string[] } };
    markStretch(g, d4b as never);
    expect(d4b.req.approvals).toEqual([]);
  });

  it('an offer carries the level rate part and its penalties scale with the level', () => {
    const g = game();
    setLevel(g, 4);
    for (let i = 0; i < 6; i++) {
      const o = offer(g, i % 2 ? 'adhoc' : 'tourSeries');
      const lv = clientPrestige(g.clients[o.clientId]);
      expect(o.prestigePct ?? 0).toBe(prestigePayPct(lv));
      const demanding = (g.company.standing ?? 0) === 0 ? BAL.v08.standing.demandingDelay : 1;
      expect(o.penalties.perDelay).toBe(Math.round(BAL.perDelay[0] * demanding * prestigePenaltyX(lv)));
    }
    expect(prestigePayPct(1)).toBeLessThan(0);
    expect(prestigePayPct(4)).toBeGreaterThan(prestigePayPct(3));
  });

  it('a relation hit from a major lands harder; the monthly drift does not', () => {
    const g = game();
    const major = clientAt(g, 4);
    const small = clientAt(g, 1);
    bumpClient(g, major.id, -10, 'We cancelled');
    bumpClient(g, small.id, -10, 'We cancelled');
    expect(major.relation).toBeCloseTo(-10 * P.relationX[4], 5);
    expect(small.relation).toBe(-10);
    bumpClient(g, major.id, -1, '');
    expect(major.relation).toBeCloseTo(-10 * P.relationX[4] - 1, 5);
  });
});

describe('visibility and level-ups', () => {
  it('a completed contract earns visibility by its block hours and the client level, once', () => {
    const g = game();
    const o = offer(g, 'adhoc');
    const c = g.clients[o.clientId];
    c.prestige = 3;
    const k = { id: 'k1', clientId: c.id, status: 'completed', use: { '2026-04': { blockMin: 600 } }, dry: false } as never;
    expect(contractVisibility(g, k)).toEqual({ amount: Math.round((10 * P.perBH[3] + P.perContract[3]) * 10) / 10, level: 3 });
    onContractDoneVisibility(g, k);
    onContractDoneVisibility(g, k);
    expect(g.company.prestige?.visibility).toBe(10 * P.perBH[3] + P.perContract[3]);
    expect(g.stats.v016?.visibilityFrom[3]).toBe(10 * P.perBH[3] + P.perContract[3]);
  });

  it('brochure work climbs slowly: 400 BH a month at level 1 reaches level 2 in months, not weeks', () => {
    const perMonth = 400 * P.perBH[1] + 2 * P.perContract[1];
    expect(P.levels[2].visibility / perMonth).toBeGreaterThan(5);
  });

  it('the level goes up one step when the thresholds hold, with a ladder card, and never down', () => {
    const g = game(3, 'LIS', true);
    setLevel(g, 1);
    const p = g.company.prestige!;
    const t = P.levels[2];
    p.visibility = t.visibility;
    g.stats.contractsDone = t.contracts;
    g.company.reputation.reliable = t.reliable;
    g.now = g.started + (t.months + 1) * 31 * DAY;
    takeCues();
    expect(levelReached(g, 2)).toBe(true);
    dailyPrestige(g);
    expect(p.level).toBe(2);
    expect(p.levelAt[2]).toBe(g.now);
    const m = g.messages[0];
    expect(m.title).toBe(`New rating: ★★☆☆☆ ${PRESTIGE_NAME[2]}`);
    expect(m.topic).toBe('ladder');
    expect(m.body).toContain('Next, National carriers');
    expect(takeCues()).toContain('ladder');
    // Reliability falls: the level stays.
    g.company.reputation.reliable = 10;
    dailyPrestige(g);
    expect(p.level).toBe(2);
    // Level 3 needs IOSA held: visibility alone is not enough.
    p.visibility = P.levels[3].visibility;
    g.stats.contractsDone = 40;
    g.company.reputation.reliable = 90;
    g.now += 24 * 31 * DAY;
    dailyPrestige(g);
    expect(p.level).toBe(2);
    expect(prestigeView(g).next?.missing).toEqual(['IOSA registration held']);
    g.company.approvals.push('iosa');
    dailyPrestige(g);
    expect(p.level).toBe(3);
  });

  it('a contract signed off a stretch offer is counted once', () => {
    const g = game();
    const o = offer(g, 'adhoc');
    o.stretch = true;
    o.status = 'accepted';
    g.contracts.kx = { id: 'kx', offerId: o.id, status: 'signed' } as never;
    dailyPrestige(g);
    dailyPrestige(g);
    expect(g.stats.v016?.stretchSigned).toBe(1);
    expect(g.contracts.kx.stretch).toBe(true);
  });

  it('what a level 3 / 4 client checks reads as plain lines with a pass mark', () => {
    const g = game();
    const r3 = prestigeRequirements(g, 3);
    expect(r3).toHaveLength(3);
    expect(r3[0].ok).toBe(false);
    expect(r3[0].line).toContain('IOSA');
    expect(r3[1].ok).toBe(g.company.reputation.reliable >= P.reqs[3].reliable);
    g.company.approvals.push('iosa');
    expect(prestigeRequirements(g, 3)[0].ok).toBe(true);
    expect(prestigeRequirements(g, 4)).toHaveLength(4);
    expect(prestigeRequirements(g, 2)).toEqual([]);
  });
});

describe('older saves', () => {
  it('derives the record from completed contracts: visibility by client level; a level with two jobs counts as reached', () => {
    const g = game();
    const o = offer(g, 'adhoc');
    const c = g.clients[o.clientId];
    c.prestige = 3;
    for (let i = 0; i < 2; i++) g.contracts[`d${i}`] = { id: `d${i}`, clientId: c.id, status: 'completed', use: { '2026-04': { blockMin: 1200 } }, dry: false } as never;
    g.contracts.dx = { id: 'dx', clientId: c.id, status: 'active', use: {}, dry: false } as never;
    const p = derivePrestige(g);
    expect(p.derived).toBe(true);
    expect(p.visibility).toBe(2 * (20 * P.perBH[3] + P.perContract[3]));
    expect(p.level).toBe(3);
    // One job for a level-4 client: the level below.
    const major = clientAt(g, 4);
    g.contracts.d9 = { id: 'd9', clientId: major.id, status: 'completed', use: {}, dry: false } as never;
    expect(derivePrestige(g).level).toBe(3);
    delete g.contracts.d0;
    delete g.contracts.d1;
    expect(derivePrestige(g).level).toBe(3);
    g.contracts.d8 = { id: 'd8', clientId: major.id, status: 'completed', use: {}, dry: false } as never;
    expect(derivePrestige(g).level).toBe(4);
  });
});

describe('v0.16.1 stars: a finer display per client, the four levels unchanged', () => {
  it('seeds and derivation: flagships 5, majors 4, governments 5, national carriers 3, charter market 2, big brochures 1, small ones 0', () => {
    const g = newGame(3);
    const by = (name: string) => Object.values(g.clients).find((c) => c.name === name);
    const stars = (name: string) => (by(name) ? clientStars(by(name)) : seedStars({ name, kind: 'airline', country: 'XX' }));
    expect(seedStars({ name: 'Air France', kind: 'airline', country: 'FR' })).toBe(5);
    expect(seedStars({ name: 'Lufthansa', kind: 'airline', country: 'DE' })).toBe(5);
    expect(seedStars({ name: 'Iberia', kind: 'airline', country: 'ES' })).toBe(4);
    expect(seedStars({ name: 'UK Ministry of Defence', kind: 'government', country: 'GB' })).toBe(5);
    expect(seedStars({ name: 'Portuguese Ministry of Foreign Affairs', kind: 'government', country: 'PT' })).toBe(3);
    expect(seedStars({ name: 'Condor', kind: 'airline', country: 'DE' })).toBe(2);
    expect(seedStars({ name: 'TUI Deutschland', kind: 'tourOperator', country: 'DE' })).toBe(1);
    expect(seedStars({ name: 'easyJet', kind: 'airline', country: 'GB' })).toBe(1);
    expect(seedStars({ name: 'Čedok', kind: 'tourOperator', country: 'CZ' })).toBe(0);
    expect(seedStars({ name: 'Some Small Tours', kind: 'tourOperator', country: 'PT' })).toBe(0);
    // Every star band belongs to its level; the level a client has is what the engine still gates on.
    for (const c of Object.values(g.clients)) expect(LEVEL_OF_STARS[clientStars(c)]).toBe(clientPrestige(c));
    expect(stars('Air France') === 5 || !by('Air France')).toBe(true);
  });
  it('a save without stars gets them on load; the old minimum level becomes a minimum of stars', () => {
    const g = newGame(3);
    for (const c of Object.values(g.clients)) delete c.stars;
    g.filter = { on: true, kindsOff: [], minPrestige: 3 };
    loadPrestige(g);
    for (const c of Object.values(g.clients)) expect(c.stars).toBe(seedStars(c));
    expect(g.filter.minPrestige).toBeUndefined();
    expect(g.filter.minStars).toBe(3);
  });
  it('our own stars: the highest band the level reaches, and what the next band needs', () => {
    const g = newGame(3);
    playerPrestige(g).level = 1;
    expect(playerStars(g)).toBe(1);
    expect(nextStars(g)).toEqual({ stars: 2, level: 2 });
    playerPrestige(g).level = 4;
    expect(playerStars(g)).toBe(5);
    expect(nextStars(g)).toBeNull();
    expect(starsLabel(3)).toBe('3 of 5 stars');
    expect(starsText(2)).toBe('★★☆☆☆');
    expect(levelUpText(g, 3).title).toBe('New rating: ★★★☆☆ National carriers');
  });
});
