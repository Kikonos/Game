// v0.17 the lessor rating (UPDATE-0.17.md §C; lane `deals`). `lessorRating` is real from step 0: a pure read that
// nothing acts on yet. (The design calls it `creditView`; that name is engine/finance's bank credit line.)
// Exposure, caps and the leaseback lessor pick (§C.3, §K.2) are step-0 stubs.

import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { CreditGrade, GameState, LessorId, LessorRating } from '../core/types';
import { monthEndBill } from '../ops/finance';
import { monthKey } from '../core/time';
import { playerStars } from '../contracts/prestige';

const MONTH = 30.44 * DAY;
const K = () => BAL.v017.credit;

/** Points of the highest band reached: [[12, 8], [24, 14]] at 30 → 14. */
const band = (x: number, bands: readonly (readonly [number, number])[]): number => {
  let p = 0;
  for (const [at, pts] of bands) if (x >= at) p = pts;
  return p;
};

/** The grade of a score (§C.1). Pure. */
export function gradeOf(score: number): CreditGrade {
  const G = K().grades;
  return score >= G.A ? 'A' : score >= G.B ? 'B' : score >= G.C ? 'C' : 'D';
}

/** Our lessor rating now, with its parts (§C.1). Pure. */
export function lessorRating(g: GameState): LessorRating {
  const R = K();
  const parts: { label: string; pts: number }[] = [];
  const add = (label: string, pts: number) => parts.push({ label, pts });
  const co = g.company;
  const months = Math.floor((g.now - (co.aocAt ?? g.started)) / MONTH);
  add(`${months} months on the AOC`, band(months, R.aocMonths));
  const fleet = Object.values(g.fleet).filter((a) => a.status !== 'delivering').length;
  add(`${fleet} aircraft on the AOC`, band(fleet, R.fleet));
  const line = g.treasury?.credit;
  const undrawn = line && !line.frozen ? Math.max(0, line.limit - line.drawn) : 0;
  if (co.cash < 0) add('Cash below zero', R.cover.negative);
  else {
    const bill = monthEndBill(g, monthKey(g.now) + 1).total;
    const cover = bill > 0 ? (co.cash + undrawn) / bill : 99;
    add(`Cash cover ${cover >= 10 ? '10+' : cover.toFixed(1)} months`, band(cover, R.cover.bands));
  }
  const closed = g.finance.history.filter((s) => s.closed).slice(-6);
  if (closed.length < R.profit.minStatements) add('Fewer than 3 months of accounts', 0);
  else {
    let rev = 0;
    let profit = 0;
    for (const s of closed) {
      for (const [cat, v] of Object.entries(s.lines)) {
        if (v === undefined) continue;
        profit += v;
        if (v > 0 && /Revenue$|^leaseIncome$|^interestIncome$/.test(cat)) rev += v;
      }
      // Approval fees are one-offs: added back.
      profit -= s.lines.approvals ?? 0;
    }
    const margin = rev > 0 ? profit / rev : 0;
    add(profit < 0 ? 'A loss over the last six months' : margin >= R.profit.margin[0] ? `Profitable, ${Math.round(margin * 100)} % margin` : 'Profitable', profit < 0 ? R.profit.loss : margin >= R.profit.margin[0] ? R.profit.margin[1] : R.profit.profit);
  }
  const d = g.treasury?.distress;
  if (d?.rentDeferrals.some((x) => !x.done)) add('Rent deferral running', R.distress.deferral);
  if (d?.plans.some((x) => !x.done)) add('Creditor payment plan', R.distress.plan);
  if (d?.investor && !d.investor.released) add("Investor's board seated", R.distress.investor);
  if (line?.frozen) add('Credit line frozen', R.distress.frozen);
  else if (line && line.breaches > 0) add('Covenant breach', R.distress.breach);
  const stars = playerStars(g);
  add(`${stars}★ clients`, R.stars[stars] ?? 0);
  if (co.approvals.includes('iosa')) add('IOSA held', R.iosa);
  const rel = co.reputation.reliable;
  if (rel >= R.reliableHigh[0]) add('Reliable operation', R.reliableHigh[1]);
  else if (rel <= R.reliableLow[0]) add('Unreliable operation', R.reliableLow[1]);
  const returns = g.stats.leaseReturns ?? 0;
  if (returns) add(`${returns} lease${returns > 1 ? 's' : ''} handed back properly`, Math.min(R.returns.max, returns * R.returns.per));
  const score = Math.max(0, Math.min(100, R.base + parts.reduce((s, p) => s + p.pts, 0)));
  // A restructuring running, or its label standing, caps the grade at D (§C.1).
  const per = d?.per;
  const capped = !!per && per.labelUntil > g.now;
  return { score, grade: capped ? 'D' : gradeOf(score), parts, at: g.now };
}

/** Aircraft we lease from a lessor now (dry leases in and leasebacks, delivering ones, deals in progress) (§C.3). Step 0: 0. Pure. */
export function exposureOf(g: GameState, lessorId: LessorId): { all: number; wide: number } {
  void g;
  void lessorId;
  return { all: 0, wide: 0 };
}

/** Whether a lessor would take our aircraft in a sale and leaseback (§K.2). Step 0: always. Pure. */
export function leasebackLessorOk(g: GameState, lessorName: string): boolean {
  void g;
  void lessorName;
  return true;
}

/**
 * The lessor of a sale and leaseback (§K.2): the stable pick when it is willing, else the next willing one of `list`;
 * `why` when none is. Step 0: the stable pick, no reason. Pure.
 */
export function leasebackLessorFor(g: GameState, preferred: string, list: readonly string[]): { lessor: string; why: string | null } {
  void list;
  return { lessor: preferred, why: leasebackLessorOk(g, preferred) ? null : `${preferred} won't take it` };
}
