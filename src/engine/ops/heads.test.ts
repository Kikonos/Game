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
import { blockMinutes, typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { GameState, HeadId } from '../core/types';
import { flightCrewStatus } from '../crew';
import { buildDuties } from '../crew/duties';
import { addCrew, fixtureContract, fixtureGame } from '../crew/fixtures';
import { autoRoster, releaseCrew, setFlightsCrew } from '../crew/roster';
import { serialize } from '../save';
import { checkAchievements } from './achievements';
import {
  acceptProposal, analystView, dailyHeads, defaultRules, dismissProposal, fireHead, headsView, headView, hireHead, mistakeRoll, monthlyHeads, rollCandidates, setHeadRules, unlockHead, watchDeskHour,
} from './heads';
import { checkStatus, nextPlanned, scheduleCheck } from './maintenance';
import { dayIndex, v09Stats } from '../crew/dayPlan';
import { acceptOffer, feasibilityAll } from '../contracts';
import { onContractEnd } from '../contracts/accept';
import { applyDecisionOption, reopenLatePayment } from './events';
import { nextId } from '../core/entities';

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

describe('§5.3 round 4 (audit): heads', () => {
  /** A signed one-way job TLV–LIS two days out, the A320 at LIS: same-day positioning LIS–TLV lands 45 min before it. */
  function job(seed: number, to = 'TLV') {
    const g = fixtureGame(seed);
    const acId = Object.keys(g.fleet)[0];
    const ac = g.fleet[acId];
    for (const f of Object.values(g.flights)) if (f.aircraftId === acId) f.status = 'cancelled';
    ac.at = 'LIS';
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * 60;
    const b = blockMinutes(ac.typeId, to, 'LIS');
    const k = fixtureContract(g, { title: 'Winter sun', pattern: { kind: 'legs', legs: [] }, aircraftIds: [acId], start: std - DAY, end: std + 2 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false } });
    const turn = 45;
    const pos = addFlight(g, { no: 'AW9001', aircraftId: acId, contractId: k.id, kind: 'positioning', from: 'LIS', to, std: std - turn - b, sta: std - turn });
    const f0 = addFlight(g, { no: 'AW970', aircraftId: acId, contractId: k.id, kind: 'revenue', from: to, to: 'LIS', std, sta: std + b, pax: 170 });
    buildDuties(g, acId, g.now, g.now + 5 * DAY);
    for (const id of addCrew(g, { CPT: 2, FO: 3, PUR: 1, CC: 3 })) g.crew[id].off = [];
    autoRoster(g);
    return { g, ac, k, pos, f0 };
  }

  it('fleet planner: a contract two days out whose same-day positioning leaves no FDP margin → a position proposal for the day before; Accept re-plans the empty legs', () => {
    const { g, ac, k, pos, f0 } = job(92);
    hire(g, 'fleetPlanner', 1);
    takeCues();
    dailyHeads(g);
    const p = g.heads!.fleetPlanner.proposals.find((x) => x.kind === 'position');
    expect(p).toBeTruthy();
    expect(p!.data).toMatchObject({ aircraftId: ac.id, to: 'TLV', contractId: k.id, arriveBy: f0.std - BAL.v09.heads.fleet.arriveBeforeMin });
    expect(p!.text).toMatch(/^Position .* LIS–TLV the day before Winter sun: /);
    expect(p!.cost).toBeGreaterThan(0);
    expect(g.messages[0].title).toBe(`${g.heads!.fleetPlanner.hired!.name.split(' ')[0]} proposes: ${p!.text}`);
    expect(takeCues()).toContain('decision');
    // Once a day, not twice.
    dailyHeads(g);
    expect(g.heads!.fleetPlanner.proposals.filter((x) => x.kind === 'position').length).toBe(1);
    const r = acceptProposal(g, 'fleetPlanner', p!.id);
    expect(r.ok ? '' : r.error).toBe('');
    expect(g.flights[pos.id]).toBeUndefined();
    const moved = Object.values(g.flights).filter((f) => f.aircraftId === ac.id && f.kind === 'positioning' && f.status === 'scheduled' && f.contractId === k.id);
    expect(moved.length).toBeGreaterThan(0);
    expect(Math.max(...moved.map((f) => f.sta))).toBeLessThanOrEqual(f0.std - BAL.v09.heads.fleet.arriveBeforeMin);
    expect(moved[moved.length - 1].to).toBe('TLV');
    expect(g.heads!.fleetPlanner.proposals).toEqual([]);
  });

  it('a dismissed proposal stays away (14 days, or until the situation changes) and is on the log', () => {
    const { g, ac } = job(93);
    hire(g, 'fleetPlanner', 1);
    dailyHeads(g);
    const h = g.heads!.fleetPlanner;
    const p = h.proposals.find((x) => x.kind === 'position')!;
    expect(dismissProposal(g, 'fleetPlanner', p.id).ok).toBe(true);
    expect(h.log[0].text).toMatch(/^Dismissed until .*: Position /);
    g.now += DAY;
    dailyHeads(g);
    expect(h.proposals).toEqual([]);
    // The ferry-home subject includes where the aircraft is: at MAD it is proposed, dismissed, not again the next day; after 14 days it is.
    for (const f of Object.values(g.flights)) if (f.aircraftId === ac.id) f.status = 'cancelled';
    ac.at = 'MAD';
    ac.bhSince = Math.floor(g.now / DAY) - 5;
    dailyHeads(g);
    const q = h.proposals.find((x) => x.kind === 'ferryHome')!;
    expect(q).toBeTruthy();
    dismissProposal(g, 'fleetPlanner', q.id);
    g.now += DAY;
    dailyHeads(g);
    expect(h.proposals.find((x) => x.kind === 'ferryHome')).toBeUndefined();
    g.now += 14 * DAY;
    dailyHeads(g);
    expect(h.proposals.find((x) => x.kind === 'ferryHome')).toBeTruthy();
  });

  it('defaults read BAL; alert rules without an id get one from the game sequence, distinct in one tick', () => {
    expect(defaultRules('opsControl').maxDelayMin).toBe(BAL.v09.heads.ops.maxDelayMin);
    expect(defaultRules('crewDesk').fixMax).toBe(BAL.v09.heads.desk.fixMax);
    const g = fixtureGame(94);
    hire(g, 'watch', 1);
    expect(setHeadRules(g, 'watch', { alerts: [{ id: '', kind: 'cashBelow', value: 500_000, action: 'alert', on: true }, { id: '', kind: 'delayOver', value: 2, action: 'alert', on: true }] }).ok).toBe(true);
    const ids = g.heads!.watch.rules.alerts!.map((a) => a.id);
    expect(ids[0]).toMatch(/^ar/);
    expect(ids[1]).not.toBe(ids[0]);
    // Kept on a re-save, and never Date.now.
    setHeadRules(g, 'watch', { alerts: g.heads!.watch.rules.alerts!.map((a) => ({ ...a, on: false })) });
    expect(g.heads!.watch.rules.alerts!.map((a) => a.id)).toEqual(ids);
  });

  it('watch desk: a held alert whose subject cleared is a mistake on the record (never a silent miss)', () => {
    const g = fixtureGame(95);
    hire(g, 'watch', 1);
    setHeadRules(g, 'watch', { alerts: [{ id: 'r1', kind: 'cashBelow', value: 500_000, action: 'alert', on: true }] });
    const h = g.heads!.watch;
    h.recent = [['w:r1:cash', g.now + 60]];
    g.company.cash = 900_000;
    expect(watchDeskHour(g)).toBe(0);
    expect(h.mistakes).toBe(1);
    expect(h.log[0]).toMatchObject({ kind: 'mistake', text: 'The alert on cash below $500K was held an hour and the subject cleared before it went out' });
    expect(h.recent).toEqual([]);
  });

  it('Ops Control: "standby first" leaves the sick call to the player when only a day-off crew member could take it; off, every sick call comes to you; a ticket mistake only where a standby was free', () => {
    const { g, f, p } = trip(96);
    hire(g, 'opsControl', 1);
    const fo = p.slots.find((s) => s.role === 'FO')!.crewId!;
    releaseCrew(g, p, fo);
    setFlightsCrew(g, p);
    const d = g.duties[f.dutyId!];
    g.crew[fo].blocks = [{ from: g.now - 60, to: d.release + DAY, why: 'sick' }];
    // Every other pilot (a captain may fly as FO) on a published day off over the duty.
    const on = new Set(p.slots.map((s) => s.crewId));
    const spares = Object.values(g.crew).filter((c) => (c.role === 'FO' || c.role === 'CPT') && !on.has(c.id) && c.id !== fo);
    for (const c of spares) c.off = [dayIndex(c.base, d.report) - 1, dayIndex(c.base, d.report), dayIndex(c.base, d.release) + 1];
    const sick = () => pushDecision(g, {
      kind: 'sickCrew', title: 'Sick', body: '', defaultOption: 'callIn', expires: g.now + DAY, ref: { kind: 'flight', id: f.id }, data: { flightId: f.id, crewId: fo },
      options: [{ id: 'callIn', label: 'Call in', desc: '' }, { id: 'subcharter', label: 'Sub', desc: '' }, { id: 'cancel', label: 'Cancel', desc: '' }],
    });
    clearPause();
    const n0 = g.decisions.length;
    sick();
    expect(g.decisions.length).toBe(n0 + 1);
    expect(flightCrewStatus(g, f.id).level).toBe('missing');
    g.decisions.pop();
    // A spare on home standby over the departure: taken, and never "a ticket" (the standby is the cheapest, real choice).
    const s = spares[0];
    s.off = [];
    s.standby = [{ from: f.std - 10 * 60, to: f.std + 60 }];
    clearPause();
    sick();
    expect(g.decisions.length).toBe(n0);
    expect(g.messages[0].title).toMatch(/^Ops Control called in /);
    expect(g.messages[0].body).not.toMatch(/ticket/);
    expect(g.messages[0].body).toMatch(/is on standby at LIS, no delay/);
    // Rule off: the sick call is the player's.
    const { g: g2, f: f2, p: p2 } = trip(97);
    hire(g2, 'opsControl', 1);
    setHeadRules(g2, 'opsControl', { standbyFirst: false });
    const fo2 = p2.slots.find((s) => s.role === 'FO')!.crewId!;
    releaseCrew(g2, p2, fo2);
    setFlightsCrew(g2, p2);
    g2.crew[fo2].blocks = [{ from: g2.now - 60, to: g2.now + 5 * DAY, why: 'sick' }];
    clearPause();
    const m0 = g2.decisions.length;
    pushDecision(g2, { kind: 'sickCrew', title: 'Sick', body: '', defaultOption: 'callIn', expires: g2.now + DAY, options: [{ id: 'callIn', label: 'Call in', desc: '' }], data: { flightId: f2.id, crewId: fo2 } });
    expect(g2.decisions.length).toBe(m0 + 1);
    clearPause();
  });

  it('Ops Control holds a flight at the gate only while no penalty is due: 3 h late on any contract kind (VIP 30 min) is the player\'s call', () => {
    const { g, f } = trip(98);
    hire(g, 'opsControl', 1);
    const short = () => pushDecision(g, {
      kind: 'crewShort', title: 'Short', body: '', defaultOption: 'delay', expires: g.now + DAY, ref: { kind: 'flight', id: f.id }, data: { flightId: f.id },
      options: [{ id: 'delay', label: 'Wait', desc: '' }, { id: 'cancel', label: 'Cancel', desc: '' }],
    });
    g.now = f.std;
    clearPause();
    const n0 = g.decisions.length;
    short();
    expect(g.decisions.length).toBe(n0);
    expect(g.messages[0].title).toBe(`Ops Control held ${f.no} for a legal crew`);
    expect(g.messages[0].body).toMatch(/no penalty\.$/);
    // The same flight already 3 h late (wet or charter alike): left to the player.
    f.schedStd = f.std - 180;
    clearPause();
    short();
    expect(g.decisions.length).toBe(n0 + 1);
    g.decisions.pop();
    f.schedStd = f.std - 40;
    g.contracts[f.contractId!].requirements.standards = 'vip';
    clearPause();
    short();
    expect(g.decisions.length).toBe(n0 + 1);
    clearPause();
  });

  it('credit control\'s note carries the receivable; "Change" re-asks the decision (never taken by the head again) and the player\'s choice counts as overridden', () => {
    const g = fixtureGame(99);
    hire(g, 'credit', 1);
    const cl = Object.values(g.clients)[0];
    cl.level = 'known';
    const r = { id: nextId(g, 'rc'), clientId: cl.id, contractId: null, desc: 'Test invoice', amount: 50_000, issued: g.now - 40 * DAY, due: g.now - 10 * DAY, payAt: g.now + 5 * DAY, paid: null, cat: 'charterRevenue' as const };
    g.finance.receivables.push(r);
    const n0 = g.decisions.length;
    pushDecision(g, {
      kind: 'latePayment', title: 'Late', body: '', defaultOption: 'wait', expires: g.now + DAY, ref: { kind: 'receivable', id: r.id }, data: { receivableId: r.id, clientId: cl.id },
      options: [{ id: 'wait', label: 'Wait', desc: '' }, { id: 'waive', label: 'Waive', desc: '' }],
    });
    expect(g.decisions.length).toBe(n0);
    expect(g.messages[0].ref).toEqual({ kind: 'receivable', id: r.id });
    const h = g.heads!.credit;
    expect(h.overridden).toBe(0);
    const re = reopenLatePayment(g, r.id);
    expect(re.ok).toBe(true);
    const d = g.decisions.find((x) => re.ok && x.id === re.data!.decisionId)!;
    expect(d).toBeTruthy();
    expect(d.ref).toEqual({ kind: 'receivable', id: r.id });
    expect(applyDecisionOption(g, d, 'waive').ok).toBe(true);
    expect(h.overridden).toBe(1);
    expect(h.log[0].kind).toBe('overridden');
    clearPause();
  });

  it('the analyst\'s estimate is noted at signing and judged when the contract ends: a 55-skill analyst logs at least one mistake over 10 contracts, exactly the estimates off by the threshold', () => {
    const g = fixtureGame(100);
    hire(g, 'analyst', 0.55);
    const h = g.heads!.analyst;
    let n = 0;
    // Round 5: ten contracts, and on until one estimate is off by the threshold (the error is fixed per offer id, so the
    // first ten can all happen to fall inside it); every judgement is then checked against its own estimate.
    let off = 0;
    for (let i = 0; i < 80 && (n < 10 || off === 0); i++) {
      const o = generateOffer(g, i % 2 ? 'adhoc' : 'aogCover');
      if (!o || o.product.kind === 'dry') continue;
      const fit = feasibilityAll(g, o.id).find((x) => (x.level === 'ok' || x.level === 'warn') && x.estRevenue > 0);
      if (!fit) continue;
      const r = acceptOffer(g, o.id, [fit.aircraftId]);
      if (!r.ok) continue;
      const c = g.contracts[r.data!.contractId];
      expect(c.analyst).toBeTruthy();
      expect(c.analyst!.name).toBe(h.hired!.name);
      // The job ends: its legs gone, the end event lands.
      for (const f of Object.values(g.flights)) if (f.contractId === c.id) delete g.flights[f.id];
      onContractEnd(g, { t: g.now, type: 'contract.end', id: c.id, v: 0, seq: 0 });
      expect(c.status).toBe('completed');
      n++;
      if (Math.abs(c.analyst!.pct / c.analyst!.est - 1) >= BAL.v09.heads.analystErr) off++;
    }
    expect(n).toBeGreaterThanOrEqual(10);
    expect(h.handled).toBe(n);
    expect(h.log.some((l) => l.kind === 'mistake' && /estimated the .* margin: said .* %, it was .* %$/.test(l.text))).toBe(true);
    expect(h.mistakes).toBe(off);
    expect(h.mistakes).toBeGreaterThanOrEqual(1);
    expect(h.mistakes).toBeLessThan(n);
  });

  it('maintenance planner: a clashing A-check is moved only when a replacement slot exists; else it stays booked with one warning; a C-slot proposal survives Accept until the check is booked', () => {
    const g = fixtureGame(101);
    const ac = Object.values(g.fleet)[0];
    hire(g, 'maintPlanner', 1);
    for (const f of Object.values(g.flights)) if (f.aircraftId === ac.id) f.status = 'cancelled';
    for (const m of Object.values(g.maintenance)) if (m.aircraftId === ac.id) m.status = 'cancelled';
    const t0 = Math.ceil(g.now / 60) * 60;
    expect(scheduleCheck(g, ac.id, 'A', t0 + DAY + 6 * 60, g.company.homeBase).ok).toBe(true);
    const planned = nextPlanned(g, ac.id, 'A')!;
    // Then wall-to-wall legs for four days (LIS–FNC–LIS), one over the slot, and the check due within a day.
    const b = blockMinutes(ac.typeId, 'LIS', 'FNC');
    for (let t = t0 + 60; t < t0 + 4 * DAY; t += 2 * b + 90) {
      addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'FNC', std: t, sta: t + b, pax: 100 });
      addFlight(g, { no: 'AW2', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FNC', to: 'LIS', std: t + b + 45, sta: t + 2 * b + 45, pax: 100 });
    }
    const st = checkStatus(g, ac);
    ac.maint.fhSinceA = Math.ceil(0.99 * (st.aHoursLeft + ac.maint.fhSinceA));
    const m0 = g.messages.length;
    dailyHeads(g);
    expect(g.maintenance[planned.id].status).toBe('planned');
    const warns = () => g.messages.slice(0, g.messages.length - m0).filter((m) => /can't move .* A-check/.test(m.title));
    expect(warns().length).toBe(1);
    expect(warns()[0].tone).toBe('warn');
    expect(g.heads!.maintPlanner.log.some((l) => /took .* off/.test(l.text))).toBe(false);
    g.now += DAY;
    dailyHeads(g);
    expect(warns().length).toBe(1);
    // The C-check slot: proposed, Accept keeps it (the check planner opens), booking the check ends it.
    const g2 = fixtureGame(102);
    const ac2 = Object.values(g2.fleet)[0];
    hire(g2, 'maintPlanner', 1);
    for (const m of Object.values(g2.maintenance)) if (m.aircraftId === ac2.id) m.status = 'cancelled';
    ac2.maint.lastC = g2.now - (typeOf(ac2.typeId).cCheckMonths - 3) * 30 * DAY;
    dailyHeads(g2);
    const p = g2.heads!.maintPlanner.proposals.find((x) => x.kind === 'cSlot');
    expect(p).toBeTruthy();
    expect(acceptProposal(g2, 'maintPlanner', p!.id)).toEqual({ ok: true, msg: 'Pick the slot in the check planner' });
    expect(g2.heads!.maintPlanner.proposals.some((x) => x.id === p!.id)).toBe(true);
    g2.maintenance.cx = { id: 'cx', aircraftId: ac2.id, kind: 'C', at: g2.company.homeBase, start: Number(p!.data.from), end: Number(p!.data.from) + 20 * DAY, cost: 1, status: 'planned', planned: true, ev: 0 };
    dailyHeads(g2);
    expect(g2.heads!.maintPlanner.proposals.some((x) => x.id === p!.id)).toBe(false);
  });
});
