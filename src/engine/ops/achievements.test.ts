// v0.9 achievements (UPDATE-0.9.md §14.1): each triggers once with its message and chime, heads unlock with theirs,
// an older save is backfilled silently (one summary line), and progress reads right.

import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, type AchievementId } from '../../data/achievements';
import { takeCues } from '../core/cues';
import { clearPause } from '../core/pause';
import { DAY, monthKey } from '../core/time';
import type { GameState } from '../core/types';
import { rosterStats, v09Stats } from '../crew/dayPlan';
import { fixtureGame } from '../crew/fixtures';
import { devAddType } from '../dev';
import { achievementProgress, achievementsView, checkAchievements, loadAchievements } from './achievements';
import { announceBackfill } from './heads';
import { newStatement } from './finance';

const SET: Record<AchievementId, (g: GameState) => void> = {
  cleanSheet: (g) => { v09Stats(g).legalStreak = 25; },
  clockwork: (g) => { v09Stats(g).onTimeM = { [monthKey(g.now) - 1]: [40, 39] }; },
  outstationFix: (g) => { v09Stats(g).outstationFix = 1; },
  ninetyClean: (g) => { v09Stats(g).lastCancel = g.now - 91 * DAY; },
  fullCover: (g) => { const k = monthKey(g.now); v09Stats(g).cover = { [k - 2]: [100, 0], [k - 1]: [120, 1] }; },
  bunkTime: (g) => { v09Stats(g).restPlans = 1; },
  slipCrew: (g) => { v09Stats(g).slips = 1; },
  standby: (g) => { rosterStats(g).callOuts = 25; },
  goodPlace: (g) => { for (const c of Object.values(g.crew)) c.morale = 80; },
  cOnTime: (g) => { v09Stats(g).cOnTime = 1; },
  noOverdue: (g) => { v09Stats(g).lastOverdue = g.now - 366 * DAY; },
  fiveFlown: (g) => { g.stats.contractsDone = 5; },
  paidInTheEnd: (g) => { v09Stats(g).lateGovPaid = 1; },
  partner: (g) => { Object.values(g.clients)[0].level = 'partner'; },
  firstCall: (g) => { v09Stats(g).firstCall = 1; },
  hajj: (g) => { v09Stats(g).hajjDone = 1; },
  homeSafe: (g) => { v09Stats(g).homeSafe = 1; },
  blueIce: (g) => { v09Stats(g).antarctic = 1; },
  aroundWorld: (g) => { v09Stats(g).tourDone = 1; },
  widebody: (g) => { devAddType(g, 'a332'); },
  queen: (g) => { v09Stats(g).queenSectors = 1; },
  reliable: (g) => { g.company.reputation.reliable = 90; v09Stats(g).reliableSince = g.now - 31 * DAY; },
  cleanRecord: (g) => { g.company.reputation.clean = 80; },
  inTheBlack: (g) => {
    const y = Math.floor(monthKey(g.now) / 12) - 1;
    for (let m = 0; m < 12; m++) g.finance.history.push({ ...newStatement(y * 12 + m, 1_000_000), lines: { charterRevenue: 100_000 }, closed: true, cashEnd: 1_000_000 });
  },
  rainyDay: (g) => { g.finance.history.push({ ...newStatement(monthKey(g.now) - 1, 5_000_000), closed: true, cashEnd: 5_200_000 }); },
};

/** A fresh game with whatever it already has earned recorded silently. */
function fresh(seed: number): GameState {
  const g = fixtureGame(seed);
  g.company.reputation.reliable = Math.min(g.company.reputation.reliable, 60);
  g.company.reputation.clean = Math.min(g.company.reputation.clean, 60);
  for (const c of Object.values(g.crew)) c.morale = Math.min(c.morale, 60);
  checkAchievements(g, { silent: true, monthEnd: true });
  takeCues();
  clearPause();
  return g;
}

describe('§14.1 each achievement once', () => {
  for (const a of ACHIEVEMENTS) {
    it(`${a.id}: earned once with its message and chime${a.head ? `, unlocking ${a.head}` : ''}`, () => {
      const g = fresh(71);
      expect(g.achievements?.[a.id]).toBeUndefined();
      SET[a.id](g);
      const got = checkAchievements(g, { monthEnd: a.id === 'goodPlace' });
      expect(got).toContain(a.id);
      expect(g.achievements![a.id]).toBe(g.now);
      const msgs = g.messages.filter((m) => m.topic === 'achievement' && m.title === `Achievement: ${a.title}`);
      expect(msgs.length).toBe(1);
      expect(msgs[0].cat).toBe('goal');
      const cues = takeCues();
      expect(cues).toContain('achievement');
      if (a.head) {
        expect(g.heads![a.head].unlockedAt).toBe(g.now);
        expect(g.heads![a.head].candidates!.length).toBe(3);
        expect(g.messages.some((m) => m.topic === 'head' && m.ref?.kind === 'head' && m.ref.id === a.head && /^You've earned an? /.test(m.title))).toBe(true);
        expect(cues).toContain('headUnlocked');
      }
      // Never twice.
      expect(checkAchievements(g, { monthEnd: true })).toEqual([]);
      expect(g.messages.filter((m) => m.title === `Achievement: ${a.title}`).length).toBe(1);
      clearPause();
    });
  }

  it('goodPlace only at a month end', () => {
    const g = fresh(72);
    SET.goodPlace(g);
    expect(checkAchievements(g)).not.toContain('goodPlace');
    expect(checkAchievements(g, { monthEnd: true })).toContain('goodPlace');
  });

  it('v0.9 round 4: a clean operator earns "a year without an overdue check": the clock starts at the first revenue departure or at load', () => {
    const g = fresh(75);
    expect(achievementProgress(g, 'noOverdue')).toEqual({ have: 0, need: 365, label: '0 of 365 days' });
    // An older save: the clock starts at load (stats.v09 exists from then, so the Reliable clock can start too).
    delete g.achievements;
    delete g.stats.v09;
    g.company.reputation.reliable = 95;
    loadAchievements(g);
    expect(g.stats.v09!.lastOverdue).toBe(g.now);
    expect(g.stats.v09!.reliableSince).toBe(g.now);
    g.now += 200 * DAY;
    expect(achievementProgress(g, 'noOverdue')!.label).toBe('200 of 365 days');
    expect(checkAchievements(g)).not.toContain('noOverdue');
    g.now += 166 * DAY;
    expect(checkAchievements(g)).toContain('noOverdue');
    // A grounding resets it (maintenance.ts).
    const h = fresh(76);
    v09Stats(h).lastOverdue = h.now - 400 * DAY;
    v09Stats(h).lastOverdue = h.now;
    expect(achievementProgress(h, 'noOverdue')!.have).toBe(0);
  });

  it('v0.9 round 4: the agreed plain counts: 5 contracts of any size; 2 closed months at 98 % with at least one sector (no 100-sector bar)', () => {
    const g = fresh(77);
    g.stats.contractsDone = 4;
    expect(checkAchievements(g)).not.toContain('fiveFlown');
    g.stats.contractsDone = 5;
    expect(checkAchievements(g)).toContain('fiveFlown');
    const k = monthKey(g.now);
    v09Stats(g).cover = { [k - 2]: [90, 1], [k - 1]: [60, 0] };
    expect(achievementProgress(g, 'fullCover')).toEqual({ have: 2, need: 2, label: '2 of 2 months' });
    expect(checkAchievements(g)).toContain('fullCover');
    expect(g.heads!.crewDesk.unlockedAt).toBe(g.now);
    const h = fresh(78);
    v09Stats(h).cover = { [k - 2]: [90, 2], [k - 1]: [0, 0] };
    expect(checkAchievements(h)).not.toContain('fullCover');
  });
});

describe('§14.1 backfill and progress', () => {
  it('an older save earns silently: one summary line, no achievement messages or chimes; heads in one combined line', () => {
    const g = fixtureGame(73);
    delete g.achievements;
    for (const h of Object.values(g.heads ?? {})) h.unlockedAt = null;
    g.stats.contractsDone = 6;
    g.company.reputation.reliable = 90;
    v09Stats(g).reliableSince = g.now - 31 * DAY;
    const m0 = g.messages.length;
    takeCues();
    const got = loadAchievements(g);
    announceBackfill(g);
    expect(got).toEqual(expect.arrayContaining(['fiveFlown', 'reliable']));
    const added = g.messages.slice(0, g.messages.length - m0);
    expect(added.filter((m) => m.topic === 'achievement')).toEqual([]);
    expect(added.filter((m) => /achievements already earned$/.test(m.title)).length).toBe(1);
    expect(added.filter((m) => m.topic === 'head').length).toBe(1);
    expect(added.find((m) => m.topic === 'head')!.title).toMatch(/department heads are available$|^A department head is available/);
    expect(g.heads!.analyst.unlockedAt).toBe(g.now);
    expect(g.heads!.watch.unlockedAt).toBe(g.now);
    expect(g.heads!.analyst.hired).toBeNull();
    expect(takeCues()).not.toContain('achievement');
    // Loading again changes nothing.
    expect(loadAchievements(g)).toEqual([]);
  });

  it('progress values and the gallery view', () => {
    const g = fresh(74);
    g.stats.contractsDone = 3;
    expect(achievementProgress(g, 'fiveFlown')).toEqual({ have: 3, need: 5, label: '3 of 5 contracts' });
    rosterStats(g).callOuts = 7;
    expect(achievementProgress(g, 'standby')).toEqual({ have: 7, need: 25, label: '7 of 25 call-outs' });
    v09Stats(g).legalStreak = 18;
    expect(achievementProgress(g, 'cleanSheet')!.label).toBe('18 of 25 sectors');
    const v = achievementsView(g);
    // v0.12.1 25 with Around the world.
    expect(v.length).toBe(25);
    expect(v.find((x) => x.id === 'fiveFlown')!.progress!.have).toBe(3);
    SET.fiveFlown(g);
    checkAchievements(g);
    const after = achievementsView(g).find((x) => x.id === 'fiveFlown')!;
    expect(after.at).toBe(g.now);
    expect(after.progress).toBeNull();
    expect(after.head).toBe('analyst');
  });
});
