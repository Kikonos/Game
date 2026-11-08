// v0.18.1 player's reports 1108: annual leave by request (an allowance a year, approved by operations by the Company's
// rules), the monthly roster (out on the 15th for the whole next month) and the legs flown kept for the calendar.

import { describe, expect, it } from 'vitest';
import { DAY, fmtDay, fromUTC, monthKey, yearOf } from '../core/time';
import type { GameState } from '../core/types';
import { advanceTo } from '../sim';
import { devRoster } from '../dev';
import { fixtureGame } from './fixtures';
import { crewCalendar } from './calendar';
import { dayIndex, midnight, offOn, pubEndDay, publishDayOf, publishedTo, rosterHorizon, rosterOutLine } from './dayPlan';
import { answerLeave, askLeave, dailyLeave, leaveBalance, leaveDaysFor, leaveEarned, leavePolicy, leaveVerdict, setLeavePolicy } from './leave';

const years = (g: GameState) => yearOf(g.now);

/** dailyLeave run day by day for `days` (leave only: the roster is not planned). */
function leaveDays(g: GameState, days: number): void {
  for (let i = 0; i < days; i++) {
    g.now += DAY;
    dailyLeave(g);
  }
}

describe('v0.18.1 annual leave allowance', () => {
  it('30 days a year at a Portuguese base, the EU 4 weeks elsewhere; pro rata in the year of joining; earned month by month', () => {
    expect(leaveDaysFor('LIS')).toBe(30);
    expect(leaveDaysFor('FRA')).toBe(28);
    const g = fixtureGame(3);
    const c = Object.values(g.crew)[0];
    const y = years(g) + 1;
    c.hired = fromUTC(y, 7, 1);
    expect(leaveBalance(g, c, y).ent).toBe(15);
    const d = Object.values(g.crew)[1];
    // Nothing is written by reading (a screen showing it changes nothing).
    expect(d.leaveYears).toBeUndefined();
    expect(leaveBalance(g, d, y).ent).toBe(30);
    expect(d.leaveYears).toBeUndefined();
    // Earned by the end of January with two months' advance: 3 months of 2.5 days.
    expect(leaveEarned(g, d, y, y * 12)).toBe(8);
    expect(leaveEarned(g, d, y, y * 12 + 11)).toBe(30);
  });
});

describe('v0.18.1 leave requests decided by the rules', () => {
  it('a year of requests: blocks of 2–14 days, never in July or August, never over the share away, never over the allowance', () => {
    const g = fixtureGame(13);
    const pol = leavePolicy(g);
    expect(pol).toEqual({ auto: true, maxShare: 0.1, blackout: [6, 7] });
    leaveDays(g, 330);
    const st = g.stats.leave!;
    expect(st.asked).toBeGreaterThan(Object.keys(g.crew).length);
    expect(st.approved).toBeGreaterThan(st.declined);
    // Every refusal by the rules is a wish (dates asked whatever the leave calendar showed).
    for (const q of g.leaveRequests!) if (q.status === 'declined') expect(q.wish, q.why).toBe(true);
    const size = new Map<string, number>();
    const away = new Map<string, number>();
    for (const c of Object.values(g.crew)) {
      for (const f of c.ratings) size.set(`${f}|${c.role}`, (size.get(`${f}|${c.role}`) ?? 0) + 1);
      for (const [y, r] of Object.entries(c.leaveYears ?? {})) expect(r.booked, `${c.id} ${y}`).toBeLessThanOrEqual(r.ent + 10);
      for (const b of c.blocks ?? []) {
        if (!b.annual) continue;
        const n = Math.round((b.to - b.from) / DAY);
        expect(n).toBeGreaterThanOrEqual(2);
        expect(n).toBeLessThanOrEqual(14);
        for (let k = dayIndex(c.base, b.from); k < dayIndex(c.base, b.to); k++) {
          expect([6, 7]).not.toContain(new Date(Date.UTC(2000, 0, 1) + k * DAY * 60_000).getUTCMonth());
          for (const f of c.ratings) away.set(`${f}|${c.role}|${k}`, (away.get(`${f}|${c.role}|${k}`) ?? 0) + 1);
        }
      }
    }
    for (const [k, n] of away) {
      const grp = k.split('|').slice(0, 2).join('|');
      expect(n, k).toBeLessThanOrEqual(Math.max(1, Math.round(0.1 * size.get(grp)!)));
    }
    // Most crew booked most of what they earned in the year (the first year runs from the start, pro rata).
    const y = yearOf(g.now) - 1;
    const booked = Object.values(g.crew).map((c) => (c.leaveYears?.[y]?.booked ?? 0) / Math.max(1, leaveBalance(g, c, y).ent));
    expect(booked.reduce((a, b) => a + b, 0) / booked.length).toBeGreaterThan(0.7);
  });

  it('by me: requests wait for the player; approve books the block, decline costs a little morale and they ask again later', () => {
    const g = fixtureGame(14);
    setLeavePolicy(g, { auto: false });
    leaveDays(g, 60);
    const open = g.leaveRequests!.filter((q) => q.status === 'pending');
    expect(open.length).toBeGreaterThan(0);
    expect(g.messages.some((m) => /new leave request/.test(m.title))).toBe(true);
    const ok = open.find((q) => leaveVerdict(g, g.crew[q.crewId], q.from, q.days, q).ok)!;
    const c = g.crew[ok.crewId];
    const before = leaveBalance(g, c, yearOf(ok.from + 720)).booked;
    expect(answerLeave(g, ok.id, true).ok).toBe(true);
    expect(c.blocks!.some((b) => b.annual && b.from === midnight(c.base, dayIndex(c.base, ok.from)))).toBe(true);
    expect(leaveBalance(g, c, yearOf(ok.from + 720)).booked).toBe(before + ok.days);
    expect(answerLeave(g, ok.id, true).ok).toBe(false);
    const no = g.leaveRequests!.find((q) => q.status === 'pending')!;
    const d = g.crew[no.crewId];
    const m0 = d.morale;
    expect(answerLeave(g, no.id, false).ok).toBe(true);
    expect(d.morale).toBeCloseTo(m0 - 1, 5);
    expect(d.leaveAskAt).toBeGreaterThan(g.now);
    expect(askLeave(g).some((q) => q.crewId === d.id)).toBe(false);
  });

  it('the rules: the peak months and the share away can be overridden by the player, the published roster cannot', () => {
    const g = fixtureGame(15);
    const c = Object.values(g.crew).find((x) => x.role === 'CC')!;
    const y = years(g) + 1;
    const july = midnight(c.base, fromUTC(y, 7, 10) / DAY);
    const v = leaveVerdict(g, c, july, 7);
    expect(v.ok).toBe(false);
    expect(v.hard).toBe(false);
    expect(v.why).toMatch(/No leave in July/);
    const now = leaveVerdict(g, c, midnight(c.base, dayIndex(c.base, g.now) + 2), 5);
    expect(now.hard).toBe(true);
    expect(now.why).toMatch(/roster is already out/);
  });
});

describe('v0.18.1 the monthly roster (out on the 15th for the whole next month)', () => {
  it('before the 15th the roster runs to the end of this month, from the 15th to the end of the next; the planner works it out from the 12th', () => {
    const k = (y: number, m: number, d: number) => fromUTC(y, m, d) / DAY;
    expect(pubEndDay('LIS', k(2028, 11, 10))).toBe(k(2028, 12, 1));
    expect(pubEndDay('LIS', k(2028, 11, 15))).toBe(k(2029, 1, 1));
    expect(pubEndDay('LIS', k(2028, 12, 31))).toBe(k(2029, 2, 1));
    const g = fixtureGame(16);
    g.now = midnight('LIS', k(2027, 3, 12)) + 60;
    expect(rosterHorizon(g)).toBe(midnight('LIS', k(2027, 5, 1)));
    expect(fmtDay(publishDayOf(g, k(2027, 5, 3)))).toBe(fmtDay(fromUTC(2027, 4, 15)));
    expect(rosterOutLine(g, fromUTC(2027, 5, 3, 12))).toBe('the May roster comes out on 15 Apr');
  });

  it('played to the 15th: the next month is published with its days off and standby; the month after reads "Roster out on 15 …"', () => {
    const g = fixtureGame(11);
    devRoster(g);
    const target = midnight('LIS', fromUTC(yearOf(g.now), 3, 16) / DAY);
    advanceTo(g, target, new Set());
    const home = g.company.homeBase;
    const next = monthKey(g.now) + 1;
    expect(monthKey(publishedTo(g) - 1)).toBe(next);
    const k0 = Math.floor(fromUTC(Math.floor(next / 12), (next % 12) + 1, 1) / DAY);
    const k1 = Math.floor(fromUTC(Math.floor((next + 1) / 12), ((next + 1) % 12) + 1, 1) / DAY);
    const crew = Object.values(g.crew).filter((c) => c.status !== 'joining' && !c.notice);
    for (const c of crew) {
      let off = 0;
      for (let k = k0; k < k1; k++) if (offOn(c, k)) off++;
      const leave = (c.blocks ?? []).some((b) => b.from < midnight(home, k1) && b.to > midnight(home, k0));
      if (!leave) expect(off, c.id).toBeGreaterThanOrEqual(7);
    }
    const c = crew[0];
    const after = crewCalendar(g, c.id, midnight(home, k1 + 3), midnight(home, k1 + 4));
    const free = after.find((b) => b.label === 'Free');
    if (free) expect(free.detail).toMatch(/^Roster out on 15 /);
  }, 120_000);
});

describe('v0.18.1 the legs flown stay on the calendar after the flights are pruned', () => {
  it('a duty flown is recorded with its flight numbers and still shows them a month later', () => {
    const g = fixtureGame(11);
    devRoster(g);
    advanceTo(g, g.now + 40 * DAY, new Set());
    const c = Object.values(g.crew).find((x) => (x.flown ?? []).some((f) => !f.pax && f.s < g.now - 20 * DAY))!;
    expect(c).toBeDefined();
    const rec = c.flown!.find((f) => !f.pax && f.s < g.now - 20 * DAY)!;
    // The flights themselves are gone (pruned a week after landing).
    expect(Object.values(g.flights).some((f) => f.no === rec.legs[0][0] && (f.atd ?? f.std) === rec.legs[0][3])).toBe(false);
    const bl = crewCalendar(g, c.id, rec.s - 60, rec.e + 60).find((b) => b.kind === 'duty' && b.start === rec.s)!;
    expect(bl.flights!.map((f) => f.no)).toEqual(rec.legs.map((l) => l[0]));
    expect(bl.flights![0].from).toBe(rec.legs[0][1]);
  }, 120_000);
});
