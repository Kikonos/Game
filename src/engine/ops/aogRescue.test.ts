// v0.25.1 (ops-aog-rescue) a long AOG at an outstation: the leg that brings the passengers home is rescued by
// default (our spare ferries in, or a rival flies it), not held for days behind the repair.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { Aircraft, Flight, GameState, Minute } from '../core/types';
import { acceptOffer } from '../contracts';
import { leased, legsOffer, newGame, owned } from '../contracts/testkit';
import { advanceTo } from '../sim';
import { aogDecision, resolveDecision } from './events';
import { startAog } from './maintenance';

const skip = (g: GameState, t: Minute) => advanceTo(g, t, new Set());

/** A two-leg charter home–PMI–home; the aircraft at the gate in Palma for the return, AOG for `hours`. */
function strandedAt(hours: number, seed = 21): { g: GameState; ac: Aircraft; ret: Flight } {
  const g = newGame(seed);
  const ac = leased(g);
  const home = g.company.homeBase;
  const t0 = Math.floor(g.now / DAY) * DAY + 3 * DAY;
  const o = legsOffer(g, [[home, 'PMI', t0 + 8 * 60], ['PMI', home, t0 + DAY + 12 * 60]], 150);
  o.broker = undefined;
  const r = acceptOffer(g, o.id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  const ret = Object.values(g.flights).find((f) => f.contractId === r.data!.contractId && f.from === 'PMI')!;
  skip(g, ret.std - 2);
  expect(ac.at).toBe('PMI');
  g.decisions.length = 0;
  startAog(g, ac, ret);
  const m = g.maintenance[ac.maintId!];
  // The fault drawn is the RNG's: fix the repair time and ask again.
  m.end = g.now + hours * 60;
  g.decisions.length = 0;
  aogDecision(g, ac, ret, m);
  return { g, ac, ret };
}

const aogCard = (g: GameState) => g.decisions.find((d) => d.kind === 'aog')!;

describe('AOG rescue (ops-aog-rescue)', () => {
  it('a repair of a few hours: the return waits, no rescue', () => {
    const { g } = strandedAt(8);
    const d = aogCard(g);
    expect(d.data!.rescue).toBeUndefined();
    expect(['courier', 'team']).toContain(d.defaultOption);
    expect(d.options.find((o) => o.id === 'courier')!.chips!.some((c) => /h late$/.test(c))).toBe(false);
  });

  it('a tug-damage repair of 80 h with a spare at base: the spare ferries in, its cost on the card', () => {
    const { g, ret } = strandedAt(80);
    const spare = owned(g);
    const d = aogCard(g);
    expect(d.options.find((o) => o.id === 'courier')!.chips!.some((c) => /^Up to \d+ h late$/.test(c))).toBe(true);
    const swap = d.options.find((o) => o.id === 'swap')!;
    expect(swap.label).toContain(spare.reg);
    expect(swap.chips!.some((c) => /^−\$/.test(c))).toBe(true);
    expect(d.defaultOption).toBe('swap');
    expect(d.data!.rescue).toBe('swap');
    expect(d.body).toMatch(new RegExp(`${ret.no} leaves \\d+ h late: ${spare.reg} can fly it`));
    expect(resolveDecision(g, d.id, d.defaultOption).ok).toBe(true);
    expect(ret.aircraftId).toBe(spare.id);
    expect(ret.std - (ret.schedStd ?? ret.std)).toBeLessThanOrEqual(BAL.aogRescueMin);
  });

  it('no spare free: another operator flies the return within the day', () => {
    const g0 = strandedAt(80);
    const { g, ret } = g0;
    // Ask again with the spare away in maintenance.
    owned(g).status = 'maintenance';
    g.decisions.length = 0;
    aogDecision(g, g0.ac, ret, g.maintenance[g0.ac.maintId!]);
    const d = aogCard(g);
    expect(d.defaultOption).toBe('subcharter');
    expect(d.data!.rescue).toBe('subcharter');
    expect(resolveDecision(g, d.id, 'subcharter').ok).toBe(true);
    expect(ret.operatedBy).toBe(d.data!.rivalId);
    expect(ret.std - (ret.schedStd ?? ret.std)).toBeLessThanOrEqual(BAL.aogRescueMin);
  });

  it('unanswered, the card expires into the rescue', () => {
    const { g, ret } = strandedAt(80);
    const d = aogCard(g);
    skip(g, d.expires + 1);
    expect(g.decisions).not.toContain(d);
    expect(ret.aircraftId).toBe(owned(g).id);
  });
});
