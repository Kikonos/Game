// Goals: real progress, posted once (B3). DESIGN.md §5.9.

import { describe, expect, it } from 'vitest';
import { DAY, monthKey } from '../core/time';
import type { GameState } from '../core/types';
import { acceptOffer } from '../contracts';
import { addAircraft, hamBase, leased, newGame } from '../contracts/testkit';
import { applyApproval, GOALS, newStatement, setUpEtopsMx } from '.';
import { checkGoals, syncGoals } from './goals';

const progress = (g: GameState, id: string) => GOALS.find((d) => d.id === id)!.progress(g);
const done = (g: GameState) => g.goals.filter((x) => x.done !== null).map((x) => x.id).sort();
const posted = (g: GameState) => g.messages.filter((m) => m.cat === 'goal').map((m) => m.title);

describe('goals', () => {
  it('has the seven v0.5 goals and the v0.7 ladder goals, in ladder order, in the save from the start', () => {
    const g = newGame(31);
    expect(GOALS.map((d) => d.id)).toEqual(['firstContract', 'millionMonth', 'threeAircraft', 'etops120', 'widebodyOps', 'firstWidebody', 'etops180', 'augmentedLongHaul', 'first777', 'etops240', 'ulrApproved', 'firstUlr']);
    expect(g.goals.map((x) => x.id)).toEqual(GOALS.map((d) => d.id));
    expect(g.goals.every((x) => x.done === null)).toBe(true);
    for (const d of GOALS) expect(d.progress(g)).toBeLessThan(1);
    expect(progress(g, 'threeAircraft')).toBeCloseTo(2 / 3);
    checkGoals(g);
    expect(done(g)).toEqual([]);
    // Saves from older builds get missing goals back.
    g.goals = g.goals.filter((x) => x.id !== 'firstUlr' && x.id !== 'etops120').reverse();
    syncGoals(g);
    expect(g.goals.map((x) => x.id)).toEqual(GOALS.map((d) => d.id));
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
    // v0.10.2 the ETOPS maintenance programme under way and a technical dispatch record to judge.
    expect(setUpEtopsMx(g).ok).toBe(true);
    g.stats.techDisp = { [Math.floor(g.now / DAY)]: [100, 0] };
    expect(applyApproval(g, 'etops120').ok).toBe(true);
    expect(progress(g, 'etops180')).toBeCloseTo(0.1 * 0.4);
    expect(progress(g, 'etops120')).toBeCloseTo(0.1);
    g.company.pendingApprovals = [];
    g.company.approvals.push('etops120');
    expect(progress(g, 'etops180')).toBeCloseTo(0.4);
    g.company.pendingApprovals.push({ id: 'etops180', started: g.now, done: g.now + 150 * DAY, cost: 0 });
    expect(progress(g, 'etops180')).toBeCloseTo(0.1);
    g.now += 75 * DAY;
    expect(progress(g, 'etops180')).toBeCloseTo(0.5);
    g.company.approvals.push('etops180');
    expect(progress(g, 'etops180')).toBe(1);
    expect(progress(g, 'augmentedLongHaul')).toBe(0);
    g.company.pendingApprovals = [{ id: 'augmented', started: g.now, done: g.now + 90 * DAY, cost: 0 }];
    expect(progress(g, 'augmentedLongHaul')).toBeCloseTo(0.05);
    g.stats.augmentedDuties = 1;
    expect(progress(g, 'augmentedLongHaul')).toBe(1);
    expect(progress(g, 'firstUlr')).toBe(0);
    g.stats.ulrSectors = 1;
    expect(progress(g, 'firstUlr')).toBe(1);
    addAircraft(g, 'b763');
    checkGoals(g);
    expect(done(g)).toEqual(['augmentedLongHaul', 'etops120', 'etops180', 'firstUlr', 'firstWidebody', 'threeAircraft']);
  });

  it('ladder goals post once with topic ladder (the celebration card), naming what opened; a 777 delivering counts half', () => {
    const g = newGame(41);
    const t7 = addAircraft(g, 'b77w');
    t7.status = 'delivering';
    expect(progress(g, 'first777')).toBe(0.5);
    t7.status = 'available';
    expect(progress(g, 'first777')).toBe(1);
    checkGoals(g);
    checkGoals(g);
    const ladder = g.messages.filter((m) => m.topic === 'ladder');
    expect(ladder.map((m) => m.title).sort()).toEqual(['Goal reached: First widebody', 'Goal reached: Triple Seven']);
    const m = ladder.find((x) => x.title === 'Goal reached: Triple Seven')!;
    expect(m.ref).toEqual({ kind: 'aircraft', id: t7.id });
    expect(m.body).toMatch(/Next: ETOPS 240/);
    // Plain goals stay plain.
    expect(g.messages.find((x) => x.title === 'Goal reached: Three aircraft')?.topic).toBeUndefined();
  });
});
