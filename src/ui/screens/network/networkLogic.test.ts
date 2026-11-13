import { describe, expect, it } from 'vitest';
import { fromUTC, monthKey } from '../../../engine/core/time';
import type { Rotation, Route, RoutePnl, SectorLoad } from '../../../engine/network/types';
import {
  cargoLine, chainOf, daysOf, depthHint, hhmm, isRouteContract, kg, lastQuarters, marketKind, monthBars, pnlSum, ratios, repWord, rotationLoad, rotationResult, seasonWord,
  sectorLoad, seatsLine, seriesWords, stageHint, statusChip, timetableWords, trend, upcoming,
} from './networkLogic';
import { ROUTE_MARKETS } from '../../../data/routes';
import { LAUNCH_STAGES } from '../../../engine/network/types';

const sec = (x: Partial<SectorLoad> = {}): SectorLoad => ({ from: 'LIS', to: 'OXB', capJ: 16, capY: 251, bookedJ: 9, bookedY: 214, cargoKg: 3800, ...x });
const rot = (x: Partial<Rotation> = {}): Rotation => ({ id: 'r1', routeId: 'R1', seriesId: 's1', dep: fromUTC(2027, 11, 12, 6, 40), status: 'planned', sectors: [sec(), sec({ from: 'OXB', to: 'LIS', bookedJ: 4, bookedY: 120, cargoKg: 0 })], ...x });
const pnl = (x: Partial<RoutePnl>): RoutePnl => ({ rev: 0, tickets: 0, cargo: 0, ancillary: 0, direct: 0, acTime: 0, result: 0, pax: 0, seats: 0, bh: 0, sectors: 0, onTime: 0, cargoKg: 0, launch: 0, ...x });
const route = (x: Partial<Route> = {}): Route => ({
  id: 'R1', marketId: 'LIS-OXB', model: 'own', flightNo: 351, status: 'operating', opened: 0, stages: [], series: [], rotations: [],
  fares: { level: 'market' }, marketing: 'normal', awareness: 0.5, reputation: 62, unearned: 0, pnl: {}, contractIds: [], ...x,
});

describe('v0.19 network view helpers', () => {
  it('says the timetable in words', () => {
    expect(seriesWords({ days: 1 << 4, every: 1 })).toBe('Weekly, Fri');
    expect(seriesWords({ days: (1 << 2) | (1 << 4), every: 1 })).toBe('Twice weekly, Wed · Fri');
    expect(seriesWords({ days: 1 << 5, every: 2 })).toBe('Every 2 weeks, Sat');
    expect(seriesWords({ days: 1 << 4, every: 1, monthly: { nth: 1, weekday: 4 } })).toBe('Monthly, first Fri');
    expect(seriesWords({ days: 127, every: 1 })).toBe('Daily');
    expect(seriesWords({ days: 0b10101, every: 1 })).toBe('3 a week, Mon · Wed · Fri');
    // v0.23.2 a seasonal series names its months.
    expect(seriesWords({ days: 1 << 5, every: 1, months: 0b111000001111 })).toBe('Weekly, Sat, Oct–Apr');
    expect(seriesWords({ days: 1 << 5, every: 1, months: 4095 })).toBe('Weekly, Sat');
    expect(daysOf(0b1000001)).toEqual([0, 6]);
    expect(hhmm(400)).toBe('06:40');
    expect(hhmm(-30)).toBe('23:30');
  });

  it('the timetable of a route now, or that it has none', () => {
    const t = fromUTC(2027, 6, 1);
    expect(timetableWords(route(), t)).toBe('No timetable yet');
    const s = { id: 's1', days: 1 << 4, every: 1, out: 400, back: 810, nights: 0, typeId: 'b763', layout: 'two-class' as const, from: t - 1, to: t + 1e6 };
    expect(timetableWords(route({ series: [s] }), t)).toBe('Weekly, Fri');
    expect(timetableWords(route({ series: [s, { ...s, id: 's2', days: 1 << 2 }] }), t)).toBe('Weekly, Fri +1 more');
    expect(timetableWords(route({ series: [{ ...s, to: t - 10 }] }), t)).toBe('Timetable ended');
  });

  it('status chips: launching counts the stages, a wait is amber', () => {
    expect(statusChip(route()).label).toBe('Operating');
    expect(statusChip(route({ status: 'case' })).tone).toBe('warn');
    const st = route({ status: 'launching', stages: [{ id: 'study', state: 'done', cost: 1 }, { id: 'case', state: 'done', cost: 0 }, { id: 'rights', state: 'delayed', cost: 1 }] });
    expect(statusChip(st)).toEqual({ label: 'Launching · 3 of 11', tone: 'warn' });
  });

  it('loads: booked before, flown after; the busiest sector for the list', () => {
    const l = sectorLoad(sec());
    expect(l.lf).toBeCloseTo(223 / 267);
    expect(seatsLine(l)).toBe('J 9/16 · Y 214/251 · 84 %');
    expect(sectorLoad(sec({ flownJ: 8, flownY: 200 })).bookedY).toBe(200);
    expect(seatsLine(sectorLoad(sec({ capJ: 0, bookedJ: 0, capY: 309, bookedY: 200 })))).toBe('Y 200/309 · 65 %');
    expect(rotationLoad(rot()).bookedY).toBe(214);
    expect(chainOf(rot())).toBe('LIS–OXB–LIS');
  });

  it('cargo in tonnes and kilos, live animals named', () => {
    expect(kg(3800)).toBe('3.8 t');
    expect(kg(640)).toBe('640 kg');
    expect(kg(0)).toBe('0 kg');
    expect(cargoLine({ cargoKg: 3800, aviKg: 600, mailKg: 300 })).toBe('cargo 3.8 t (live animals 600 kg) · mail 300 kg');
    expect(cargoLine({ cargoKg: 0 })).toBe('');
  });

  it('reputation words follow §I', () => {
    expect(repWord(35).word).toBe('Poor');
    expect(repWord(50).word).toBe('Mixed');
    expect(repWord(60).word).toBe('Good');
    expect(repWord(80).word).toBe('Very good');
  });

  it('months: sums, the last three closed against the three before, trends', () => {
    const now = fromUTC(2027, 10, 15);
    const k = monthKey(now);
    const r = route({ pnl: { [k - 1]: pnl({ result: 30_000, rev: 150_000, pax: 400, seats: 534, tickets: 120_000, sectors: 8 }), [k - 2]: pnl({ result: 10_000, sectors: 8 }), [k - 4]: pnl({ result: 5_000, sectors: 8 }), [k]: pnl({ result: 99_999 }) } });
    const q = lastQuarters(r, now);
    expect(q.cur.result).toBe(40_000);
    expect(q.prev.result).toBe(5_000);
    expect(q.months).toBe(2);
    expect(trend(q.cur.result, q.prev.result).dir).toBe(1);
    expect(trend(100, 101).dir).toBe(0);
    expect(trend(0, 0).change).toBeNull();
    expect(ratios(pnlSum(r, [k - 1])).lf).toBeCloseTo(400 / 534);
    expect(ratios(pnlSum(r, [k - 1])).yieldPax).toBe(300);
    const b = monthBars(route({ pnl: { [k]: pnl({ result: -20_000, launch: 50_000 }) } }), now, 3);
    expect(b.keys).toEqual([k - 2, k - 1, k]);
    expect(b.result).toEqual([0, 0, -20_000]);
    expect(b.launch).toEqual([0, 0, 50_000]);
  });

  it('upcoming and results of rotations', () => {
    const now = fromUTC(2027, 11, 1);
    const r = route({ rotations: [rot({ id: 'a', dep: now + 3 * 1440 }), rot({ id: 'b', dep: now - 30 * 1440, status: 'flown' }), rot({ id: 'c', dep: now + 1440, status: 'cancelled' })] });
    expect(upcoming(r, now).map((x) => x.id)).toEqual(['a']);
    expect(rotationResult(rot())).toBeNull();
    expect(rotationResult(rot({ sectors: [sec({ rev: 80_000, cost: 52_000 }), sec({ rev: 40_000, cost: 45_000 })] }))).toBe(23_000);
  });

  it('seasons and route contracts', () => {
    expect(seasonWord('S27')).toBe('summer 2027');
    expect(seasonWord('W27')).toBe('winter 2027–28');
    expect(isRouteContract({ archetype: 'scheduled' })).toBe(true);
    expect(isRouteContract({ archetype: 'adhoc', sched: { routeId: 'x', season: 'S27' } })).toBe(true);
    expect(isRouteContract({ archetype: 'adhoc' })).toBe(false);
  });
});

// v0.23.2 review: the study and campaign texts written for Lisbon's diaspora markets showed on every market.
describe('launch texts follow who travels', () => {
  const mk = (id: string) => ROUTE_MARKETS.find((m) => m.id === id)!;
  it('Lisbon\'s Africa keeps its words; a holiday or business market never reads diaspora, churches or NGOs', () => {
    expect(marketKind(mk('LIS-OXB'))).toBe('aid');
    expect(depthHint('full', mk('LIS-OXB'))).toBe('Booking data, the diaspora associations, government and NGO interviews.');
    expect(stageHint('marketing', mk('LIS-OXB'))).toMatch(/churches/);
    expect(stageHint('study', mk('LIS-OXB'))).toMatch(/NGO/);
    // No market known: the old words.
    expect(stageHint('study')).toMatch(/diaspora/);
    for (const m of ROUTE_MARKETS) {
      const k = marketKind(m);
      const text = [depthHint('desk', m), depthHint('full', m), depthHint('survey', m), ...LAUNCH_STAGES.map((id) => stageHint(id, m))].join(' ');
      for (const id of LAUNCH_STAGES) expect(stageHint(id, m).length, `${m.id} ${id}`).toBeGreaterThan(10);
      if (k === 'holiday' || k === 'business') expect(text, m.id).not.toMatch(/[Dd]iaspora|church|NGO|government/);
      if (k === 'family') expect(text, m.id).not.toMatch(/church|NGO|government/);
      if (k === 'holiday') expect(text, m.id).toMatch(/[Tt]our operators/);
    }
    expect(marketKind(mk('MLA-CPH'))).toBe('holiday');
    expect(marketKind(mk('TLL-ARN'))).not.toBe('aid');
    expect(marketKind(mk('VNO-LTN'))).toBe('family');
    expect(marketKind(mk('LIS-SID'))).toBe('holiday');
  });
});

