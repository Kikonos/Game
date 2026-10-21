// v0.6 morale & attrition (UPDATE-0.6.md §F3): target and drift, every driver, sickness slope, resignation odds,
// bond, notice and deletion, late salaries, weekly history, service quality.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { CrewMember, GameState } from '../core/types';
import { run } from '../contracts/testkit';
import { demoFlights } from '../dev';
import { monthlySalaries } from './costs';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { dailyMorale, legService, noteService, onContractDoneMorale, onDutyMorale, resignRoll, settleService, lateChange } from './morale';
import {
  applyDiscretion, autoRoster, crewCalendar, crewStatusView, flightCrewStatus, moraleOf, moraleSummary, moraleTarget, policyPreview, resignChance, resignNow, rosterOf, sickMult,
} from '.';

const avg = (g: GameState) => Object.values(g.crew).reduce((s, c) => s + c.morale, 0) / Object.keys(g.crew).length;
const one = (g: GameState, role = 'CC') => Object.values(g.crew).find((c) => c.role === role)!;

describe('morale target and drift', () => {
  it('the target follows the policy table', () => {
    expect(moraleTarget({ perDiemPct: 100, rotationWeeks: 5 })).toBe(65);
    expect(moraleTarget({ perDiemPct: 80, rotationWeeks: 6 })).toBe(60);
    expect(moraleTarget({ perDiemPct: 120, rotationWeeks: 4 })).toBe(70);
    expect(moraleTarget({ perDiemPct: 150, rotationWeeks: 4 })).toBe(73);
  });

  it('over 180 days default policies settle at 60–70, stingy ones lower, generous ones higher', () => {
    const settle = (perDiemPct: number, rotationWeeks: 4 | 5 | 6, hotelTier: 3 | 4 | 5) => {
      const g = fixtureGame(11);
      g.company.cash = 50_000_000;
      Object.assign(g.company.policies, { perDiemPct, rotationWeeks, hotelTier });
      demoFlights(g, ['FAO', 'FNC', 'PMI', 'OPO'], 4, 'revenue');
      run(g, g.started + 180 * DAY);
      return avg(g);
    };
    const def = settle(100, 5, 4);
    expect(def).toBeGreaterThanOrEqual(60);
    expect(def).toBeLessThanOrEqual(70);
    expect(settle(80, 6, 3)).toBeLessThan(def - 3);
    expect(settle(120, 4, 5)).toBeGreaterThan(def + 3);
  }, 30_000);

  it('the policy preview shows the target and cost change before commit (pure)', () => {
    const g = fixtureGame();
    g.finance.history.push({ ...g.finance.current, lines: { perDiem: -20_000, hotels: -10_000, deadhead: -5_000 }, closed: true });
    const before = JSON.stringify(g);
    const p = policyPreview(g, { perDiemPct: 120 });
    expect(JSON.stringify(g)).toBe(before);
    expect(p).toEqual({ target: 68, targetNow: 65, costPerMonth: 39_000, costNow: 35_000 });
    expect(policyPreview(g, { hotelTier: 5 }).costPerMonth).toBe(Math.round(20_000 + 10_000 * (230 / 140) + 5_000));
  });
});

describe('morale drivers', () => {
  it('daily drivers: hotel, long tour, days off away, workload', () => {
    const g = fixtureGame();
    g.company.policies.hotelTier = 3;
    const c = one(g);
    c.awaySince = g.now - 30 * DAY;
    c.loc = 'HAM';
    const w = { ...g.crew[addCrew(g, { FO: 1 })[0]] };
    const busy = g.crew[w.id];
    for (let i = 0; i < 16; i++) busy.log.push({ start: g.now - (i + 2) * DAY, end: g.now - (i + 2) * DAY + 10 * 60, fdp: 600, block: 400, sectors: 2, augmented: false, disruptive: false });
    dailyMorale(g);
    expect(c.moraleWhy).toMatchObject({ hotel: BAL.morale.hotelDay[3], tour: -0.15, offAway: BAL.morale.offAway });
    expect(busy.moraleWhy?.workload).toBe(BAL.morale.heavy);
    // Past 42 days away the tour weighs double; 5★ hotels lift.
    c.awaySince = g.now - 45 * DAY;
    g.company.policies.hotelTier = 5;
    c.moraleWhy = {};
    dailyMorale(g);
    expect(c.moraleWhy).toMatchObject({ hotel: BAL.morale.hotelDay[5], tour: -0.3 });
  });

  it('shocks: late change (once a day, not in the first days), discretion, mission once per trip, extra crew, salaries late', () => {
    const g = fixtureGame();
    demoFlights(g, undefined, 6, 'revenue');
    autoRoster(g);
    const c = one(g);
    const m0 = c.morale;
    lateChange(g, c.id, g.now + DAY);
    expect(c.morale).toBe(m0);
    g.now += 4 * DAY;
    lateChange(g, c.id, g.now + 24 * 60);
    lateChange(g, c.id, g.now + 30 * 60);
    expect(c.morale).toBeCloseTo(m0 + BAL.morale.lateChange, 5);
    expect(c.moraleWhy?.lateChange).toBe(BAL.morale.lateChange);
    lateChange(g, one(g, 'FO').id, g.now + 80 * 60);
    expect(one(g, 'FO').moraleWhy?.lateChange).toBeUndefined();
    // Mission: once, at the trip's last release; extra crew: the group that flew with someone above the minimum.
    const p = Object.values(g.pairings).find((x) => x.slots.every((s) => s.crewId))!;
    const k = fixtureContract(g, { aircraftIds: [p.aircraftId!], start: g.now, end: g.now + DAY, pattern: { kind: 'legs', legs: [] }, effects: { morale: 6 } });
    p.contractId = k.id;
    p.slots.push({ role: 'CC', crewId: addCrew(g, { CC: 1 })[0], above: true });
    const cabin = g.crew[p.slots.find((s) => g.crew[s.crewId!].role !== 'CPT' && g.crew[s.crewId!].role !== 'FO')!.crewId!];
    const pilot = g.crew[p.slots[0].crewId!];
    onDutyMorale(g, p, false);
    expect(cabin.moraleWhy?.mission).toBeUndefined();
    expect(cabin.moraleWhy?.extraCrew).toBe(BAL.morale.extraDuty);
    expect(pilot.moraleWhy?.extraCrew).toBeUndefined();
    onDutyMorale(g, p, true);
    expect(cabin.moraleWhy?.mission).toBe(6);
    // Discretion −3.
    const d = g.duties[p.dutyIds[0]];
    const before = pilot.morale;
    applyDiscretion(g, d.id);
    expect(pilot.morale).toBeCloseTo(before - 3, 5);
    expect(pilot.moraleWhy?.discretion).toBe(-3);
    // Salaries paid out of a negative balance: −15 for everyone, one message.
    g.company.cash = -500_000;
    const n0 = g.messages.length;
    const pm = pilot.morale;
    monthlySalaries(g);
    expect(pilot.morale).toBeCloseTo(pm + BAL.morale.salaryLate, 5);
    expect(g.messages.length).toBe(n0 + 1);
    expect(g.messages[0].title).toBe('Salaries paid late');
  });

  it('sickness slope and resignation multipliers', () => {
    expect(sickMult(70)).toBe(1);
    expect(sickMult(60)).toBe(1);
    expect(sickMult(30)).toBeCloseTo(1.6);
    const g = fixtureGame();
    const c = one(g);
    c.morale = 75;
    expect(resignChance(g, c)).toBeCloseTo(0.004);
    c.morale = 55;
    expect(resignChance(g, c)).toBeCloseTo(0.008);
    c.morale = 40;
    expect(resignChance(g, c)).toBeCloseTo(0.016);
    c.morale = 20;
    expect(resignChance(g, c)).toBeCloseTo(0.024);
    c.bondUntil = g.now + DAY;
    expect(resignChance(g, c)).toBeCloseTo(0.024 * BAL.conv.bondFactor);
    const v = moraleOf(g, c.id);
    expect(v.sickMult).toBeCloseTo(1.8);
    expect(v.resignPerMonth).toBeCloseTo(0.0072);
  });

  it('resignations over 20,000 seeded crew-months match resignPerMonth × mult within 15%', () => {
    const g = fixtureGame();
    const c: CrewMember = { ...one(g) };
    for (const [m, mult] of [[65, 1], [35, 2]] as const) {
      c.morale = m;
      let n = 0;
      const crewN = 200;
      const days = 3_000;
      for (let i = 0; i < crewN; i++) {
        c.id = `c${i}x${m}`;
        for (let d = 0; d < days; d++) {
          g.now = g.started + d * DAY;
          if (resignRoll(g, c)) n++;
        }
      }
      const months = (crewN * days) / 30;
      const want = months * BAL.morale.resignPerMonth * mult;
      expect(Math.abs(n - want) / want).toBeLessThan(0.15);
    }
  });
});

describe('notice and leaving', () => {
  it('still rostered before the leave date; released after it, then deleted without breaking reads', () => {
    const g = fixtureGame(21);
    demoFlights(g, undefined, 40, 'revenue');
    autoRoster(g);
    const c = Object.values(g.crew).find((x) => x.role === 'CC' && rosterOf(g, x.id, g.now + DAY, g.now + 8 * DAY).length)!;
    g.now += 4 * DAY;
    expect(resignNow(g, c.id)).toBe(true);
    expect(g.messages[0].title).toMatch(/resigned$/);
    expect(g.messages[0].body).toMatch(/^30 days' notice: last day /);
    const leaves = c.notice!.leaves;
    expect(leaves - g.now).toBe(30 * DAY);
    expect(crewStatusView(g, c.id).leaves).toBe(leaves);
    expect(crewStatusView(g, c.id).text).toMatch(/Leaves \d+ \w+$/);
    expect(resignChance(g, c)).toBe(0);
    // Nothing rostered from the leave date.
    expect(rosterOf(g, c.id, leaves, leaves + 60 * DAY)).toEqual([]);
    const m = c.morale;
    run(g, leaves - DAY);
    expect(c.morale).toBe(m);
    run(g, leaves + 2 * DAY);
    expect(g.crew[c.id]).toBeUndefined();
    expect(g.stats.resigned).toBe(1);
    for (const f of Object.values(g.flights)) flightCrewStatus(g, f.id);
    expect(crewCalendar(g, c.id, g.now - 40 * DAY, g.now)).toEqual([]);
    expect(crewStatusView(g, c.id).label).toBe('—');
    expect(moraleOf(g, c.id).value).toBe(0);
    run(g, g.now + 40 * DAY);
  }, 30_000);

  it('the company summary: averages, low, leaving; weekly history keeps 12 weeks', () => {
    const g = fixtureGame();
    g.company.cash = 50_000_000;
    run(g, g.started + 100 * DAY);
    for (const x of Object.values(g.crew)) delete x.notice;
    expect(g.stats.moraleWeeks!.length).toBe(12);
    const c = one(g);
    c.morale = 30;
    resignNow(g, one(g, 'FO').id);
    const s = moraleSummary(g);
    expect(s.low).toBe(1);
    expect(s.leaving).toBe(1);
    expect(s.target).toBe(65);
    expect(s.avg).toBeGreaterThan(55);
  }, 30_000);
});

describe('service quality', () => {
  it('cabin morale and extra cabin crew score each leg; the score moves the client relation', () => {
    const g = fixtureGame();
    demoFlights(g, undefined, 2, 'revenue');
    autoRoster(g);
    const f = Object.values(g.flights).find((x) => x.kind === 'revenue' && x.crewIds.length > 2)!;
    const k = fixtureContract(g, { aircraftIds: [f.aircraftId!], start: g.now, end: g.now + DAY, pattern: { kind: 'legs', legs: [] }, product: { kind: 'charter', price: 1, depositPct: 0, balanceDaysBefore: 7, fuelEscalation: false } });
    f.contractId = k.id;
    for (const id of f.crewIds) g.crew[id].morale = 90;
    expect(legService(g, f)).toBeCloseTo(0.5);
    const extra = addCrew(g, { CC: 2 });
    f.crewIds.push(...extra);
    for (const id of extra) g.crew[id].morale = 90;
    expect(legService(g, f)).toBeCloseTo(0.9);
    f.status = 'done';
    noteService(g, f);
    noteService(g, f);
    expect(k.service).toEqual({ sum: 1.8, n: 2 });
    const rel = g.clients[k.clientId]?.relation ?? 0;
    g.clients[k.clientId] ??= { id: k.clientId, name: 'C', kind: 'tourOperator', country: 'PT', base: 'LIS', payReliability: 1, lateDays: [0, 0], cleanSensitivity: 0, relation: 0 };
    const r0 = g.clients[k.clientId].relation;
    k.legsFlown = 10;
    k.legsOnTime = 9;
    onContractDoneMorale(g, k);
    expect(g.clients[k.clientId].relation).toBe(r0 + Math.round(0.9 * BAL.morale.service.relation));
    expect(k.service).toEqual({ sum: 0, n: 0 });
    expect(g.crew[extra[0]].moraleWhy?.recognition).toBe(BAL.morale.recognition);
    expect(settleService(g, k)).toBeNull();
    expect(rel).toBeDefined();
  });
});
