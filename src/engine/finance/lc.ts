// v0.17 letters of credit on the v0.16 credit line (UPDATE-0.17.md §K.1; lane `deals`): a lease deposit as a standby
// letter of credit uses that much of the undrawn limit, at 1.25 % a year (accrued daily, posted to bankFees at the
// month end). Grades A (every lessor) and B (mid-life and end-of-life lessors), with the line open and not frozen.
// A line that freezes or is not renewed: the lessor wants cash within 30 days. At the return the letter is released.

import { BAL } from '../core/balance';
import { cashOnly, post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { DAY, fmtDay } from '../core/time';
import type { CreditGrade, GameState, LessorId, MonthKey } from '../core/types';
import { LESSOR_BY_ID } from '../../data/lessors';
import { usd } from '../ops/util';

const LC = () => BAL.v017.lc;

/** Letters of credit out now (they lower the undrawn limit: creditView, drawCredit, covenantCheck). Pure. */
export function lcInUse(g: GameState): number {
  const lc = g.leasing?.lc;
  if (!lc) return 0;
  let s = 0;
  for (const v of Object.values(lc)) s += v;
  return s;
}

/** The undrawn limit left for a new letter of credit (0 with no open, unfrozen, renewing line). Pure. */
export function lcRoom(g: GameState): number {
  const line = g.treasury?.credit;
  if (!line || line.frozen || line.notRenewed) return 0;
  return Math.max(0, line.limit - line.drawn - lcInUse(g));
}

/** Whether a lessor takes a letter of credit from us at a grade (§C.2, §K.1). Pure. */
export function lcLessorOk(lessorId: LessorId | undefined, grade: CreditGrade): boolean {
  const who = LC().grades[grade];
  if (!who || !lessorId) return false;
  if (who === 'all') return true;
  const tier = LESSOR_BY_ID[lessorId]?.tier;
  return tier === 'midLife' || tier === 'endOfLife';
}

/** Why a letter of credit of `amount` can't be used (null: it can). Pure. */
export function lcWhy(g: GameState, lessorId: LessorId | undefined, grade: CreditGrade, amount: number): string | null {
  if (!lcLessorOk(lessorId, grade)) return grade === 'A' || grade === 'B' ? 'This lessor wants cash at rating B' : `Lessors want cash at rating ${grade}`;
  const line = g.treasury?.credit;
  if (!line) return 'Needs a credit line (Finance › The bank)';
  if (line.frozen || line.notRenewed) return 'The credit line is frozen';
  const room = lcRoom(g);
  if (room < amount) return `Only ${usd(room)} undrawn on the credit line`;
  return null;
}

/** Issues (or tops up) a letter of credit under `key` (an aircraft id, or a deal id before signing). */
export function issueLc(g: GameState, key: string, amount: number): void {
  if (!g.leasing || amount <= 0) return;
  g.leasing.lc[key] = (g.leasing.lc[key] ?? 0) + Math.round(amount);
}

/** Moves a letter of credit to another key (a deal's to its aircraft at signing). */
export function moveLc(g: GameState, from: string, to: string): number {
  const L = g.leasing;
  if (!L?.lc[from]) return 0;
  const v = L.lc[from];
  delete L.lc[from];
  L.lc[to] = (L.lc[to] ?? 0) + v;
  return v;
}

/** Releases a letter of credit (the lease returned, the deal ended). */
export function releaseLc(g: GameState, key: string): number {
  const L = g.leasing;
  if (!L?.lc[key]) return 0;
  const v = L.lc[key];
  delete L.lc[key];
  if (L.lcCashDue) delete L.lcCashDue[key];
  return v;
}

/** The letter-of-credit fees of month k (posted to bankFees at the month end; the bill and the forecast). Pure. */
export function lcFeeBill(g: GameState, k: MonthKey): number {
  void k;
  return Math.round((lcInUse(g) * LC().fee) / 12);
}

/**
 * Daily: the fee accrues; letters of leases no longer ours are released; a frozen or not-renewed line gets the
 * lessors' cash call (30 days), paid in cash at the due day (the deposit becomes cash).
 */
export function dailyLc(g: GameState): void {
  const L = g.leasing;
  if (!L) return;
  for (const key of Object.keys(L.lc)) {
    if (key.startsWith('deal')) {
      const d = L.deals.find((x) => x.id === key);
      if (!d || (d.stage !== 'committee' && d.stage !== 'conditions' && d.stage !== 'approved')) releaseLc(g, key);
      continue;
    }
    const ac = g.fleet[key];
    if (!ac || ac.ownership.kind !== 'dryLeaseIn') {
      releaseLc(g, key);
      continue;
    }
  }
  const out = lcInUse(g);
  if (!out) return;
  L.lcAccrued += (out * LC().fee) / 365;
  const line = g.treasury?.credit;
  const bad = !line || !!line.frozen || !!line.notRenewed;
  for (const key of Object.keys(L.lc)) {
    const ac = g.fleet[key];
    if (!ac || ac.ownership.kind !== 'dryLeaseIn') continue;
    const due = L.lcCashDue?.[key];
    if (bad && due === undefined) {
      (L.lcCashDue ??= {})[key] = g.now + LC().cashDays * DAY;
      pushMessage(g, {
        tone: 'warn', cat: 'finance', topic: 'market', cue: 'notice', title: `${ac.ownership.lessor} wants cash for ${ac.reg}'s deposit`,
        body: `The credit line behind the ${usd(L.lc[key])} letter of credit is ${line ? 'frozen' : 'closed'}. The lessor asks the deposit in cash by ${fmtDay(L.lcCashDue![key])}; it is taken then.`,
        ref: { kind: 'aircraft', id: ac.id }, problem: { kind: 'leaseConditions', ref: { kind: 'aircraft', id: ac.id } },
      });
    } else if (!bad && due !== undefined) delete L.lcCashDue![key];
    else if (bad && due !== undefined && due <= g.now) {
      const v = releaseLc(g, key);
      cashOnly(g, -v);
      ac.ownership.deposit = (ac.ownership.deposit ?? 0) + v;
      ac.ownership.lc = 0;
      pushMessage(g, { tone: 'info', cat: 'finance', topic: 'market', cue: null, title: `Deposit paid in cash: ${ac.reg}`, body: `${usd(v)} to ${ac.ownership.lessor} in place of the letter of credit; refunded at the return.`, ref: { kind: 'aircraft', id: ac.id } });
    }
  }
}

/** Month end (before the statement closes): the fees accrued posted to bankFees. */
export function monthlyLc(g: GameState): void {
  const L = g.leasing;
  if (!L) return;
  const fee = Math.round(L.lcAccrued);
  if (fee) post(g, 'bankFees', -fee);
  L.lcAccrued = 0;
}
