// v0.16 the Compliance Monitoring Manager (UPDATE-0.16.md §F): candidates, the hire (nothing until they join), the
// effects (ramp finding mean × (1 − 0.4 × skill), the audit's paperwork roll, Level 2 deadlines +30 days, corrective
// actions × 0.8, the ramp task at half the cost), the pay pro-rated, the dismissal and the 30-day wait.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY, monthKey, monthStart } from '../core/time';
import { newGame } from '../contracts/testkit';
import {
  complianceAuditFactor, complianceBill, complianceCandidates, complianceDeadlinePlus, complianceFactor, complianceRehireDays, complianceTaskCostX, complianceView, fireComplianceManager,
  hireComplianceManager, monthlyCompliance, rampTaskFor,
} from './compliance';
import { rampFindings } from './ramp';

const C = BAL.v016.compliance;

describe('the post', () => {
  it('has three candidates from the start (junior, mid, senior), kept until one is hired', () => {
    const g = newGame(1);
    const cands = complianceCandidates(g);
    expect(cands).toHaveLength(3);
    expect(cands.map((c) => c.salary)).toEqual([6_400, 8_500, 11_900]);
    for (const [i, c] of cands.entries()) {
      expect(Math.abs(c.skill - C.tiers[i][0])).toBeLessThanOrEqual(0.051);
      expect(c.name).toMatch(/\S+ \S+/);
      expect(c.blurb).toBeTruthy();
    }
    expect(complianceCandidates(g)).toEqual(cands);
    const v = complianceView(g);
    expect(v.hired).toBeNull();
    expect(v.does).toHaveLength(3);
    expect(v.effect).toBeNull();
  });

  it('does nothing until the manager joins (14 days), then cuts ramp findings by 0.4 × skill and the rest', () => {
    const g = newGame(2);
    const k = complianceCandidates(g)[1];
    expect(hireComplianceManager(g, 1).ok).toBe(true);
    expect(hireComplianceManager(g, 0).ok).toBe(false);
    const h = g.compliance!.hired!;
    expect(h.name).toBe(k.name);
    expect(h.joins - h.since).toBe(C.joinDays * DAY);
    expect(complianceCandidates(g)).toEqual([]);
    expect(g.messages.some((m) => m.title === `${k.name} joins as Compliance Monitoring Manager` && m.ref?.kind === 'compliance')).toBe(true);
    expect(complianceFactor(g)).toBe(1);
    expect(complianceAuditFactor(g)).toBe(1);
    expect(complianceDeadlinePlus(g)).toBe(0);
    expect(complianceTaskCostX(g)).toBe(1);
    expect(rampTaskFor(g, 'Hire a compliance officer for the line stations', 60_000)).toEqual({ label: 'Hire a compliance officer for the line stations', cost: 60_000 });
    expect(complianceView(g).status).toMatch(/^Joins /);
    g.now += C.joinDays * DAY;
    expect(complianceFactor(g)).toBeCloseTo(1 - C.rampCut * h.skill, 6);
    expect(complianceAuditFactor(g)).toBeCloseTo(1 - C.auditCut * h.skill, 6);
    expect(complianceDeadlinePlus(g)).toBe(C.deadlinePlusDays);
    expect(complianceTaskCostX(g)).toBe(C.taskCostX);
    expect(rampTaskFor(g, 'Hire a compliance officer for the line stations', 60_000)).toEqual({ label: 'The CMM adds line-station checks', cost: 30_000 });
    expect(complianceView(g).effect).toBe(`${Math.round(C.rampCut * h.skill * 100)} % fewer ramp findings`);
    expect(complianceView(g).status).toMatch(/^Since /);
  });

  it('ramp inspections find fewer things with the manager at work (the mean × the factor)', () => {
    const g = newGame(3);
    const ac = Object.values(g.fleet)[0];
    const sum = (n: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) {
        const f = rampFindings(g, ac, `t:${i}`);
        s += f.cats[0] + f.cats[1] + f.cats[2];
      }
      return s;
    };
    const without = sum(600);
    hireComplianceManager(g, 2);
    g.now += C.joinDays * DAY;
    const f = complianceFactor(g);
    expect(f).toBeLessThan(0.7);
    const withCmm = sum(600);
    expect(without).toBeGreaterThan(100);
    expect(withCmm / without).toBeGreaterThan(f - 0.12);
    expect(withCmm / without).toBeLessThan(f + 0.12);
    expect(g.compliance!.stats.rampSaved).toBe(0);
  });

  it('is paid from the day they join, pro-rated, under salaries at month end', () => {
    const g = newGame(4);
    g.now = monthStart(monthKey(g.now) + 1) + 2 * DAY;
    hireComplianceManager(g, 1);
    const h = g.compliance!.hired!;
    const k = monthKey(h.joins);
    const a = monthStart(k), b = monthStart(k + 1);
    expect(complianceBill(g, k)).toBe(Math.round(h.salary * ((b - h.joins) / (b - a))));
    expect(complianceBill(g, k + 1)).toBe(h.salary);
    expect(complianceBill(g, k - 1)).toBe(0);
    g.finance.current.month = k;
    const cash = g.company.cash;
    monthlyCompliance(g);
    expect(cash - g.company.cash).toBe(complianceBill(g, k));
  });

  it('a dismissal costs a month, empties the candidates and brings new ones after 30 days', () => {
    const g = newGame(5);
    hireComplianceManager(g, 2);
    const cash = g.company.cash;
    expect(fireComplianceManager(g).ok).toBe(true);
    expect(cash - g.company.cash).toBe(11_900);
    expect(g.compliance!.hired).toBeNull();
    expect(complianceFactor(g)).toBe(1);
    expect(complianceCandidates(g)).toEqual([]);
    expect(complianceRehireDays(g)).toBe(C.rehireDays);
    expect(fireComplianceManager(g).ok).toBe(false);
    g.now += C.rehireDays * DAY;
    expect(complianceRehireDays(g)).toBe(0);
    expect(complianceCandidates(g)).toHaveLength(3);
  });
});
