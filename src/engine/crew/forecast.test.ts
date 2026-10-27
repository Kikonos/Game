// Peak-staffing round (27 Oct 2026): the busy-month heads-up (crew/forecast.ts) on built scenarios. A July with two
// A320s flying two day-duties each every day needs a known number of crew at work; the forecast counts crew once (as
// staffing()), says nothing when staffed, shows a gap only inside the time a hire takes plus two weeks, tells the
// Inbox once per month and gap, and the crew desk proposes from the same numbers.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { blockMinutes, typeOf } from '../core/perf';
import { DAY, daysInMonth, fromUTC, monthKey, monthStart } from '../core/time';
import type { GameState, Role } from '../core/types';
import { acceptProposal, dismissProposal, hireHead, monthlyHeads, unlockHead } from '../ops/heads';
import { problemFor } from '../problems';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { crewDays, crewPeakCard, hireLeadDays, PEAK, peakForecast, peakHeadsUp, peakId, peakLine, warnDays } from './forecast';
import { staffing } from './hr';
import { touchCrew } from './timeline';

const JULY = monthKey(fromUTC(2027, 7, 1));

/**
 * Two A320s (180 seats: 1 captain, 1 first officer, 1 purser, 3 cabin crew) flying LIS–FNC–LIS twice a day, every day
 * of July: four days of work a day (the morning and the afternoon rotation are two duties: 05:00–19:00 is too long for
 * one crew). The company's crew are replaced by exactly `crew` (no leave, no courses). `now` days before 1 July.
 */
function july(crew: Partial<Record<Role, number>>, daysBefore = 35, rotations = [6 * 60, 14 * 60]): GameState {
  const g = fixtureGame(41);
  const acs = Object.values(g.fleet).slice(0, 2);
  expect(acs.length).toBe(2);
  for (const id of Object.keys(g.crew)) delete g.crew[id];
  const start = monthStart(JULY);
  const end = monthStart(JULY + 1);
  for (const ac of acs) {
    ac.at = 'LIS';
    const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [ac.id], start, end, product: { kind: 'charter', price: 2_000_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false } });
    const out = blockMinutes(ac.typeId, 'LIS', 'FNC');
    const back = blockMinutes(ac.typeId, 'FNC', 'LIS');
    for (let d = 0; d < daysInMonth(JULY); d++) {
      for (const dep of rotations) {
        const std = start + d * DAY + dep;
        addFlight(g, { no: `AW${d}${dep}`, aircraftId: ac.id, contractId: k.id, kind: 'revenue', from: 'LIS', to: 'FNC', std, sta: std + out, pax: 170 });
        addFlight(g, { no: `AW${d}${dep}b`, aircraftId: ac.id, contractId: k.id, kind: 'revenue', from: 'FNC', to: 'LIS', std: std + out + 50, sta: std + out + 50 + back, pax: 170 });
      }
    }
  }
  addCrew(g, crew);
  for (const c of Object.values(g.crew)) delete c.blocks;
  g.now = start - daysBefore * DAY;
  touchCrew(g);
  return g;
}

const FULL = { CPT: 8, FO: 8, PUR: 8, CC: 21 };
/** Working days of a person in a 31-day month: less the days off (at least 7 a month and 96 a year pro rata). */
const WORK = 31 - Math.max((PEAK.offMonth * 31) / 30.44, (PEAK.freeYear * 31) / 365);
/** People needed at work in July per role: four duties a day of `per` crew, a home standby a day, the packing. */
const needOf = (per: number) => ((4 * per + 1) * 31) / PEAK.packing / WORK;

describe('peak forecast: a busy July', () => {
  it('counts the July work and says how many more of each role, in sets', () => {
    expect(typeOf(Object.values(fixtureGame(41).fleet)[0].typeId).family).toBe('A320');
    const g = july({ ...FULL, CC: 18 });
    const gaps = peakForecast(g).gaps.filter((x) => x.month === JULY);
    // Cabin crew: 4 × 3 a day + 1 standby → about 20.7 needed at work, 18 there → 3 more, one set (3 CC each).
    const cc = gaps.find((x) => x.role === 'CC')!;
    expect(cc, 'a cabin crew gap').toBeDefined();
    expect(cc.need).toBeCloseTo(needOf(3), 1);
    expect(cc.have).toBeCloseTo(18, 1);
    expect(cc.short).toBe(Math.ceil(needOf(3) - 18 - PEAK.minShort));
    expect(cc.short).toBe(3);
    expect(cc.perSet).toBe(3);
    expect(cc.sets).toBe(1);
    expect(cc.serious).toBe(true);
    // Pilots and pursers (1 a duty, 8 each ≈ 8.0 needed) are staffed.
    expect(gaps.map((x) => x.role)).toEqual(['CC']);
    expect(peakLine(gaps)).toBe('July needs 3 more A320 cabin crew (about 1 set)');
    // The four-line card names it, why, and a prefilled Hire.
    const card = crewPeakCard(g, peakId(JULY, 'A320'))!;
    expect(card.what).toBe('July needs 3 more A320 cabin crew (about 1 set)');
    expect(card.why).toMatch(/^July's signed flying needs about 21 cabin crew at work .*; you will have about 18\.$/);
    expect(card.actions[0]).toMatchObject({ label: 'Hire 3 cabin crew', open: { modal: 'hire', id: 'CC:A320:3' }, primary: true });
    expect(problemFor(g, card.subject)?.what).toBe(card.what);
  });

  it('a summer peak short of two captains and two sets of cabin crew', () => {
    const g = july({ ...FULL, CPT: 6, CC: 15 }, 40);
    const gaps = peakForecast(g).gaps.filter((x) => x.month === JULY);
    expect(gaps.map((x) => [x.role, x.short])).toEqual([['CPT', 2], ['CC', 6]]);
    expect(peakLine(gaps)).toBe('July needs 2 more A320 captains and 6 cabin crew (about 2 sets)');
  });

  it('no heads-up when the month is staffed', () => {
    const g = july(FULL);
    expect(peakForecast(g).gaps).toEqual([]);
    const n = g.messages.length;
    peakHeadsUp(g);
    expect(g.messages.length).toBe(n);
    expect(crewPeakCard(g, peakId(JULY, 'A320'))).toBeNull();
  });

  it('crew still joining count from their join date; hiring the gap closes it', () => {
    const g = july({ ...FULL, CC: 18 });
    const before = peakForecast(g).gaps.find((x) => x.role === 'CC')!;
    const ids = addCrew(g, { CC: 3 });
    for (const id of ids) {
      const c = g.crew[id];
      c.status = 'joining';
      c.hired = monthStart(JULY) + 10 * DAY;
      delete c.blocks;
    }
    touchCrew(g);
    // Joining on 11 July: they give two thirds of the month.
    const mid = peakForecast(g).gaps.find((x) => x.role === 'CC')!;
    expect(mid.have).toBeGreaterThan(before.have + 1.5);
    expect(mid.have).toBeLessThan(before.have + 2.5);
    for (const id of ids) g.crew[id].hired = monthStart(JULY) - 5 * DAY;
    touchCrew(g);
    expect(peakForecast(g).gaps).toEqual([]);
  });
});

describe('peak forecast: counting crew once', () => {
  it('cabin crew on two fleet types count once, in their hire family, and agree with staffing()', () => {
    const g = july({ ...FULL, CC: 18 });
    // A 737 in the fleet: the A320 cabin crew who also hold it are counted in the A320 family only.
    const ac = Object.values(g.fleet)[0];
    const b737 = { ...structuredClone(ac), id: 'a737', reg: 'CS-B37', typeId: 'b738' };
    g.fleet[b737.id] = b737;
    const dual = Object.values(g.crew).filter((c) => c.role === 'CC').slice(0, 4);
    for (const c of dual) c.ratings = ['A320', 'B737'];
    touchCrew(g);
    const from = monthStart(JULY);
    const to = monthStart(JULY + 1);
    const days = crewDays(g, from, to);
    expect(days.get('A320')!.CC / WORK).toBeCloseTo(18, 1);
    expect(days.get('B737')?.CC ?? 0).toBe(0);
    // The same people as the Hire view and Planning count (full month, nobody away).
    const st = staffing(g);
    for (const role of ['CPT', 'FO', 'PUR', 'CC'] as Role[]) {
      const line = st.find((l) => l.family === 'A320' && l.role === role);
      expect(days.get('A320')![role] / WORK, role).toBeCloseTo(line?.have ?? 0, 1);
    }
  });
});

describe('peak forecast: the lead time', () => {
  it('a captain gap shows as soon as a captain hired then can still join; cabin crew six weeks ahead', () => {
    const lead = hireLeadDays(fixtureGame(41), 'A320', 'CPT');
    expect(lead).toBe(Math.ceil(60 * 1.2));
    expect(warnDays(fixtureGame(41), 'A320', 'CPT')).toBe(lead + PEAK.spareDays);
    expect(warnDays(fixtureGame(41), 'A320', 'CC')).toBe(PEAK.minLeadDays);
    // 80 days before July: the captain gap shows (warned 86 days ahead), the cabin crew gap not yet.
    let g = july({ ...FULL, CPT: 6, CC: 15 }, 80);
    expect(peakForecast(g).gaps.filter((x) => x.month === JULY).map((x) => x.role)).toEqual(['CPT']);
    const cpt = peakForecast(g).gaps[0];
    expect(cpt.late).toBe(false);
    expect(cpt.hireBy).toBe(monthStart(JULY) - lead * DAY);
    // 40 days before: both, and the captains can no longer join before July starts (late, serious).
    g = july({ ...FULL, CPT: 6, CC: 15 }, 40);
    const gaps = peakForecast(g).gaps.filter((x) => x.month === JULY);
    expect(gaps.map((x) => x.role)).toEqual(['CPT', 'CC']);
    expect(gaps[0].late).toBe(true);
    expect(gaps[1].late).toBe(false);
    expect(crewPeakCard(g, peakId(JULY, 'A320'))!.hurt.text).toMatch(/^Yes: 2 captains hired today join after July starts/);
    // 100 days before: nothing yet (no hire is that slow).
    g = july({ ...FULL, CPT: 6, CC: 15 }, 100);
    expect(peakForecast(g).gaps).toEqual([]);
  });
});

describe('peak heads-up in the Inbox', () => {
  it('once per month and gap: not repeated daily; a new role gets one more note; past months forgotten', () => {
    const g = july({ ...FULL, CPT: 6, CC: 15 }, 80);
    const notes = () => g.messages.filter((m) => m.ref?.id === peakId(JULY, 'A320'));
    peakHeadsUp(g);
    expect(notes().length).toBe(1);
    expect(notes()[0].title).toBe('July needs 2 more A320 captains');
    expect(notes()[0].tone).toBe('warn');
    expect(notes()[0].problem?.kind).toBe('crewPeak');
    // Days pass: the same gap is not told again.
    for (let d = 0; d < 20; d++) {
      g.now += DAY;
      peakHeadsUp(g);
    }
    expect(notes().length).toBe(1);
    // Six weeks before July the cabin crew gap shows: one more note, for it.
    g.now = monthStart(JULY) - 41 * DAY;
    peakHeadsUp(g);
    peakHeadsUp(g);
    expect(notes().length).toBe(2);
    expect(notes()[0].title).toBe('July needs 2 more A320 captains and 6 cabin crew (about 2 sets)');
    expect(g.stats.peakWarned).toEqual([`${JULY}|A320|CPT`, `${JULY}|A320|CC`]);
    // In August, July's keys go.
    g.now = monthStart(JULY + 1) + DAY;
    peakHeadsUp(g);
    expect(g.stats.peakWarned).toEqual([]);
  });
});

describe('the crew desk uses the same forecast', () => {
  it('proposes the busy month’s hires (after the sets round-up); accepting hires them and the gap closes', () => {
    const g = july({ ...FULL, CPT: 6, CC: 15 }, 40);
    unlockHead(g, 'crewDesk');
    expect(hireHead(g, 'crewDesk', 2).ok).toBe(true);
    g.company.cash = 10_000_000;
    // Short of sets as well: the sets round-up comes first (one hire proposal per family at a time).
    monthlyHeads(g);
    const sets = g.heads!.crewDesk.proposals.find((x) => x.kind === 'hire');
    expect(sets?.text).toMatch(/to complete 10 A320 family sets$/);
    expect(dismissProposal(g, 'crewDesk', sets!.id).ok).toBe(true);
    // Dismissed: the busy month, from the same numbers as the Crew screen's heads-up.
    monthlyHeads(g);
    const p = g.heads!.crewDesk.proposals.find((x) => x.kind === 'hire' && x.data.peak === JULY);
    expect(p, 'a proposal for July').toBeDefined();
    expect(p!.text).toBe('Hire 2 CPT, 6 CC for July (A320 family)');
    expect(acceptProposal(g, 'crewDesk', p!.id).ok).toBe(true);
    // The cabin crew join in time and close their gap (captains hired now join after 1 July: late).
    const left = peakForecast(g).gaps.filter((x) => x.month === JULY);
    expect(left.map((x) => x.role)).toEqual(['CPT']);
    expect(left[0].late).toBe(true);
  });
});
