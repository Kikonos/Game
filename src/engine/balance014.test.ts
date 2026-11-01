// v0.14 balance pass (the player's decisions): one cabin pay scale, widebody pilot pay, insurance, rents with floors,
// C-check costs, widebody wet leases (3–6 months, MGH 300+), the Widebody operations reliability gate, pay-scale sync
// for saves, staggered start C-checks.

import { describe, expect, it } from 'vitest';
import { ACMI_TYPES, ACMI_TYPES_LIST, ageFactor, rentForAge } from '../data/acmiTypes';
import { generateOffer } from './contracts/offers';
import { newGame } from './contracts/testkit';
import { BAL } from './core/balance';
import { DAY, fromUTC, monthKey, monthStart, yearOf } from './core/time';
import type { Role } from './core/types';
import { salaryFor } from './crew/generate';
import { dailyPay } from './crew/hr';
import { createGame } from './newGame';
import { hullMonth, insuranceOf } from './ops/finance';
import { cCheckGross, checkCostOf, checkStatus } from './ops/maintenance';
import { devMarketOffer } from './ops/market';

describe('v0.14 crew pay', () => {
  it('cabin crew and pursers earn the same on every type; widebody pilots earn more', () => {
    for (const r of ['PUR', 'CC'] as Role[]) {
      expect(salaryFor(r, 'A320')).toBe(salaryFor(r, 'A330/340'));
      expect(salaryFor(r, 'B757/767', false)).toBe(salaryFor(r, 'B757/767', true));
    }
    for (const r of ['CPT', 'FO'] as Role[]) {
      const p = salaryFor(r, 'A330/340') / salaryFor(r, 'A320') - 1;
      expect(p).toBeGreaterThanOrEqual(0.25);
      expect(p).toBeLessThanOrEqual(0.45);
    }
    // 757/767 pilots: widebody pay only while a 767 is in the fleet.
    expect(salaryFor('CPT', 'B757/767', true)).toBe(BAL.salary.CPT[1]);
    expect(salaryFor('CPT', 'B757/767', false)).toBe(BAL.salary.CPT[0]);
  });

  it('a save on the old scales moves to the new ones at the start of a month, once, with a message', () => {
    const g = newGame(3);
    const cc = Object.values(g.crew).find((c) => c.role === 'CC')!;
    const cpt = Object.values(g.crew).find((c) => c.role === 'CPT')!;
    const pay = [cc.salary, cpt.salary];
    cc.salary = 1_900;
    cpt.salary = 9_000;
    // Mid-month: nothing changes (the month is paid at the scale it began with).
    const k = monthKey(g.now);
    g.now = monthStart(k) + 10 * DAY;
    g.finance.current.month = k;
    expect(dailyPay(g)).toBe(0);
    expect(cc.salary).toBe(1_900);
    // The first day of the next month, once its statement is open.
    g.now = monthStart(k + 1) + 60;
    g.finance.current.month = k + 1;
    const said = () => g.messages.filter((m) => m.title === 'New pay scales from this month').length;
    expect(dailyPay(g)).toBe(2);
    expect([cc.salary, cpt.salary]).toEqual(pay);
    expect(said()).toBe(1);
    expect(dailyPay(g)).toBe(0);
    expect(said()).toBe(1);
  });
});

describe('v0.14 insurance', () => {
  it('mid-life all-in figures in the researched bands, matching the hull + liability model', () => {
    expect(ACMI_TYPES.a320ceo.insuranceMonth).toBeGreaterThanOrEqual(10_000);
    expect(ACMI_TYPES.a320ceo.insuranceMonth).toBeLessThanOrEqual(25_000);
    expect(ACMI_TYPES.a332.insuranceMonth).toBeGreaterThanOrEqual(20_000);
    expect(ACMI_TYPES.a332.insuranceMonth).toBeLessThanOrEqual(40_000);
    for (const t of ACMI_TYPES_LIST) {
      const c = t.cabins[0];
      const model = hullMonth(t.valueUsed) + BAL.insurance.liabilitySeat[t.body] * (c.j + c.w + c.y);
      expect(Math.abs(t.insuranceMonth - model), t.id).toBeLessThanOrEqual(250);
    }
  });

  it('the hull part follows the airframe age: an old jet a little cheaper, a new one a little dearer', () => {
    const g = newGame(3);
    const y = yearOf(g.now);
    const old = insuranceOf(g, { typeId: 'a320ceo', builtYear: y - 25 });
    const mid = insuranceOf(g, { typeId: 'a320ceo', builtYear: y - 12 });
    const fresh = insuranceOf(g, { typeId: 'a320ceo', builtYear: y - 2 });
    expect(mid).toBe(ACMI_TYPES.a320ceo.insuranceMonth);
    expect(old).toBeLessThan(mid);
    expect(fresh).toBeGreaterThan(mid);
    // Liability stays: even the oldest A320 pays most of it.
    expect(old).toBeGreaterThan(0.75 * mid);
  });
});

describe('v0.14 rents', () => {
  it('old airframes rent at the type floor, mid-life at rentMonth', () => {
    expect(rentForAge(ACMI_TYPES.a332, 12)).toBe(ACMI_TYPES.a332.rentMonth);
    expect(rentForAge(ACMI_TYPES.a332, 28)).toBe(ACMI_TYPES.a332.rentFloor);
    expect(rentForAge(ACMI_TYPES.b744, 30)).toBe(140_000);
    // Without a floor of its own: 55 % of rentMonth, the old clamp.
    expect(rentForAge(ACMI_TYPES.b741, 50)).toBe(0.55 * ACMI_TYPES.b741.rentMonth);
    expect(ageFactor(12)).toBe(1);
  });

  it('a used A330-200 lease on the market costs at least its floor (× the market range and index)', () => {
    const g = newGame(3);
    for (let i = 0; i < 12; i++) {
      const id = devMarketOffer(g, 'a332', { kind: 'dryLeaseIn' });
      const o = g.market.aircraft.find((x) => x.id === id)!;
      expect(o.rentPerMonth).toBeGreaterThanOrEqual(Math.floor(ACMI_TYPES.a332.rentFloor! * 0.9 * g.market.wideIndex / 1000) * 1000);
      expect(o.rentPerMonth).toBeLessThanOrEqual(ACMI_TYPES.a332.rentMonth * 1.2 * g.market.wideIndex);
    }
  });
});

describe('v0.14 C-checks', () => {
  it('per-type gross costs, half of it ours (reserves cover the rest)', () => {
    expect(cCheckGross('a320ceo')).toBe(700_000);
    expect(cCheckGross('a332')).toBe(2_000_000);
    const g = newGame(3);
    const a = Object.values(g.fleet)[0];
    expect(checkCostOf(a, 'C')).toBe(350_000);
    for (const t of ACMI_TYPES_LIST) expect(t.cCheck, t.id).toBeGreaterThan(0);
  });

  it('a start fleet staggers its C-checks: the two worn veterans are not due the same month', () => {
    const g = createGame({ name: 'Vets', code: 'VT', livery: { primary: '#000000', secondary: '#ffffff', tail: 'solid' }, base: 'LIS', seed: 5, setup: 'veterans', start: fromUTC(2027, 3, 1) });
    const due = Object.values(g.fleet).map((a) => monthKey(checkStatus(g, a).cDue));
    expect(due.length).toBe(2);
    expect(due[0]).not.toBe(due[1]);
  });
});

describe('v0.14 widebody wet leases and approval', () => {
  it('a widebody base runs 3–6 months with an MGH of at least 300', () => {
    const g = newGame(3);
    g.company.approvals.push('widebody');
    let n = 0;
    for (let i = 0; i < 40 && n < 6; i++) {
      const o = generateOffer(g, 'seasonBase', { wide: true, window: false, paint: false, cabin: false });
      if (!o) continue;
      n++;
      expect(o.requirements.body).toBe('wide');
      const days = (o.end - o.start) / DAY;
      expect(days).toBeGreaterThanOrEqual(90);
      expect(days).toBeLessThanOrEqual(185);
      expect(o.product.kind === 'wet' && o.product.mghPerMonth).toBeGreaterThanOrEqual(300);
    }
    expect(n).toBeGreaterThan(0);
  });

  it('Widebody operations asks 95 % technical reliability; the ETOPS rungs keep 97–98.5 %', () => {
    const T = BAL.ladder.tech.target;
    expect(T.widebody).toBe(95);
    expect(T.etops120).toBe(97);
    expect(T.etops180).toBe(98);
    expect(T.ulr).toBe(98.5);
  });
});
