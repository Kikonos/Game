// v0.24 offers aware of the game stage (player: "a lot of IOSA contracts offered when I don't have IOSA yet ... so far
// no government contracts offered in MLA base, and the ones that were needed IOSA"). Airlines ask a new operator for
// IOSA; governments and aid bodies do not (an EU AOC, insurance, their own checks). Before IOSA is filed only a share of
// the airlines' IOSA asks reach us; our own state's ministries call from the start.

import { describe, expect, it, onTestFinished } from 'vitest';
import '../commercial/index';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { Client, GameState, Prestige } from '../core/types';
import { generateOffer } from './offers';
import { asksIosa, loadPrestige, markStretch, prestigeOfferWeight, prestigeRequirements, PRESTIGE_GATE } from './prestige';
import { newGame } from './testkit';
import * as F from './flavor';

const P = BAL.v016.prestige;

const game = (base = 'MLA', seed = 3): GameState => {
  const g = newGame(seed, base, true);
  PRESTIGE_GATE.on = true;
  onTestFinished(() => {
    PRESTIGE_GATE.on = false;
  });
  g.company.prestige = { level: 1, visibility: 0, levelAt: { 1: g.started } };
  return g;
};
const named = (g: GameState, name: string): Client => Object.values(g.clients).find((c) => c.name === name)!;
function airlineAt(g: GameState, level: Prestige): Client {
  const c = Object.values(g.clients).find((x) => x.kind === 'airline' && !x.rivalId)!;
  const k: Client = { ...c, id: `ia${level}`, name: `Test air ${level}`, prestige: level, jobs: 0, relation: 0 };
  g.clients[k.id] = k;
  return k;
}
const draft = (c: Client) => ({ client: c, req: { approvals: [] as string[] } });

describe('who asks for IOSA', () => {
  it('airlines do; ministries, the UN agencies and aid bodies do not', () => {
    expect(asksIosa({ kind: 'airline' })).toBe(true);
    for (const k of ['government', 'agency', 'tourOperator', 'sports'] as const) expect(asksIosa({ kind: k })).toBe(false);
    const g = game();
    for (const name of ['Maltese Ministry for Foreign Affairs', 'Armed Forces of Malta', 'UNHCR', 'International Organization for Migration (IOM)', 'French Ministry of the Armed Forces']) {
      const d = draft(named(g, name));
      for (let i = 0; i < 20; i++) {
        g.now += 37;
        expect(markStretch(g, d as never)).toBeUndefined();
      }
      expect(d.req.approvals, name).toEqual([]);
    }
  });

  it('a ministry checks our record and fleet, not IOSA; an airline lists IOSA', () => {
    const g = game();
    expect(prestigeRequirements(g, 3, 'government').some((x) => /IOSA/.test(x.line))).toBe(false);
    expect(prestigeRequirements(g, 4, 'government').some((x) => /IOSA/.test(x.line))).toBe(false);
    expect(prestigeRequirements(g, 3, 'airline')[0].line).toMatch(/IOSA/);
    expect(prestigeRequirements(g, 3)[0].line).toMatch(/IOSA/);
  });
});

describe('IOSA asks by the game stage', () => {
  it('before IOSA is filed only about iosaKeep of a new national carrier\'s asks reach us', () => {
    const g = game();
    const c = airlineAt(g, 3);
    let dropped = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      g.now += 61;
      const d = draft(c);
      if (markStretch(g, d as never) === 'drop') dropped++;
      else expect(d.req.approvals).toEqual(['iosa']);
    }
    const kept = 1 - dropped / N;
    expect(kept).toBeGreaterThan(P.iosaKeep - 0.1);
    expect(kept).toBeLessThan(P.iosaKeep + 0.1);
  });

  it('a national carrier or a major one or two levels up shows itself at iosaShow, outside the stretch slot; a level-2 airline keeps the ladder', () => {
    const g = game();
    const shut = () => {
      g.company.prestige!.stretchAt = g.now;
    };
    shut();
    // Level 1: a level-2 airline asks no IOSA, so it comes only in the monthly stretch slot (as before v0.24).
    expect(prestigeOfferWeight(g, airlineAt(g, 2))).toBe(0);
    expect(prestigeOfferWeight(g, airlineAt(g, 3))).toBe(P.iosaShow);
    expect(prestigeOfferWeight(g, airlineAt(g, 4))).toBe(0);
    delete g.company.prestige!.stretchAt;
    expect(prestigeOfferWeight(g, airlineAt(g, 2))).toBe(P.weight['1']);
    // Level 2: both a level-3 and a level-4 airline show themselves; a ministry two up does not.
    g.company.prestige = { level: 2, visibility: 0, levelAt: { 1: g.started } };
    shut();
    expect(prestigeOfferWeight(g, airlineAt(g, 3))).toBe(P.iosaShow);
    expect(prestigeOfferWeight(g, airlineAt(g, 4))).toBe(P.iosaShow);
    expect(prestigeOfferWeight(g, named(g, 'Lithuanian Ministry of Foreign Affairs'))).toBe(0);
    // A small weight, well under the at-level one.
    expect(P.iosaShow).toBeLessThanOrEqual(0.25 * P.weight['0']);
  });

  it('filing or holding IOSA never hides them: the same weight, and their offers keep coming', () => {
    for (const level of [1, 2] as const) {
      const g = game();
      g.company.prestige = { level, visibility: 0, levelAt: { 1: g.started } };
      g.company.prestige.stretchAt = g.now;
      const c3 = airlineAt(g, 3);
      const c4 = airlineAt(g, 4);
      const before = [prestigeOfferWeight(g, c3), prestigeOfferWeight(g, c4)];
      g.company.pendingApprovals.push({ id: 'iosa', started: g.now, done: g.now + 240 * DAY, cost: 0 });
      expect([prestigeOfferWeight(g, c3), prestigeOfferWeight(g, c4)]).toEqual(before);
      g.company.pendingApprovals = [];
      g.company.approvals.push('iosa');
      expect([prestigeOfferWeight(g, c3), prestigeOfferWeight(g, c4)]).toEqual(before);
    }
  });

  it('the market draw at level 1 (stretch slot closed): no level-2 airline; national carriers ask IOSA before filing and come more often after', () => {
    const draw = (filed: boolean) => {
      const g = game('MLA', 5);
      g.company.standing = 1;
      if (filed) g.company.pendingApprovals.push({ id: 'iosa', started: g.now, done: g.now + 400 * DAY, cost: 0 });
      const by = { n: 0, l2: 0, l3: 0, iosa: 0, stretch: 0 };
      for (let i = 0; i < 300; i++) {
        g.now += DAY;
        g.company.prestige!.stretchAt = g.now;
        for (const o of Object.values(g.offers)) if (o.status === 'open') delete g.offers[o.id];
        const o = generateOffer(g, undefined, { ordinary: true, window: false, paint: false, cabin: false });
        if (!o) continue;
        by.n++;
        const c = g.clients[o.clientId];
        if (c.kind === 'airline' && c.prestige === 2) by.l2++;
        if (c.kind === 'airline' && c.prestige === 3) by.l3++;
        if (o.requirements.approvals.includes('iosa')) by.iosa++;
        if (o.stretch) by.stretch++;
      }
      return by;
    };
    const none = draw(false);
    const filed = draw(true);
    expect(none.l2).toBe(0);
    expect(filed.l2).toBe(0);
    expect(none.stretch + filed.stretch).toBe(0);
    expect(none.l3).toBeGreaterThan(0);
    expect(none.iosa / none.n).toBeLessThan(0.2);
    expect(filed.iosa).toBe(0);
    expect(filed.l3).toBeGreaterThanOrEqual(none.l3);
  });

  it('a lead the client said yes to, or a pitch answered yes, is never thinned out at the answer', () => {
    const g = game();
    const c = airlineAt(g, 3);
    for (let i = 0; i < 200; i++) {
      g.now += 61;
      const d = draft(c);
      expect(markStretch(g, d as never, true)).toBeUndefined();
      expect(d.req.approvals).toEqual(['iosa']);
    }
    // Through generateOffer, as sales.ts leadOffer (leadId) and pitchOffer (asked) ask: every offer comes.
    const g2 = game('MLA', 5);
    g2.company.standing = 1;
    g2.company.prestige = { level: 2, visibility: 0, levelAt: { 1: g2.started } };
    const km = named(g2, 'KM Malta Airlines');
    expect(km.prestige).toBe(3);
    let n = 0;
    for (let i = 0; i < 60; i++) {
      for (const o of Object.values(g2.offers)) if (o.status === 'open') delete g2.offers[o.id];
      g2.now += 37;
      const o = generateOffer(g2, 'seasonBase', { client: km.id, ...(i % 2 ? { leadId: `ld${i}` } : { asked: true }), window: false, wide: false, paint: false, cabin: false });
      if (o) {
        n++;
        expect(o.requirements.approvals).toContain('iosa');
      }
    }
    expect(n).toBe(60);
  });

  it('filed: national carriers take that (nothing asked, nothing dropped); the majors still want it held, every time', () => {
    const g = game();
    g.company.pendingApprovals.push({ id: 'iosa', started: g.now, done: g.now + 240 * DAY, cost: 0 });
    const c3 = airlineAt(g, 3);
    const c4 = airlineAt(g, 4);
    for (let i = 0; i < 50; i++) {
      g.now += 61;
      const d3 = draft(c3);
      expect(markStretch(g, d3 as never)).toBeUndefined();
      expect(d3.req.approvals).toEqual([]);
      const d4 = draft(c4);
      expect(markStretch(g, d4 as never)).toBeUndefined();
      expect(d4.req.approvals).toEqual(['iosa']);
    }
    g.company.approvals.push('iosa');
    const d4 = draft(c4);
    markStretch(g, d4 as never);
    expect(d4.req.approvals).toEqual([]);
  });

  it('a Malta newcomer\'s offers over a year: few need IOSA, and the state work comes without it', () => {
    const g = game('MLA', 9);
    let n = 0;
    let iosa = 0;
    let gov = 0;
    for (let i = 0; i < 365; i++) {
      g.now += DAY;
      for (const o of Object.values(g.offers)) if (o.status === 'open') delete g.offers[o.id];
      const o = generateOffer(g, undefined, { ordinary: true, window: false, paint: false, cabin: false });
      if (!o) continue;
      n++;
      if (o.requirements.approvals.includes('iosa')) iosa++;
      const c = g.clients[o.clientId];
      if (c.kind === 'government') {
        gov++;
        expect(o.requirements.approvals, o.title).not.toContain('iosa');
      }
    }
    expect(n).toBeGreaterThan(150);
    expect(iosa / n).toBeLessThan(0.15);
    expect(gov).toBeGreaterThan(0);
  });
});

describe('government work at every start base', () => {
  it('our own state\'s ministries call at our level from the start; another state\'s wait for the ladder', () => {
    const g = game('MLA');
    expect(prestigeOfferWeight(g, named(g, 'Maltese Ministry for Foreign Affairs'))).toBe(P.weight['0']);
    expect(prestigeOfferWeight(g, named(g, 'Armed Forces of Malta'))).toBe(P.weight['0']);
    // Its home affairs (return flights) waits for the ladder like any level-3 client.
    expect(prestigeOfferWeight(g, named(g, 'Maltese Ministry for Home Affairs'))).toBe(0);
    expect(prestigeOfferWeight(g, named(g, 'Lithuanian Ministry of Foreign Affairs'))).toBe(0);
    // A big state's level-4 ministry keeps the ladder even at home.
    const fr = game('LIS');
    const french = { ...named(fr, 'French Ministry of the Armed Forces'), id: 'frx', country: 'PT' };
    fr.clients.frx = french;
    expect(prestigeOfferWeight(fr, french)).toBe(0);
  });

  it('every start base has its foreign and defence ministry, at most level 3 (no IOSA either way)', () => {
    const g = game('LIS');
    for (const country of ['PT', 'LT', 'MT', 'ES', 'LV', 'CZ', 'BG', 'EE']) {
      const gov = Object.values(g.clients).filter((c) => c.kind === 'government' && c.country === country);
      const roles = gov.map((c) => c.name);
      expect(roles.some((n) => /Foreign/.test(n)), country).toBe(true);
      expect(roles.some((n) => /Defence|Armed Forces/.test(n)), country).toBe(true);
      for (const c of gov) if (/Foreign|Defence|Armed Forces/.test(c.name)) expect(c.prestige, c.name).toBeLessThanOrEqual(3);
    }
  });

  it('the Armed Forces of Malta rotate troops mostly to UNIFIL; Spain to Lebanon, Latvia and Djibouti', () => {
    for (const [base, home] of [['MLA', 'MT'], ['MAD', 'ES']] as const) {
      const g = game(base, 4);
      const to: Record<string, number> = {};
      for (let i = 0; i < 40; i++) {
        g.now += DAY;
        for (const o of Object.values(g.offers)) if (o.status === 'open') delete g.offers[o.id];
        const o = generateOffer(g, 'troopRotation', { window: false, paint: false, cabin: false, wide: false });
        if (!o || o.pattern.kind !== 'legs') continue;
        expect(g.clients[o.clientId].country).toBe(home);
        expect(o.requirements.approvals).not.toContain('iosa');
        to[o.pattern.legs[0].to] = (to[o.pattern.legs[0].to] ?? 0) + 1;
      }
      const own = F.HOME_MISSIONS[home].reduce((s, c) => s + (to[c] ?? 0), 0);
      const all = Object.values(to).reduce((s, x) => s + x, 0);
      expect(all).toBeGreaterThan(10);
      expect(own / all).toBeGreaterThan(0.5);
    }
  });

  it('a Frontex return flight leaves from our own state\'s airport', () => {
    const g = game('MLA');
    const fx = named(g, 'Frontex');
    const o = generateOffer(g, 'deportation', { client: fx.id, window: false, paint: false, cabin: false, wide: false });
    expect(o).not.toBeNull();
    if (o?.pattern.kind === 'legs') expect(o.pattern.legs[0].from).toBe('MLA');
    expect(o?.requirements.approvals).toEqual([]);
  });

  it('an older save\'s Frontex (level 3, never flown for) follows its seed to level 2 on load', () => {
    const g = game('MLA');
    const fx = named(g, 'Frontex');
    fx.prestige = 3;
    fx.stars = 3;
    loadPrestige(g);
    expect(fx.prestige).toBe(2);
    expect(fx.stars).toBe(2);
    // Flown for already: kept as it was.
    fx.prestige = 3;
    fx.jobs = 1;
    loadPrestige(g);
    expect(fx.prestige).toBe(3);
  });
});
