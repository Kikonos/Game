// v0.9 department heads (UPDATE-0.9.md §5): unlocks, candidates, hire/fire/rehire, salary, the decision hook (Ops
// Control and credit control), mistakes, the maintenance planner, the crew desk, proposals, watch rules, the analyst.

import { BAL } from '../core/balance';
import { describe, expect, it } from 'vitest';
import { generateOffer } from '../contracts';
import { counterBase, counterOdds } from '../contracts/counter';
import { addFlight } from '../core/entities';
import { takeCues } from '../core/cues';
import { pushDecision } from '../core/messages';
import { clearPause, takePause } from '../core/pause';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import type { GameState, HeadId } from '../core/types';
import { flightCrewStatus } from '../crew';
import { buildDuties } from '../crew/duties';
import { addCrew, fixtureContract, fixtureGame } from '../crew/fixtures';
import { autoRoster, releaseCrew, setFlightsCrew } from '../crew/roster';
import { serialize } from '../save';
import { checkAchievements } from './achievements';
import {
  acceptProposal, analystView, dailyHeads, fireHead, headsView, headView, hireHead, mistakeRoll, monthlyHeads, rollCandidates, setHeadRules, unlockHead, watchDeskHour,
} from './heads';
import { checkStatus, nextPlanned } from './maintenance';
import { v09Stats } from '../crew/dayPlan';

/** Unlocked and hired (the senior candidate, or a given skill). */
function hire(g: GameState, id: HeadId, skill?: number): void {
  unlockHead(g, id);
  expect(hireHead(g, id, 2).ok).toBe(true);
  if (skill !== undefined) g.heads![id].hired!.skill = skill;
}

/** A rostered out-and-back from LIS two days out (as in outOfHours.test). */
function trip(seed: number) {
  const g = fixtureGame(seed);
  const acId = Object.keys(g.fleet)[0];
  const ac = g.fleet[acId];
  ac.at = 'LIS';
  const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * 60;
  const b = blockMinutes(ac.typeId, 'LIS', 'FNC');
  const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [acId], start: std - DAY, end: std + 2 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false } });
  const f = addFlight(g, { no: 'AW970', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'LIS', to: 'FNC', std, sta: std + b, pax: 170 });
  addFlight(g, { no: 'AW971', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'FNC', to: 'LIS', std: std + b + 50, sta: std + 2 * b + 50, pax: 160 });
  buildDuties(g, acId, g.now, g.now + 5 * DAY);
  for (const id of addCrew(g, { CPT: 2, FO: 3, PUR: 1, CC: 3 })) g.crew[id].off = [];
  autoRoster(g);
  const d = g.duties[g.flights[f.id].dutyId!];
  return { g, f, d, p: g.pairings[d.pairingId] };
}

describe('§5 unlocks and candidates', () => {
  it('locked until its achievement; the threshold unlocks it with three candidates in their bands', () => {
    const g = fixtureGame(81);
    const v = headView(g, 'opsControl');
    expect(v.unlocked).toBe(false);
    v09Stats(g).legalStreak = 24;
    expect(headView(g, 'opsControl').progress).toEqual({ have: 24, need: 25, label: '24 of 25 sectors' });
    checkAchievements(g, { ids: ['cleanSheet'] });
    expect(headView(g, 'opsControl').unlocked).toBe(false);
    v09Stats(g).legalStreak = 25;
    checkAchievements(g, { ids: ['cleanSheet'] });
    const u = headView(g, 'opsControl');
    expect(u.unlocked).toBe(true);
    expect(u.progress).toBeNull();
    expect(u.candidates.length).toBe(3);
    const bands = [[0.55, 0.65, 0.7], [0.7, 0.8, 1], [0.85, 0.92, 1.45]];
    u.candidates.forEach((c, i) => {
      expect(c.skill).toBeGreaterThanOrEqual(bands[i][0]);
      expect(c.skill).toBeLessThanOrEqual(bands[i][1]);
      expect(c.salary).toBe(Math.round((BAL.v09.heads.salary.opsControl * bands[i][2]) / 100) * 100);
      expect(c.name).toMatch(/^\S+ \S/);
    });
    expect(headsView(g).length).toBe(7);
    // Deterministic per seed.
    expect(rollCandidates(fixtureGame(81), 'opsControl', 0)).toEqual(u.candidates);
    expect(rollCandidates(fixtureGame(82), 'opsControl', 0)).not.toEqual(u.candidates);
  });

  it('hire, fire with a month of severance, rehire only after 30 days from fresh candidates; salary at the month end', () => {
    const g = fixtureGame(83);
    expect(hireHead(g, 'analyst', 0).ok).toBe(false);
    unlockHead(g, 'analyst');
    takeCues();
    const c = g.heads!.analyst.candidates![1];
    expect(hireHead(g, 'analyst', 1).ok).toBe(true);
    expect(takeCues()).toContain('headHired');
    expect(headView(g, 'analyst').person!.name).toBe(c.name);
    const s0 = g.finance.current.lines.salaries ?? 0;
    monthlyHeads(g);
    expect((g.finance.current.lines.salaries ?? 0) - s0).toBe(-c.salary);
    const s1 = g.finance.current.lines.salaries ?? 0;
    expect(fireHead(g, 'analyst').ok).toBe(true);
    expect((g.finance.current.lines.salaries ?? 0) - s1).toBe(-c.salary);
    expect(hireHead(g, 'analyst', 0).ok).toBe(false);
    g.now += 31 * DAY;
    dailyHeads(g);
    expect(g.heads!.analyst.candidates!.length).toBe(3);
    expect(hireHead(g, 'analyst', 0).ok).toBe(true);
  });

  it('the mistake rate over 2,000 rolls is (1 − skill) × 0.35 ± 2 %', () => {
    const g = fixtureGame(84);
    for (const skill of [0.6, 0.9]) {
      let n = 0;
      for (let i = 0; i < 2000; i++) if (mistakeRoll(g, skill, `t${i}`)) n++;
      expect(Math.abs(n / 2000 - (1 - skill) * 0.35)).toBeLessThan(0.02);
    }
  });
});

describe('§5.3 the decision hook', () => {
  it('Ops Control answers a sick call with a call-in: no decision, no pause, one quiet message', () => {
    const { g, f, p } = trip(85);
    hire(g, 'opsControl', 1);
    const fo = p.slots.find((s) => s.role === 'FO')!.crewId!;
    releaseCrew(g, p, fo);
    setFlightsCrew(g, p);
    expect(flightCrewStatus(g, f.id).level).toBe('missing');
    clearPause();
    takeCues();
    const n0 = g.decisions.length;
    pushDecision(g, {
      kind: 'sickCrew', title: 'Sick', body: '', defaultOption: 'callIn', expires: g.now + DAY, ref: { kind: 'flight', id: f.id }, data: { flightId: f.id, crewId: fo },
      options: [{ id: 'callIn', label: 'Call in', desc: '' }, { id: 'subcharter', label: 'Sub', desc: '' }, { id: 'cancel', label: 'Cancel', desc: '' }],
    });
    expect(g.decisions.length).toBe(n0);
    expect(takePause()).toBeNull();
    const lvl = flightCrewStatus(g, f.id).level;
    expect(lvl === 'ok' || lvl === 'tight').toBe(true);
    const m = g.messages[0];
    expect(m.topic).toBe('head');
    expect(m.title).toMatch(/^Ops Control called in .* for AW970$/);
    expect(takeCues()).toEqual(['headDone']);
    expect(g.heads!.opsControl.handled).toBe(1);
    expect(g.stats.v09!.headHandled).toBe(1);
  });

  it('never takes crises; switched off, it leaves the sick call to the player', () => {
    const { g, f, p } = trip(86);
    hire(g, 'opsControl', 1);
    clearPause();
    const n0 = g.decisions.length;
    pushDecision(g, { kind: 'aog', title: 'AOG', body: '', defaultOption: 'wait', expires: g.now + DAY, options: [{ id: 'wait', label: 'Wait', desc: '' }], data: { aircraftId: Object.keys(g.fleet)[0] } });
    expect(g.decisions.length).toBe(n0 + 1);
    g.heads!.opsControl.on = false;
    const fo = p.slots.find((s) => s.role === 'FO')!.crewId!;
    releaseCrew(g, p, fo);
    setFlightsCrew(g, p);
    pushDecision(g, { kind: 'sickCrew', title: 'Sick', body: '', defaultOption: 'callIn', expires: g.now + DAY, options: [{ id: 'callIn', label: 'Call in', desc: '' }], data: { flightId: f.id, crewId: fo } });
    expect(g.decisions.length).toBe(n0 + 2);
    expect(takePause()).toBe('decision');
  });

  it('credit control waits for a late payer, and waives the interest for a Trusted client', () => {
    const g = fixtureGame(87);
    hire(g, 'credit', 1);
    const [a, b] = Object.values(g.clients);
    a.level = 'known';
    b.level = 'trusted';
    const late = (clientId: string) => pushDecision(g, {
      kind: 'latePayment', title: 'Late', body: '', defaultOption: 'wait', expires: g.now + DAY, data: { receivableId: 'none', clientId },
      options: [{ id: 'wait', label: 'Wait', desc: '' }, { id: 'waive', label: 'Waive', desc: '' }, { id: 'factor', label: 'Factor', desc: '' }],
    });
    const n0 = g.decisions.length;
    late(a.id);
    expect(g.messages[0].title).toBe(`Credit control: we wait for ${a.name}`);
    late(b.id);
    expect(g.messages[0].title).toBe(`Credit control: waived the interest for ${b.name}`);
    expect(g.decisions.length).toBe(n0);
  });
});

describe('§5.3 daily and hourly work', () => {
  it('the maintenance planner books a due A-check into a gap and never a C-check', () => {
    const g = fixtureGame(88);
    const ac = Object.values(g.fleet)[0];
    hire(g, 'maintPlanner', 1);
    const st = checkStatus(g, ac);
    ac.maint.fhSinceA = Math.ceil(0.8 * (st.aHoursLeft + ac.maint.fhSinceA));
    ac.maint.fhSinceC = 1e6;
    for (const m of Object.values(g.maintenance)) if (m.aircraftId === ac.id) m.status = 'cancelled';
    dailyHeads(g);
    expect(nextPlanned(g, ac.id, 'A')).toBeTruthy();
    expect(nextPlanned(g, ac.id, 'C')).toBeFalsy();
    expect(g.heads!.maintPlanner.log.some((l) => /booked .* A-check/.test(l.text))).toBe(true);
  });

  it('the fleet planner proposes a ferry home for an idle aircraft; accepting books the ferry', () => {
    const g = fixtureGame(89);
    const ac = Object.values(g.fleet)[0];
    for (const f of Object.values(g.flights)) if (f.aircraftId === ac.id) f.status = 'cancelled';
    ac.at = 'MAD';
    ac.bhSince = Math.floor(g.now / DAY) - 5;
    hire(g, 'fleetPlanner', 1);
    dailyHeads(g);
    const p = g.heads!.fleetPlanner.proposals.find((x) => x.kind === 'ferryHome' && x.data.aircraftId === ac.id);
    expect(p).toBeTruthy();
    expect(p!.cost).toBeGreaterThan(0);
    const r = acceptProposal(g, 'fleetPlanner', p!.id);
    expect(r.ok ? '' : r.error).toBe('');
    const ferries = Object.values(g.flights).filter((f) => f.aircraftId === ac.id && f.kind === 'ferry' && f.status === 'scheduled');
    expect(ferries.length).toBeGreaterThan(0);
    expect(ferries[ferries.length - 1].to).toBe(g.company.homeBase);
    expect(g.heads!.fleetPlanner.proposals).toEqual([]);
  });

  it('a watch rule fires once per subject, pauses with "rule", and fires again only after it clears', () => {
    const g = fixtureGame(90);
    hire(g, 'watch', 1);
    expect(setHeadRules(g, 'watch', { alerts: [{ id: 'r1', kind: 'cashBelow', value: 500_000, action: 'pause', on: true }] }).ok).toBe(true);
    g.company.cash = 400_000;
    clearPause();
    takeCues();
    expect(watchDeskHour(g)).toBe(1);
    expect(g.messages[0].title).toBe('Your rule: cash below $500K');
    expect(takePause()).toBe('rule');
    expect(takeCues()).toContain('ruleAlert');
    expect(watchDeskHour(g)).toBe(0);
    g.company.cash = 900_000;
    expect(watchDeskHour(g)).toBe(0);
    g.company.cash = 300_000;
    expect(watchDeskHour(g)).toBe(1);
    clearPause();
  });

  it('analystView: null unless hired; pure and deterministic; the counter inside the 60 % band', () => {
    const g = fixtureGame(91);
    let o = generateOffer(g, 'adhoc');
    for (let i = 0; i < 20 && !o; i++) o = generateOffer(g);
    expect(o).toBeTruthy();
    expect(analystView(g, o!.id)).toBeNull();
    hire(g, 'analyst', 0.9);
    const state = () => JSON.stringify(JSON.parse(serialize(g)).state);
    const s0 = state();
    const a = analystView(g, o!.id)!;
    expect(a).not.toBeNull();
    expect(analystView(g, o!.id)).toEqual(a);
    expect(state()).toBe(s0);
    expect(['take', 'counter', 'pass', 'busy']).toContain(a.verdict);
    expect(a.lines.length).toBeGreaterThan(0);
    if (a.counter) expect(counterOdds(o!, a.counter / counterBase(o!)).accept).toBeGreaterThanOrEqual(0.6 - 1e-9);
  });
});
