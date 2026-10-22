// Manual roster adjustment: candidates, assign/replace/extra, unassign, swap, legality, locks vs re-plan.

import { describe, expect, it } from 'vitest';
import { retimeFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { GameState, Pairing } from '../core/types';
import { demoFlights } from '../dev';
import { deserialize, serialize } from '../save';
import { settle } from '../sim';
import { fixtureGame } from './fixtures';
import { rootReason } from './reasons';
import { assignCrew, autoRoster, dutyCandidates, dutyCrew, dutyLegality, flightCrewStatus, rerosterFrom, swapCrew, unassignCrew } from '.';

function rostered(seed = 5): GameState {
  const g = fixtureGame(seed);
  demoFlights(g, undefined, 6, 'revenue');
  autoRoster(g);
  return g;
}

/** Crewed pairings starting after tomorrow (no duty under way), earliest first. */
const futurePairings = (g: GameState): Pairing[] =>
  Object.values(g.pairings).filter((p) => p.start > g.now + DAY && p.slots.every((s) => s.crewId)).sort((a, b) => a.start - b.start);

const firstDuty = (p: Pairing) => p.dutyIds[0];

describe('manual roster', () => {
  it('lists candidates legal-first with reasons, and is pure', () => {
    const g = rostered();
    const p = futurePairings(g)[0];
    const before = JSON.stringify(g);
    const list = dutyCandidates(g, firstDuty(p), 'FO');
    expect(JSON.stringify(g)).toBe(before);
    expect(list.length).toBeGreaterThan(3);
    const firstIllegal = list.findIndex((c) => !c.legal);
    if (firstIllegal >= 0) expect(list.slice(firstIllegal).every((c) => !c.legal)).toBe(true);
    for (const c of list) if (!c.legal) expect(c.reasons.length).toBeGreaterThan(0);
    // The FO already on the trip is listed as onPairing.
    const holder = p.slots.find((s) => s.role === 'FO')!.crewId!;
    expect(list.find((c) => c.crewId === holder)?.onPairing).toBe(true);
    // v0.7.2 the trip's own captain is never offered for the FO seat ('Captain flying as FO' would empty the left seat).
    const cpt = p.slots.find((s) => s.role === 'CPT')!.crewId!;
    expect(list.some((c) => c.crewId === cpt)).toBe(false);
    // A flight id resolves to its duty.
    const fid = g.duties[firstDuty(p)].flightIds[0];
    expect(dutyCandidates(g, fid, 'FO').map((c) => c.crewId)).toEqual(list.map((c) => c.crewId));
  });

  it('replaces a seat holder with a legal crew member and locks the seat', () => {
    const g = rostered();
    const p = futurePairings(g)[0];
    const d = firstDuty(p);
    const holder = p.slots.find((s) => s.role === 'FO')!.crewId!;
    const pick = dutyCandidates(g, d, 'FO').find((c) => c.legal && !c.onPairing && c.role === 'FO')!;
    const r = assignCrew(g, d, pick.crewId, 'FO', { replace: holder });
    expect(r.ok).toBe(true);
    const seat = p.slots.find((s) => s.crewId === pick.crewId)!;
    expect(seat.locked).toBe(true);
    expect(p.slots.some((s) => s.crewId === holder)).toBe(false);
    for (const fid of g.duties[d].flightIds) expect(g.flights[fid].crewIds).toContain(pick.crewId);
    expect(dutyLegality(g, d).legal).toBe(true);
  });

  it('refuses an illegal assignment unless forced, then flags it red', () => {
    const g = rostered();
    const ps = futurePairings(g);
    const p = ps[0];
    const d = firstDuty(p);
    const holder = p.slots.find((s) => s.role === 'CPT')!.crewId!;
    const bad = dutyCandidates(g, d, 'CPT').find((c) => !c.legal && !c.onPairing);
    expect(bad).toBeTruthy();
    const r = assignCrew(g, d, bad!.crewId, 'CPT', { replace: holder });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^Illegal/);
    const f = assignCrew(g, d, bad!.crewId, 'CPT', { replace: holder, force: true });
    expect(f.ok).toBe(true);
    const v = dutyLegality(g, d);
    expect(v.legal).toBe(false);
    expect(v.warnings.some((w) => w.crewId === bad!.crewId)).toBe(true);
    expect(flightCrewStatus(g, g.duties[d].flightIds[0]).level).toBe('illegal');
  });

  it('adds an extra above the complement and removes it again; required seats need force', () => {
    const g = rostered();
    const p = futurePairings(g)[0];
    const d = firstDuty(p);
    const n = p.slots.length;
    const pick = dutyCandidates(g, d, 'CC').find((c) => c.legal && !c.onPairing)!;
    expect(assignCrew(g, d, pick.crewId, 'CC').ok).toBe(true);
    expect(p.slots.length).toBe(n + 1);
    expect(p.slots[n].extra).toBe(true);
    expect(dutyCrew(g, d)!.slots[n].extra).toBe(true);
    expect(unassignCrew(g, d, pick.crewId).ok).toBe(true);
    expect(p.slots.length).toBe(n);
    const cpt = p.slots.find((s) => s.role === 'CPT')!.crewId!;
    expect(unassignCrew(g, d, cpt).ok).toBe(false);
    g.company.policies.autoRoster = false;
    expect(unassignCrew(g, d, cpt, { force: true }).ok).toBe(true);
    expect(dutyLegality(g, d).warnings.some((w) => w.code === 'missing')).toBe(true);
  });

  it('refills a required seat at once with someone else when the auto-roster policy is on', () => {
    const g = rostered();
    g.company.policies.autoRoster = true;
    const p = futurePairings(g)[0];
    const d = firstDuty(p);
    const cc = p.slots.find((s) => s.role === 'CC')!.crewId!;
    const r = unassignCrew(g, d, cc, { force: true });
    expect(r.ok).toBe(true);
    const ccs = p.slots.filter((s) => s.role === 'CC');
    expect(ccs.every((s) => s.crewId && s.crewId !== cc)).toBe(true);
    expect(r.ok && r.msg).toMatch(/takes the CC seat/);
  });

  it('swaps two crew members between trips', () => {
    const g = rostered();
    const ps = futurePairings(g);
    let done = false;
    for (let i = 0; i < ps.length && !done; i++) {
      for (let j = i + 1; j < ps.length && !done; j++) {
        const a = ps[i].slots.find((s) => s.role === 'CC')!.crewId!;
        const b = ps[j].slots.find((s) => s.role === 'CC')!.crewId!;
        const r = swapCrew(g, firstDuty(ps[i]), a, firstDuty(ps[j]), b);
        if (!r.ok) continue;
        expect(ps[i].slots.some((s) => s.crewId === b && s.locked)).toBe(true);
        expect(ps[j].slots.some((s) => s.crewId === a && s.locked)).toBe(true);
        done = true;
      }
    }
    expect(done).toBe(true);
    expect(swapCrew(g, firstDuty(ps[0]), ps[0].slots[0].crewId!, firstDuty(ps[0]), ps[0].slots[1].crewId!).ok).toBe(false);
  });

  it('swaps crew between two trips that overlap in time (each leaves the other trip)', () => {
    const g = rostered();
    const ps = futurePairings(g);
    let tried = 0;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        if (!(ps[i].start < ps[j].end && ps[j].start < ps[i].end)) continue;
        const a = ps[i].slots.find((s) => s.role === 'FO')!.crewId!;
        const b = ps[j].slots.find((s) => s.role === 'FO')!.crewId!;
        const r = swapCrew(g, firstDuty(ps[i]), a, firstDuty(ps[j]), b);
        tried++;
        if (!r.ok) expect(r.error).not.toMatch(/On another/);
        if (tried >= 4) return;
      }
    }
    expect(tried).toBeGreaterThan(0);
  });

  it('keeps locked seats through the rolling re-plan and a save round trip', () => {
    const g = rostered();
    const p = futurePairings(g)[0];
    const d = firstDuty(p);
    const holder = p.slots.find((s) => s.role === 'CPT')!.crewId!;
    const bad = dutyCandidates(g, d, 'CPT').find((c) => !c.legal && !c.onPairing)!;
    assignCrew(g, d, bad.crewId, 'CPT', { replace: holder, force: true });
    rerosterFrom(g, p.aircraftId!, g.now);
    autoRoster(g);
    expect(g.pairings[p.id].slots.some((s) => s.crewId === bad.crewId && s.locked)).toBe(true);
    // A retime re-syncs via settle and still keeps the lock.
    const f = g.flights[g.duties[d].flightIds[0]];
    retimeFlight(g, f, f.std + 30, f.sta + 30);
    settle(g);
    expect(g.pairings[p.id]?.slots.some((s) => s.crewId === bad.crewId && s.locked)).toBe(true);
    const h = deserialize(serialize(g));
    expect(h.pairings[p.id].slots.find((s) => s.crewId === bad.crewId)?.locked).toBe(true);
  });

  it('refuses changes while a duty of the trip is under way', () => {
    const g = rostered();
    const p = Object.values(g.pairings).find((x) => x.slots.every((s) => s.crewId) && x.dutyIds.length)!;
    const d = g.duties[firstDuty(p)];
    g.now = d.report + 10;
    const pick = dutyCandidates(g, d.id, 'CC').find((c) => !c.onPairing)!;
    const r = assignCrew(g, d.id, pick.crewId, 'CC', { force: true });
    expect(r.ok).toBe(false);
    expect(dutyCrew(g, d.id)!.inProgress).toBe(true);
  });
});

// v0.7.1 one reason per person (UPDATE-0.7.1.md §6): the root cause wins (busy beats place; sick beats rest), the
// full list stays behind it, and candidates and warnings carry it.
describe('rootReason', () => {
  it('priority table: busy beats place, sick beats rest, hours and recovery read in plain words', () => {
    const g = rostered();
    const c = Object.values(g.crew)[0];
    const busy = rootReason(g, [{ code: 'location', level: 'illegal', text: 'At LIS, not DUS' }, { code: 'overlap', level: 'illegal', text: 'On another trip until 3 Mar' }], c)!;
    expect(busy.code).toBe('busy');
    expect(busy.text).toMatch(/^busy on another trip/);
    expect(busy.all).toHaveLength(2);
    c.blocks = [{ from: g.now, to: g.now + 3 * DAY, why: 'sick' }];
    const sick = rootReason(g, [{ code: 'rest', level: 'illegal', text: 'Rest 7:30 < 10:00' }, { code: 'status', level: 'illegal', text: 'Sick' }], c)!;
    expect(sick.code).toBe('sick');
    expect(sick.text).toMatch(/^sick until /);
    delete c.blocks;
    const hours = rootReason(g, [{ code: 'block28d', level: 'illegal', text: 'Block 28d 98:00 > 100:00' }], c)!;
    expect(hours).toMatchObject({ code: 'hours', text: 'at 98 of 100 flying hours in 28 days' });
    const place = rootReason(g, [{ code: 'location', level: 'illegal', text: 'Earliest arrival DUS 11:40, must land by 08:34 (report 09:34)' }], c)!;
    expect(place).toMatchObject({ code: 'place', text: 'in Lisbon, landing 11:40 at the earliest' });
    expect(rootReason(g, [{ code: 'recovery', level: 'illegal', text: 'No 36 h recovery in 168 h' }], c)!.code).toBe('recovery');
    expect(rootReason(g, [{ code: 'fdp', level: 'illegal', text: 'FDP 11:45 > 11:00' }], c)).toMatchObject({ code: 'fdp', text: 'over the day limit (11:45 of 11:00)' });
    expect(rootReason(g, [], c)).toBeNull();
    expect(rootReason(g, [{ code: 'rest', level: 'legal', text: '' }], c)).toBeNull();
  });

  it('candidates and legality warnings carry the one reason', () => {
    const g = rostered();
    const p = futurePairings(g)[0];
    const cands = dutyCandidates(g, firstDuty(p), 'CPT');
    for (const c of cands) {
      if (c.level === 'legal') expect(c.reason).toBeUndefined();
      else {
        expect(c.reason).toBeDefined();
        expect(c.reason!.text.length).toBeGreaterThan(3);
        expect(c.reason!.all.length).toBeGreaterThan(0);
      }
    }
    const lv = dutyLegality(g, firstDuty(p));
    for (const w of lv.warnings) if (w.crewId && w.level !== 'legal') expect(w.reason).toBeDefined();
  });
});
