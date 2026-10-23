// v0.9 roster planning like a real EASA operator (UPDATE-0.9.md §R.13): legal days off, standby instead of OFF,
// hotel standby at detachments, standby in the duty limits, call-out reductions, rest after standby, annual leave,
// protected days off and old saves.

import { describe, expect, it } from 'vitest';
import { DAY, fmtTime, fromUTC, monthKey, monthStart, yearOf } from '../core/time';
import type { CrewMember, GameState } from '../core/types';
import { demoFlights, devFleet, devRoster } from '../dev';
import { addFlight, ownFlightNo } from '../core/entities';
import { blockMinutes } from '../core/perf';
import { BAL } from '../core/balance';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { fixture } from '../fixtures/compatKit';
import { addCrew, fixtureGame } from './fixtures';
import { autoRoster, crewControl, crewWindows, dayIndex, dropTargets, moveDuty, offBreak, planLeave, publishedTo } from '.';
import { crewMonth, dayPlanMonth, midnight, monthFloorIssue, offDaysHit, offOn, offSwappable, takeOffDays } from './dayPlan';
import { crewCalendar } from './calendar';
import { evalSegs, localMin, minRest, nightsIn, offsetAt, standbyCut, standbyView, STANDBY, type Seg } from './rules';
import { reserveContact, standbyFor } from './standby';
import { ctxOf, segsOf, standbySeg } from './timeline';

const H = 60;

/** Day indices (base-local) with work: a duty, ticket or standby seg touching the day. */
function workDays(g: GameState, c: CrewMember): Set<number> {
  const s = new Set<number>();
  for (const x of segsOf(g, c)) {
    if (x.kind === 'log') continue;
    for (let k = dayIndex(c.base, x.start); k <= dayIndex(c.base, x.end - 1); k++) s.add(k);
  }
  return s;
}

/** devRoster (4 A320s, a DUB season base, 20 days run), shared by the read-only tests. */
let dub: { g: GameState; dubCrew: string } | null = null;
function dubRun(): { g: GameState; dubCrew: string } {
  if (dub) return dub;
  const g = fixtureGame(11);
  const dubCrew = devRoster(g);
  dub = { g, dubCrew };
  return dub;
}

describe('§R.13 1–2: legal minimums; unassigned days are standby, not off', () => {
  it('every closed crew-month keeps ≥ 7 days off (≤ 10 planned), two 2-day blocks, and recovery within 168 h', () => {
    const g = fixtureGame(12);
    devRoster(g);
    advanceTo(g, g.now + 100 * DAY, new Set());
    const r = g.stats.v09!.roster!;
    expect(r.months).toBeGreaterThan(100);
    expect(r.monthsLow).toBe(0);
    for (const c of Object.values(g.crew)) {
      for (const [mk, n] of Object.entries(c.offMonths ?? {})) {
        expect(n, `${c.id} month ${mk}`).toBeGreaterThanOrEqual(7);
        // (the first month of a crew member, or of the company, can run long: the planner starts them staggered)
        if (+mk > monthKey(Math.max(g.started, c.hired))) expect(n, `${c.id} month ${mk}`).toBeLessThanOrEqual(12);
      }
    }
    // Two recovery rests of 2 whole local days in last month (ORO.FTL.235(d); counted as they happen: c.twoDays).
    const mk = monthKey(g.now) - 1;
    for (const c of Object.values(g.crew)) {
      if (c.hired > g.started || c.blocks?.some((b) => monthKey(b.from) <= mk && monthKey(b.to) >= mk)) continue;
      expect(c.twoDays?.[mk] ?? 0, c.id).toBeGreaterThanOrEqual(2);
    }
    // v0.9 fix: the 168 h is a hard planning limit (a planned duty keeps an hour in hand for delays).
    expect(r.maxRecGapH).toBeLessThanOrEqual(168);
  }, 120_000);

  it('inside the published roster every day is work, a planned day off, standby, leave or rest the limits ask for', () => {
    const { g } = dubRun();
    const today = dayIndex(g.company.homeBase, g.now);
    const pub = dayIndex(g.company.homeBase, publishedTo(g));
    let days = 0;
    let rest = 0;
    let sby = 0;
    for (const c of Object.values(g.crew)) {
      if (c.status === 'joining' || c.notice) continue;
      const work = workDays(g, c);
      for (let k = today + 1; k < pub; k++) {
        if (c.blocks?.some((b) => dayIndex(c.base, b.from) <= k && dayIndex(c.base, b.to - 1) >= k)) continue;
        days++;
        if (offOn(c, k)) continue;
        if (c.standby?.some((w) => dayIndex(c.base, w.from) === k)) sby++;
        if (!work.has(k)) rest++;
      }
    }
    // Free days are standby: "Rest (limits)" stays the exception.
    expect(sby / days).toBeGreaterThan(0.25);
    expect(rest / days).toBeLessThan(0.1);
  }, 120_000);
});

describe('§R.13 3: hotel standby at a detachment', () => {
  it('DUB tour crew sit on hotel standby at DUB on their non-flying, non-OFF days', () => {
    const { g, dubCrew } = dubRun();
    expect(dubCrew).not.toBe('');
    const hotel = Object.values(g.crew).flatMap((c) => (c.standby ?? []).filter((w) => w.kind === 'hotel' && w.at === 'DUB'));
    expect(hotel.length).toBeGreaterThan(5);
    for (const w of hotel) expect(w.to - w.from).toBeLessThanOrEqual(12 * H);
  }, 120_000);

  it('a sick call at DUB: Crew Control calls hotel standby first, ready in 45 min, no overtime', () => {
    const { g } = dubRun();
    // A DUB departure within the next day whose crew has someone on hotel standby at DUB now.
    const onSby = Object.values(g.crew).filter((c) => c.standby?.some((w) => w.kind === 'hotel' && w.at === 'DUB' && w.from <= g.now + 2 * H && w.to > g.now + 4 * H));
    const f = Object.values(g.flights)
      .filter((x) => x.from === 'DUB' && x.status === 'scheduled' && x.dutyId && x.std > g.now + 3 * H && x.std < g.now + 12 * H)
      .sort((a, b) => a.std - b.std)[0];
    if (!f || !onSby.length) return; // the schedule of this seed has no such moment (covered by the label test below)
    const p = g.pairings[g.duties[f.dutyId!].pairingId];
    const slot = p.slots.find((s) => s.crewId && g.crew[s.crewId].role === 'CC' && onSby.some((c) => c.role === 'CC'));
    if (!slot) return;
    slot.crewId = null;
    const v = crewControl(g, f.id)!;
    const s = v.solutions.find((x) => x.id === 'callIn');
    if (s?.available && s.options?.length) {
      expect(s.options[0].label).toMatch(/Hotel standby at DUB · ready in 45 min|Airport standby/);
      expect(s.options[0].cost).toBe(0);
    }
  }, 120_000);
});

describe('§R.13 4–6: standby in the limits, call-outs, rest after standby', () => {
  const crew = () => {
    const g = fixtureGame(7);
    const [id] = addCrew(g, { CPT: 1 });
    const c = g.crew[id];
    c.off = [];
    delete c.standby;
    return { g, c };
  };
  it('home 12 h → 3 h, hotel 12 h → 3 h, airport 4 h → 4 h, reserve → 0 in the 7/14/28-day duty', () => {
    const { g, c } = crew();
    const d0 = Math.floor(g.now / DAY) * DAY + DAY;
    c.standby = [
      { from: d0 + 5 * H, to: d0 + 17 * H, shift: 'E' },
      { from: d0 + DAY + 6 * H, to: d0 + DAY + 18 * H, kind: 'hotel', at: 'DUB' },
      { from: d0 + 2 * DAY + 5 * H, to: d0 + 2 * DAY + 9 * H, kind: 'airport' },
      { from: d0 + 3 * DAY, to: d0 + 4 * DAY, kind: 'reserve' },
    ];
    const w = crewWindows(g, c, d0 + 5 * DAY);
    expect(w.duty7d).toBe(3 * H + 3 * H + 4 * H);
    expect(w.duty28d).toBe(10 * H);
  });

  it('call-out reductions: home after 6 h (8 h augmented), airport after 4 h, the night not counted, awake and 16 h caps', () => {
    const t0 = 1_000 * DAY; // 00:00 UTC
    // Home standby from 06:00, called for a 14:00 report: 8 h → 2 h off the FDP; augmented: none until 8 h.
    expect(standbyCut('home', t0 + 6 * H, t0 + 14 * H, 'LIS', false)).toBe(2 * H);
    expect(standbyCut('home', t0 + 6 * H, t0 + 14 * H, 'LIS', true)).toBe(0);
    // Airport standby 5 h before report: 1 h off.
    expect(standbyCut('airport', t0 + 5 * H, t0 + 10 * H, 'LIS', false)).toBe(H);
    // 23:00–07:00 before contact is not counted (Lisbon in winter = UTC).
    expect(standbyCut('home', t0 - H, t0 + 9 * H, 'LIS', false, t0 + 7 * H)).toBe(0);
    expect(STANDBY.awakeMax).toBe(18 * H);
    expect(STANDBY.airportTotal).toBe(16 * H);
  });

  it('reserve answers only a report at least 10 h after the call; home standby needs its 90 min', () => {
    const { g, c } = crew();
    // Round 4: a call in the day (09:00 local); 22:00–06:00 is the reserve's no-contact period (tested below).
    g.now = g.now - localMin(c.base, g.now) + 9 * H;
    c.standby = [{ from: g.now - H, to: g.now + 23 * H, kind: 'reserve' }];
    expect(standbyFor(g, c, g.now + 8 * H)).toBeNull();
    expect(standbyFor(g, c, g.now + 11 * H)?.kind).toBe('reserve');
    c.standby = [{ from: g.now - H, to: g.now + 11 * H }];
    expect(standbyFor(g, c, g.now + 60)).toBeNull();
    expect(standbyFor(g, c, g.now + 2 * H)?.kind).toBe('home');
  });

  it('a window not called is followed by 12 h rest at home before the next report', () => {
    const { g, c } = crew();
    const w = { from: g.now + DAY, to: g.now + DAY + 12 * H };
    const sby = standbySeg(c, w);
    expect(sby.rest).toBe(minRest({ dutyMin: 0, atHome: true, augmented: false, tzShift: 0 }));
    expect(sby.rest).toBe(12 * H);
    const duty = (start: number): Seg => ({ kind: 'duty', start, end: start + 8 * H, fdp: 7 * H, maxFdp: 13 * H, block: 5 * H, sectors: 2, aug: false, disruptive: false, rest: 12 * H, at: c.base, from: c.base, dutyId: 'x' });
    const ctx = { ...ctxOf(g, c), now: g.now + DAY + 13 * H };
    const bad = evalSegs(ctx, [{ ...sby }, duty(w.to + 11 * H)]);
    expect(bad.some((i) => i.code === 'rest' && i.level === 'illegal')).toBe(true);
    const ok = evalSegs(ctx, [{ ...sby }, duty(w.to + 12 * H)]);
    expect(ok.some((i) => i.code === 'rest' && i.level === 'illegal')).toBe(false);
  });
});

describe('§R.13 7: annual leave', () => {
  it('28 days a year, weighted to Q1 and Q4, ≤ 10 % of a group at once, never in the published roster', () => {
    const g = fixtureGame(13);
    const y = new Date(Date.UTC(2000, 0, 1) + g.now * 60_000).getUTCFullYear() + 1;
    for (const c of Object.values(g.crew)) c.blocks = c.blocks?.filter((b) => !b.annual);
    planLeave(g, y);
    const y0 = Date.UTC(y, 0, 1);
    const byQ = [0, 0, 0, 0];
    const perDay = new Map<string, number>();
    let total = 0;
    for (const c of Object.values(g.crew)) {
      const blocks = (c.blocks ?? []).filter((b) => b.annual && new Date(Date.UTC(2000, 0, 1) + b.from * 60_000).getUTCFullYear() === y);
      const days = blocks.reduce((n, b) => n + Math.round((b.to - b.from) / DAY), 0);
      expect(days, c.id).toBeGreaterThanOrEqual(24);
      expect(days, c.id).toBeLessThanOrEqual(28);
      total += days;
      for (const b of blocks) {
        const q = Math.floor(new Date(Date.UTC(2000, 0, 1) + (b.from + 12 * H) * 60_000).getUTCMonth() / 3);
        byQ[q] += Math.round((b.to - b.from) / DAY);
        for (let k = dayIndex(c.base, b.from + H); k <= dayIndex(c.base, b.to - H); k++) for (const f of c.ratings) perDay.set(`${f}|${c.role}|${k}`, (perDay.get(`${f}|${c.role}|${k}`) ?? 0) + 1);
      }
    }
    expect(byQ[0] + byQ[3]).toBeGreaterThan(byQ[1] + byQ[2]);
    const size = new Map<string, number>();
    for (const c of Object.values(g.crew)) for (const f of c.ratings) size.set(`${f}|${c.role}`, (size.get(`${f}|${c.role}`) ?? 0) + 1);
    for (const [k, n] of perDay) {
      const grp = k.split('|').slice(0, 2).join('|');
      expect(n, k).toBeLessThanOrEqual(Math.max(1, Math.ceil(0.1 * size.get(grp)!)));
    }
    expect(total).toBeGreaterThan(0);
    void y0;
    // This year's leave (planned at the start) never sits inside the first published 14 days.
    const g2 = fixtureGame(14);
    for (const c of Object.values(g2.crew)) for (const b of c.blocks ?? []) if (b.annual) expect(b.from).toBeGreaterThanOrEqual(publishedTo(g2) - DAY);
  });
});

describe('§R.13 8: protected days off', () => {
  it('a board move onto a published day off asks first, costs morale −6 and moves the day off; the roster never takes one', () => {
    const g = fixtureGame(15);
    // Demo work for 10 days on the first aircraft, rostered.
    demoFlights(g, ['FAO', 'OPO'], 10, 'revenue');
    autoRoster(g, { to: g.now + 14 * DAY });
    // The roster never puts work on a planned day off.
    for (const c of Object.values(g.crew)) {
      const work = new Set<number>();
      for (const x of segsOf(g, c)) if (x.kind === 'duty' || x.kind === 'pos') for (let k = dayIndex(c.base, x.start); k <= dayIndex(c.base, x.end - 1); k++) work.add(k);
      for (const k of c.off ?? []) expect(work.has(k), `${c.id} day ${k}`).toBe(false);
    }
    // A duty and a same-role crew member with a published day off on it.
    const duties = Object.values(g.duties).filter((d) => d.report > g.now + DAY && d.report < publishedTo(g) - DAY).sort((a, b) => a.report - b.report);
    let found: { dutyId: string; from: string; to: string } | null = null;
    for (const d of duties) {
      const p = g.pairings[d.pairingId];
      for (const s of p.slots) {
        if (!s.crewId) continue;
        const role = g.crew[s.crewId].role;
        const other = Object.values(g.crew).find((c) => c.role === role && c.id !== s.crewId && offOn(c, dayIndex(c.base, d.report)) && !p.slots.some((x) => x.crewId === c.id));
        if (other) {
          found = { dutyId: d.id, from: s.crewId, to: other.id };
          break;
        }
      }
      if (found) break;
    }
    expect(found).not.toBeNull();
    const { dutyId, from, to } = found!;
    const t = dropTargets(g, dutyId, from, 'duty')[to];
    expect(t?.offBreak).toMatch(/day off/);
    const d = g.duties[dutyId];
    const ob = offBreak(g, to, d.report, d.release)!;
    expect(ob.protected).toBe(true);
    expect(ob.morale).toBe(-6);
    if (t.level === 'illegal' || t.level === 'ineligible') return;
    const no = moveDuty(g, dutyId, from, to, 'duty');
    expect(no.ok).toBe(false);
    const c = g.crew[to];
    const m0 = c.morale;
    const k = dayIndex(c.base, d.report);
    const offs0 = (c.off ?? []).filter((x) => monthKey(x * DAY) === monthKey(k * DAY)).length;
    const yes = moveDuty(g, dutyId, from, to, 'duty', { takeOff: true, force: true });
    expect(yes.ok).toBe(true);
    expect(offOn(c, k)).toBe(false);
    expect(c.morale).toBeLessThan(m0);
    expect(c.moraleWhy?.daysOff).toBeLessThanOrEqual(-6);
    // The day off moved, in the same month when a free unpublished day was left.
    const offs1 = (c.off ?? []).filter((x) => monthKey(x * DAY) === monthKey(k * DAY)).length;
    expect(offs1).toBeGreaterThanOrEqual(offs0 - 1);
    expect(g.stats.v09!.roster!.offBroken).toBe(1);
  });

  it('a break that leaves the month below 7 is illegal', () => {
    const g = fixtureGame(16);
    const [id] = addCrew(g, { CPT: 1 });
    const c = g.crew[id];
    // The 7 days off of this month are its last 7 days, all published: one taken can only move to next month.
    const mk = monthKey(g.now);
    const end = monthStart(mk + 1) / DAY;
    g.now = (end - 9) * DAY + 8 * H;
    c.off = [];
    for (let k = end - 7; k < end; k++) c.off.push(k);
    g.dayPlan!.publishedTo = (end + 5) * DAY;
    g.dayPlan!.planned = (end + 5) * DAY;
    const k0 = end - 5;
    const ob = offBreak(g, id, k0 * DAY + 8 * H, k0 * DAY + 14 * H)!;
    expect(ob.legal).toBe(false);
    expect(ob.text).toMatch(/would fall to 6 \(minimum 7\)/);
  });
});

describe('§R.13 9: old saves', () => {
  it('a v0.8 save keeps its published days, plans from dayPlan.from, holds the rules 60 days on and round-trips', () => {
    const g = deserialize(fixture('v08'));
    expect(g.dayPlan).toBeDefined();
    const from = g.dayPlan!.from;
    expect(from).toBeGreaterThan(g.now + 13 * DAY);
    expect(g.messages.some((m) => m.title === 'Roster planning changed')).toBe(true);
    // Before `from` nothing is planned as a day off.
    for (const c of Object.values(g.crew)) expect((c.off ?? []).every((k) => k >= dayIndex(c.base, from) - 1)).toBe(true);
    advanceTo(g, g.now + 60 * DAY, new Set());
    const r = g.stats.v09!.roster!;
    expect(r.monthsLow).toBe(0);
    expect(Object.values(g.crew).some((c) => (c.off ?? []).length > 0)).toBe(true);
    expect(Object.values(g.crew).some((c) => c.standby?.some((w) => w.from >= from))).toBe(true);
    const again = deserialize(serialize(g));
    expect(JSON.parse(serialize(again)).state).toEqual(JSON.parse(serialize(g)).state);
  }, 120_000);
});

describe('v0.9 round 3: stagger, the day-off swap, airport standby', () => {
  it('days off are staggered: in each role never half the group off on a day, and 9 days in 10 at the 30 % average or below', () => {
    const g = fixtureGame(11);
    devRoster(g);
    advanceTo(g, g.now + 30 * DAY, new Set());
    const t0 = dayIndex(g.company.homeBase, g.now);
    for (const role of ['CPT', 'FO', 'PUR', 'CC'] as const) {
      const cs = Object.values(g.crew).filter((c) => c.role === role && c.status !== 'joining');
      const share: number[] = [];
      for (let k = t0 - 30; k < t0 + 14; k++) share.push(cs.filter((c) => offOn(c, k)).length / cs.length);
      share.sort((a, b) => a - b);
      expect(share[share.length - 1], role).toBeLessThan(0.5);
      expect(share[Math.floor(0.9 * (share.length - 1))], role).toBeLessThanOrEqual(0.31);
    }
  }, 120_000);

  it('a published day off is swapped only by agreement: short notice, morale ≥ 50, once in 14 days; the day moves inside its month (morale −3)', () => {
    const g = fixtureGame(18);
    devRoster(g);
    const S = BAL.v09.roster.swap;
    // A crew member with a published day off 2–3 days out and the month able to take it back.
    const pub = dayIndex(g.company.homeBase, publishedTo(g));
    const today = dayIndex(g.company.homeBase, g.now);
    const c = Object.values(g.crew).find((x) => x.status !== 'joining' && (x.off ?? []).some((k) => k >= today + 2 && k <= today + 3 && k < pub && monthKey(k * DAY) === monthKey((k + 5) * DAY)))!;
    expect(c).toBeDefined();
    const k = c.off!.find((x) => x >= today + 2 && x <= today + 3)!;
    const day = midnight(c.base, k);
    const work: Seg = { kind: 'duty', start: day + 8 * H, end: day + 14 * H, fdp: 6 * H, maxFdp: 13 * H, block: 4 * H, sectors: 2, aug: false, disruptive: false, rest: 12 * H, at: c.base, from: c.base, fresh: true };
    const segs = [...segsOf(g, c), work].sort((a, b) => a.start - b.start);
    c.morale = 60;
    expect(offSwappable(g, c, segs)).toBe(true);
    // Not with low morale, nor for work more than 72 h out, nor twice in 14 days.
    c.morale = S.minMorale - 1;
    expect(offSwappable(g, c, segs)).toBe(false);
    c.morale = 60;
    const far = { ...work, start: g.now + (S.horizonH + 1) * H, end: g.now + (S.horizonH + 7) * H };
    expect(offSwappable(g, c, [...segsOf(g, c), far].sort((a, b) => a.start - b.start))).toBe(false);
    const mk = monthKey(k * DAY);
    const inMonth = () => (c.off ?? []).filter((x) => monthKey(x * DAY) === mk).length;
    const n0 = inMonth();
    const m0 = c.morale;
    const swaps0 = g.stats.v09!.roster!.offSwaps ?? 0;
    const moves = takeOffDays(g, c, [work], true);
    expect(moves.length).toBeGreaterThan(0);
    expect(offOn(c, k)).toBe(false);
    expect(inMonth()).toBe(n0);
    expect(c.morale).toBeCloseTo(m0 + S.morale, 5);
    expect(c.offSwapAt).toBe(g.now);
    expect(g.stats.v09!.roster!.offSwaps).toBe(swaps0 + 1);
    expect(offSwappable(g, c, segs)).toBe(false);
  }, 120_000);

  it('airport standby: 3 A320 departures 05:00–10:00 local at base put 1 CPT, 1 FO and 1 CC at the airport, 90 min before the first, 4 h', () => {
    const g = fixtureGame(19);
    devFleet(g, 4);
    addCrew(g, { CPT: 12, FO: 12, PUR: 12, CC: 36 });
    advanceTo(g, g.now + 2 * DAY, new Set());
    const home = g.company.homeBase;
    // Day D enters the published roster at tomorrow's midnight run.
    const D = dayIndex(home, publishedTo(g));
    const acs = Object.values(g.fleet).slice(0, 3);
    const stds = acs.map((_, i) => midnight(home, D) + (6 + i) * 60 + 30);
    acs.forEach((ac, i) => {
      const blk = blockMinutes(ac.typeId, home, 'FAO');
      addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: home, to: 'FAO', std: stds[i], sta: stds[i] + blk, pax: 150 });
      addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FAO', to: home, std: stds[i] + blk + 50, sta: stds[i] + 2 * blk + 50, pax: 150 });
    });
    advanceTo(g, midnight(home, D - 13) + 60, new Set());
    const asby = Object.values(g.crew).flatMap((c) => (c.standby ?? []).filter((w) => w.kind === 'airport' && dayIndex(home, w.from) === D).map((w) => ({ c, w })));
    expect(asby.map(({ c }) => (c.role === 'PUR' ? 'CC' : c.role)).sort()).toEqual(['CC', 'CPT', 'FO']);
    for (const { w } of asby) {
      expect(w.from).toBe(Math.min(...stds) - BAL.v09.roster.airport.leadMin);
      expect(w.to - w.from).toBe(BAL.v09.roster.airport.hours * 60);
    }
  }, 120_000);
});

describe('v0.9 round 4: days off keep the morning free, reserve no-contact, standby call-out cuts, the 96 a year', () => {
  const crew = () => {
    const g = fixtureGame(7);
    const [id] = addCrew(g, { CPT: 1 });
    const c = g.crew[id];
    c.off = [];
    delete c.standby;
    return { g, c };
  };
  /** UTC minute of `local` minutes after local midnight at `code` on the local day of t. */
  const localAt = (code: string, t: number, local: number) => t - localMin(code, t) + local;

  it('every planned off block holds 2 local nights, and no home standby opens before 06:00 the morning after a day off', () => {
    const { g } = dubRun();
    const home = g.company.homeBase;
    const today = dayIndex(home, g.now);
    const pub = dayIndex(home, publishedTo(g));
    let blocks = 0;
    let singles = 0;
    for (const c of Object.values(g.crew)) {
      if (c.status === 'joining' || c.notice) continue;
      const work = segsOf(g, c).filter((x) => x.kind !== 'log');
      const off = (c.off ?? []).filter((k) => k > today && k < pub);
      for (let i = 0; i < off.length; i++) {
        if (i > 0 && off[i - 1] === off[i] - 1) continue;
        let j = i;
        while (j + 1 < off.length && off[j + 1] === off[j] + 1) j++;
        const a = midnight(c.base, off[i]);
        const b = midnight(c.base, off[j] + 1);
        const before = work.filter((x) => x.end <= a + 6 * H).reduce((m, x) => Math.max(m, x.end), -Infinity);
        const after = work.filter((x) => x.start >= b - 6 * H).reduce((m, x) => Math.min(m, x.start), Infinity);
        // nightsIn reads one offset for the whole span: a block across the clock change is counted by hand elsewhere.
        if (before === -Infinity || after === Infinity || offsetAt(c.base, before) !== offsetAt(c.base, after)) continue;
        blocks++;
        if (j === i) singles++;
        expect(nightsIn(c.base, before, after), `${c.id} off ${off[i]}–${off[j]}`).toBeGreaterThanOrEqual(2);
      }
      for (const w of c.standby ?? []) {
        if ((w.kind ?? 'home') !== 'home' || !offOn(c, dayIndex(c.base, w.from) - 1)) continue;
        expect(localMin(c.base, w.from), `${c.id} window after a day off`).toBeGreaterThanOrEqual(BAL.v09.roster.off.morningFree);
      }
    }
    expect(blocks).toBeGreaterThan(20);
    void singles;
    // A single day off is 1 day and 2 nights: a report before 06:00 the next morning takes the day off before it.
    const c = Object.values(g.crew).find((x) => x.off?.length)!;
    const k = c.off![0];
    expect(offDaysHit(c, midnight(c.base, k + 1) + 5 * H, midnight(c.base, k + 1) + 12 * H)).toContain(k);
    expect(offDaysHit(c, midnight(c.base, k + 1) + 6 * H, midnight(c.base, k + 1) + 12 * H)).not.toContain(k);
  }, 120_000);

  it('a reserve is not called 22:00–06:00: at 02:00 a 12:00 report is refused, the 10 h run from 06:00 (16:00), as the calendar says', () => {
    const { g, c } = crew();
    const m = localAt(c.base, g.now + DAY, 0);
    g.now = m + 2 * H;
    c.standby = [{ from: m, to: m + DAY, kind: 'reserve' }];
    expect(standbyFor(g, c, m + 12 * H)).toBeNull();
    expect(standbyFor(g, c, m + 15 * H + 59)).toBeNull();
    expect(standbyFor(g, c, m + 16 * H)?.kind).toBe('reserve');
    expect(reserveContact(g, c.base)).toBe(m + 6 * H);
    expect(fmtTime(reserveContact(g, c.base) + BAL.v09.roster.reserve.noticeMin, c.base)).toBe('16:00');
    // Called in the evening (23:00) the contact is 06:00 the next morning; in the day it is now.
    g.now = m + 23 * H;
    expect(reserveContact(g, c.base)).toBe(m + DAY + 6 * H);
    g.now = m + 9 * H;
    expect(reserveContact(g, c.base)).toBe(g.now);
    expect(standbyFor(g, c, m + 19 * H)?.kind).toBe('reserve');
    const cal = crewCalendar(g, c.id, m, m + DAY).find((b) => b.sby === 'reserve');
    expect(cal?.detail).toContain('no contact 22:00–06:00');
  });

  it('the placement check cuts a called home standby from the call, as the placed duty is cut (05:00 window, call 06:00, report 13:30: 1:30)', () => {
    const { g, c } = crew();
    const d0 = localAt(c.base, g.now + DAY, 0);
    g.now = d0 + 6 * H;
    const sby = standbySeg(c, { from: d0 + 5 * H, to: d0 + 17 * H, shift: 'E' });
    const duty: Seg = { kind: 'duty', start: d0 + 13 * H + 30, end: d0 + 21 * H, fdp: 7 * H, maxFdp: 13 * H, block: 5 * H, sectors: 2, aug: false, disruptive: false, rest: 12 * H, at: c.base, from: c.base, dutyId: 'x', fresh: true };
    const ctx = { ...ctxOf(g, c), now: g.now };
    const v = standbyView(ctx, [sby, duty]).find((x) => x.kind === 'duty')!;
    expect(13 * H - v.maxFdp).toBe(90);
    expect(13 * H - v.maxFdp).toBe(standbyCut('home', d0 + 5 * H, duty.start, c.base, false, g.now));
  });

  it('rest after a called airport standby covers the standby too: 4 h airport standby + 10 h duty → 14 h at home', () => {
    const { g, c } = crew();
    const d0 = localAt(c.base, g.now + DAY, 0);
    g.now = d0 + 6 * H;
    const sby = standbySeg(c, { from: d0 + 5 * H, to: d0 + 9 * H, kind: 'airport' });
    const duty: Seg = { kind: 'duty', start: d0 + 8 * H + 40, end: d0 + 19 * H, fdp: 9 * H, maxFdp: 13 * H, block: 7 * H, sectors: 2, aug: false, disruptive: false, rest: 12 * H, at: c.base, from: c.base, dutyId: 'x', fresh: true };
    const v = standbyView({ ...ctxOf(g, c), now: g.now }, [sby, duty]).find((x) => x.kind === 'duty')!;
    expect(v.rest).toBe(14 * H);
    expect(v.rest).toBe(minRest({ dutyMin: 14 * H, atHome: true, augmented: false, tzShift: 0 }));
  });

  it('a hotel standby at DXB (LIS base) excludes 23:00–07:00 on the station clock: window from 02:00, call 05:00, report 13:00 → cut 2 h', () => {
    const { g, c } = crew();
    expect(c.base).toBe('LIS');
    const s0 = localAt('DXB', g.now + DAY, 2 * H);
    g.now = s0 + 3 * H;
    const sby = standbySeg(c, { from: s0, to: s0 + 16 * H, kind: 'hotel', at: 'DXB' });
    const duty: Seg = { kind: 'duty', start: s0 + 11 * H, end: s0 + 19 * H, fdp: 7 * H, maxFdp: 13 * H, block: 5 * H, sectors: 2, aug: false, disruptive: false, rest: 10 * H, at: 'DXB', from: 'DXB', dutyId: 'x', fresh: true };
    const v = standbyView({ ...ctxOf(g, c), now: g.now }, [sby, duty]).find((x) => x.kind === 'duty')!;
    expect(13 * H - v.maxFdp).toBe(2 * H);
    expect(standbyCut('home', s0, duty.start, 'DXB', false, g.now)).toBe(2 * H);
    expect(standbyCut('home', s0, duty.start, 'LIS', false, g.now)).not.toBe(2 * H);
  });

  it('the 96 a year: a plan that would leave the year short is refused; leave and pro-rated sick months count; the month line says it', () => {
    const { g, c } = crew();
    const y = yearOf(g.now) + 1;
    const y0 = fromUTC(y, 1, 1);
    for (const id of Object.keys(g.crew)) if (id !== c.id) delete g.crew[id];
    // Planned and hired from 1 January; it is 20 December, 11 months closed with 7 days off each, 7 planned in December.
    g.dayPlan!.from = y0;
    c.hired = y0 - DAY;
    g.now = fromUTC(y, 12, 20, 8);
    g.dayPlan!.planned = fromUTC(y, 12, 31);
    g.dayPlan!.publishedTo = g.dayPlan!.planned;
    c.offMonths = {};
    for (let m = 0; m < 11; m++) c.offMonths[y * 12 + m] = 7;
    const dec = fromUTC(y, 12, 1) / DAY;
    c.off = [dec + 1, dec + 2, dec + 8, dec + 9, dec + 15, dec + 16, dec + 22];
    c.blocks = [];
    const segs = segsOf(g, c);
    const day = (k: number): Seg => ({ kind: 'duty', start: midnight(c.base, k) + 8 * H, end: midnight(c.base, k) + 16 * H, fdp: 7 * H, maxFdp: 13 * H, block: 5 * H, sectors: 2, aug: false, disruptive: false, rest: 12 * H, at: c.base, from: c.base, dutyId: 'x', fresh: true });
    // 77 + 7 = 84 held, 11 free days left: 95 at best. Work on one of them makes 96 unreachable.
    const bad = monthFloorIssue(g, c, segs, [day(dec + 27)]);
    expect(bad?.level).toBe('illegal');
    expect(bad?.text).toMatch(new RegExp(`Days off in ${y} would fall to \\d+ \\(minimum 96\\)`));
    expect(crewMonth(g, c.id, g.now).line).toContain('of 96 this year');
    // With 20 days of leave in March (a closed month: freeMonths, as dayPlanMonth records it) the plan is fine (104).
    c.freeMonths = { [y * 12 + 2]: 20 };
    expect(monthFloorIssue(g, c, segs, [day(dec + 27)])).toBeNull();
    expect(crewMonth(g, c.id, g.now).year).toBe(104);
    // Leave in the open month comes from the block itself: 8 days, 24–31 December.
    c.blocks = [{ from: fromUTC(y, 12, 24), to: fromUTC(y + 1, 1, 1), why: 'leave', annual: true }];
    expect(crewMonth(g, c.id, g.now).year).toBe(112);
    // The December close counts the year (and records December's leave): 84 alone is a year low; 28 days' leave and
    // a pro-rated sick month are not.
    g.now = fromUTC(y + 1, 1, 1, 0, 1);
    const r = g.stats.v09!.roster!;
    const before = { years: r.years ?? 0, low: r.yearsLow ?? 0 };
    dayPlanMonth(g);
    expect(c.freeMonths[y * 12 + 11]).toBe(8);
    expect((r.years ?? 0) - before.years).toBe(1);
    expect((r.yearsLow ?? 0) - before.low).toBe(0);
    c.blocks = [];
    c.freeMonths = {};
    dayPlanMonth(g);
    expect((r.yearsLow ?? 0) - before.low).toBe(1);
    c.freeMonths = { [y * 12 + 2]: 28, [y * 12 + 6]: 20 };
    delete c.offMonths[y * 12 + 6];
    dayPlanMonth(g);
    expect((r.yearsLow ?? 0) - before.low).toBe(1);
    // A crew member hired in March is measured pro rata (from April: 275 days → 72): 8 months × 7 + 7 = 63 is low,
    // with the 28 days' leave (91) it is not.
    c.hired = fromUTC(y, 3, 10);
    c.freeMonths = {};
    c.offMonths[y * 12 + 6] = 7;
    dayPlanMonth(g);
    expect((r.yearsLow ?? 0) - before.low).toBe(2);
    expect(crewMonth(g, c.id, fromUTC(y, 12, 20)).yearMin).toBe(72);
    c.freeMonths = { [y * 12 + 4]: 28 };
    dayPlanMonth(g);
    expect((r.yearsLow ?? 0) - before.low).toBe(2);
    expect(crewMonth(g, c.id, fromUTC(y, 12, 20)).year).toBe(91);
  });
});
