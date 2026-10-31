// BLU1396 round (player's save, 15 Oct 2027): a one-way widebody charter home from Montego Bay (MBJ–PAP–AMS, a
// planned extension) had no crew two days out. Three causes, each fixed and pinned here:
// 1. the ticket home after the extended duty was planned 13:45 after release, while the check asks +4 h (17:45):
//    every pilot read "Rest 14:15 < 17:45";
// 2. the ticket out rested to the pilots' report, not the cabin crew's 15 min earlier one: every cabin crew member
//    read "Rest 13:55 < 14:00";
// 3. ORO.FTL.205(d) lets the operator take +2 h before and +2 h after instead of +4 h after: both are now read.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { addFlight, retimeFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { planCrew } from './check';
import { buildDuties } from './duties';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { evalSegs, EXT_REST, extRestCut, minRest, mkSeg, type Seg, type TimelineCtx } from './rules';
import { aboard, cabinEarly, dhBlock, OUT_REST_BUFFER, outTicket, segsOf, touchCrew } from './timeline';
import { autoRoster, crewControl, dutyCandidates } from '.';
import { advanceTo } from '../sim';

const H = 60;

/** An A330 at MBJ flying MBJ–PAP–AMS two days out (2 pilots, an extended FDP), crew at LIS. */
function mbj(): { g: GameState; dutyId: string } {
  const g = fixtureGame();
  const ac = Object.values(g.fleet)[0];
  ac.typeId = 'a332';
  ac.cabin = { ...ac.cabin, total: 263, y: 263, j: 0, w: 0 };
  ac.at = 'MBJ';
  const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 14 * H + 30;
  addFlight(g, { no: 'AW1396', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'MBJ', to: 'PAP', std, sta: std + 70, pax: 263 });
  addFlight(g, { no: 'AW1396', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'PAP', to: 'AMS', std: std + 180, sta: std + 180 + 540, pax: 263 });
  addCrew(g, { CPT: 3, FO: 3, PUR: 2, CC: 10 }, 'A330/340');
  // v0.12.1 approvals are checked at departure: the A330 and the PAP–AMS crossing on our certificate.
  g.company.approvals.push('widebody', 'etops120');
  const d = buildDuties(g, ac.id, g.now, g.now + 5 * DAY)[0];
  return { g, dutyId: d.id };
}

describe('BLU1396: an extended duty far from base', () => {
  it('is an extended FDP ending away from base, 15 min earlier for the cabin crew', () => {
    const { g, dutyId } = mbj();
    const d = g.duties[dutyId];
    expect(d.ext).toBe(true);
    expect(d.restAt).toBe('AMS');
    expect(cabinEarly(g, g.pairings[d.pairingId], d)).toBe(15);
  });

  it('every seat has legal candidates: the ticket home waits the extension rest, the ticket out rests to the cabin report', () => {
    const { g, dutyId } = mbj();
    const d = g.duties[dutyId];
    const p = g.pairings[d.pairingId];
    for (const role of ['CPT', 'FO', 'PUR', 'CC'] as const) {
      const legal = dutyCandidates(g, dutyId, role).filter((c) => c.legal);
      expect(legal.length, role).toBeGreaterThan(0);
      // Never the two BLU1396 refusals.
      for (const c of dutyCandidates(g, dutyId, role)) expect(c.reasons.join(' / ')).not.toMatch(/Rest 1[34]:\d\d < 1[47]:\d\d/);
    }
    const c = g.crew[dutyCandidates(g, dutyId, 'CC').find((x) => x.legal)!.crewId];
    const plan = planCrew(g, c, p, segsOf(g, c, p.id));
    expect(plan.level).not.toBe('illegal');
    const out = plan.out!;
    const tz = 14 * H;
    // Lands with the 14 h rest (4+ time zones) plus the far-trip margin before the cabin crew's report.
    expect(d.report - d.cabinEarly! - out.sta).toBeGreaterThanOrEqual(tz + OUT_REST_BUFFER - 60);
    // Home: after the duty's rest +2 h (the crew rested 2 h more than the minimum before) or +4 h.
    const dutyMin = d.release - d.report + d.cabinEarly!;
    const base = minRest({ dutyMin, atHome: false, augmented: false, tzShift: 0 });
    const home = plan.home!;
    expect(home.std - BAL.deadheadCheckIn - d.release).toBeGreaterThanOrEqual(base + EXT_REST.split);
  });

  it('the roster crews the whole trip', () => {
    const { g, dutyId } = mbj();
    autoRoster(g, {});
    const p = g.pairings[g.duties[dutyId].pairingId];
    expect(p.slots.filter((s) => !s.above).every((s) => s.crewId)).toBe(true);
  });

  it('a late itinerary still rests: the ticket out leaves a few hours before the last one that would', () => {
    const { g, dutyId } = mbj();
    const d = g.duties[dutyId];
    const p = g.pairings[d.pairingId];
    const o = outTicket(g, p, d, 'LIS');
    expect(o.why).toBeNull();
    const blk = dhBlock('LIS', 'MBJ');
    const last = Math.floor((d.report - d.cabinEarly! - 14 * H - blk) / 60) * 60;
    expect(o.plan.std).toBeLessThanOrEqual(last - OUT_REST_BUFFER + 59);
    // Too late for the margin: the last ticket that still rests, not none.
    g.now = last - BAL.deadheadCheckIn - 30;
    const o2 = outTicket(g, p, d, 'LIS');
    expect(o2.why).toBeNull();
    expect(o2.plan.std).toBe(last);
  });
});

describe('ORO.FTL.205(d) rest options around a planned extension', () => {
  const ctx: TimelineCtx = { base: 'LIS', restUntil: 0, lastRecovery: 0, blockYear: 0, blockYearOf: 2028, freeSince: -10 * DAY };
  const T0 = 10 * DAY;
  const duty = (start: number, len: number, ext = false, fresh = true): Seg =>
    mkSeg({ kind: 'duty', start, end: start + len, fdp: len, maxFdp: 14 * H, block: len - 60, sectors: 2, aug: false, disruptive: false, rest: minRest({ dutyMin: len, atHome: false, augmented: false, tzShift: 0, extended: ext }), at: 'AMS', from: 'AMS', dutyId: `d${start}`, ticketId: undefined, home: undefined, out: undefined, fresh, ext });
  const rests = (l: ReturnType<typeof evalSegs>) => l.filter((i) => i.code === 'rest').map((i) => i.text);

  it('+4 h after: a minimum rest before the extended duty is legal, the rest after needs the 4 h', () => {
    const a = duty(T0, 10 * H);
    const e = duty(a.end + a.rest, 13 * H + 30, true);
    // 13:30 + 4 h after.
    const ok = duty(e.end + 17 * H + 30, 8 * H);
    expect(rests(evalSegs(ctx, [a, e, ok]))).toEqual([]);
    const short = duty(e.end + 16 * H, 8 * H);
    expect(rests(evalSegs(ctx, [a, e, short]))).toEqual(['Rest 16:00 < 17:30']);
  });

  it('+2 h before and +2 h after: 2 h more rest before allows the rest after at +2 h, never less', () => {
    const a = duty(T0, 10 * H);
    const e = duty(a.end + a.rest + 2 * H, 13 * H + 30, true);
    expect(rests(evalSegs(ctx, [a, e, duty(e.end + 15 * H + 30, 8 * H)]))).toEqual([]);
    expect(rests(evalSegs(ctx, [a, e, duty(e.end + 15 * H, 8 * H)]))).toEqual(['Rest 15:00 < 15:30']);
    // 1:59 more before is not the +2 h option: +4 h after.
    const e2 = duty(a.end + a.rest + 2 * H - 1, 13 * H + 30, true);
    expect(rests(evalSegs(ctx, [a, e2, duty(e2.end + 15 * H + 30, 8 * H)]))).toEqual(['Rest 15:30 < 17:30']);
    expect(extRestCut(100, 100 - 2 * H)).toBe(2 * H);
    expect(extRestCut(100, 100 - 2 * H + 1)).toBe(0);
  });
});

describe('ORO.FTL.205(d) at the release: a standby is not rest before the extended duty', () => {
  /** MBJ–PAP–AMS rostered and flown to the release; an FO's hotel standby at MBJ from the end of her rest (`sby`). */
  function flown(sby: boolean) {
    const { g, dutyId } = mbj();
    autoRoster(g, {});
    const d = g.duties[dutyId];
    const p = g.pairings[d.pairingId];
    const fo = g.crew[p.slots.find((s) => s.role === 'FO' && s.crewId)!.crewId!];
    const t = d.deadheadIds.map((id) => g.flights[id]).find((f) => f && aboard(f, fo.id) && f.sta <= d.report)!;
    advanceTo(g, t.sta + 30, new Set());
    // The ticket out lands with the far-trip margin: her minimum rest ends over 2 h before the report.
    expect(d.report - fo.restUntil).toBeGreaterThanOrEqual(EXT_REST.split);
    if (sby) {
      // Called out from it for this duty: standby and duty run on, the rest before was only the minimum.
      fo.standby = [{ from: fo.restUntil, to: d.report + 4 * H, kind: 'hotel', at: 'MBJ', calledAt: d.report - 60 }];
      touchCrew(g);
    }
    advanceTo(g, g.duties[dutyId].release + 3 * H, new Set());
    const e = fo.log.find((x) => x.ext)!;
    expect(g.duties[dutyId].done).toBe(true);
    return { fo, e, full: minRest({ dutyMin: e.end - e.start, atHome: false, augmented: false, tzShift: 0, extended: true }) };
  }

  it('2 h more rest before: +2 h after', () => {
    const { fo, e, full } = flown(false);
    expect(e.extRest).toBe('split');
    expect(fo.restUntil - e.end).toBeGreaterThanOrEqual(full - EXT_REST.split);
  });

  it('a standby after the minimum rest: +4 h after', () => {
    const { fo, e, full } = flown(true);
    expect(e.extRest).toBe('after');
    expect(fo.restUntil - e.end).toBeGreaterThanOrEqual(full);
  });
});

describe('BLU1396: Crew Control delay and Auto-fix agree', () => {
  /**
   * A DUS–FNC trip with no captain: the one captain not on leave flies LIS–DUS on the other aircraft the day before
   * and rests at Düsseldorf until 5 min after this trip's report ('Rest 9:55 < 10:00', as BLU1396's cabin crew).
   */
  function fiveShort() {
    const g = fixtureGame(5);
    const [a1, a2] = Object.values(g.fleet);
    const cpt = Object.values(g.crew).find((c) => c.role === 'CPT')!.id;
    for (const c of Object.values(g.crew)) {
      c.off = [];
      if (c.role === 'CPT' && c.id !== cpt) { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    }
    a1.at = 'DUS';
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 17 * H;
    const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [a1.id], start: std - DAY, end: std + 2 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false }, penalties: { cancelScale: [], perDelay: 2_500, perCancelledLeg: 15_000 } });
    const f1 = addFlight(g, { no: 'AW816', aircraftId: a1.id, contractId: k.id, kind: 'revenue', from: 'DUS', to: 'FNC', std, sta: std + 4 * H, pax: 170 });
    addFlight(g, { no: 'AW817', aircraftId: a1.id, contractId: k.id, kind: 'revenue', from: 'FNC', to: 'DUS', std: std + 4 * H + 50, sta: std + 8 * H + 50, pax: 160 });
    const report = buildDuties(g, a1.id, g.now, g.now + 5 * DAY)[0].report;
    // The other aircraft's one-way LIS–DUS, timed so its release + 10 h ends 5 min after that report.
    const x = addFlight(g, { no: 'AW900', aircraftId: a2.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'DUS', std: report - 15 * H, sta: report - 12 * H, pax: 150 });
    const d2 = buildDuties(g, a2.id, g.now, g.now + 5 * DAY)[0];
    const shift = report - 10 * H + 5 - d2.release;
    retimeFlight(g, x, x.std + shift, x.sta + shift);
    buildDuties(g, a2.id, g.now, g.now + 5 * DAY);
    autoRoster(g, { aircraftIds: [a2.id] });
    expect(g.pairings[g.duties[x.dutyId!].pairingId].slots.find((s) => s.role === 'CPT')!.crewId).toBe(cpt);
    autoRoster(g, { aircraftIds: [a1.id] });
    g.now = report - 30 * H;
    touchCrew(g);
    return { g, flightId: f1.id, cpt };
  }

  it('offers the small delay that makes the rest legal, and never points to an Auto-fix that cannot crew it', () => {
    const { g, flightId, cpt } = fiveShort();
    const f = g.flights[flightId];
    expect(g.pairings[g.duties[f.dutyId!].pairingId].slots.find((s) => s.role === 'CPT')!.crewId).toBeNull();
    const cand = dutyCandidates(g, flightId, 'CPT').find((c) => c.crewId === cpt)!;
    expect(cand.reasons, JSON.stringify(cand)).toContain('Rest 9:55 < 10:00');
    const v = crewControl(g, flightId)!;
    const by = (id: string) => v.solutions.find((s) => s.id === id)!;
    const auto = by('autoFix');
    expect(auto.available && auto.preview.after.level !== 'missing' && auto.preview.after.level !== 'illegal').toBe(false);
    const delay = by('delay');
    expect(delay.available, delay.why).toBe(true);
    expect(delay.newDeparture).toBe(f.std + 10);
    for (const s of v.solutions) if (!s.available) expect(s.why ?? '').not.toMatch(/use Auto-fix/);
  });
});
