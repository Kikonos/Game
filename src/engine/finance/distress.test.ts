// v0.16.3 distress finance (engine/finance/distress.ts): the secured line below zero, rent deferral, creditor plans,
// an investor sought with board targets, furlough and pay deferral, stretched checks, early payment, the PER
// restructuring; everything through the ledger, forecasts and statements included, old saves load.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { invoice, statementTotals } from '../core/ledger';
import { DAY, monthKey, monthStart, nextMonthStart } from '../core/time';
import type { GameState, MonthStatement } from '../core/types';
import { leased, newGame, owned } from '../contracts/testkit';
import { checkStatus } from '../ops/maintenance';
import { cashForecast, forecastItems, monthEndBill, newStatement } from '../ops/finance';
import { saleQuote } from '../ops/sale';
import { cashNegativeCard } from '../problems/money';
import { deserialize, serialize } from '../save';
import { borrowingBase, covenantCheck, creditOpenWhy, creditTerms, dailyTreasury, depositNorm, loanQuote, monthlyTreasury, openCreditLine, drawCredit, leasebackQuote, treasury } from '.';
import {
  applyDistress, askPrepayment, boardTargetCard, checkStretch, debtCommitments, deferRent, deferSalaries, distress, distressForecastItems, distressOptions, fileRestructuring, furloughCrew, furloughQuote, furloughSaving,
  inDebt, investorQuote, margin3, noCreditWhy, perActive, perQuote, planQuote, prepayQuote, rentDeferralQuote, restructuringCard, restructuringLabel, salaryDeferralQuote, seekInvestor, startPlan, stretchChecks, unsecuredClaims,
} from './distress';

const D = BAL.v0163;

function statements(g: GameState, n: number, revenue: number, costs = 300_000, extra: Partial<MonthStatement['lines']> = {}): void {
  const k0 = g.finance.current.month;
  for (let i = n; i >= 1; i--) {
    const st: MonthStatement = { ...newStatement(k0 - i, g.company.cash), lines: { acmiRevenue: revenue, fuel: -costs, ...extra }, bh: 300, closed: true };
    g.finance.history.push(st);
  }
}

const clientId = (g: GameState) => Object.keys(g.clients)[0];
const line = (g: GameState, cat: keyof MonthStatement['lines']) => g.finance.current.lines[cat] ?? 0;

/** A game in debt: statements, a receivable due in 30 days, cash at −$600K for 10 days. */
function inTheRed(cash = -600_000): GameState {
  const g = newGame();
  statements(g, 6, 900_000);
  invoice(g, { clientId: clientId(g), contractId: null, desc: 'Winter wet lease', amount: 400_000, cat: 'acmiRevenue', dueDays: 30 });
  g.company.cash = cash;
  g.finance.negSince = g.now - 10 * DAY;
  return g;
}

/** Runs the month end (finance passes only) for the current month. */
function monthEnd(g: GameState): void {
  const k = g.finance.current.month;
  g.now = nextMonthStart(g.now);
  monthlyTreasury(g, k);
  g.finance.current.closed = true;
  g.finance.history.push(g.finance.current);
  g.finance.current = newStatement(monthKey(g.now), g.company.cash);
}

describe('the secured credit line below zero', () => {
  it('the bank lends against receivables and unpledged owned aircraft, at a higher margin and fee, and takes the aircraft as security', () => {
    const g = inTheRed();
    expect(creditOpenWhy(g)).toBeNull();
    const b = borrowingBase(g);
    expect(b.receivables).toBe(400_000);
    expect(b.aircraft).toBeGreaterThan(0);
    expect(b.pledge).toContain(owned(g).id);
    const t = creditTerms(g);
    expect(t.secured).toBe(true);
    expect(t.limit).toBe(b.base);
    expect(t.margin).toBe(D.secured.margin[1]);
    expect(t.fee).toBe(Math.max(D.secured.arrangementMin, Math.round(b.base * D.secured.arrangementFee)));
    const cash0 = g.company.cash;
    expect(openCreditLine(g).ok).toBe(true);
    expect(g.company.cash).toBe(cash0 - t.fee);
    expect(line(g, 'bankFees')).toBe(-t.fee);
    const l = treasury(g).credit!;
    expect(l.secured).toBe(true);
    expect(l.pledged).toEqual(b.pledge);
    // The pledged aircraft cannot be sold, borrowed against or leased back.
    expect(saleQuote(g, owned(g).id).why).toMatch(/security for the credit line/);
    expect(loanQuote(g, owned(g).id, 5)!.why).toMatch(/security for the credit line/);
    expect(leasebackQuote(g, owned(g).id, 6)!.why).toMatch(/security for the credit line/);
    // Draws work as on any line.
    expect(drawCredit(g, 200_000).ok).toBe(true);
    expect(l.drawn).toBe(200_000);
    // The secured covenants: 1.5 months' bills of liquidity; drawn under the base.
    const cov = covenantCheck(g);
    expect(cov.bill).toBeCloseTo(monthEndBill(g, monthKey(g.now) + 1).total * D.secured.liquidityMonths, 0);
    expect(cov.debtCap).toBe(borrowingBase(g).base);
    expect(cov.leverage).toBe(true);
  });
  it('nothing to secure: no line; a normal line above zero as before; Cash Crunch still has none', () => {
    const g = newGame();
    statements(g, 6, 900_000);
    g.company.cash = -200_000;
    for (const a of Object.values(g.fleet)) if (a.ownership.kind === 'owned') a.ownership = { kind: 'dryLeaseIn', lessor: 'AerCap', rentPerMonth: 200_000, reservesPerFH: 300, leaseStart: g.now, leaseEnd: g.now + 400 * DAY };
    expect(creditOpenWhy(g)).toMatch(/Nothing to secure/);
    g.company.cash = 2_000_000;
    expect(creditOpenWhy(g)).toBeNull();
    expect(creditTerms(g).secured).toBe(false);
    g.scen = { id: 'cashCrunch', end: g.now + 90 * DAY, tally: {} as NonNullable<GameState['scen']>['tally'], scan: g.now, fired: [], noRescue: true };
    g.company.cash = -200_000;
    expect(creditOpenWhy(g)).toMatch(/overdraft/);
  });
  it('a drawn balance above the re-measured base is scheduled back within the month; the line is re-priced as normal at a healthy renewal', () => {
    const g = inTheRed();
    expect(openCreditLine(g).ok).toBe(true);
    const l = treasury(g).credit!;
    const limit = l.limit;
    expect(drawCredit(g, limit).ok).toBe(true);
    // The receivable is paid: the base shrinks.
    const r = g.finance.receivables[0];
    r.paid = g.now;
    g.company.cash = 3_000_000;
    monthEnd(g);
    const over = limit - borrowingBase(g).base;
    expect(over).toBeGreaterThan(0);
    expect((l.repay ?? []).reduce((s, x) => s + x.amount, 0)).toBe(over);
    // At the renewal, with cash above zero and no breach, a normal line: security released.
    g.now = l.renewsAt;
    dailyTreasury(g);
    expect(l.secured).toBeUndefined();
    expect(l.pledged).toBeUndefined();
    expect(l.margin).toBe(BAL.v016.finance.credit.margin[1]);
    expect(g.messages.some((m) => /re-prices the line as a normal one/.test(m.body))).toBe(true);
  });
});

describe('lessor rent deferral', () => {
  it('keeps the rent for the months, builds the repayments with the premium, extends the lease and hits reliability; repaid at month ends and in the forecast', () => {
    const g = inTheRed();
    const ac = leased(g);
    const own = ac.ownership as Extract<typeof ac.ownership, { kind: 'dryLeaseIn' }>;
    const end0 = own.leaseEnd;
    const q = rentDeferralQuote(g, ac.id, 2)!;
    expect(q.why).toBeNull();
    expect(q.extendMonths).toBe(4);
    const rel0 = g.company.reputation.reliable;
    expect(deferRent(g, ac.id, 2).ok).toBe(true);
    expect(own.leaseEnd).toBeGreaterThan(end0);
    expect(g.company.reputation.reliable).toBe(rel0 + D.rent.reliable);
    expect(rentDeferralQuote(g, ac.id, 2)!.why).toMatch(/already defers/);
    // Month end 1 and 2: the rent stays with us (the statement still books it: ops posts rent after this pass).
    const d = distress(g);
    const rd = d.rentDeferrals[0];
    const cash0 = g.company.cash;
    monthEnd(g);
    expect(rd.deferred).toBeGreaterThan(0);
    expect(g.company.cash).toBeGreaterThan(cash0);
    monthEnd(g);
    expect(rd.repay.length).toBe(2);
    const total = rd.repay.reduce((s, x) => s + x.amount, 0);
    expect(total).toBe(rd.deferred + Math.round(rd.deferred * D.rent.premium));
    const fc = distressForecastItems(g, 90);
    expect(fc.filter((x) => x.what === 'deferred rent repaid').length).toBe(2);
    expect(forecastItems(g, 90).some((x) => x.what === 'deferred rent repaid')).toBe(true);
    // Repayments swept at the next two month ends, the premium on the statement.
    g.company.cash = 5_000_000;
    const c1 = g.company.cash;
    monthEnd(g);
    expect(c1 - g.company.cash).toBe(rd.repay.length ? total - rd.repay[0].amount : total);
    expect(g.finance.history[g.finance.history.length - 1].lines.distress).toBeLessThan(0);
    monthEnd(g);
    expect(rd.done).toBeDefined();
    expect(rd.defaulted).toBeUndefined();
  });
  it('a repayment swept below zero blocks the lessor for a year', () => {
    const g = inTheRed();
    const ac = leased(g);
    expect(deferRent(g, ac.id, 2).ok).toBe(true);
    monthEnd(g);
    monthEnd(g);
    g.company.cash = -100_000;
    monthEnd(g);
    const rd = distress(g).rentDeferrals[0];
    expect(rd.defaulted).toBeDefined();
    expect(distress(g).lessorBlock[rd.lessor]).toBeGreaterThan(g.now);
  });
});

describe('creditor payment plans', () => {
  it('spreads half of the last two months\' bills with a real creditor for a fee, swept at month ends; refused when too much is deferred', () => {
    const g = inTheRed();
    g.finance.current.lines.maintenance = -300_000;
    g.finance.history[g.finance.history.length - 1].lines.checks = -500_000;
    const q = planQuote(g, 'mro', 4);
    expect(q.why).toBeNull();
    expect(q.bills).toBe(800_000);
    expect(q.amount).toBe(400_000);
    expect(q.fee).toBe(Math.round(400_000 * Math.max(D.plan.feeMin, D.plan.feePerMonth * 4)));
    expect(['Lufthansa Technik', 'TAP Maintenance & Engineering', 'Iberia Maintenance', 'SR Technics', 'AFI KLM E&M']).toContain(q.creditor);
    const cash0 = g.company.cash;
    expect(startPlan(g, 'mro', 4).ok).toBe(true);
    expect(g.company.cash).toBe(cash0 + 400_000);
    expect(planQuote(g, 'mro', 4).why).toMatch(/already runs a plan/);
    g.finance.current.lines.fuel = -40_000_000;
    expect(planQuote(g, 'fuel', 3).why).toMatch(/Too much is deferred/);
    const p = distress(g).plans[0];
    expect(p.repay.length).toBe(4);
    expect(p.repay.reduce((s, x) => s + x.amount, 0)).toBe(400_000 + q.fee);
    g.company.cash = 2_000_000;
    const c1 = g.company.cash;
    monthEnd(g);
    expect(c1 - g.company.cash).toBe(400_000 + q.fee - p.repay.reduce((s, x) => s + x.amount, 0));
    const st = g.finance.history[g.finance.history.length - 1];
    expect(st.lines.distress).toBeLessThan(0);
    // Two parts from an overdrawn account: the rest is called with a fee.
    g.company.cash = -50_000;
    monthEnd(g);
    monthEnd(g);
    expect(p.missed).toBe(2);
    expect(p.repay.length).toBe(0);
    expect(p.done).toBeDefined();
    expect(g.messages.some((m) => /calls the plan/.test(m.title))).toBe(true);
  });
});

describe('an investor sought early', () => {
  it('pays the hole plus a month\'s bills for a smaller stake than the forced rescue, counts as the rescue below zero, and sets board targets', () => {
    const g = inTheRed();
    g.company.reputation.clean = 80;
    const q = investorQuote(g);
    expect(q.why).toBeNull();
    expect(q.stake).toBe(Math.max(D.investor.stakeMin, q.forcedStake - D.investor.stakeLess));
    expect(q.amount).toBeGreaterThanOrEqual(600_000 + q.bill);
    const rel0 = g.company.reputation.reliable;
    expect(seekInvestor(g).ok).toBe(true);
    expect(g.company.cash).toBeGreaterThan(0);
    expect(g.finance.rescues).toBe(1);
    expect(g.finance.negSince).toBeNull();
    expect(g.company.reputation.reliable).toBe(rel0 + D.investor.reliable);
    const inv = distress(g).investor!;
    expect(D.investor.names).toContain(inv.name);
    expect(investorQuote(g).why).toMatch(/already holds/);
    // Review day with cash below zero and no revenue: a miss (card); a second miss sells an owned aircraft.
    g.now = inv.reviewAt;
    g.company.cash = -10_000;
    dailyTreasury(g);
    expect(inv.misses).toBe(1);
    expect(boardTargetCard(g)?.severity).toBe('red');
    expect(g.messages.some((m) => m.problem?.kind === 'boardTarget')).toBe(true);
    g.now = inv.reviewAt;
    dailyTreasury(g);
    expect(inv.misses).toBe(2);
    expect(inv.forcedSales).toBe(1);
    expect(owned(g).sale).toBeDefined();
    // A third: the board replaces the management.
    g.now = inv.reviewAt;
    dailyTreasury(g);
    expect(g.gameOver?.reason).toMatch(/replaced the management/);
  });
  it('targets met four quarters running release the board; margin3 reads the statements', () => {
    const g = inTheRed();
    g.company.reputation.clean = 80;
    expect(seekInvestor(g).ok).toBe(true);
    const inv = distress(g).investor!;
    expect(margin3(g)).toBeCloseTo((900_000 - 300_000) / 900_000, 5);
    for (let i = 0; i < 4; i++) {
      g.now = inv.reviewAt;
      dailyTreasury(g);
    }
    expect(inv.met).toBe(4);
    expect(inv.released).toBeDefined();
  });
});

describe('cost cuts', () => {
  it('furlough: a share of each role with the least work ahead goes on unpaid leave; the saving comes off the month-end bill and the salaries line; morale drops', () => {
    const g = inTheRed();
    const q = furloughQuote(g, 0.25, 4);
    expect(q.why).toBeNull();
    expect(q.crewIds.length).toBeGreaterThan(0);
    const bill0 = monthEndBill(g, monthKey(g.now)).salaries;
    const m0 = g.crew[q.crewIds[0]].morale;
    expect(furloughCrew(g, 0.25, 4).ok).toBe(true);
    const c = g.crew[q.crewIds[0]];
    expect(c.blocks?.some((b) => b.furlough && b.why === 'leave')).toBe(true);
    expect(c.morale).toBe(Math.max(0, m0 + D.furlough.morale));
    const k = monthKey(g.now);
    const saved = furloughSaving(g, k);
    expect(saved).toBeGreaterThan(0);
    expect(monthEndBill(g, k).salaries).toBe(Math.max(0, bill0 - saved));
    expect(furloughQuote(g, 0.25, 4).why).toMatch(/on furlough until/);
    monthEnd(g);
    const st = g.finance.history[g.finance.history.length - 1];
    expect(st.lines.salaries).toBe(saved);
  });
  it('pay deferral keeps a share at the month end and repays it over two; checks stretched move the planning point inside the tolerance', () => {
    const g = inTheRed();
    const q = salaryDeferralQuote(g, 1);
    expect(q.why).toBeNull();
    expect(deferSalaries(g, 1).ok).toBe(true);
    const cash0 = g.company.cash;
    monthEnd(g);
    const sd = distress(g).salaryDeferral!;
    expect(sd.deferred).toBeGreaterThan(0);
    expect(g.company.cash).toBe(cash0 + sd.deferred);
    expect(sd.repay.length).toBe(2);
    expect(sd.repay.reduce((s, x) => s + x.amount, 0)).toBe(sd.deferred);
    monthEnd(g);
    monthEnd(g);
    expect(sd.done).toBeDefined();
    // Checks.
    expect(checkStretch(g)).toEqual({ planAt: BAL.planAt, dueX: 1 });
    expect(stretchChecks(g).ok).toBe(true);
    expect(checkStretch(g)).toEqual({ planAt: D.checks.planAt, dueX: D.checks.dueX });
    expect(D.checks.dueX).toBeLessThan(1 + BAL.overdueTolerance);
    const ac = owned(g);
    const def0 = ac.maint.deferred;
    monthEnd(g);
    expect(ac.maint.deferred).toBeCloseTo(Math.min(1, def0 + D.checks.deferredPerMonth), 5);
    // A fresh aircraft stays well inside the tolerance at the stretched due date.
    const h = newGame();
    expect(checkStatus(h, owned(h)).grounded).toBe(false);
  });
});

describe('early payment', () => {
  it('a client who agrees pays now less the discount (on the statement); a refusal closes the invoice to a second ask', () => {
    const g = inTheRed();
    const r = g.finance.receivables[0];
    const q = prepayQuote(g, r.id)!;
    expect(q.why).toBeNull();
    expect(q.discount).toBe(Math.round(r.amount * Math.min(D.prepay.clamp[1], D.prepay.base + D.prepay.perDay * 30)));
    g.clients[r.clientId].relation = 100;
    const cash0 = g.company.cash;
    // Relation 100: 95 % agree; force the roll by trying a few seeds' worth of asks on copies.
    let agreed = false;
    for (let i = 0; i < 20 && !agreed; i++) {
      const h = deserialize(serialize(g));
      expect(askPrepayment(h, r.id).ok).toBe(true);
      const hr = h.finance.receivables[0];
      if (hr.paid !== null) {
        agreed = true;
        expect(h.company.cash).toBe(cash0 + r.amount - q.discount);
        expect(h.finance.current.lines.distress).toBe(-q.discount);
        expect(prepayQuote(h, r.id)!.why).toMatch(/Already paid/);
      } else {
        expect(hr.prepay?.refused).toBe(true);
        expect(prepayQuote(h, r.id)!.why).toMatch(/said no/);
        g.seed++;
      }
    }
    expect(agreed).toBe(true);
  });
});

describe('PER restructuring', () => {
  it('needs a deep hole, writes off 30 % of unsecured claims as a gain, charges fees, freezes claims and pauses the clock; exits above zero, liquidates below', () => {
    const g = inTheRed(-200_000);
    g.finance.negSince = g.now - 5 * DAY;
    expect(perQuote(g).why).toMatch(/Not deep enough/);
    g.finance.negSince = g.now - 25 * DAY;
    const q = perQuote(g);
    expect(q.why).toBeNull();
    expect(q.procedure).toMatch(/PER \(Processo Especial de Revitaliza/);
    expect(unsecuredClaims(g)).toBe(200_000);
    const rel0 = g.company.reputation.reliable;
    const c0 = g.company.cash;
    expect(fileRestructuring(g).ok).toBe(true);
    const p = distress(g).per!;
    expect(p.writtenOff).toBe(60_000);
    expect(g.company.cash).toBe(c0 + 60_000 - q.fee);
    expect(line(g, 'distress')).toBe(60_000 - q.fee);
    expect(g.company.reputation.reliable).toBe(rel0 + D.per.reliable);
    expect(perActive(g)).toBe(true);
    expect(restructuringLabel(g)).toBe(true);
    expect(noCreditWhy(g)).toMatch(/no new credit/);
    expect(creditOpenWhy(g)).toMatch(/no new credit/);
    expect(depositNorm(g, clientId(g))).toBe(0);
    expect(restructuringCard(g)?.severity).toBe('red');
    expect(perQuote(g).why).toMatch(/runs until/);
    // The plan's end below zero: liquidation; above zero: exit, the label stays.
    const h = deserialize(serialize(g));
    h.now = p.until;
    h.company.cash = -1;
    dailyTreasury(h);
    expect(h.gameOver?.reason).toMatch(/liquidation/);
    g.now = p.until;
    g.company.cash = 100_000;
    dailyTreasury(g);
    expect(p.exited).toBeDefined();
    expect(perActive(g)).toBe(false);
    expect(restructuringLabel(g)).toBe(true);
    expect(perQuote(g).why).toMatch(/Done once/);
    g.now = p.labelUntil;
    expect(restructuringLabel(g)).toBe(false);
  });
  it('not in a scenario; Cash Crunch keeps its crunch (no plans, deferrals, investor or line); the cash card points at the ways out; the panel ranks the gentle ways first', () => {
    const g = inTheRed();
    g.scen = { id: 'summerSurge', end: g.now + 90 * DAY, tally: {} as NonNullable<GameState['scen']>['tally'], scan: g.now, fired: [] };
    expect(perQuote(g).why).toMatch(/Not in a scenario/);
    g.scen.noRescue = true;
    expect(planQuote(g, 'mro', 3).why).toBeTruthy();
    expect(rentDeferralQuote(g, leased(g).id, 2)!.why).toMatch(/no deferrals in this scenario/);
    expect(salaryDeferralQuote(g, 1).why).toMatch(/no deferrals in this scenario/);
    expect(investorQuote(g).why).toMatch(/No investor comes/);
    expect(creditOpenWhy(g)).toMatch(/overdraft/);
    // Furlough, stretched checks and early payment stay: they inject no credit.
    expect(furloughQuote(g, 0.25, 4).why).toBeNull();
    expect(prepayQuote(g, g.finance.receivables[0].id)!.why).toBeNull();
    delete g.scen;
    expect(inDebt(g)).toBe(true);
    const card = cashNegativeCard(g)!;
    expect(card.actions[0]).toMatchObject({ id: 'debt', open: { tab: 'finance', view: 'debt' } });
    const opts = distressOptions(g);
    expect(opts.map((o) => o.id)).toContain('per');
    const ok = opts.filter((o) => !o.why);
    expect(ok.length).toBeGreaterThan(3);
    expect(ok[0].rank).toBeLessThanOrEqual(ok[ok.length - 1].rank);
    for (const o of opts) {
      expect(o.gives.length).toBeGreaterThan(5);
      expect(o.costs.length).toBeGreaterThan(5);
      expect(o.consequence.length).toBeGreaterThan(5);
    }
    expect(applyDistress(g, 'checks').ok).toBe(true);
    expect(debtCommitments(g).some((c) => c.id === 'checks')).toBe(true);
  });
});

describe('saves', () => {
  it('an older save without the record loads with an empty one and keeps working; a save mid-deferral round-trips', () => {
    const g = inTheRed();
    delete g.treasury!.distress;
    const h = deserialize(serialize(g));
    expect(h.treasury?.distress).toBeDefined();
    expect(h.treasury!.distress!.rentDeferrals).toEqual([]);
    expect(deferRent(h, leased(h).id, 3).ok).toBe(true);
    const j = deserialize(serialize(h));
    expect(j.treasury!.distress!.rentDeferrals.length).toBe(1);
    expect(JSON.stringify(j.treasury!.distress)).toBe(JSON.stringify(deserialize(serialize(j)).treasury!.distress));
    const fc = cashForecast(j, 60);
    expect(fc.length).toBeGreaterThan(0);
    expect(statementTotals(j.finance.current.lines).costs).toBeGreaterThanOrEqual(0);
    expect(monthStart(monthKey(j.now))).toBeLessThanOrEqual(j.now);
  });
});
