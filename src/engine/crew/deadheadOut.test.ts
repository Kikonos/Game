// v0.6.2 hotfix: positioning out to a trip searches the whole window of commercial departures (now + check-in up
// to an hour before report), takes the rest option when the merged FDP is too long, and says exactly why when
// nothing works (instead of "Can't reach X in time").

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { addFlight } from '../core/entities';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import type { Duty, GameState, Pairing } from '../core/types';
import { planCrew } from './check';
import { buildDuties } from './duties';
import { addCrew, fixtureGame } from './fixtures';
import { minRest } from './rules';
import { dhBlock, OUT_BUFFER, OUT_CONNECT, outTicket, segsOf } from './timeline';
import { dutyCandidates } from '.';

const CHECKIN = BAL.deadheadCheckIn;
const floorH = (t: number) => Math.floor(t / 60) * 60;

/** One out-and-back from `dep` (aircraft parked there) two days out at 17:00 UTC; crew at base (LIS). */
function trip(dep: string, dest: string, hhmm = 17 * 60): { g: GameState; d: Duty; p: Pairing; crew: string[] } {
  const g = fixtureGame();
  const acId = Object.keys(g.fleet)[0];
  const ac = g.fleet[acId];
  ac.at = dep;
  const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + hhmm;
  const b = blockMinutes(ac.typeId, dep, dest);
  addFlight(g, { no: 'T1', aircraftId: acId, contractId: null, kind: 'revenue', from: dep, to: dest, std, sta: std + b });
  addFlight(g, { no: 'T2', aircraftId: acId, contractId: null, kind: 'revenue', from: dest, to: dep, std: std + b + 50, sta: std + 2 * b + 50 });
  const d = buildDuties(g, acId, g.now, g.now + 5 * DAY)[0];
  const crew = addCrew(g, { CPT: 2, FO: 2, PUR: 1, CC: 3 });
  return { g, d, p: g.pairings[d.pairingId], crew };
}

describe('deadhead out to a trip', () => {
  it('(a) takes a ticket a few hours before report when the 3 h buffer is already gone (was refused)', () => {
    const { g, d, p, crew } = trip('OPO', 'FNC');
    const blk = dhBlock('LIS', 'OPO');
    g.now = d.report - 4 * 60;
    // The v0.6.1 plan (report − 3 h − block, rounded down) can no longer be checked in for.
    expect(floorH(d.report - OUT_BUFFER - blk) - CHECKIN).toBeLessThan(g.now);
    const o = outTicket(g, p, d, 'LIS');
    expect(o.why).toBeNull();
    expect(o.plan.std - CHECKIN).toBeGreaterThanOrEqual(g.now);
    expect(o.plan.sta).toBeLessThanOrEqual(d.report - OUT_CONNECT);
    expect(o.plan.std % 60).toBe(0);
    expect(o.plan.sta - o.plan.std).toBe(blk);
    // The crew picker offers the base crew, with the ticket they would take.
    const c = dutyCandidates(g, d.id, 'CPT').find((x) => x.crewId === crew[0])!;
    expect(c.legal).toBe(true);
    expect(c.travel).toMatch(/^Deadhead LIS \d\d:\d\d → OPO \d\d:\d\d UTC/);
    // And the plan is FTL-legal for the crew member (merged FDP within its limit).
    const plan = planCrew(g, g.crew[crew[0]], p, segsOf(g, g.crew[crew[0]], p.id));
    expect(plan.level).not.toBe('illegal');
    expect(plan.out?.std).toBe(o.plan.std);
  });

  it('(b) flies out the day before with rest when deadhead + duty would exceed the max FDP', () => {
    const { g, d, p, crew } = trip('VNO', 'CMN');
    const blk = dhBlock('LIS', 'VNO');
    g.now = d.report - 30 * 60;
    const o = outTicket(g, p, d, 'LIS');
    expect(o.why).toBeNull();
    const rest = minRest({ dutyMin: blk + CHECKIN, atHome: false, augmented: false, tzShift: 0 });
    // Lands at least minimum rest before report: positioning, then rest at the hotel (not FDP).
    expect(d.report - o.plan.sta).toBeGreaterThanOrEqual(rest);
    expect(o.plan.std).toBe(floorH(d.report - rest - blk));
    const plan = planCrew(g, g.crew[crew[0]], p, segsOf(g, g.crew[crew[0]], p.id));
    expect(plan.level).not.toBe('illegal');
    expect(plan.segs[0].kind).toBe('pos');
  });

  it('(c) says exactly why when no ticket works: FDP with the rest option gone, or no arrival in time', () => {
    const { g, d, p, crew } = trip('VNO', 'CMN');
    // 10 h before report: every same-day ticket makes the FDP too long, and the rested one has left.
    g.now = d.report - 10 * 60;
    const o = outTicket(g, p, d, 'LIS');
    expect(o.why).toMatch(/^Deadhead \+ duty FDP \d+:\d\d > \d+:\d\d max; rest at VNO needed landing by \d\d:\d\d$/);
    // 5 h before report: nothing lands an hour before report.
    g.now = d.report - 5 * 60;
    const late = outTicket(g, p, d, 'LIS');
    const arr = floorH(g.now + CHECKIN + 59) + dhBlock('LIS', 'VNO');
    expect(arr).toBeGreaterThan(d.report - OUT_CONNECT);
    expect(late.why).toMatch(/^Earliest arrival VNO \d\d:\d\d, must land by \d\d:\d\d \(report \d\d:\d\d\)$/);
    // The picker shows that reason, not the old generic one.
    const c = dutyCandidates(g, d.id, 'CPT').find((x) => x.crewId === crew[0])!;
    expect(c.legal).toBe(false);
    expect(c.reasons[0]).toBe(late.why);
    expect(c.reasons.some((r) => /Can't reach/.test(r))).toBe(false);
    expect(c.travel).toBeUndefined();
    // A connection is named.
    const { g: g2, d: d2, p: p2 } = trip('ADA', 'IST');
    g2.now = d2.report - 3 * 60;
    expect(outTicket(g2, p2, d2, 'LIS').why).toMatch(/^Earliest arrival ADA .* \(via [A-Z]{3}\), must land by/);
  });

  it('(d) crew already away: plans from where they are, after their rest there', () => {
    const { g, d, p, crew } = trip('OPO', 'FNC');
    const c = g.crew[crew[0]];
    g.now = d.report - 12 * 60;
    // Just off a duty at MAD: resting at the hotel there for 10 h.
    c.loc = 'MAD';
    c.awaySince = g.now - DAY;
    c.log = [{ start: g.now - 8 * 60, end: g.now - 60, fdp: 6 * 60, block: 5 * 60, sectors: 2, augmented: false, disruptive: false }];
    c.restUntil = g.now + 9 * 60;
    const plan = planCrew(g, c, p, segsOf(g, c, p.id));
    expect(plan.out?.from).toBe('MAD');
    expect(plan.out!.std - CHECKIN).toBeGreaterThanOrEqual(c.restUntil);
    expect(plan.out!.sta).toBeLessThanOrEqual(d.report - OUT_CONNECT);
    expect(plan.issues.filter((i) => i.level === 'illegal')).toEqual([]);
    const cand = dutyCandidates(g, d.id, 'CPT').find((x) => x.crewId === c.id)!;
    expect(cand.loc).toBe('MAD');
    expect(cand.legal).toBe(true);
    // Resting too long to make it: the reason says so, from MAD.
    c.restUntil = d.report - 2 * 60;
    const late = planCrew(g, c, p, segsOf(g, c, p.id));
    expect(late.issues.find((i) => i.code === 'location')?.text).toMatch(/^Resting at MAD until \d\d:\d\d; earliest arrival OPO \d\d:\d\d.*, must land by/);
  });

  it('is pure and repeatable (engine read API)', () => {
    const { g, d, p } = trip('OPO', 'FNC');
    g.now = d.report - 5 * 60;
    const before = JSON.stringify(g);
    const a = outTicket(g, p, d, 'LIS');
    const b = outTicket(g, p, d, 'LIS');
    expect(a).toEqual(b);
    dutyCandidates(g, d.id, 'FO');
    expect(JSON.stringify(g)).toBe(before);
  });
});
