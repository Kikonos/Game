// v0.25 r2 milestones: round numbers and anniversaries, one Inbox note each, none for what an older save had passed.
import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import { createGame } from '../newGame';
import { dailyMilestones, loadMilestones, passedMilestones } from './milestones';

const livery = { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' as const };
const game = () => createGame({ name: 'Blue Airlines', code: 'BL', livery, base: 'LIS', seed: 3 });

describe('v0.25 r2 milestones', () => {
  it('a new game counts passengers from the start and has passed nothing', () => {
    const g = game();
    expect(g.stats.paxFlown).toBe(0);
    expect(g.stats.milestones).toEqual([]);
  });

  it('one note per round number passed, never twice', () => {
    const g = game();
    const before = g.messages.length;
    g.stats.legs = 1_000;
    g.stats.paxFlown = 12_000;
    dailyMilestones(g);
    const got = g.messages.slice(0, g.messages.length - before).map((m) => m.title);
    expect(got).toContain('Our 1,000th revenue flight');
    expect(got).toContain('Our 100th revenue flight');
    expect(got).toContain('10,000 passengers');
    const n = g.messages.length;
    dailyMilestones(g);
    expect(g.messages.length).toBe(n);
  });

  it('an anniversary a year after the start', () => {
    const g = game();
    g.now = g.started + 366 * DAY;
    dailyMilestones(g);
    expect(g.messages[0].title).toBe('Blue Airlines: one year flying');
    expect(g.messages[0].body).toMatch(/^Our first anniversary\. Since /);
  });

  it('an older save marks what it had passed silently and has no passenger count', () => {
    const g = game();
    delete g.stats.paxFlown;
    delete g.stats.milestones;
    g.stats.legs = 3_000;
    g.now = g.started + 800 * DAY;
    loadMilestones(g, false);
    expect(g.stats.paxFlown).toBeUndefined();
    expect(g.stats.milestones).toEqual(passedMilestones(g));
    const n = g.messages.length;
    dailyMilestones(g);
    expect(g.messages.length).toBe(n);
  });
});
