// v0.6 roster board (UPDATE-0.6.md §F1): rows, drop-target verdicts, moving a duty or a trip, locks, forced
// illegal moves, late-change morale, purity.

import { readFileSync } from 'node:fs';
import LZString from 'lz-string';
import { describe, expect, it } from 'vitest';
import { deserialize } from '../save';
import { DAY } from '../core/time';
import type { GameState, Pairing } from '../core/types';
import { demoFlights } from '../dev';
import { addCrew, fixtureGame, seasonBase } from './fixtures';
import { autoRoster, crewCalendar, dropTargets, dutyLegality, flightCrewStatus, moveDuty, rerosterFrom, rosterBoard, rosterOf } from '.';
import { touchCrew } from './timeline';
import { perfBudgetFactor } from '../../test/perf';

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

describe('roster board row cache (v0.7 C2)', () => {
  it('an unchanged crew member keeps the same row object while the clock runs within the hour; a move rebuilds only the crew it touches', () => {
    const g = rostered();
    const ids = Object.keys(g.crew);
    const from = g.now;
    const to = g.now + 14 * DAY;
    const a = rosterBoard(g, from, to, ids);
    g.now += 10;
    const b = rosterBoard(g, from, to, ids);
    b.forEach((r, i) => expect(r).toBe(a[i]));
    // A new window rebuilds (different key).
    expect(rosterBoard(g, from, to + DAY, ids.slice(0, 1))[0]).not.toBe(a[0]);
    const c = rosterBoard(g, from, to, ids);
    const p = future(g)[0];
    const cc = p.slots.find((s) => s.role === 'CC')!.crewId!;
    const t = dropTargets(g, p.dutyIds[0], cc, 'trip');
    const spare = Object.keys(t).find((id) => t[id].level === 'legal' && t[id].kind === 'assign')!;
    expect(spare).toBeTruthy();
    expect(moveDuty(g, p.dutyIds[0], cc, spare, 'trip').ok).toBe(true);
    const d = rosterBoard(g, from, to, ids);
    const changed = ids.filter((_, i) => d[i] !== c[i]);
    expect(changed).toContain(cc);
    expect(changed).toContain(spare);
    expect(changed.length).toBeLessThan(ids.length / 2);
    // Every row still equals a fresh build.
    d.forEach((r) => expect(r.blocks.map((x) => [x.kind, x.start, x.end, x.label])).toEqual(crewCalendar(g, r.crewId, from, to).map((x) => [x.kind, x.start, x.end, x.label])));
  });
});

describe('roster board row cache: the running clock', () => {
  it('as the clock runs for two days, only rows reaching a time boundary rebuild, and every row equals a fresh build', () => {
    const g = rostered();
    const ids = Object.keys(g.crew);
    const from = g.now - DAY;
    const to = g.now + 14 * DAY;
    let prev = rosterBoard(g, from, to, ids);
    let rebuilt = 0;
    let steps = 0;
    for (let k = 0; k < 80; k++) {
      g.now += 36;
      const cur = rosterBoard(g, from, to, ids);
      rebuilt += cur.filter((r, i) => r !== prev[i]).length;
      steps++;
      if (k % 10 === 9) expect(JSON.stringify(cur)).toBe(JSON.stringify(rosterBoard(structuredClone(g), from, to, ids)));
      prev = cur;
    }
    // An hourly key rebuilt every row about every other step; now a few rows per step at most (v0.9: every free day
    // is a standby window, so more rows reach a boundary).
    expect(rebuilt / steps).toBeLessThan(Math.max(3, ids.length * 0.15));
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
    g.crew[spare].off = []; // v0.9: no planned day off in the way (protected days off: dayPlan.test.ts)
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
    const free = Object.values(t).find((v) => v.kind === 'assign' && v.level !== 'illegal' && !v.offBreak);
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
    g.crew[sick].off = [];
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
    // v0.7 C5: warm up once, then the best of 5 (parallel test files under load don't make it flaky).
    dropTargets(g, p.dutyIds[0], cc, 'trip');
    const times: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      dropTargets(g, p.dutyIds[0], cc, 'trip');
      times.push(performance.now() - t0);
    }
    expect(Math.min(...times)).toBeLessThan(400 * perfBudgetFactor());
  });

  it('dropTargets green ⇒ moveDuty works; a refused move changes nothing (v0.5.2 fixture, both scopes)', () => {
    const raw = LZString.decompressFromBase64(readFileSync(new URL('../fixtures/save-v052.lz.txt', import.meta.url), 'utf8'))!;
    const g0 = deserialize(raw);
    let tried = 0;
    for (const scope of ['duty', 'trip'] as const) {
      for (const c of Object.values(g0.crew).filter((_, i) => i % 3 === 0)) {
        const d = rosterOf(g0, c.id, g0.now, g0.now + 10 * DAY).find((x) => !x.done && x.report > g0.now);
        if (!d) continue;
        const t = dropTargets(g0, d.id, c.id, scope);
        for (const v of Object.values(t).filter((x) => x.level === 'legal' || x.level === 'tight').slice(0, 3)) {
          const g = deserialize(raw);
          const r = moveDuty(g, d.id, c.id, v.crewId, scope);
          expect(r.ok ? '' : `${scope} ${c.id}→${v.crewId} "${v.reason}": ${r.error}`).toBe('');
          tried++;
        }
        // A refused move (ineligible target) leaves the state as it was.
        const no = Object.values(t).find((x) => x.level === 'ineligible' && x.crewId !== c.id);
        if (no) {
          const g = deserialize(raw);
          const before = JSON.stringify(g);
          expect(moveDuty(g, d.id, c.id, no.crewId, scope).ok).toBe(false);
          expect(JSON.stringify(g)).toBe(before);
        }
      }
    }
    expect(tried).toBeGreaterThan(30);
  }, 60_000);

  it('duty scope: the verdict names what the source is left with, and the move re-plans their next duty', () => {
    const raw = LZString.decompressFromBase64(readFileSync(new URL('../fixtures/save-v052.lz.txt', import.meta.url), 'utf8'))!;
    const g0 = deserialize(raw);
    let found = false;
    for (const c of Object.values(g0.crew)) {
      for (const d of rosterOf(g0, c.id, g0.now, g0.now + 10 * DAY).filter((x) => !x.done && x.report > g0.now)) {
        const hit = Object.values(dropTargets(g0, d.id, c.id, 'duty')).find((v) => v.level === 'legal' && v.kind === 'assign' && /DH /.test(v.source ?? ''));
        if (!hit) continue;
        expect(hit.reason).toContain(hit.source!);
        const g = deserialize(raw);
        expect(moveDuty(g, d.id, c.id, hit.crewId, 'duty').ok).toBe(true);
        // The source's next duty is legal (positioned), not left stranded.
        const next = rosterOf(g, c.id, d.release, d.release + 10 * DAY).find((x) => !x.done);
        if (next) expect(dutyLegality(g, next.id).warnings.filter((w) => w.crewId === c.id && w.level === 'illegal')).toEqual([]);
        found = true;
        break;
      }
      if (found) break;
    }
    expect(found).toBe(true);
  }, 30_000);
});
