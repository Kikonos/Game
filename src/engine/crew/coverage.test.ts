// v0.5.2 crew coverage (fix lane, round 2): tour gaps, plan-time FDP clock, under-way splits, tickets around rest.

import { describe, expect, it } from 'vitest';
import { addDeadhead, addFlight, retimeFlight } from '../core/entities';
import { blockMinutes, reportMinutes, typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { GameState, Pairing } from '../core/types';
import { settle } from '../sim';
import { openDuties } from './check';
import { evalSegs, localMin, maxFdp, minRest } from './rules';
import { ctxOf, segsOf } from './timeline';
import { fixtureGame, seasonBase } from './fixtures';
import { emptyResult, fillAll, releaseCrew, stayOn } from './roster';
import { autoRoster } from '.';

function allCrewLegal(g: GameState): string[] {
  const bad: string[] = [];
  for (const c of Object.values(g.crew)) {
    const issues = evalSegs(ctxOf(g, c), segsOf(g, c)).filter((i) => i.level === 'illegal');
    if (issues.length) bad.push(`${c.id}:${issues.map((i) => i.code).join(',')}`);
  }
  return bad;
}

const day0 = (g: GameState) => Math.floor(g.now / DAY) * DAY;
const ticketsOf = (g: GameState, id: string) => Object.values(g.flights).filter((f) => f.kind === 'deadhead' && f.status === 'scheduled' && f.crewIds.includes(id));

describe('tour seats', () => {
  it('a seat nobody can take from the first duty is filled from the first later duty someone can (the tour is split)', () => {
    const g = fixtureGame();
    g.company.policies.rotationWeeks = 4;
    const ac = Object.keys(g.fleet)[0];
    seasonBase(g, ac, 'HAM', 'PMI', [6 * 60, 12 * 60 + 30], 21);
    autoRoster(g, { to: g.now + 30 * DAY });
    const tour = Object.values(g.pairings).filter((p) => p.tour && openDuties(g, p).length >= 4).sort((a, b) => a.start - b.start)[0];
    const fo = tour.slots.find((s) => s.role === 'FO')!;
    const sick = g.crew[fo.crewId!];
    // The tour's FO is sick over its first two duties; every other FO is busy (excluded).
    const ds = openDuties(g, tour);
    sick.blocks = [{ from: ds[0].report - DAY, to: ds[1].release + 60, why: 'sick' }];
    releaseCrew(g, tour, sick.id);
    const others = new Set(Object.values(g.crew).filter((c) => c.role === 'FO' && c.id !== sick.id).map((c) => c.id));
    fillAll(g, [tour], emptyResult(), others);
    const parts = Object.values(g.pairings).filter((p) => p.tour && p.slots.some((s) => s.crewId === sick.id) && p.dutyIds.some((id) => ds.some((d) => d.id === id)));
    expect(parts).toHaveLength(1);
    const later = parts[0];
    expect(later.id).not.toBe(tour.id);
    expect(later.start).toBeGreaterThanOrEqual(ds[1].release);
    expect(tour.slots.find((s) => s.role === 'FO')!.crewId).toBeNull();
    // The rest of the tour's crew fly both parts.
    const crew = (p: Pairing) => p.slots.filter((s) => s.role !== 'FO').map((s) => s.crewId);
    expect(crew(later)).toEqual(crew(tour));
  });
});

describe('plan-time FDP clock', () => {
  it('an early 4-sector day at a station an hour ahead of base is cut by the stricter clock (no illegal duty)', () => {
    const g = fixtureGame();
    const ac = Object.values(g.fleet)[0];
    const turn = typeOf(ac.typeId).turnMin;
    const rm = reportMinutes(ac.typeId);
    // Report 04:30 UTC: 04:30 at LIS (base clock for the first 48 h), 05:30 at FRA.
    const lim = (tz: string) => maxFdp({ reportLocal: localMin(tz, day0(g) + 2 * DAY + 4 * 60 + 30), sectors: 4, acclimatised: true, augment: 0, restClass: null, longestBlock: 0 });
    const dest = ['BCN', 'MAD', 'FCO', 'VIE', 'LHR', 'CPH', 'OPO', 'NAP', 'PRG', 'ARN'].find((x) => {
      const fdp = rm.report + 2 * (blockMinutes(ac.typeId, 'FRA', x) + blockMinutes(ac.typeId, x, 'FRA')) + 3 * turn;
      return fdp > lim('LIS') && fdp <= lim('FRA') - 30;
    });
    expect(dest).toBeDefined();
    const out = blockMinutes(ac.typeId, 'FRA', dest!);
    const back = blockMinutes(ac.typeId, dest!, 'FRA');
    const w1 = 5 * 60 + 30 + rm.report; // FRA local
    seasonBase(g, ac.id, 'FRA', dest!, [w1, w1 + out + back + 2 * turn], 6);
    autoRoster(g, { to: g.now + 10 * DAY });
    expect(Object.values(g.duties).filter((d) => d.legality === 'illegal')).toEqual([]);
  });
});

describe('under way', () => {
  it('a leg held to the next day after the first landing becomes a duty of its own (hotel in between)', () => {
    const g = fixtureGame();
    const ac = Object.values(g.fleet)[0];
    const std = day0(g) + 2 * DAY + 8 * 60;
    const f1 = addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'ZAG', std, sta: std + 185 });
    const f2 = addFlight(g, { no: 'AW2', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'ZAG', to: 'LIS', std: std + 230, sta: std + 415 });
    autoRoster(g);
    const d = g.duties[f1.dutyId!];
    expect(f2.dutyId).toBe(d.id);
    const p = g.pairings[d.pairingId];
    // First leg flown; the aircraft goes AOG at ZAG and the return slips a day.
    g.now = f1.sta + 30;
    p.status = 'active';
    f1.status = 'done';
    f1.ata = f1.sta;
    retimeFlight(g, f2, f2.std + DAY, f2.sta + DAY);
    settle(g);
    expect(f2.dutyId).not.toBe(d.id);
    const d2 = g.duties[f2.dutyId!];
    expect(d2.pairingId).toBe(p.id);
    expect(d.flightIds).toEqual([f1.id]);
    expect(d.release).toBeLessThanOrEqual(g.now);
    expect(d2.report).toBe(f2.std - reportMinutes(ac.typeId).report);
    expect(d2.fdp).toBeLessThan(10 * 60);
  });
});

describe('tickets around rest', () => {
  it('a ticket home after rest moves back when the release slips (no check-in inside the rest)', () => {
    const g = fixtureGame();
    const ac = Object.values(g.fleet)[0];
    ac.at = 'FAO';
    const t = day0(g) + 2 * DAY;
    // A long day out of FAO (06:00–18:20): the ticket home leaves the next morning, after minimum rest.
    addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FAO', to: 'FNC', std: t + 7 * 60, sta: t + 7 * 60 + 110 });
    addFlight(g, { no: 'AW2', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FNC', to: 'FAO', std: t + 16 * 60, sta: t + 16 * 60 + 110 });
    autoRoster(g);
    const d = Object.values(g.duties)[0];
    const home = d.deadheadIds.map((id) => g.flights[id]).find((f) => f.from === 'FAO' && f.std > d.release)!;
    expect(home.std - d.release).toBeGreaterThanOrEqual(600);
    const last = g.flights[d.flightIds[d.flightIds.length - 1]];
    retimeFlight(g, last, last.std + 40, last.sta + 40);
    settle(g);
    const dd = g.duties[last.dutyId!];
    const rest = minRest({ dutyMin: dd.release - dd.report, atHome: false, augmented: false, tzShift: 0 });
    // The same ticket, moved (the crew keep the trip).
    const tk = g.flights[home.id];
    expect(tk.status).toBe('scheduled');
    expect(tk.std - 60).toBeGreaterThanOrEqual(dd.release + rest);
    expect(dd.pairingId).toBe(d.pairingId);
    expect(allCrewLegal(g)).toEqual([]);
  });

  it('crew flying home only to fly straight back out next day stay at the hotel (both tickets dropped)', () => {
    const g = fixtureGame();
    const ac = Object.values(g.fleet)[0];
    const std = day0(g) + 2 * DAY + 8 * 60;
    addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'ZAG', std, sta: std + 185 });
    addFlight(g, { no: 'AW2', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'ZAG', to: 'LIS', std: std + 26 * 60, sta: std + 26 * 60 + 185 });
    autoRoster(g);
    const ps = Object.values(g.pairings).sort((a, b) => a.start - b.start);
    expect(ps).toHaveLength(2);
    const pilots = ps[1].slots.map((s) => s.crewId!);
    for (const id of pilots) expect(ticketsOf(g, id)).toEqual([]);
    // What an older plan left: the pilots fly home with the cabin crew and back out the next afternoon.
    const a = openDuties(g, ps[0])[0];
    const b = openDuties(g, ps[1])[0];
    const h = addDeadhead(g, { crewIds: pilots, from: 'ZAG', to: 'LIS', std: a.release + 90, sta: a.release + 90 + 185, cost: 500 });
    a.deadheadIds.push(h.id);
    const o = addDeadhead(g, { crewIds: pilots, from: 'LIS', to: 'ZAG', std: b.report - 300, sta: b.report - 115, cost: 500 });
    b.deadheadIds.push(o.id);
    expect(stayOn(g).sort()).toEqual([...pilots].sort());
    for (const id of pilots) expect(ticketsOf(g, id)).toEqual([]);
    expect(allCrewLegal(g)).toEqual([]);
    // Nothing more to do on a second pass.
    expect(stayOn(g)).toEqual([]);
  });
});
