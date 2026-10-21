// v0.6 roster board (UPDATE-0.6.md §F1): rows, drop-target verdicts, moving a duty or a trip, locks, forced
// illegal moves, late-change morale, purity.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import type { GameState, Pairing } from '../core/types';
import { demoFlights } from '../dev';
import { addCrew, fixtureGame, seasonBase } from './fixtures';
import { autoRoster, crewCalendar, dropTargets, flightCrewStatus, moveDuty, rerosterFrom, rosterBoard, rosterOf } from '.';
import { touchCrew } from './timeline';

function rostered(seed = 5): GameState {
  const g = fixtureGame(seed);
  demoFlights(g, undefined, 6, 'revenue');
  autoRoster(g);
  return g;
}

const future = (g: GameState): Pairing[] =>
  Object.values(g.pairings).filter((p) => p.start > g.now + DAY && p.slots.every((s) => s.crewId)).sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));

/** A season base away from home: tours of many duties per crew set. */
function tours(seed = 5): GameState {
  const g = fixtureGame(seed);
  const ac = Object.keys(g.fleet)[0];
  seasonBase(g, ac, 'HAM', 'PMI', [6 * 60, 13 * 60], 20);
  addCrew(g, { CPT: 6, FO: 6, CC: 20 });
  autoRoster(g);
  return g;
}

describe('roster board rows', () => {
  it('shows the crew calendar blocks, with pairing, lock and drag state; pure', () => {
    const g = rostered();
    const ids = Object.keys(g.crew).slice(0, 3);
    const from = g.now;
    const to = g.now + 14 * DAY;
    const before = JSON.stringify(g);
    const rows = rosterBoard(g, from, to, ids);
    expect(JSON.stringify(g)).toBe(before);
    expect(rows.map((r) => r.crewId)).toEqual(ids);
    rows.forEach((r) => {
      const cal = crewCalendar(g, r.crewId, from, to);
      expect(r.blocks.map((b) => [b.kind, b.start, b.end, b.label])).toEqual(cal.map((b) => [b.kind, b.start, b.end, b.label]));
      for (const b of r.blocks.filter((x) => x.kind === 'duty' && x.dutyId)) {
        expect(b.pairingId).toBe(g.duties[b.dutyId!].pairingId);
        expect(b.movable).toBe(g.duties[b.dutyId!].report > g.now);
      }
    });
    const c = g.crew[ids[0]];
    expect(rows[0].name).toBe(`${c.last}, ${c.first[0]}.`);
    // A missing id is skipped (resigned crew are deleted).
    expect(rosterBoard(g, from, to, ['nobody', ids[1]]).map((r) => r.crewId)).toEqual([ids[1]]);
  });
});

describe('drop targets', () => {
  it('verdicts: ineligible rank and rating, green assign, swaps, red with a rest reason, busy with two', () => {
    const g = rostered();
    const [b737] = addCrew(g, { CPT: 1 }, 'B737');
    const [spare] = addCrew(g, { CPT: 1 });
    const p = future(g)[0];
    const d = p.dutyIds[0];
    const cpt = p.slots.find((s) => s.role === 'CPT')!.crewId!;
    const before = JSON.stringify(g);
    const t = dropTargets(g, d, cpt, 'trip');
    expect(JSON.stringify(g)).toBe(before);
    expect(Object.keys(t).length).toBe(Object.keys(g.crew).length);
    expect(t[cpt].level).toBe('ineligible');
    const fo = Object.values(g.crew).find((c) => c.role === 'FO')!;
    expect(t[fo.id]).toMatchObject({ level: 'ineligible', reason: "A FO can't fill a CPT seat" });
    expect(t[b737]).toMatchObject({ level: 'ineligible', reason: 'Not rated A320' });
    expect(t[spare]).toMatchObject({ level: 'legal', kind: 'assign' });
    expect(t[spare].reason).toMatch(/^Legal · /);
    const swaps = Object.values(t).filter((v) => v.kind === 'swap');
    expect(swaps.length).toBeGreaterThan(0);
    for (const v of swaps) {
      expect(v.swapDutyId).toBeTruthy();
      expect(v.reason).toMatch(/^Swap with /);
    }
    expect(Object.values(t).some((v) => v.level === 'illegal' && /rest/i.test(v.reason))).toBe(true);
    // Two trips in the window: busy.
    const others = Object.values(g.pairings).filter((q) => q.id !== p.id && q.aircraftId !== p.aircraftId && Math.abs(q.start - p.start) < 10 * 60);
    const q1 = others[0];
    const q2 = Object.values(g.pairings).find((q) => q.id !== p.id && q.id !== q1?.id && q.start > p.start - 12 * 60 && q.start < p.end + 6 * 60);
    if (q1 && q2) {
      q1.slots.find((s) => s.role === 'CPT')!.crewId = spare;
      q2.slots.find((s) => s.role === 'CPT')!.crewId = spare;
      touchCrew(g);
      expect(dropTargets(g, d, cpt, 'trip')[spare]).toMatchObject({ level: 'ineligible', reason: 'Busy: 2 trips' });
    }
  });
});

describe('moving duties', () => {
  it('trip scope moves the rest of the trip; the seat is locked and survives a re-plan', () => {
    const g = rostered();
    const [spare] = addCrew(g, { CC: 1 });
    const p = future(g)[0];
    const cc = p.slots.find((s) => s.role === 'CC')!.crewId!;
    const r = moveDuty(g, p.dutyIds[0], cc, spare, 'trip');
    expect(r.ok).toBe(true);
    expect(r.ok && r.data).toEqual({ level: 'legal', swapped: false });
    const seat = g.pairings[p.id].slots.find((s) => s.crewId === spare)!;
    expect(seat.locked).toBe(true);
    expect(g.pairings[p.id].slots.some((s) => s.crewId === cc)).toBe(false);
    rerosterFrom(g, p.aircraftId!, g.now);
    expect(g.pairings[p.id].slots.find((s) => s.crewId === spare)?.locked).toBe(true);
  });

  it('a swap trades the two trips', () => {
    const g = rostered();
    const p = future(g)[0];
    const cpt = p.slots.find((s) => s.role === 'CPT')!.crewId!;
    const t = dropTargets(g, p.dutyIds[0], cpt, 'trip');
    const sw = Object.values(t).find((v) => v.kind === 'swap' && v.level === 'legal')!;
    const q = g.pairings[g.duties[sw.swapDutyId!].pairingId];
    const r = moveDuty(g, p.dutyIds[0], cpt, sw.crewId, 'trip');
    expect(r.ok && r.data).toEqual({ level: 'legal', swapped: true });
    expect(p.slots.some((s) => s.crewId === sw.crewId && s.locked)).toBe(true);
    expect(q.slots.some((s) => s.crewId === cpt && s.locked)).toBe(true);
  });

  it('duty scope isolates the duty: the other duties keep their crew', () => {
    const g = tours();
    const p = Object.values(g.pairings).filter((x) => x.tour && x.slots.every((s) => s.crewId) && x.dutyIds.filter((id) => g.duties[id].report > g.now + DAY).length >= 4).sort((a, b) => a.start - b.start)[0];
    expect(p).toBeTruthy();
    const open = p.dutyIds.map((id) => g.duties[id]).filter((d) => d.report > g.now + DAY).sort((a, b) => a.report - b.report);
    const mid = open[1];
    const cc = p.slots.find((s) => s.role === 'CC')!.crewId!;
    const t = dropTargets(g, mid.id, cc, 'duty');
    const free = Object.values(t).find((v) => v.kind === 'assign' && v.level !== 'illegal');
    expect(free).toBeTruthy();
    const r = moveDuty(g, mid.id, cc, free!.crewId, 'duty', { force: true });
    expect(r.ok).toBe(true);
    const pm = g.pairings[g.duties[mid.id].pairingId];
    expect(pm.dutyIds).toEqual([mid.id]);
    expect(pm.slots.some((s) => s.crewId === free!.crewId && s.locked)).toBe(true);
    // The duties before and after still have the source crew member.
    expect(g.pairings[g.duties[open[0].id].pairingId].slots.some((s) => s.crewId === cc)).toBe(true);
    expect(g.pairings[g.duties[open[2].id].pairingId].slots.some((s) => s.crewId === cc)).toBe(true);
    expect(rosterOf(g, free!.crewId, mid.report, mid.release).map((d) => d.id)).toEqual([mid.id]);
  });

  it('illegal moves are refused unless forced, then stay flagged red', () => {
    const g = rostered();
    const [sick] = addCrew(g, { CC: 1 });
    const p = future(g)[0];
    g.crew[sick].blocks = [{ from: p.start - DAY, to: p.end + DAY, why: 'sick' }];
    const cc = p.slots.find((s) => s.role === 'CC')!.crewId!;
    expect(dropTargets(g, p.dutyIds[0], cc, 'trip')[sick]).toMatchObject({ level: 'illegal', kind: 'assign', reason: 'Sick' });
    const no = moveDuty(g, p.dutyIds[0], cc, sick, 'trip');
    expect(no.ok).toBe(false);
    const yes = moveDuty(g, p.dutyIds[0], cc, sick, 'trip', { force: true });
    expect(yes.ok && yes.data!.level).toBe('illegal');
    expect(g.pairings[p.id].legality).toBe('illegal');
    expect(flightCrewStatus(g, g.duties[p.dutyIds[0]].flightIds[0]).level).toBe('illegal');
    rerosterFrom(g, p.aircraftId!, g.now);
    expect(g.pairings[p.id].slots.some((s) => s.crewId === sick && s.locked)).toBe(true);
  });

  it('a late change (report within 72 h) costs both crew members 2 morale points', () => {
    const g = fixtureGame(5);
    g.now += 4 * DAY;
    g.started = g.now - 4 * DAY;
    demoFlights(g, undefined, 4, 'revenue');
    autoRoster(g);
    // Rostering brand-new flights inside 72 h was itself a late change; start the day clean.
    for (const c of Object.values(g.crew)) delete c.lateAt;
    const [spare] = addCrew(g, { CC: 1 });
    const p = Object.values(g.pairings).filter((x) => x.start > g.now + 12 * 60 && x.start < g.now + 48 * 60 && x.slots.every((s) => s.crewId)).sort((a, b) => a.start - b.start)[0];
    const cc = p.slots.find((s) => s.role === 'CC')!.crewId!;
    const t = dropTargets(g, p.dutyIds[0], cc, 'trip');
    expect(t[spare].lateChange).toBe(true);
    const [m1, m2] = [g.crew[cc].morale, g.crew[spare].morale];
    expect(moveDuty(g, p.dutyIds[0], cc, spare, 'trip').ok).toBe(true);
    expect(g.crew[cc].morale).toBeCloseTo(m1 - 2, 5);
    expect(g.crew[spare].morale).toBeCloseTo(m2 - 2, 5);
  });

  it('dropTargets stays fast with ~120 crew', () => {
    const g = rostered();
    addCrew(g, { CPT: 15, FO: 15, CC: 30 });
    const p = future(g)[0];
    const cc = p.slots.find((s) => s.role === 'CC')!.crewId!;
    dropTargets(g, p.dutyIds[0], cc, 'trip');
    const t0 = performance.now();
    dropTargets(g, p.dutyIds[0], cc, 'trip');
    expect(performance.now() - t0).toBeLessThan(400);
  });
});
