// v0.16 review: the bank's money has to add up when the rest of the game touches a financed thing: a frozen line
// that was cured is renewed as the message promised; a client's administration settles a factored invoice with the
// bank (recourse: the advance goes back; without: the bank's loss and the bank's claim); a late-payment decision cannot
// sell to a factor an invoice the bank already holds.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { invoice } from '../core/ledger';
import { DAY } from '../core/time';
import type { GameState, MonthStatement } from '../core/types';
import { newGame } from '../contracts/testkit';
import { newStatement } from '../ops/finance';
import { latePaymentDecision } from '../ops/events';
import { resolveDecision } from '../ops';
import { CRISIS, dailyCrises, startCrisis } from '../commercial/crises';
import { clientByName } from '../commercial/state';
import '../commercial/index';
import { covenantCheck, dailyTreasury, drawCredit, ebitda12, factorInvoice, monthlyTreasury, openCreditLine } from '.';

const F = BAL.v016.finance;

function statements(g: GameState, n: number, revenue: number, costs = 300_000): void {
  const k0 = g.finance.current.month;
  for (let i = n; i >= 1; i--) {
    const st: MonthStatement = { ...newStatement(k0 - i, g.company.cash), lines: { acmiRevenue: revenue, fuel: -costs }, bh: 300, closed: true };
    g.finance.history.push(st);
  }
}

const badDebt = (g: GameState) => [...g.finance.history, g.finance.current].reduce((s, m) => s + (m.lines.badDebt ?? 0), 0);

describe('a frozen credit line', () => {
  it('is renewed at the anniversary once the covenants hold again (the cure message says so); still in breach it is not', () => {
    const g = newGame();
    g.company.cash = 200_000;
    statements(g, 12, 1_200_000);
    expect(openCreditLine(g).ok).toBe(true);
    const cr = g.treasury!.credit!;
    g.finance.history = [];
    statements(g, 12, 100_000, 400_000);
    expect(ebitda12(g)).toBeLessThan(0);
    expect(drawCredit(g, cr.limit).ok).toBe(true);
    g.company.cash = 50_000;
    for (let i = 0; i < F.credit.freezeAfter; i++) monthlyTreasury(g, g.finance.current.month + i);
    expect(cr.frozen).toBeTruthy();
    // Cured: the debt repaid, cash in hand.
    g.company.cash = 10_000_000;
    cr.drawn = 0;
    cr.repay = [];
    monthlyTreasury(g, g.finance.current.month + 3);
    expect(cr.breaches).toBe(0);
    expect(covenantCheck(g).liquidity && covenantCheck(g).leverage).toBe(true);
    // The anniversary: the freeze lifts and the line is re-sized, not closed.
    g.now = cr.renewsAt;
    dailyTreasury(g);
    expect(g.treasury!.credit).toBe(cr);
    expect(cr.notRenewed).toBeUndefined();
    expect(cr.frozen).toBeFalsy();
    expect(cr.renewsAt).toBeGreaterThan(g.now);
    expect(drawCredit(g, 50_000).ok).toBe(true);
    expect(g.messages[0].title).toMatch(/renewed/);
  });

  it('still in breach at the anniversary is not renewed', () => {
    const g = newGame();
    g.company.cash = 200_000;
    statements(g, 12, 1_200_000);
    expect(openCreditLine(g).ok).toBe(true);
    const cr = g.treasury!.credit!;
    g.finance.history = [];
    statements(g, 12, 100_000, 400_000);
    expect(drawCredit(g, cr.limit).ok).toBe(true);
    g.company.cash = 50_000;
    for (let i = 0; i < F.credit.freezeAfter; i++) monthlyTreasury(g, g.finance.current.month + i);
    expect(cr.frozen).toBeTruthy();
    g.now = cr.renewsAt;
    dailyTreasury(g);
    expect(cr.notRenewed).toBe(true);
  });
});

describe('a factored invoice when the client goes into administration', () => {
  it('with recourse: the bank takes its advance back, the whole invoice is our bad debt and the claim is ours', () => {
    const g = newGame(44);
    const cl = clientByName(g, 'Croatia Airlines')!;
    const r = invoice(g, { clientId: cl.id, contractId: null, desc: 'June block hours', amount: 200_000, cat: 'acmiRevenue', dueDays: 30 });
    expect(factorInvoice(g, r.id, true).ok).toBe(true);
    const adv = r.factor!.advance;
    const cash = g.company.cash;
    const debt0 = badDebt(g);
    const x = startCrisis(g, 'bankruptcy', cl.id)!;
    expect(r.written).toBe(true);
    dailyTreasury(g);
    expect(r.factor!.boughtBack).toBeTruthy();
    expect(g.company.cash).toBe(cash - adv);
    expect(g.treasury!.factored).not.toContain(r.id);
    expect(badDebt(g) - debt0).toBe(-200_000);
    expect(x.written).toBe(200_000);
    // The claim pays us its share of the whole invoice (it is ours again).
    g.now = x.claim!.payAt;
    const before = g.company.cash;
    dailyCrises(g);
    expect(g.company.cash - before).toBe(x.claim!.amount);
    expect(x.claim!.amount).toBeGreaterThanOrEqual(200_000 * CRISIS.claimPct[0] - 1);
  });

  it('without recourse: the advance stays, only the balance is our bad debt and the bank\'s share of the claim is not ours', () => {
    const g = newGame(44);
    const cl = clientByName(g, 'Croatia Airlines')!;
    const r = invoice(g, { clientId: cl.id, contractId: null, desc: 'June block hours', amount: 200_000, cat: 'acmiRevenue', dueDays: 30 });
    expect(factorInvoice(g, r.id, false).ok).toBe(true);
    const adv = r.factor!.advance;
    const cash = g.company.cash;
    const debt0 = badDebt(g);
    const x = startCrisis(g, 'bankruptcy', cl.id)!;
    expect(r.written).toBe(true);
    dailyTreasury(g);
    expect(r.factor!.boughtBack).toBeUndefined();
    expect(g.company.cash).toBe(cash);
    expect(g.treasury!.factored).not.toContain(r.id);
    expect(badDebt(g) - debt0).toBe(-(200_000 - adv));
    expect(x.written).toBe(200_000 - adv);
    expect(x.claim!.amount).toBeLessThanOrEqual((200_000 - adv) * CRISIS.claimPct[1] + 1);
  });
});

describe('the late-payment decision on an invoice the bank already holds', () => {
  it('cannot sell it a second time', () => {
    const g = newGame();
    const cl = Object.values(g.clients).find((c) => c.kind !== 'government')!;
    const r = invoice(g, { clientId: cl.id, contractId: null, desc: 'late', amount: 100_000, cat: 'charterRevenue', dueDays: 10 });
    expect(factorInvoice(g, r.id, true).ok).toBe(true);
    const cash = g.company.cash;
    g.now = r.due + 31 * DAY;
    latePaymentDecision(g, r);
    const d = g.decisions.find((x) => x.kind === 'latePayment' && x.data?.receivableId === r.id)!;
    // No second sale on offer; choosing it anyway moves no money.
    expect(d.options.some((o) => o.id === 'factor')).toBe(false);
    resolveDecision(g, d.id, 'factor');
    expect(g.company.cash).toBe(cash);
    expect(r.paid).toBeNull();
  });
});
