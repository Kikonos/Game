// Goals: real progress, posted once (B3). DESIGN.md §5.9.

import { describe, expect, it } from 'vitest';
import { DAY, monthKey } from '../core/time';
import type { GameState } from '../core/types';
import { acceptOffer } from '../contracts';
import { addAircraft, hamBase, leased, newGame } from '../contracts/testkit';
import { applyApproval, GOALS, newStatement } from '.';
import { checkGoals, syncGoals } from './goals';

const progress = (g: GameState, id: string) => GOALS.find((d) => d.id === id)!.progress(g);
const done = (g: GameState) => g.goals.filter((x) => x.done !== null).map((x) => x.id).sort();
const posted = (g: GameState) => g.messages.filter((m) => m.cat === 'goal').map((m) => m.title);

describe('goals', () => {
  it('has the seven v0.5 goals in the save from the start', () => {
    const g = newGame(31);
    expect(GOALS.map((d) => d.id)).toEqual(['firstContract', 'millionMonth', 'threeAircraft', 'firstWidebody', 'etops180', 'augmentedLongHaul', 'firstUlr']);
    expect(g.goals.map((x) => x.id)).toEqual(GOALS.map((d) => d.id));
    expect(g.goals.every((x) => x.done === null)).toBe(true);
    for (const d of GOALS) expect(d.progress(g)).toBeLessThan(1);
    expect(progress(g, 'threeAircraft')).toBeCloseTo(2 / 3);
    checkGoals(g);
    expect(done(g)).toEqual([]);
    // Saves from older builds get missing goals back.
    g.goals = g.goals.filter((x) => x.id !== 'firstUlr');
    syncGoals(g);
    expect(g.goals.map((x) => x.id)).toContain('firstUlr');
  });

  it('first contract, three aircraft, first widebody and a $1M month: real progress, one message each', () => {
    const g = newGame(31);
    const o = hamBase(g, g.now + 5 * DAY, 30);
    const res = acceptOffer(g, o.id, [leased(g).id]);
    if (!res.ok) throw new Error(res.error);
    expect(progress(g, 'firstContract')).toBe(1);
    const rep = g.company.reputation.reliable;
    checkGoals(g);
    expect(done(g)).toEqual(['firstContract']);
    expect(g.goals.find((x) => x.id === 'firstContract')!.done).toBe(g.now);
    expect(g.company.reputation.reliable).toBe(rep + 1);
    expect(posted(g)).toEqual(['Goal reached: First contract']);
    checkGoals(g);
    expect(posted(g)).toHaveLength(1);
    // A widebody on order counts half; on the AOC it is the third aircraft too.
    const w = addAircraft(g, 'b763');
    w.status = 'delivering';
    expect(progress(g, 'firstWidebody')).toBe(0.5);
    expect(progress(g, 'threeAircraft')).toBeCloseTo(2 / 3);
    w.status = 'available';
    expect(progress(g, 'firstWidebody')).toBe(1);
    expect(progress(g, 'threeAircraft')).toBe(1);
    // Revenue so far this month counts; a closed month over $1M completes it.
    g.finance.current.lines.acmiRevenue = 600_000;
    expect(progress(g, 'millionMonth')).toBeCloseTo(0.6);
    g.finance.history.push({ ...newStatement(monthKey(g.now) - 1, 0), lines: { acmiRevenue: 1_200_000, fuel: -900_000 }, closed: true });
    expect(progress(g, 'millionMonth')).toBe(1);
    checkGoals(g);
    expect(done(g)).toEqual(['firstContract', 'firstWidebody', 'millionMonth', 'threeAircraft']);
    expect(posted(g)).toHaveLength(4);
    expect(g.company.reputation.reliable).toBe(rep + 4);
  });

  it('ETOPS 180, augmented long haul and ULR follow approvals and flown duties', () => {
    const g = newGame(32);
    expect(progress(g, 'etops180')).toBe(0);
    expect(applyApproval(g, 'etops120').ok).toBe(true);
    expect(progress(g, 'etops180')).toBeCloseTo(0.1 * 0.4);
    g.company.pendingApprovals = [];
    g.company.approvals.push('etops120');
    expect(progress(g, 'etops180')).toBeCloseTo(0.4);
    addAircraft(g, 'b763');
    expect(applyApproval(g, 'etops180').ok).toBe(true);
    const p = g.company.pendingApprovals.find((x) => x.id === 'etops180')!;
    expect(progress(g, 'etops180')).toBeCloseTo(0.1);
    g.now = p.started + (p.done - p.started) / 2;
    expect(progress(g, 'etops180')).toBeCloseTo(0.5);
    g.company.approvals.push('etops180');
    expect(progress(g, 'etops180')).toBe(1);
    expect(progress(g, 'augmentedLongHaul')).toBe(0);
    expect(applyApproval(g, 'augmented').ok).toBe(true);
    expect(progress(g, 'augmentedLongHaul')).toBeCloseTo(0.05);
    g.stats.augmentedDuties = 1;
    expect(progress(g, 'augmentedLongHaul')).toBe(1);
    expect(progress(g, 'firstUlr')).toBe(0);
    g.stats.ulrSectors = 1;
    expect(progress(g, 'firstUlr')).toBe(1);
    checkGoals(g);
    // The 767 added for ETOPS 180 also completes "three aircraft" and "first widebody".
    expect(done(g)).toEqual(['augmentedLongHaul', 'etops180', 'firstUlr', 'firstWidebody', 'threeAircraft']);
  });
});
