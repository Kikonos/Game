// v0.7.3 the rules in the roster (UPDATE-0.7.3.md §2.3, §3): the plan order (basic → split → extension → 3 → 4
// pilots), the cabin crew reporting with the pilots (C2), extra cabin crew for rest, delayed reporting, the dev
// scenes, home standby and Crew Control's call-in.

import { describe, expect, it } from 'vitest';
import { addFlight, retimeFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { AcRest, GameState } from '../core/types';
import { devExtension, devRestPlan, devShortCruise, devSplit, devStandby } from '../dev';
import { problems } from '../ops';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { applyCrewFix, autoRoster, buildDuties, crewControl, fdpWhy, restPlan, restPlanForFlight, setDutyAugment } from '.';
import { syncDuty } from './duties';
import { dailyStandby, dropStandby, onStandby } from './standby';
import { evalSegs, type Seg } from './rules';
import { ctxOf, dutySegs, segsOf } from './timeline';
import { createGame } from '../newGame';

const H = 60;
const newDev = () => createGame({ name: 'Dev Air', code: 'DV', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 9 });

/** An A330-300 (440 seats: 9 cabin crew) with these facilities and crew, the augmented approval held. */
function wide(g: GameState, rest: AcRest = { fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 1, kind: 'ldmcr', places: 7 } }) {
  g.company.approvals.push('augmented');
  const ac = Object.values(g.fleet)[0];
  ac.typeId = 'a333';
  ac.cabin = { ...ac.cabin, total: 440, y: 440, j: 0, w: 0 };
  ac.rest = rest;
  addCrew(g, { CPT: 6, FO: 6, PUR: 4, CC: 30 }, 'A330/340');
  const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 8 * 60;
  fixtureContract(g, { aircraftIds: [ac.id], start: std, end: std + 3 * DAY, pattern: { kind: 'legs', legs: [] }, product: { kind: 'charter', price: 1, depositPct: 0, balanceDaysBefore: 0, fuelEscalation: false } });
  return { ac, std };
}

describe('the plan order (v0.7.3 §2.3)', () => {
  it('C2: 4 pilots + class 1 + one long sector is 18:00, the cabin crew reporting with the pilots', () => {
    const g = fixtureGame();
    const { ac, std } = wide(g);
    addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'SIN', std, sta: std + 15 * H + 45 });
    const [d] = buildDuties(g, ac.id, g.now, g.now + 5 * DAY);
    expect(d.augment).toBe(2);
    expect(d.maxFdp).toBe(18 * H);
    expect(d.cabinEarly).toBe(0);
    expect(d.legality).not.toBe('illegal');
    expect(g.pairings[d.pairingId].slots.filter((s) => s.role === 'CPT' || s.role === 'FO').length).toBe(4);
  });
  it('extra cabin crew when half the crew working leaves no room: the complement grows by restExtra', () => {
    const g = fixtureGame();
    const { ac, std } = wide(g, { fc: { cls: 2, kind: 'jSeats', places: 2 }, cc: { cls: 2, kind: 'jSeats', places: 6 } });
    addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'GRU', std, sta: std + 400 });
    addFlight(g, { no: 'AW2', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'GRU', to: 'LIS', std: std + 460, sta: std + 860 });
    const [d] = buildDuties(g, ac.id, g.now, g.now + 5 * DAY);
    expect(d.augment).toBe(2);
    expect(d.restExtra).toBe(1);
    const p = g.pairings[d.pairingId];
    expect(p.slots.filter((s) => (s.role === 'PUR' || s.role === 'CC') && !s.above).length).toBe(10);
    const plan = restPlan(g, d.id)!;
    expect(plan.ok).toBe(true);
    expect(plan.extraCabin).toBe(1);
    expect(plan.cabin.map((t) => t.n)).toEqual([5, 5]);
  });
  it('dev scenes: a class 2 rest plan, a cruise too short, an extension, a split duty', () => {
    let g = newDev();
    const a = devRestPlan(g);
    const pa = restPlanForFlight(g, a)!;
    expect(pa.ok).toBe(true);
    expect(pa.pilots.every((t) => t.crewIds.length === 1)).toBe(true);
    expect(pa.blocked[a]).toBe(7);
    expect(fdpWhy(g, g.flights[a].dutyId!)!.why).toMatch(/^Why 16:00\? 3 pilots with business seats \(class 2\) allow 16 h/);
    // "fly it with 4 pilots" re-crews with two captains and two first officers
    const d = g.duties[g.flights[a].dutyId!];
    expect(setDutyAugment(g, d.id, 2).ok).toBe(true);
    expect(g.duties[d.id].augment).toBe(2);
    expect(g.pairings[g.duties[d.id].pairingId].slots.filter((s) => s.role === 'CPT').length).toBe(2);
    g = newDev();
    const b = devShortCruise(g);
    const pb = restPlanForFlight(g, b)!;
    expect(pb.ok).toBe(false);
    expect(pb.code).toBe('tooShort');
    expect(pb.why).toMatch(/landing pilots each need 2 hours in a row/);
    const card = problems(g).find((c) => c.subject.kind === 'restTooShort');
    expect(card?.what).toMatch(/^No in-flight rest possible on /);
    expect(card?.hurt.text).toMatch(/fresh crew at/);
    g = newDev();
    const e = g.duties[devExtension(g)];
    expect(e.ext).toBe(true);
    expect([e.basicFdp, e.maxFdp]).toEqual([13 * H, 14 * H]);
    expect(e.legality).not.toBe('illegal');
    const p = g.pairings[e.pairingId];
    const c = g.crew[p.slots.find((s) => s.crewId)!.crewId!];
    const seg = dutySegs(g, c, p, e, null, null).find((x) => x.kind === 'duty')!;
    expect(seg.ext).toBe(true);
    expect(seg.rest).toBe(Math.max(seg.end - seg.start, 12 * H) + 4 * H);
    g = newDev();
    const s = g.duties[devSplit(g)];
    expect(s.split).toMatchObject({ at: 'FNC', net: 210, room: 'hotel' });
    expect([s.basicFdp, s.maxFdp]).toEqual([11 * H, 12 * H + 45]);
  });
  it('extension and split never merge two units into a longer day', () => {
    const g = newDev();
    const ac = Object.values(g.fleet)[0];
    // two out-and-backs from base 6 h apart: one long day would need an extension; two duties instead
    const day = Math.ceil((g.now + 3 * DAY) / DAY) * DAY + 7 * H;
    addFlight(g, { no: 'X1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'FAO', std: day, sta: day + 50 });
    addFlight(g, { no: 'X2', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FAO', to: 'LIS', std: day + 100, sta: day + 150 });
    addFlight(g, { no: 'X3', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'PMI', std: day + 400, sta: day + 560 });
    addFlight(g, { no: 'X4', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'PMI', to: 'LIS', std: day + 610, sta: day + 770 });
    const ds = buildDuties(g, ac.id, g.now, g.now + 6 * DAY).filter((d) => d.flightIds.some((id) => g.flights[id].no.startsWith('X')));
    expect(ds.every((d) => !d.ext && !d.split)).toBe(true);
  });
});

describe('delayed reporting (CS FTL.1.205(d))', () => {
  const setup = () => {
    const g = fixtureGame();
    const ac = Object.values(g.fleet)[0];
    // report 04:30 local (LIS is UTC+0 in March): the 17:00–04:59 band (11:00)
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 5 * H + 30;
    const a = addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'FAO', std, sta: std + 50 });
    const b = addFlight(g, { no: 'AW2', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FAO', to: 'LIS', std: std + 100, sta: std + 150 });
    const [d] = buildDuties(g, ac.id, g.now, g.now + 5 * DAY);
    autoRoster(g, { aircraftIds: [ac.id] });
    const p = g.pairings[d.pairingId];
    syncDuty(g, d, p);
    expect(d.notified).toBe(d.report);
    expect(d.maxFdp).toBe(11 * H);
    const shift = (min: number, now: number) => {
      g.now = now;
      retimeFlight(g, a, a.std + min, a.sta + min);
      retimeFlight(g, b, b.std + min, b.sta + min);
      syncDuty(g, d, p);
    };
    return { g, d, shift };
  };
  it('under 4 h: the limit of the report the crew were told (04:30 → 06:00 keeps 11:00, not 13:00)', () => {
    const { d, shift } = setup();
    shift(90, d.report - 10 * H);
    expect(d.report - d.notified!).toBe(90);
    expect(d.maxFdp).toBe(11 * H);
  });
  it('4–10 h: the more limiting of the two; 10 h or more: a new day', () => {
    const a = setup();
    a.shift(5 * H, a.d.report - 10 * H);
    expect(a.d.maxFdp).toBe(11 * H);
    const b = setup();
    b.shift(10 * H + 30, b.d.report - 10 * H);
    expect(b.d.notified).toBe(b.d.report);
    expect(b.d.maxFdp).toBe(12 * H);
  });
  it('a change made 18 h or more before the told report is a new roster, not a delay', () => {
    const { d, shift } = setup();
    shift(90, d.report - 20 * H);
    expect(d.notified).toBe(d.report);
    expect(d.maxFdp).toBe(13 * H);
  });
});

describe('home standby (CS FTL.1.225(b))', () => {
  it('the daily roster puts 1 CPT, FO, PUR and CC per family on standby 06:00–18:00 at base for 2 days', () => {
    const g = newDev();
    dailyStandby(g);
    const on = Object.values(g.crew).filter((c) => c.standby?.length);
    const byRole = (r: string) => on.filter((c) => c.role === r).reduce((n, c) => n + c.standby!.length, 0);
    expect([byRole('CPT'), byRole('FO'), byRole('PUR'), byRole('CC')]).toEqual([2, 2, 2, 2]);
    for (const c of on) {
      for (const w of c.standby!) {
        expect(w.to - w.from).toBe(12 * H);
        expect(c.base).toBe('LIS');
        // never someone on leave or sick
        expect(c.blocks?.some((b) => b.from < w.to && b.to > w.from) ?? false).toBe(false);
      }
    }
    // idempotent
    dailyStandby(g);
    expect(Object.values(g.crew).reduce((n, c) => n + (c.standby?.length ?? 0), 0)).toBe(8);
    // standby is not rest, and counts 25 %
    const c = on[0];
    expect(segsOf(g, c).some((s) => s.kind === 'sby' && s.share === 0.25)).toBe(true);
  });
  it('planned work replaces standby not yet started: the check ignores it, the assignment drops it', () => {
    const g = newDev();
    dailyStandby(g);
    const c = Object.values(g.crew).find((x) => x.role === 'CPT' && x.standby?.some((w) => w.from > g.now))!;
    const w = c.standby!.find((x) => x.from > g.now)!;
    const ctx = ctxOf(g, c);
    const sby = segsOf(g, c).find((x) => x.kind === 'sby' && x.start === w.from)!;
    // A fresh duty overlapping the window: legal (the window is dropped from the view), as is one 2 days later.
    const duty = (start: number): Seg => ({ kind: 'duty', start, end: start + 8 * H, fdp: 7 * H, maxFdp: 13 * H, block: 5 * H, sectors: 2, aug: false, disruptive: false, rest: 12 * H, at: 'LIS', from: 'LIS', dutyId: 'x', fresh: true });
    for (const t of [w.from + 2 * H, w.to + 2 * DAY]) {
      const issues = evalSegs(ctx, [...segsOf(g, c), duty(t)].sort((a, b) => a.start - b.start));
      expect(issues.filter((i) => i.level === 'illegal').map((i) => i.code)).toEqual([]);
    }
    expect(sby.share).toBe(0.25);
    dropStandby(g, c, w.to + 3 * DAY);
    expect(c.standby?.some((x) => x.from === w.from) ?? false).toBe(false);
    // A window already running stays (it is a call-out if a duty reports inside it).
    const run = { from: g.now - H, to: g.now + 11 * H };
    c.standby = [run];
    dropStandby(g, c, g.now + 3 * DAY);
    expect(c.standby).toEqual([run]);
  });
  it('Crew Control calls a captain on standby first: no overtime, the call counted', () => {
    const g = newDev();
    const fid = devStandby(g);
    expect(fid).not.toBe('');
    const v = crewControl(g, fid)!;
    const s = v.solutions.find((x) => x.id === 'callIn')!;
    expect(s.options![0].label).toMatch(/On home standby since/);
    expect(s.chips).toEqual(['No overtime', 'Home standby']);
    const sal = g.finance.current.lines.salaries ?? 0;
    const r = applyCrewFix(g, fid, 'callIn');
    expect(r.ok).toBe(true);
    expect(g.finance.current.lines.salaries ?? 0).toBe(sal);
    expect(g.stats.standbyCalls).toBe(1);
    const called = Object.values(g.crew).find((c) => c.standby?.some((w) => w.calledAt !== undefined))!;
    expect(onStandby(g, called.id, g.now)).toBeNull();
  });
});
