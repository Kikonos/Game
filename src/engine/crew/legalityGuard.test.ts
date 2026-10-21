// Crew legality as shown and as flown (v0.5 release blockers): a crew member who can't fly a later duty of a trip
// flags that duty, not the whole trip, and the roster splits it off at once; nobody over a crew limit reports for
// a duty (2 h check) or leaves the gate.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import type { Duty, GameState, Pairing } from '../core/types';
import { advanceTo } from '../sim';
import { openDuties } from './check';
import { addCrew, fixtureGame, seasonBase } from './fixtures';
import { evalSegs, type Seg } from './rules';
import { recheckPairing, recheckSoon } from './roster';
import { segsOf } from './timeline';
import { autoRoster, crewIssuesFor, dutyCrew, dutyLegality, flightCrewStatus } from '.';

/** HAM–PMI season base (2 waves), rostered: the first crewed tour with at least 3 duties still to fly. */
function rostered(): { g: GameState; acId: string; p: Pairing; duties: Duty[] } {
  const g = fixtureGame();
  const acId = Object.keys(g.fleet)[0];
  seasonBase(g, acId, 'HAM', 'PMI', [6 * 60, 12 * 60 + 30], 21);
  autoRoster(g, { to: g.now + 30 * DAY });
  const p = Object.values(g.pairings)
    .filter((x) => x.slots.every((s) => s.crewId) && openDuties(g, x).length >= 3)
    .sort((a, b) => a.start - b.start)[0];
  return { g, acId, p, duties: openDuties(g, p) };
}

const levels = (g: GameState, d: Duty) => d.flightIds.map((id) => flightCrewStatus(g, id).level);

/**
 * The tour's captain reaches 168 h since the last recovery during a later duty: a short log before the tour (no
 * recovery gap) and lastRecovery set back. Returns an earlier duty they can still fly and the duty they can't.
 */
function laterRecoveryProblem(g: GameState, p: Pairing, duties: Duty[]): { early: Duty; late: Duty; crewId: string } {
  const c = g.crew[p.slots[0].crewId!];
  const own = segsOf(g, c).filter((x) => x.kind !== 'log' && x.start >= p.start - DAY && x.start <= p.end);
  const s0 = own[0].start;
  // The first duty after a gap-free run from the start of the tour (every break < 30 h).
  let k = 1;
  let prevEnd = own[0].end;
  for (const x of own.slice(1)) {
    if (x.start - prevEnd >= 30 * 60) break;
    prevEnd = Math.max(prevEnd, x.end);
    if (x.kind === 'duty' && x.dutyId && x.dutyId !== duties[0].id) {
      k = duties.findIndex((d) => d.id === x.dutyId);
      break;
    }
  }
  const early = duties[k - 1];
  const late = duties[k];
  c.log = [{ start: s0 - 20 * 60, end: s0 - 14 * 60, fdp: 300, block: 240, sectors: 2, augmented: false, disruptive: false }];
  c.restUntil = s0 - 60;
  c.lastRecovery = late.release - 168 * 60 - 1;
  return { early, late, crewId: c.id };
}

describe('crew legality: a later duty\'s problem', () => {
  it('flags only the duty a crew member can\'t fly (earlier flights warn), and the duty view agrees', () => {
    const { g, p, duties } = rostered();
    const { early, late, crewId } = laterRecoveryProblem(g, p, duties);
    const c = g.crew[crewId];
    expect(recheckPairing(g, p).level).toBe('illegal');
    expect(p.illegalFrom).toBe(late.report);
    // Earlier duty: a warning ('tight'), not a crew problem; its modal says the same.
    expect(levels(g, early).every((l) => l === 'tight')).toBe(true);
    const ev = dutyLegality(g, early.id);
    expect(ev.legal).toBe(true);
    expect(ev.level).toBe('tight');
    expect(dutyCrew(g, early.id)!.slots[0].level).toBe('tight');
    // The duty itself: illegal everywhere.
    expect(levels(g, late).every((l) => l === 'illegal')).toBe(true);
    expect(dutyLegality(g, late.id).level).toBe('illegal');
    expect(dutyLegality(g, late.id).warnings.some((w) => w.code === 'recovery' && w.crewId === c.id)).toBe(true);
    expect(dutyCrew(g, late.id)!.slots[0].level).toBe('illegal');
  });

  it('splits the trip at the problem duty as soon as the daily re-check sees it: the crew keep the earlier duties', () => {
    const { g, p, duties } = rostered();
    const { early, late, crewId } = laterRecoveryProblem(g, p, duties);
    const c = g.crew[crewId];
    recheckSoon(g);
    expect(g.pairings[early.pairingId].slots.some((s) => s.crewId === c.id)).toBe(true);
    const q = g.pairings[g.duties[late.id].pairingId];
    expect(q.id).not.toBe(early.pairingId);
    expect(q.slots.some((s) => s.crewId === c.id)).toBe(false);
    expect(crewIssuesFor(g, g.duties[late.id])).toEqual([]);
    expect(levels(g, early).some((l) => l === 'illegal')).toBe(false);
    expect(levels(g, g.duties[late.id]).some((l) => l === 'illegal')).toBe(false);
  });

  it('counts disruptive duties for the 60 h recovery only since the last recovery', () => {
    const H = 60;
    const t0 = Date.UTC(2027, 5, 1, 3) / 60000 - Date.UTC(2000, 0, 1) / 60000;
    const seg = (start: number, hours: number, kind: Seg['kind'], disruptive: boolean): Seg => ({
      kind, start, end: start + hours * H, fdp: hours * H, maxFdp: 13 * H, block: (hours - 1) * H, sectors: 2, aug: false, disruptive, rest: 12 * H, at: 'LIS', from: 'LIS', fresh: kind !== 'log',
    });
    // Three early starts, a 66 h recovery ending at the 4th report (recorded as lastRecovery), then a 49 h break
    // with two local nights: a 36 h recovery (only one disruptive duty since the last one), so the duty ending
    // 169 h after the recorded recovery is legal (counting the earlier three would demand 60 h and break it).
    const segs = [seg(t0, 6, 'log', true), seg(t0 + 2 * DAY, 6, 'log', true), seg(t0 + 4 * DAY, 6, 'log', true)];
    const rec = t0 + 4 * DAY + 6 * H + 66 * H;
    segs.push(seg(rec, 6, 'log', true));
    const next = rec + 6 * H + 49 * H;
    segs.push(seg(next, 6, 'duty', false), seg(next + 2 * DAY, 6, 'duty', false), seg(rec + 6 * DAY + 19 * H, 6, 'duty', false));
    const issues = evalSegs({ base: 'LIS', restUntil: 0, lastRecovery: rec, blockYear: 0, blockYearOf: 2027 }, segs);
    expect(issues.filter((i) => i.code === 'recovery')).toEqual([]);
  });
});

describe('crew legality: the 2 h check and the gate', () => {
  /** A crewed duty reporting away from midnight (no daily job between the injection and the check). */
  function midday(): { g: GameState; acId: string; p: Pairing; d: Duty } {
    const { g, acId } = rostered();
    const d = Object.values(g.duties)
      .filter((x) => {
        const p = g.pairings[x.pairingId];
        const h = (x.report % DAY) / 60;
        return p && p.slots.every((s) => s.crewId) && x.report > g.now + DAY && h >= 6 && h <= 20;
      })
      .sort((a, b) => a.report - b.report)[0];
    return { g, acId, p: g.pairings[d.pairingId], d };
  }

  it('takes a crew member over a limit off the duty 2 h before report and refills the seat', () => {
    const { g, d } = midday();
    // A spare captain based at the station.
    addCrew(g, { CPT: 1 }, 'A320', 'HAM');
    advanceTo(g, d.report - 180);
    const p = g.pairings[d.pairingId];
    const c = g.crew[p.slots[0].crewId!];
    // Sick from just before report (as if reported late: the roster has not seen it yet).
    c.blocks = [...(c.blocks ?? []), { from: d.report - 30, to: d.report + 2 * DAY, why: 'sick' }];
    expect(crewIssuesFor(g, d).map((x) => x.crewId)).toEqual([c.id]);
    advanceTo(g, d.report - 119);
    const now = g.pairings[g.duties[d.id].pairingId];
    expect(now.slots.some((s) => s.crewId === c.id)).toBe(false);
    expect(crewIssuesFor(g, g.duties[d.id])).toEqual([]);
    expect(now.slots.every((s) => s.crewId)).toBe(true);
    expect(g.messages.some((m) => m.title.includes('taken off'))).toBe(true);
  });

  it('with nobody legal to take the seat, leaves it empty: the flight does not go and ops raise the crew-short decision', () => {
    const { g, d } = midday();
    advanceTo(g, d.report - 180);
    const p = g.pairings[d.pairingId];
    const c = g.crew[p.slots[0].crewId!];
    // Every other captain is away for the day.
    for (const x of Object.values(g.crew)) if (x.role === 'CPT' && x.id !== c.id) x.blocks = [...(x.blocks ?? []), { from: d.report - 3 * DAY, to: d.report + 3 * DAY, why: 'leave' }];
    c.blocks = [...(c.blocks ?? []), { from: d.report - 30, to: d.report + 2 * DAY, why: 'sick' }];
    advanceTo(g, d.report - 119);
    const now = g.pairings[g.duties[d.id]?.pairingId ?? ''] ?? p;
    expect(now.slots.some((s) => s.crewId === c.id)).toBe(false);
    const f = g.flights[d.flightIds[0]];
    expect(flightCrewStatus(g, f.id).level).toBe('missing');
    advanceTo(g, f.std + 3 * 60);
    expect(f.status === 'enroute' && f.crewIds.includes(c.id)).toBe(false);
    expect(g.decisions.some((x) => x.kind === 'crewShort') || f.status !== 'scheduled' || !!f.operatedBy).toBe(true);
    expect(g.stats.illegalCrewFlown ?? 0).toBe(0);
  });

  it('blocks the gate when a crew member falls over a limit after the 2 h check', () => {
    const { g, d } = midday();
    advanceTo(g, d.report - 60);
    const p = g.pairings[d.pairingId];
    const c = g.crew[p.slots[0].crewId!];
    c.blocks = [...(c.blocks ?? []), { from: d.report - 30, to: d.report + 2 * DAY, why: 'sick' }];
    const f = g.flights[d.flightIds[0]];
    advanceTo(g, f.std + 6 * 60);
    expect(f.status !== 'scheduled' && f.crewIds.includes(c.id) && !f.operatedBy).toBe(false);
    expect(g.stats.illegalCrewFlown ?? 0).toBe(0);
  });
});

describe('crew legality: a stale trip mark (v0.6.3)', () => {
  it('a pairing still marked illegal for crew who are now legal reads as the Adjust crew panel does', () => {
    const { g, p, duties } = rostered();
    expect(duties.every((d) => dutyLegality(g, d.id).level !== 'illegal')).toBe(true);
    // The mark left behind by crew who have since been replaced: from the first duty, and an old save's (no from).
    p.legality = 'illegal';
    p.illegalFrom = duties[0].report;
    for (const d of duties) expect(levels(g, d)).not.toContain('illegal');
    delete p.illegalFrom;
    for (const d of duties) expect(levels(g, d)).not.toContain('illegal');
  });

  it('a real crew problem still reads illegal from that duty on', () => {
    const { g, p, duties } = rostered();
    const { early, late } = laterRecoveryProblem(g, p, duties);
    recheckPairing(g, p);
    expect(levels(g, late)).toContain('illegal');
    expect(levels(g, early)).not.toContain('illegal');
    expect(dutyLegality(g, late.id).level).toBe('illegal');
  });
});

describe('crew legality: a stale tight mark (v0.6.4)', () => {
  it('a pairing still marked tight for crew who are now clean reads ok, and a real tight issue stays amber', () => {
    const { g, p, duties } = rostered();
    for (const d of duties) expect(dutyLegality(g, d.id).level).toBe('legal');
    p.legality = 'tight';
    for (const d of duties) for (const lv of levels(g, d)) expect(lv).toBe('ok');
    // A real crew-level tight issue: the captain's duty hours in the 7 days to the first release above 95% of 60 h.
    const c = g.crew[p.slots[0].crewId!];
    const d0 = duties[0];
    const own = d0.release - d0.report;
    const need = Math.ceil(0.96 * 60 * 60) - own;
    c.log = [];
    for (let t = d0.release - 7 * DAY + 60, left = need; left > 0 && t + 13 * 60 < d0.report - 12 * 60; t += DAY) {
      const len = Math.min(13 * 60, left);
      c.log.push({ start: t, end: t + len, fdp: len, block: Math.round(len * 0.8), sectors: 2, augmented: false, disruptive: false });
      left -= len;
    }
    recheckPairing(g, p);
    const lv = dutyLegality(g, duties[0].id).level;
    expect(lv).not.toBe('legal');
    for (const x of levels(g, duties[0])) expect(x).not.toBe('ok');
  });
});
