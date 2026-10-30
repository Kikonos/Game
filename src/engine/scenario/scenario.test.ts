// v0.12 start setups and Scenarios mode: every setup and every scenario builds a valid game (the invariant checker over
// a few played days), goals and stars are scored as defined, a scenario game saves and loads and plays on identically,
// and the normal game is untouched (no scenario state, the classic setup is today's start).

import { describe, expect, it } from 'vitest';
import { createChecker } from '../../../scripts/invariants';
import { START_SETUPS } from '../../data/setups';
import { breathe } from '../../test/breathe';
import { acceptOffer, feasibilityAll } from '../contracts';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { createGame, setupCrew } from '../newGame';
import { resolveDecision } from '../ops';
import { saleQuote } from '../ops/sale';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { createScenario, finish, METRICS, scenarioDef, scenarioOutcome, SCENARIOS, scenarioStart, scenarioView, scoreNow, starsFor } from '.';

const livery = { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' as const };
const json = (g: GameState) => JSON.stringify((JSON.parse(serialize(g)) as { state: unknown }).state);

/** A simple player (crewAudit.test's): decision defaults, the best workable offer. */
function play(g: GameState): void {
  for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
  const open = Object.values(g.offers).filter((o) => o.status === 'open' && o.start >= g.now && g.now < o.expires).sort((a, b) => b.estValue - a.estValue || (a.id < b.id ? -1 : 1));
  for (const o of open.slice(0, 3)) {
    const r = feasibilityAll(g, o.id).find((x) => (x.level === 'ok' || x.level === 'warn') && x.estMargin > 0);
    if (r && acceptOffer(g, o.id, [r.aircraftId]).ok) return;
  }
}

/** Plays `days` in 2-hour steps under the invariant checker; its errors. */
async function checked(g: GameState, days: number): Promise<string[]> {
  const inv = createChecker();
  const end = g.now + days * DAY;
  let next = g.now;
  inv.observe(g);
  while (g.now < end && !g.gameOver) {
    if (g.now >= next) {
      play(g);
      next = g.now + 6 * 60;
    }
    advanceTo(g, Math.min(end, g.now + 120), new Set());
    inv.observe(g);
    await breathe();
  }
  inv.finish(g);
  return inv.errors.map((e) => `${e.code}: ${e.text}`);
}

describe('start setups', () => {
  it.each(START_SETUPS.map((s) => [s.id, s] as const))('%s builds a valid company and plays a fortnight cleanly', async (_id, s) => {
    const g = createGame({ name: 'Test Air', code: 'TA', livery, base: 'VNO', seed: 5, setup: s.id });
    expect(g.company.cash).toBe(s.cash);
    expect(g.finance.current.cashStart ?? s.cash).toBe(s.cash);
    const fleet = Object.values(g.fleet);
    expect(fleet.map((a) => a.typeId).sort()).toEqual(s.fleet.map((a) => a.typeId).sort());
    for (const a of fleet) {
      expect(a.at).toBe('VNO');
      expect(a.reg.startsWith('LY-')).toBe(true);
      // Short-haul narrowbodies only.
      expect(['a320ceo', 'a320neo', 'a321ceo', 'b738']).toContain(a.typeId);
      if (a.ownership.kind === 'dryLeaseIn') expect(a.ownership.rentPerMonth).toBeGreaterThan(100_000);
      else expect(a.ownership.bookValue).toBeGreaterThan(1_000_000);
    }
    // Crew sized as the Planning view counts sets: every family the fleet flies, `sets` sets per aircraft.
    const crew = setupCrew(s);
    expect(Object.keys(g.crew).length).toBe(crew.total);
    for (const fam of new Set(fleet.map((a) => (a.typeId === 'b738' ? 'B737' : 'A320')))) {
      const rated = Object.values(g.crew).filter((c) => c.ratings.includes(fam as 'A320'));
      expect(rated.filter((c) => c.role === 'CPT').length).toBe(s.sets * fleet.filter((a) => (a.typeId === 'b738' ? 'B737' : 'A320') === fam).length);
    }
    expect(Object.keys(g.offers).length).toBeGreaterThanOrEqual(2);
    expect(await checked(g, 14)).toEqual([]);
  }, 120_000);

  it('the classic setup is the normal start, unchanged (no setup or scenario state)', () => {
    const a = createGame({ name: 'Test Air', code: 'TA', livery, base: 'LIS', seed: 3 });
    const b = createGame({ name: 'Test Air', code: 'TA', livery, base: 'LIS', seed: 3, setup: 'classic' });
    expect(json(a)).toBe(json(b));
    expect(a.scenario).toBe('startup');
    expect(a.scen).toBeUndefined();
    expect(a.setup).toBeUndefined();
    expect(Object.keys(a.crew).length).toBe(60);
  });
});

describe('scenarios', () => {
  it.each(SCENARIOS.map((d) => [d.id] as const))('%s builds its own game and plays a few days cleanly', async (id) => {
    const d = SCENARIOS.find((x) => x.id === id)!;
    const g = createScenario(id);
    expect(g.scenario).toBe(id);
    expect(g.scen?.id).toBe(id);
    expect(g.started).toBe(scenarioStart(d));
    expect(g.scen!.end).toBe(g.started + d.days * DAY);
    expect(g.company.homeBase).toBe(d.company.base);
    expect(g.company.name).toBe(d.company.name);
    expect(Object.keys(g.fleet)).toHaveLength(d.fleet.length);
    for (const a of d.approvals ?? []) expect(g.company.approvals).toContain(a);
    // The scenario's note is in the Inbox; the goals view reads.
    expect(g.messages.some((m) => m.title === `Scenario: ${d.name}`)).toBe(true);
    const v = scenarioView(g)!;
    expect(v.def.id).toBe(id);
    expect(v.result).toBeNull();
    // Deterministic: the same scenario twice is the same game.
    expect(json(createScenario(id))).toBe(json(g));
    expect(await checked(g, Math.min(6, d.days - 1))).toEqual([]);
    expect(g.gameOver).toBeNull();
  }, 120_000);

  it('signs the starting contracts each story needs', () => {
    const kinds = (id: string) => Object.values(createScenario(id).contracts).map((c) => c.archetype).sort();
    expect(kinds('hajjAirlift')).toEqual(['hajj', 'hajj']);
    expect(kinds('summerSurge')).toEqual(['seasonBase']);
    expect(kinds('crewCrisis')).toEqual(['seasonBase', 'seasonBase', 'seasonBase']);
    expect(kinds('ashCloud')).toEqual(['seasonBase', 'seasonBase']);
    expect(kinds('southernWinter')).toEqual(['seasonBase']);
    // Long-Haul Debut: the A330 comes without crews; the applications are filed.
    const lh = createScenario('longHaulDebut');
    expect(Object.values(lh.crew).some((c) => c.ratings.includes('A330/340'))).toBe(false);
    expect(lh.company.pendingApprovals.map((p) => p.id).sort()).toEqual(['etops120', 'widebody']);
    // Cash Crunch: overdrawn, money owed to us, no rescue, the A320s are the bank's.
    const cc = createScenario('cashCrunch');
    expect(cc.company.cash).toBeLessThan(0);
    expect(cc.finance.receivables.filter((r) => r.paid === null).length).toBe(2);
    const owned = Object.values(cc.fleet).find((a) => a.ownership.kind === 'owned')!;
    expect(saleQuote(cc, owned.id).ok).toBe(false);
    // Crew Crisis: about half the crew a full roster needs.
    const cr = createScenario('crewCrisis');
    expect(Object.values(cr.crew).filter((c) => c.role === 'CPT').length).toBeLessThanOrEqual(8);
  });

  it('Ash Cloud closes northern Europe on day 4 and stranded passengers call', () => {
    const g = createScenario('ashCloud');
    advanceTo(g, g.started + 5 * DAY + 60, new Set());
    const ash = (g.world?.events ?? []).find((e) => e.tpl === 'ashKatla');
    expect(ash?.closed).toBe(true);
    expect(Object.values(g.offers).some((o) => o.archetype === 'repatriation')).toBe(true);
  });

  it('scores stars on the thresholds, with conditions and early failures', () => {
    const g = createScenario('aogFirefighter');
    const d = scenarioDef(g)!;
    expect(starsFor(d, d.stars[0] - 1)).toBe(0);
    expect(starsFor(d, d.stars[0])).toBe(1);
    expect(starsFor(d, d.stars[1])).toBe(2);
    expect(starsFor(d, d.stars[2] * 2)).toBe(3);
    // Reliability is a condition: legs cancelled below 95 % → no stars whatever the revenue.
    g.scen!.tally.legs = 90;
    g.scen!.tally.cxl = 10;
    g.finance.current.lines.acmiRevenue = 99_000_000;
    expect(METRICS.reliability.value(g)).toBe(90);
    let r = scoreNow(g);
    expect(r.stars).toBe(0);
    expect(r.failed).toMatch(/Missed/);
    g.scen!.tally.cxl = 2;
    r = scoreNow(g);
    expect(r.stars).toBe(3);
    // The end: the result, the clock stops, the outcome reads it.
    finish(g, d);
    expect(g.gameOver).not.toBeNull();
    expect(scenarioOutcome(g)?.stars).toBe(3);
    // A company that fails: no stars, its reason.
    const h = createScenario('summerSurge');
    h.gameOver = { t: h.now, reason: 'Insolvent' };
    expect(scenarioOutcome(h)).toMatchObject({ stars: 0, failed: 'Insolvent' });
  });

  it('ends on its last day with a result', () => {
    const g = createScenario('cupFinal');
    advanceTo(g, g.scen!.end + DAY, new Set());
    expect(g.scen!.result).toBeDefined();
    expect(g.gameOver?.t).toBe(g.scen!.end);
    expect(g.messages.some((m) => m.topic === 'scenario' && m.title.startsWith('Cup Final Week:'))).toBe(true);
  });

  it('saves and loads: a loaded scenario plays on identically', () => {
    const a = createScenario('humanitarian');
    advanceTo(a, a.now + 3 * DAY + 137, new Set());
    const b = deserialize(serialize(a));
    expect(b.scen).toEqual(a.scen);
    advanceTo(a, a.now + 4 * DAY, new Set());
    advanceTo(b, b.now + 4 * DAY, new Set());
    expect(json(b)).toBe(json(a));
    expect(a.scen!.fired.length).toBeGreaterThan(0);
  });

  it('an older save gets its scenario field back (??=)', () => {
    const g = createGame({ name: 'Test Air', code: 'TA', livery, base: 'LIS', seed: 2 });
    const raw = JSON.parse(serialize(g)) as { state: Partial<GameState> };
    delete raw.state.scenario;
    const h = deserialize(JSON.stringify(raw));
    expect(h.scenario).toBe('startup');
    expect(h.scen).toBeUndefined();
  });
});
