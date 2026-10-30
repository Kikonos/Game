// v0.12.1 day-off buy-back (round D, the player's ask: "I pulled the missing crew member out of their days off and it
// was fine; I wish it had sorted itself out"). A crew member whose ONLY blockers on a trip are day-off rules (a published
// day off, the month's minimum days off) may be asked to work the day: paid twice a day's pay (salaries), the day
// repaid on a free day of the same month (dayPlan.ts buyBackDays, takeOffDays 'bought'), at most once a month a person.
// The company's and the crew agreement's rules are bought, never the law: the EASA rest and recovery rules
// (ORO.FTL.235(d): 36 h including 2 local nights at most 168 h apart) stay hard limits (every other issue of the plan
// must be acceptable), and a month or year that would fall under its legal floor (7 days off a month, 96 a year) even
// with the day repaid is never bought. Settings › Buy back days off: automatically (the roster does it, after the free
// options and before a late ticket, a jet or a cancellation), ask me (Crew Control offers it), never.

import { BAL } from '../core/balance';
import { fmtTime } from '../core/time';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import type { BuyBackMode, CrewMember, GameState, Ref } from '../core/types';
import { usd } from '../ops/util';
import { acceptable, type CrewPlan } from './check';
import { buyBackDays, dayLabel, rosterStats, takeOffDays, type BuyBackDays } from './dayPlan';
import { crewName } from './generate';
import type { Seg } from './rules';

const R = () => BAL.v09.roster.buyBack;

/** Settings › Buy back days off (old saves: automatically). */
export const buyBackMode = (g: GameState): BuyBackMode => g.company.policies.buyBack ?? 'auto';

/** A day's pay at the buy-back rate (salary / 21 working days × 2). */
export const buyBackPay = (c: CrewMember): number => Math.round((R().pay * c.salary) / 21);

export interface BuyBack extends BuyBackDays {
  crewId: string;
  /** What it costs (the paid days at the buy-back rate). */
  cost: number;
}

/**
 * Whether crew member c could take the trip planned in `plan` by working a day off: the plan's only blockers are
 * 'daysOff' issues (everything else acceptable to the roster: no rest, FDP, recovery or cumulative limit is touched),
 * the work reports within 72 h, c's morale is 35 or more and they are not joining or leaving, no day was bought from
 * them this month yet, and the month and year keep their legal days off with the day repaid. `base`: c's timeline
 * without the trip. Null when not. Pure.
 */
export function buyBackFor(g: GameState, c: CrewMember, plan: CrewPlan, base: Seg[]): BuyBack | null {
  if (!plan.issues.some((i) => i.code === 'daysOff' && i.level !== 'legal')) return null;
  if (!acceptable(g, { ...plan, issues: plan.issues.filter((i) => i.code !== 'daysOff') })) return null;
  if (c.morale < R().minMorale || c.status === 'joining' || c.notice) return null;
  const work = plan.segs.filter((x) => x.kind !== 'log');
  if (!work.length || work[0].start > g.now + R().horizonH * 60) return null;
  const v = buyBackDays(g, c, base, plan.segs);
  if (!v || c.boughtOff?.includes(v.month)) return null;
  return { crewId: c.id, ...v, cost: buyBackPay(c) * v.paid };
}

/** Runtime: who had a day bought back at which minute (a fix's change lines say so; never saved). */
const recent = new WeakMap<GameState, Map<string, number>>();
/** Whether c's day off was bought back this minute (Crew Control's lines). */
export const boughtNow = (g: GameState, crewId: string): boolean => recent.get(g)?.get(crewId) === g.now;

/** 'Wed 27 Oct' and the repaid days in a sentence: 'António gets Fri 29 Oct off instead.' */
export function repayText(c: CrewMember, bb: BuyBackDays): string {
  const to = bb.repay.map(([, k]) => k).filter((k): k is number => k !== null);
  const owed = bb.repay.length - to.length;
  const parts: string[] = [];
  if (to.length) parts.push(`${c.first} gets ${to.map(dayLabel).join(' and ')} off instead`);
  if (owed) parts.push(`${to.length ? 'and is' : `${c.first} is`} owed ${owed === 1 ? 'a day' : `${owed} days`} off`);
  return parts.length ? `${parts.join(' ')}.` : '';
}

/**
 * Applies a buy-back once c is placed on the work in `segs`: the days off go and are repaid (takeOffDays 'bought'), the
 * pay is booked (salaries), the month is marked, and one notice says who works which day for what (its chime with it).
 * `what`: the flight number. `quiet`: the caller tells the player itself (a Crew Control fix's own message).
 */
export function applyBuyBack(g: GameState, c: CrewMember, segs: Seg[], bb: BuyBack, what: string, ref?: Ref, quiet = false): void {
  takeOffDays(g, c, segs, 'bought');
  let m = recent.get(g);
  if (!m) recent.set(g, (m = new Map()));
  m.set(c.id, g.now);
  c.boughtOff = [...(c.boughtOff ?? []).filter((m) => m > bb.month - 13), bb.month];
  post(g, 'salaries', -bb.cost);
  const st = rosterStats(g);
  st.offBoughtPaid = (st.offBoughtPaid ?? 0) + bb.cost;
  if (quiet) return;
  pushMessage(g, {
    tone: 'info', cat: 'crew', title: buyBackTitle(c, bb, what),
    body: `Paid at twice a day's pay. ${repayText(c, bb)}`.trim(),
    ...(ref ? { ref } : {}),
  });
}

/**
 * 'António Almeida works the day off on Wed 27 Oct for BLU1570 (+$412)'; a report before 06:00 the morning after only
 * cuts that day off short: 'Henrique Castro ends the day off on Tue 26 Oct early for BLU1570, reporting 02:00 UTC
 * (03:00 LIS) (+$1,010)'.
 */
export const buyBackTitle = (c: CrewMember, bb: BuyBack, what: string): string => bb.clip
  ? `${crewName(c)} ends the day off on ${dayLabel(bb.worked)} early for ${what}, reporting ${fmtTime(bb.start)} UTC (${fmtTime(bb.start, c.base)} ${c.base}) (+${usd(bb.cost)})`
  : `${crewName(c)} works the day off on ${dayLabel(bb.worked)} for ${what} (+${usd(bb.cost)})`;
