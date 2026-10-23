// v0.9 §Y.1 (UPDATE-0.9.md): a delay after the crew has reported can make an augmented duty's in-flight rest plan
// impossible; the departure re-checks it: the flight is held, the cabin crew read out of hours, never flown illegally.

import { describe, expect, it } from 'vitest';
import { takeCues } from '../core/cues';
import { addFlight } from '../core/entities';
import { typeOf } from '../core/perf';
import { clearPause } from '../core/pause';
import type { Aircraft } from '../core/types';
import { devRestPlan } from '../dev';
import { advanceTo, settle } from '../sim';
import { applyCrewFix, crewAlertKind, crewControl, flightCrewStatus, outOfHours, rerosterFrom, restPlan, shortFlights } from '../crew';
import { fixtureGame } from '../crew/fixtures';
import { segsOf, touchCrewState } from '../crew/timeline';
import { problems } from '../problems';
import { delayFlight } from './flights';
import { turnOf } from './util';

describe('§Y.1 in-flight rest re-checked at departure', () => {
  it('a long delay after report breaks the rest plan: held at the gate, crew out of hours, never departs with it', () => {
    const g = fixtureGame(41);
    const fid = devRestPlan(g);
    const f = g.flights[fid];
    const d0 = g.duties[f.dutyId!];
    expect(d0.augment).toBeGreaterThan(0);
    // Report, then the gate hold grows until the cabin crew can no longer all rest in this cruise.
    advanceTo(g, d0.report + 5, new Set());
    const d = g.duties[f.dutyId!];
    expect(restPlan(g, d.id)?.ok).toBe(true);
    let broke = false;
    for (let h = 0; h < 8 && !broke; h++) {
      delayFlight(g, fid, 60, 'Technical: APU');
      settle(g);
      broke = restPlan(g, g.flights[fid].dutyId ? g.flights[fid].dutyId! : d.id)?.ok === false;
    }
    expect(broke).toBe(true);
    clearPause();
    takeCues();
    const ill0 = g.stats.illegalFlown ?? 0;
    advanceTo(g, g.flights[fid].std + 30, new Set());
    const ff = g.flights[fid];
    if (ff.status !== 'scheduled') {
      // It left only once a legal plan was found (a fresh crew or re-planned turns).
      const dd = ff.dutyId ? g.duties[ff.dutyId] : undefined;
      expect(dd && restPlan(g, dd.id)?.ok !== false).toBe(true);
    } else {
      expect(crewAlertKind(g, fid)).toBe('hours');
      expect(g.messages.some((m) => m.topic === 'crewHours' && m.title.startsWith(`CREW OUT OF HOURS: ${ff.no}`))).toBe(true);
    }
    expect(g.stats.illegalFlown ?? 0).toBe(ill0);
  });
});

/**
 * v0.9 round 4: the rest plan judged at the gate. A late turnaround holds the LIS–GRU departure (the schedule stays,
 * only `delay` grows), so the planned plan still reads OK while the cabin crew's real day no longer fits.
 */
function heldAtGate(seed: number, holdMin: number, cabin: (ac: Aircraft) => void) {
  const g = fixtureGame(seed);
  const fid = devRestPlan(g);
  const f = g.flights[fid];
  const ac = g.fleet[f.aircraftId!];
  cabin(ac);
  rerosterFrom(g, ac.id, g.now);
  const prev = addFlight(g, { no: 'AWL100', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'OPO', to: g.company.homeBase, std: f.std - 8 * 60, sta: f.std - 7 * 60, pax: 100 });
  prev.status = 'done';
  prev.atd = prev.std;
  prev.ata = f.std + holdMin - turnOf(ac);
  const d0 = g.duties[g.flights[fid].dutyId!];
  advanceTo(g, d0.report + 5, new Set());
  const d = g.duties[g.flights[fid].dutyId!];
  expect(restPlan(g, d.id)?.ok).toBe(true);
  clearPause();
  takeCues();
  const ill0 = g.stats.illegalFlown ?? 0;
  advanceTo(g, f.std + holdMin + 1, new Set());
  return { g, fid, d, ill0, std: f.std };
}

describe('§Y.1 re-checked with the actual off-block time (round 4)', () => {
  it('a hold that only breaks the cabin crew\'s rest plan, inside discretion: the commander extends their day and it departs legally', () => {
    // Two curtained business seats for six cabin crew: 2:45 of hold lifts their rest band past what the cruise fits.
    const { g, fid, ill0 } = heldAtGate(44, 165, (ac) => { ac.cabin.j = 4; });
    const f = g.flights[fid];
    expect(f.status).toBe('enroute');
    const d = g.duties[f.dutyId!];
    expect(d.discretion).toBe(165);
    expect(g.messages.some((m) => m.title === `Commander's discretion on ${f.no}` && /hold outran the cabin crew's rest plan/.test(m.body))).toBe(true);
    expect(g.messages.some((m) => m.topic === 'crewHours')).toBe(false);
    expect(g.stats.illegalFlown ?? 0).toBe(ill0);
    expect(g.stats.v09!.discretionPlanned ?? 0).toBe(0);
    // The planned plan stands (the bot's 'impossible rest plan' count reads it): the overrun is under discretion.
    expect(restPlan(g, d.id)?.ok).toBe(true);
  });

  it('a hold past the cabin rest class cap: held, CREW OUT OF HOURS on every surface, and a fresh cabin crew from standby takes it', () => {
    // Economy-seat rest (class 3, a 16:00 cabin day) with the pilots still inside their 16:00 limit after a 2:40 hold.
    const { g, fid, d, ill0, std } = heldAtGate(45, 160, (ac) => { ac.cabin.j = 2; });
    const f = g.flights[fid];
    expect(f.status).toBe('scheduled');
    expect(restPlan(g, d.id)?.ok).toBe(true);
    expect(restPlan(g, d.id, { at: Math.max(f.std + f.delay, g.now) })?.ok).toBe(false);
    expect(crewAlertKind(g, fid)).toBe('hours');
    expect(flightCrewStatus(g, fid).level).toBe('illegal');
    const m = g.messages.find((x) => x.topic === 'crewHours')!;
    expect(m.title).toBe(`CREW OUT OF HOURS: ${f.no} at the gate`);
    expect(m.body).toMatch(/^\S+ \S+ \(purser\) and \d others are out of hours for \w+\. \S+'s rest plan no longer works after the delay/);
    expect(takeCues()).toContain('crewOutOfHours');
    // The ladder, the problems list and the gate decision all see it as out of hours.
    const row = shortFlights(g).find((x) => x.flightId === fid)!;
    expect(row).toMatchObject({ kind: 'hours', stage: 'red' });
    const card = problems(g).find((c) => c.subject.ref.id === fid)!;
    expect(card.subject.kind).toBe('crewHours');
    expect(card.actions.map((a) => a.label).slice(-2)).toEqual(['Sub-charter', 'Cancel']);
    expect(g.decisions.some((x) => x.kind === 'crewShort' && x.title === `Crew out of hours: ${f.no} ${f.from}–${f.to}`)).toBe(true);
    expect(outOfHours(g, fid)[0].limitText).toBe('cannot rest in this cruise');
    // A whole fresh cabin crew on airport standby at the base.
    const p = g.pairings[d.pairingId];
    const on = new Set(Object.values(g.pairings).flatMap((q) => q.slots.map((s) => s.crewId)));
    const fam = typeOf(g.fleet[f.aircraftId!].typeId).family;
    const sby: string[] = [];
    for (const c of Object.values(g.crew)) {
      if (!(c.role === 'PUR' || c.role === 'CC') || !c.ratings.includes(fam) || on.has(c.id) || sby.filter((id) => g.crew[id].role === c.role).length >= (c.role === 'PUR' ? 2 : 6)) continue;
      c.off = [];
      c.blocks = [];
      c.loc = g.company.homeBase;
      c.restUntil = 0;
      c.standby = [{ from: g.now - 30, to: g.now + 8 * 60, kind: 'airport', at: g.company.homeBase }];
      sby.push(c.id);
    }
    touchCrewState(g);
    expect(sby.length).toBe(8);
    const v = crewControl(g, fid)!;
    const call = v.solutions.find((s) => s.id === 'callIn')!;
    expect(call.available, call.why).toBe(true);
    expect(call.preview.changes.filter((c) => /comes off \(out of hours\)/.test(c))).toHaveLength(6);
    expect(call.preview.after.level).toBe('ok');
    const pilots = p.slots.filter((s) => s.role === 'CPT' || s.role === 'FO' || s.role === 'CRP').map((s) => s.crewId);
    const r = applyCrewFix(g, fid, 'callIn');
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    // The replaced seats start a fresh day now (their own report); the pilots keep theirs; the marks are gone.
    const q = g.pairings[g.duties[g.flights[fid].dutyId!].pairingId];
    for (const s of q.slots) {
      if (s.role === 'PUR' || s.role === 'CC') {
        expect(sby).toContain(s.crewId);
        expect(s.from).toBe(g.now);
      } else expect(pilots).toContain(s.crewId);
      expect(s.ooh).toBeUndefined();
    }
    expect(flightCrewStatus(g, fid).level).not.toBe('illegal');
    expect(crewAlertKind(g, fid)).toBeNull();
    expect(restPlan(g, d.id, { at: g.now })?.ok).toBe(true);
    // It leaves at the next attempt, legally: the fresh cabin crew's day runs from their own report, and the pilots'
    // few minutes over their limit after the hold are the commander's discretion (unforeseen, after report).
    advanceTo(g, g.now + 45, new Set());
    const ff = g.flights[fid];
    expect(ff.status).toBe('enroute');
    expect(ff.atd! - std).toBeGreaterThanOrEqual(160);
    expect(g.duties[d.id].discretion ?? 0).toBeGreaterThan(0);
    expect(g.stats.v09!.discretionPlanned ?? 0).toBe(0);
    expect(g.stats.illegalFlown ?? 0).toBe(ill0);
    expect(g.stats.illegalCrewFlown ?? 0).toBe(0);
    const cc = g.crew[q.slots.find((s) => s.role === 'CC')!.crewId!];
    const seg = segsOf(g, cc).find((s) => s.kind === 'duty' && s.dutyId === d.id)!;
    expect(seg.start).toBeGreaterThan(d.report);
    expect(seg.fdp).toBeLessThan(d.fdp);
  });
});
