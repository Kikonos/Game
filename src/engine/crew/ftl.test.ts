// FTL rules (RESEARCH §5.1 F1, F3, F8–F10; DESIGN §5.2): tables, acclimatisation, rest, windows, recovery.

import { describe, expect, it } from 'vitest';
import { DAY, fromUTC } from '../core/time';
import type { CrewMember } from '../core/types';
import { locAt } from './timeline';
import { acclimState, AUG_FDP, augLimitOf, CABIN_REST, cabinFdpCap, cabinInflightRest, DISCRETION, disruptiveKinds, evalSegs, EXT_TABLE, extFdp, FDP_BANDS, isDisruptive, LIMITS, localDaysIn, longestWorkBlock, maxFdp, minRest, nightsIn, referenceTime, splitFdp, STANDBY, standbyAwakeOk, standbyCut, TZ_NIGHTS, tzNights, woclMinutes, type Seg, type TimelineCtx } from './rules';

const hm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};
const fdp = (report: string, sectors: number, acclimatised = true) =>
  maxFdp({ reportLocal: hm(report), sectors, acclimatised, augment: 0, restClass: null, longestBlock: 120 });

describe('maxFdp F1 (2 pilots, acclimatised)', () => {
  // Every column of RESEARCH §5.1 F1, at the band start and its last minute.
  const F1: [string, string, string][] = [
    ['05:00', '05:14', '12:00'], ['05:15', '05:29', '12:15'], ['05:30', '05:44', '12:30'], ['05:45', '05:59', '12:45'],
    ['06:00', '13:29', '13:00'], ['13:30', '13:59', '12:45'], ['14:00', '14:29', '12:30'], ['14:30', '14:59', '12:15'],
    ['15:00', '15:29', '12:00'], ['15:30', '15:59', '11:45'], ['16:00', '16:29', '11:30'], ['16:30', '16:59', '11:15'],
    ['17:00', '23:59', '11:00'], ['00:00', '04:59', '11:00'],
  ];
  it.each(F1)('report %s–%s → %s for 1–2 sectors', (a, b, max) => {
    for (const s of [1, 2]) {
      expect(fdp(a, s)).toBe(hm(max));
      expect(fdp(b, s)).toBe(hm(max));
    }
  });

  it('takes 30 min per sector above 2 (reproduces EASA Table 2)', () => {
    expect(fdp('06:00', 3)).toBe(hm('12:30'));
    expect(fdp('06:00', 4)).toBe(hm('12:00'));
    expect(fdp('06:00', 8)).toBe(hm('10:00'));
    expect(fdp('05:15', 5)).toBe(hm('10:45'));
    expect(fdp('16:30', 4)).toBe(hm('10:15'));
  });

  it('never goes below the 9:00 floor', () => {
    expect(fdp('06:00', 10)).toBe(hm('9:00'));
    expect(fdp('17:00', 6)).toBe(hm('9:00'));
    expect(fdp('17:00', 5)).toBe(hm('9:30'));
    expect(fdp('02:00', 10)).toBe(hm('9:00'));
  });

  it('uses 11:00 in unknown state X whatever the report time', () => {
    expect(fdp('08:00', 2, false)).toBe(hm('11:00'));
    expect(fdp('08:00', 4, false)).toBe(hm('10:00'));
    expect(fdp('08:00', 10, false)).toBe(hm('9:00'));
  });
});

describe('maxFdp F3 (augmented)', () => {
  const aug = (augment: 1 | 2, restClass: 1 | 2 | 3, sectors = 1, longestBlock = 8 * 60) =>
    maxFdp({ reportLocal: hm('22:00'), sectors, acclimatised: true, augment, restClass, longestBlock });
  it('matches every cell of the table', () => {
    expect([aug(1, 3), aug(1, 2), aug(1, 1)]).toEqual([hm('14:00'), hm('15:00'), hm('16:00')]);
    expect([aug(2, 3), aug(2, 2), aug(2, 1)]).toEqual([hm('15:00'), hm('16:00'), hm('17:00')]);
  });
  it('adds 1:00 for ≤ 2 sectors with a sector over 9 h flight time, capped at 18:00', () => {
    expect(aug(1, 1, 2, 9 * 60 + 30)).toBe(hm('17:00'));
    expect(aug(2, 1, 1, 11 * 60)).toBe(hm('18:00'));
    expect(aug(2, 1, 3, 11 * 60)).toBe(hm('17:00'));
    // block − 20 min taxi must exceed 9 h
    expect(aug(1, 2, 1, 9 * 60 + 20)).toBe(hm('15:00'));
  });
  it('ignores augmentation above 3 sectors or without a rest facility', () => {
    expect(maxFdp({ reportLocal: hm('08:00'), sectors: 4, acclimatised: true, augment: 1, restClass: 1, longestBlock: 60 })).toBe(hm('12:00'));
    expect(maxFdp({ reportLocal: hm('08:00'), sectors: 1, acclimatised: true, augment: 2, restClass: null, longestBlock: 60 })).toBe(hm('13:00'));
  });
});

describe('minRest F8', () => {
  it('is max(duty, 12 h) at home and max(duty, 10 h) away', () => {
    expect(minRest({ dutyMin: 8 * 60, atHome: true, augmented: false, tzShift: 0 })).toBe(12 * 60);
    expect(minRest({ dutyMin: 8 * 60, atHome: false, augmented: false, tzShift: 0 })).toBe(10 * 60);
    expect(minRest({ dutyMin: 13 * 60, atHome: true, augmented: false, tzShift: 0 })).toBe(13 * 60);
    expect(minRest({ dutyMin: 11 * 60, atHome: false, augmented: false, tzShift: 0 })).toBe(11 * 60);
  });
  it('is 14 h away after a ≥ 4 h time shift, and after any augmented FDP wherever the crew rest (C4)', () => {
    expect(minRest({ dutyMin: 9 * 60, atHome: false, augmented: true, tzShift: 0 })).toBe(14 * 60);
    expect(minRest({ dutyMin: 9 * 60, atHome: false, augmented: false, tzShift: 4 })).toBe(14 * 60);
    expect(minRest({ dutyMin: 9 * 60, atHome: false, augmented: false, tzShift: 3.5 })).toBe(10 * 60);
    expect(minRest({ dutyMin: 16 * 60, atHome: false, augmented: true, tzShift: 0 })).toBe(16 * 60);
    // v0.7.3 CS FTL.1.205(c)(6): after an augmented FDP at home too (≥ duty or 14 h); the time shift rule stays away only
    expect(minRest({ dutyMin: 9 * 60, atHome: true, augmented: true, tzShift: 8 })).toBe(14 * 60);
    expect(minRest({ dutyMin: 15 * 60, atHome: true, augmented: true, tzShift: 0 })).toBe(15 * 60);
    expect(minRest({ dutyMin: 9 * 60, atHome: true, augmented: false, tzShift: 8 })).toBe(12 * 60);
  });
  it('v0.7.3 adds 4 h after a planned extension (ORO.FTL.205(d), the post-flight option)', () => {
    expect(minRest({ dutyMin: 14 * 60, atHome: true, augmented: false, tzShift: 0, extended: true })).toBe(18 * 60);
    expect(minRest({ dutyMin: 8 * 60, atHome: false, augmented: false, tzShift: 0, extended: true })).toBe(14 * 60);
  });
});

describe('acclimatisation (B/X/D)', () => {
  it('follows the DESIGN table', () => {
    const rows: [number, string][] = [[2, 'BDDDD'], [5, 'BXDDD'], [8, 'BXXDD'], [11, 'BXXXD']];
    const hours = [10, 50, 80, 100, 130];
    for (const [delta, states] of rows) expect(hours.map((h) => acclimState(delta, h)).join('')).toBe(states);
    // band edges: < 4 h is D from 48 h; exactly 6 h is the 4–6 band, exactly 9 h the 6–9 band
    expect(acclimState(3.9, 48)).toBe('D');
    expect(acclimState(4, 71.9)).toBe('X');
    expect(acclimState(6, 72)).toBe('D');
    expect(acclimState(9, 95)).toBe('X');
    expect(acclimState(9, 96)).toBe('D');
  });

  it('reads base time in B and local time in D', () => {
    const t = fromUTC(2027, 6, 1, 4, 0); // 05:00 LIS (UTC+1), 13:00 DIL (UTC+9)
    const b = referenceTime('LIS', 'DIL', t - 24 * 60, t);
    expect(b.state).toBe('B');
    expect(b.reportLocal).toBe(hm('05:00'));
    const x = referenceTime('LIS', 'DIL', t - 60 * 60, t);
    expect(x.state).toBe('X');
    const d = referenceTime('LIS', 'DIL', t - 130 * 60, t);
    expect(d.state).toBe('D');
    expect(d.reportLocal).toBe(hm('13:00'));
    // a European deployment is D after 48 h
    expect(referenceTime('LIS', 'HAM', t - 49 * 60, t).state).toBe('D');
  });
});

describe('disruptive duties and local nights', () => {
  it('flags early starts, late finishes and nights in reference time', () => {
    // LIS summer is UTC+1
    expect(isDisruptive('LIS', fromUTC(2027, 6, 1, 4, 0), fromUTC(2027, 6, 1, 11, 0))).toBe(true); // 05:00 report
    expect(isDisruptive('LIS', fromUTC(2027, 6, 1, 6, 0), fromUTC(2027, 6, 1, 20, 0))).toBe(false); // 07:00–21:00
    expect(isDisruptive('LIS', fromUTC(2027, 6, 1, 12, 0), fromUTC(2027, 6, 1, 22, 30))).toBe(true); // ends 23:30
  });
  it('counts local nights: 8 h between 22:00 and 08:00', () => {
    const s = fromUTC(2027, 6, 1, 18, 0); // 19:00 LIS
    expect(nightsIn('LIS', s, s + 24 * 60)).toBe(1);
    expect(nightsIn('LIS', s, s + 36 * 60)).toBe(2);
    expect(nightsIn('LIS', s + 5 * 60, s + 36 * 60)).toBe(2); // free from 00:00: 00:00–08:00 still counts
    expect(nightsIn('LIS', s + 6 * 60, s + 36 * 60)).toBe(1); // from 01:00: only 7 h
    expect(nightsIn('LIS', s, s + 10 * 60)).toBe(0); // until 05:00: 6 h
  });
  it('limits work blocks to 6 days (a single free day continues the block)', () => {
    expect(longestWorkBlock([1, 2, 3, 4, 5, 6])).toBe(6);
    expect(longestWorkBlock([1, 2, 3, 5, 6, 7, 8])).toBe(7);
    expect(longestWorkBlock([1, 2, 3, 6, 7, 8, 9])).toBe(4);
  });
});

// ---------- timelines ----------

const T0 = fromUTC(2027, 6, 7); // Monday 00:00 UTC
const ctx = (over: Partial<TimelineCtx> = {}): TimelineCtx => ({ base: 'LIS', restUntil: -Infinity, lastRecovery: T0 - 60, blockYear: 0, blockYearOf: 2027, ...over });
/** A duty seg: start hour on day d (UTC), length in hours, block minutes. */
const duty = (d: number, h: number, len: number, block = 0, fresh = false, extra: Partial<Seg> = {}): Seg => {
  const start = T0 + d * 1440 + h * 60;
  const end = start + len * 60;
  return { kind: 'duty', start, end, fdp: len * 60 - 30, maxFdp: 13 * 60, block, sectors: 2, aug: false, disruptive: false, rest: minRest({ dutyMin: len * 60, atHome: true, augmented: false, tzShift: 0 }), at: 'LIS', dutyId: `d${d}`, fresh, ...extra };
};
const codes = (segs: Seg[], c = ctx()) => evalSegs(c, segs).map((i) => `${i.code}:${i.level}`);

describe('timeline legality', () => {
  it('checks rest between duties (home 12 h)', () => {
    expect(codes([duty(0, 6, 8), duty(1, 2, 8, 0, true)])).toEqual([]);
    expect(codes([duty(0, 6, 8), duty(1, 1, 8, 0, true)])).toEqual(['rest:illegal']);
    expect(codes([duty(0, 6, 8), duty(0, 10, 8, 0, true)])).toContain('overlap:illegal');
    // the fresh duty must also leave rest before the next planned one
    expect(codes([duty(1, 2, 8, 0, true), duty(1, 20, 8)])).toContain('rest:illegal');
  });

  it('requires each duty to start where the previous duty or ticket left the crew', () => {
    const away = duty(0, 6, 8, 0, false, { at: 'KBL' });
    expect(codes([away, duty(1, 6, 8, 0, true, { from: 'KBL' })])).toEqual([]);
    expect(codes([away, duty(1, 6, 8, 0, true, { from: 'LIS' })])).toEqual(['location:illegal']);
    // a ticket home in between leaves the crew at LIS
    const ticket: Seg = { ...duty(1, 2, 3), kind: 'pos', block: 0, sectors: 0, rest: 0, at: 'LIS', from: 'KBL', dutyId: undefined };
    expect(codes([away, ticket, duty(1, 16, 6, 0, true, { from: 'KBL' })])).toEqual(['location:illegal']);
    // a fresh duty ending elsewhere than the next planned one starts is flagged too
    expect(codes([duty(0, 6, 8, 0, true, { at: 'MAD' }), duty(1, 6, 8, 0, false, { from: 'LIS' })])).toEqual(['location:illegal']);
  });

  it('after a logged duty whose ticket home is still to land, the crew are where it lands (v0.7.4 segsOf)', () => {
    // Released at KBL; the ticket home to LIS is inside the log entry, which carries its landing.
    const logged: Seg = { ...duty(0, 6, 8), kind: 'log', at: 'LIS', dutyId: undefined };
    const now = ctx({ now: T0 + 13 * 60, loc: 'KBL' });
    expect(codes([logged, duty(1, 6, 8, 0, true, { from: 'LIS' })], now)).toEqual([]);
    expect(codes([logged, duty(1, 6, 8, 0, true, { from: 'KBL' })], now)).toEqual(['location:illegal']);
    expect(locAt({ loc: 'KBL' } as CrewMember, [logged], T0 + DAY)).toBe('LIS');
    // a log entry without a ticket home: where they are now
    expect(codes([{ ...logged, at: '' }, duty(1, 6, 8, 0, true, { from: 'KBL' })], now)).toEqual([]);
    expect(locAt({ loc: 'KBL' } as CrewMember, [{ ...logged, at: '' }], T0 + DAY)).toBe('KBL');
  });

  it('respects the rest after the last logged duty', () => {
    expect(codes([duty(0, 8, 2, 0, true)], ctx({ restUntil: T0 + 9 * 60 }))).toEqual(['rest:illegal']);
  });

  it('flags FDP over the limit and tight within 30 min', () => {
    expect(codes([duty(0, 6, 14, 0, true)])).toContain('fdp:illegal');
    expect(codes([duty(0, 6, 13.25, 0, true)])).toContain('fdp:tight');
  });

  it('enforces 60 h of duty in 7 days', () => {
    // six 10 h duties = 60 h, a seventh pushes it over (recovery gaps kept short of 36 h on purpose)
    const segs = [0, 1, 2, 3, 4, 5].map((d) => duty(d, 6, 10, 0, false, { maxFdp: 14 * 60 }));
    expect(codes([...segs, duty(6, 6, 2, 0, true)]).filter((c) => c.startsWith('duty7d'))).toEqual(['duty7d:illegal']);
    expect(codes([...segs.slice(0, 5), duty(5, 6, 9.5, 0, true, { maxFdp: 14 * 60 })]).filter((c) => c.startsWith('duty7d'))).toEqual(['duty7d:tight']);
  });

  it('enforces 110 h in 14 days and 190 h in 28 days', () => {
    const c = ctx({ lastRecovery: T0 + 40 * 1440 });
    // 11 duties of 10 h within 14 days, spread 1.2 days apart
    const fourteen = Array.from({ length: 11 }, (_, i) => duty(i * 1.25, 6, 10, 0, false, { maxFdp: 14 * 60 }));
    const r14 = codes([...fourteen, duty(13.5, 6, 1, 0, true)], c);
    expect(r14).toContain('duty14d:illegal');
    const twentyEight = Array.from({ length: 19 }, (_, i) => duty(i * 1.4, 6, 10, 0, false, { maxFdp: 14 * 60 }));
    const r28 = codes([...twentyEight, duty(27.5, 6, 1, 0, true)], ctx({ lastRecovery: T0 + 40 * 1440 }));
    expect(r28).toContain('duty28d:illegal');
  });

  it('enforces 100 block hours in 28 days and 900 in the calendar year', () => {
    const c = ctx({ lastRecovery: T0 + 40 * 1440 });
    const segs = Array.from({ length: 20 }, (_, i) => duty(i, 6, 7, 300));
    expect(codes([...segs, duty(20, 6, 7, 30, true)], c)).toContain('block28d:illegal');
    expect(codes([duty(0, 6, 7, 300, true)], ctx({ blockYear: 896 * 60 }))).toContain('blockYear:illegal');
    expect(codes([duty(0, 6, 7, 300, true)], ctx({ blockYear: 860 * 60 }))).toContain('blockYear:tight');
    // a new year starts from zero
    expect(codes([duty(0, 6, 7, 300, true)], ctx({ blockYear: 899 * 60, blockYearOf: 2026 }))).not.toContain('blockYear:illegal');
  });

  it('needs a 36 h recovery with two local nights every 168 h', () => {
    // daily 8 h duties with 16 h gaps: no recovery after 7 days → illegal
    const daily = Array.from({ length: 7 }, (_, i) => duty(i, 8, 8));
    expect(codes([...daily, duty(7, 8, 8, 0, true)])).toContain('recovery:illegal');
    // two days off (≥ 36 h, 2 nights) in between resets the clock
    const withOff = [0, 1, 2, 3, 4, 7, 8].map((d) => duty(d, 8, 8));
    expect(codes([...withOff, duty(9, 8, 8, 0, true)])).not.toContain('recovery:illegal');
  });

  it('extends recovery to 60 h after 4 disruptive duties', () => {
    // four early starts, then a 44 h gap with two nights (enough for 36 h, not 60 h)
    const early = [0, 1, 2, 3].map((d) => duty(d, 4, 8, 0, false, { disruptive: true }));
    const gapStart = early[3].end;
    const after = { ...duty(0, 0, 8), start: gapStart + 44 * 60, end: gapStart + 52 * 60, dutyId: 'x' };
    const later = [1, 2, 3].map((k) => ({ ...duty(0, 0, 8), start: after.start + k * 1440, end: after.end + k * 1440, dutyId: `y${k}` }));
    const tail = { ...duty(0, 0, 2, 0, true), start: after.start + 4 * 1440, end: after.start + 4 * 1440 + 120 };
    expect(codes([...early, after, ...later, tail])).toContain('recovery:illegal');
    // same pattern without disruptive duties: the 44 h gap counts
    const calm = [0, 1, 2, 3].map((d) => duty(d, 4, 8));
    expect(codes([...calm, after, ...later, tail])).not.toContain('recovery:illegal');
  });

  it('exposes the limits table', () => {
    expect(LIMITS).toMatchObject({ duty7d: 3600, duty14d: 6600, duty28d: 11400, block28d: 6000, blockYear: 54000, recovery: 2160, recoveryLong: 3600, recoveryEvery: 10080 });
  });
});

// ---------- v0.7.2: the tables pinned by article (docs/acmi/EASA-FTL.md) ----------

describe('EASA FDP table (ORO.FTL.205(b)(1))', () => {
  // The regulation's table written out (report band × 1–2, 3 … 10 sectors), not computed.
  const TABLE: [string, string[]][] = [
    ['06:00', ['13:00', '12:30', '12:00', '11:30', '11:00', '10:30', '10:00', '9:30', '9:00']],
    ['13:30', ['12:45', '12:15', '11:45', '11:15', '10:45', '10:15', '9:45', '9:15', '9:00']],
    ['14:00', ['12:30', '12:00', '11:30', '11:00', '10:30', '10:00', '9:30', '9:00', '9:00']],
    ['14:30', ['12:15', '11:45', '11:15', '10:45', '10:15', '9:45', '9:15', '9:00', '9:00']],
    ['15:00', ['12:00', '11:30', '11:00', '10:30', '10:00', '9:30', '9:00', '9:00', '9:00']],
    ['15:30', ['11:45', '11:15', '10:45', '10:15', '9:45', '9:15', '9:00', '9:00', '9:00']],
    ['16:00', ['11:30', '11:00', '10:30', '10:00', '9:30', '9:00', '9:00', '9:00', '9:00']],
    ['16:30', ['11:15', '10:45', '10:15', '9:45', '9:15', '9:00', '9:00', '9:00', '9:00']],
    ['17:00', ['11:00', '10:30', '10:00', '9:30', '9:00', '9:00', '9:00', '9:00', '9:00']],
    ['05:00', ['12:00', '11:30', '11:00', '10:30', '10:00', '9:30', '9:00', '9:00', '9:00']],
    ['05:15', ['12:15', '11:45', '11:15', '10:45', '10:15', '9:45', '9:15', '9:00', '9:00']],
    ['05:30', ['12:30', '12:00', '11:30', '11:00', '10:30', '10:00', '9:30', '9:00', '9:00']],
    ['05:45', ['12:45', '12:15', '11:45', '11:15', '10:45', '10:15', '9:45', '9:15', '9:00']],
  ];
  // Band edges: first and last minute of each band.
  const EDGES: Record<string, string[]> = {
    '06:00': ['06:00', '13:29'], '13:30': ['13:30', '13:59'], '14:00': ['14:00', '14:29'], '14:30': ['14:30', '14:59'], '15:00': ['15:00', '15:29'],
    '15:30': ['15:30', '15:59'], '16:00': ['16:00', '16:29'], '16:30': ['16:30', '16:59'], '17:00': ['17:00', '04:59'], '05:00': ['05:00', '05:14'],
    '05:15': ['05:15', '05:29'], '05:30': ['05:30', '05:44'], '05:45': ['05:45', '05:59'],
  };
  it.each(TABLE)('report band %s × sectors 1–10', (band, row) => {
    for (const t of EDGES[band]) {
      expect(fdp(t, 1)).toBe(hm(row[0]));
      for (let s = 2; s <= 10; s++) expect(fdp(t, s)).toBe(hm(row[Math.max(0, s - 2)]));
    }
  });
  it('FDP_BANDS covers 05:00–16:59 in 15/30-minute bands', () => {
    expect(FDP_BANDS.length).toBe(12);
    expect(FDP_BANDS[0][0]).toBe(hm('05:00'));
    expect(FDP_BANDS[FDP_BANDS.length - 1][1]).toBe(hm('17:00'));
  });
});

describe('unknown state (ORO.FTL.205(b)(2))', () => {
  it('Table 3: 11:00, 10:30, 10:00, 9:30, 9:00, 9:00 for 1–2 … 7 sectors', () => {
    expect([2, 3, 4, 5, 6, 7].map((s) => fdp('09:00', s, false))).toEqual(['11:00', '10:30', '10:00', '9:30', '9:00', '9:00'].map(hm));
    expect(fdp('09:00', 1, false)).toBe(hm('11:00'));
  });
});

describe('augmented crew (CS FTL.1.205(c)) pinned', () => {
  it('AUG_FDP literal', () => {
    expect(AUG_FDP).toEqual({ 1: { 1: 960, 2: 900, 3: 840 }, 2: { 1: 1020, 2: 960, 3: 900 } });
  });
  it('no bonus at 3 sectors; > 3 sectors falls back to the basic table; 18:00 cap', () => {
    const m = (augment: 1 | 2, restClass: 1 | 2 | 3, sectors: number, longestBlock: number) => maxFdp({ reportLocal: hm('08:00'), sectors, acclimatised: true, augment, restClass, longestBlock });
    expect(m(1, 1, 3, 10 * 60)).toBe(hm('16:00'));
    expect(m(1, 1, 4, 10 * 60)).toBe(hm('12:00'));
    expect(m(2, 1, 2, 12 * 60)).toBe(hm('18:00'));
  });
});

describe('discretion constants (ORO.FTL.205(f))', () => {
  it('+2:00, +3:00 augmented, rest never below 10:00', () => {
    expect(DISCRETION).toEqual({ basic: 120, augmented: 180, minRest: 600 });
  });
});

describe('cabin crew in-flight rest table', () => {
  it('rows by extended FDP and rest class', () => {
    expect(CABIN_REST.map((r) => [r.upTo, r.c1, r.c2, r.c3])).toEqual([
      [870, 90, 90, 90], [900, 105, 120, 140], [930, 120, 140, 160], [960, 135, 160, 180], [990, 155, 180, null],
      [1020, 180, 205, null], [1050, 205, null, null], [1080, 230, null, null],
    ]);
  });
  it('cabinInflightRest picks the row; null when the class does not allow it', () => {
    expect(cabinInflightRest(hm('14:00'), 3)).toBe(90);
    expect(cabinInflightRest(hm('15:10'), 2)).toBe(140);
    expect(cabinInflightRest(hm('16:15'), 3)).toBeNull();
    // v0.7.3 C1: the table ends at 17:31–18:00 (3:50); nothing above 18:00
    expect(cabinInflightRest(hm('18:00'), 1)).toBe(230);
    expect(cabinInflightRest(hm('18:15'), 1)).toBeNull();
    expect(cabinInflightRest(hm('17:15'), 2)).toBeNull();
  });
  it('an augmented FDP never exceeds what the cabin crew may reach: they report with the pilots when their table would bind (C2)', () => {
    expect([cabinFdpCap(1), cabinFdpCap(2), cabinFdpCap(3)]).toEqual([hm('18:00'), hm('17:00'), hm('16:00')]);
    // 4 pilots, class 3, one long sector: 15:00 + 1:00 = 16:00 for pilots; the cabin crew report with them (early 0).
    const m = (restClass: 1 | 2 | 3, cabinEarly: number) => maxFdp({ reportLocal: hm('08:00'), sectors: 1, acclimatised: true, augment: 2, restClass, longestBlock: 11 * 60, cabinEarly });
    expect(m(3, 0)).toBe(hm('16:00'));
    expect(m(3, 15)).toBe(hm('16:00'));
    expect(augLimitOf(3, 3, 2, true, 15)).toEqual({ max: hm('16:00'), early: 0, capBy: 'pilots' });
    // 4 pilots + class 1 + one long sector: 18:00 with the cabin crew reporting with the pilots.
    expect(m(1, 15)).toBe(hm('18:00'));
    expect(augLimitOf(1, 1, 2, true, 15)).toEqual({ max: hm('18:00'), early: 0, capBy: 'pilots' });
    // 3 pilots + class 1 (16:00): the cabin crew keep their 15 min earlier report (16:15 is inside their table).
    expect(augLimitOf(1, 1, 1, false, 15)).toEqual({ max: hm('16:00'), early: 15, capBy: 'pilots' });
    // pilots in bunks, cabin crew on recliners: capped by the cabin crew's table (16:00).
    expect(augLimitOf(1, 3, 2, true, 15)).toEqual({ max: hm('16:00'), early: 0, capBy: 'cabin' });
    expect(maxFdp({ reportLocal: hm('08:00'), sectors: 1, acclimatised: true, augment: 2, restClass: 1, cabinClass: 2, longestBlock: 11 * 60 })).toBe(hm('17:00'));
  });
});

describe('cumulative limits (ORO.FTL.210) v0.7.2', () => {
  it('limits literal', () => {
    expect(LIMITS).toMatchObject({ duty7d: 3600, duty14d: 6600, duty28d: 11400, block28d: 6000, blockYear: 54000, block12m: 60000 });
  });
  it('1,000 h in 12 months: logged months plus planned block', () => {
    const c = ctx({ lastRecovery: T0 + 40 * 1440, block12m: 998 * 60 });
    expect(codes([duty(0, 6, 7, 300, true)], c)).toContain('blockYear:illegal');
    expect(codes([duty(0, 6, 7, 300, true)], ctx({ block12m: 900 * 60 }))).not.toContain('blockYear:illegal');
    // absent (old saves): only the calendar year counts
    expect(codes([duty(0, 6, 7, 300, true)], ctx())).not.toContain('blockYear:illegal');
  });
});

// ---------- v0.7.3 (UPDATE-0.7.3.md §1, §3; the player's EASA guide) ----------

describe('v0.7.3 corrections', () => {
  it('C5: more than 10 sectors is never legal (Table 2 ends at 10)', () => {
    expect(fdp('08:00', 10)).toBe(hm('9:00'));
    expect(fdp('08:00', 11)).toBe(0);
  });
  it('C10: early type disruptive kinds; WOCL 02:00–05:59 is separate from night duty 02:00–04:59', () => {
    const at = (h: string) => T0 + hm(h) - 60; // LIS is UTC+1 in June
    const k = (a: string, b: string) => disruptiveKinds('LIS', at(a), at(b) + (hm(b) < hm(a) ? 1440 : 0));
    expect(k('04:59', '12:00')).toEqual({ early: false, late: false, night: true });
    expect(k('05:00', '12:00')).toEqual({ early: true, late: false, night: false });
    expect(k('05:59', '12:00')).toEqual({ early: true, late: false, night: false });
    expect(k('06:00', '12:00')).toEqual({ early: false, late: false, night: false });
    expect(k('12:00', '22:59')).toEqual({ early: false, late: false, night: false });
    expect(k('12:00', '23:00')).toEqual({ early: false, late: true, night: false });
    expect(k('15:00', '01:59')).toEqual({ early: false, late: true, night: false });
    expect(k('15:00', '02:00')).toEqual({ early: false, late: false, night: false });
    expect(k('15:00', '02:30')).toEqual({ early: false, late: false, night: true });
    expect(isDisruptive('LIS', at('05:30'), at('11:00'))).toBe(true);
    // WOCL encroachment counts 05:00–05:59 too (not a night duty).
    expect(woclMinutes('LIS', at('05:00'), at('12:00'))).toBe(60);
    expect(woclMinutes('LIS', at('01:00'), at('09:00'))).toBe(240);
  });
});

describe('planned extension (ORO.FTL.205(d), CS FTL.1.205(b))', () => {
  const N = null;
  // The guide's table literally: start of FDP → 1–2 / 3 / 4 / 5 sectors.
  const T: [string, string, (string | null)[]][] = [
    ['06:00', '06:14', [N, N, N, N]],
    ['06:15', '06:29', ['13:15', '12:45', '12:15', '11:45']],
    ['06:30', '06:44', ['13:30', '13:00', '12:30', '12:00']],
    ['06:45', '06:59', ['13:45', '13:15', '12:45', '12:15']],
    ['07:00', '13:29', ['14:00', '13:30', '13:00', '12:30']],
    ['13:30', '13:59', ['13:45', '13:15', '12:45', N]],
    ['14:00', '14:29', ['13:30', '13:00', '12:30', N]],
    ['14:30', '14:59', ['13:15', '12:45', '12:15', N]],
    ['15:00', '15:29', ['13:00', '12:30', '12:00', N]],
    ['15:30', '15:59', ['12:45', N, N, N]],
    ['16:00', '16:29', ['12:30', N, N, N]],
    ['16:30', '16:59', ['12:15', N, N, N]],
    ['17:00', '17:29', ['12:00', N, N, N]],
    ['17:30', '17:59', ['11:45', N, N, N]],
    ['18:00', '18:29', ['11:30', N, N, N]],
    ['18:30', '18:59', ['11:15', N, N, N]],
    ['19:00', '23:59', [N, N, N, N]],
    ['00:00', '03:59', [N, N, N, N]],
    ['04:00', '05:59', [N, N, N, N]],
  ];
  it.each(T)('report %s–%s', (a, b, cells) => {
    for (const t of [a, b]) {
      const got = [1, 3, 4, 5].map((s) => extFdp(hm(t), s, 0));
      expect(got).toEqual(cells.map((c) => (c === null ? null : hm(c))));
      expect(extFdp(hm(t), 2, 0)).toBe(got[0]);
    }
  });
  it('6 or more sectors: never', () => {
    expect(extFdp(hm('08:00'), 6, 0)).toBeNull();
  });
  it('the table has 16 rows from 06:00 to 18:59', () => {
    expect(EXT_TABLE).toHaveLength(16);
    expect(EXT_TABLE[0][0]).toBe(hm('06:00'));
    expect(EXT_TABLE[EXT_TABLE.length - 1][1]).toBe(hm('19:00'));
  });
  it('sector limits by WOCL encroachment: none 5, ≤ 2 h 4, more 2', () => {
    expect(extFdp(hm('08:00'), 5, 0)).toBe(hm('12:30'));
    expect(extFdp(hm('08:00'), 5, 30)).toBeNull();
    expect(extFdp(hm('08:00'), 4, 120)).toBe(hm('13:00'));
    expect(extFdp(hm('08:00'), 3, 121)).toBeNull();
    expect(extFdp(hm('08:00'), 2, 300)).toBe(hm('14:00'));
  });
});

describe('split duty (CS FTL.1.220)', () => {
  it('adds half the net break, in 15 min steps; nothing under 3 h; 16:00 ceiling', () => {
    expect(splitFdp(hm('12:00'), hm('2:59'))).toBeNull();
    expect(splitFdp(hm('12:00'), hm('3:00'))).toBe(hm('13:30'));
    expect(splitFdp(hm('12:00'), hm('4:00'))).toBe(hm('14:00'));
    expect(splitFdp(hm('11:00'), hm('5:00'))).toBe(hm('13:30'));
    expect(splitFdp(hm('10:00'), hm('6:00'))).toBe(hm('13:00'));
    expect(splitFdp(hm('11:00'), hm('8:00'))).toBe(hm('15:00'));
    expect(splitFdp(hm('13:00'), hm('8:00'))).toBe(hm('16:00'));
    expect(splitFdp(hm('12:00'), hm('3:20'))).toBe(hm('13:30'));
  });
});

describe('standby (CS FTL.1.225)', () => {
  const at = (h: string, day = 0) => T0 + day * 1440 + hm(h) - 60; // LIS local
  it('home: no cut within 6 h; beyond 6 h minute for minute; 8 h when augmented or split', () => {
    expect(standbyCut('home', at('08:00'), at('14:00'), 'LIS', false)).toBe(0);
    expect(standbyCut('home', at('08:00'), at('16:00'), 'LIS', false)).toBe(120);
    expect(standbyCut('home', at('08:00'), at('16:00'), 'LIS', true)).toBe(0);
    expect(standbyCut('home', at('08:00'), at('17:00'), 'LIS', true)).toBe(60);
  });
  it('home: 23:00–07:00 does not count until contacted (06:00 start: the first hour is free)', () => {
    expect(standbyCut('home', at('06:00'), at('14:00'), 'LIS', false)).toBe(60);
    expect(standbyCut('home', at('06:00'), at('14:00'), 'LIS', false, at('06:30'))).toBe(90);
    // guide example 6: standby 07:00, report 15:00 → 2 h off
    expect(standbyCut('home', at('07:00'), at('15:00'), 'LIS', false)).toBe(120);
  });
  it('round 4: the 23:00–07:00 exclusion only for standby starting in that period (CS FTL.1.225(b)(5))', () => {
    // A late window from 12:00 called at 23:30 for 00:30: 12:30 of standby, 6 h free → 6:30 off (no night excluded).
    expect(standbyCut('home', at('12:00'), at('00:30', 1), 'LIS', false, at('23:30'))).toBe(390);
    // Standby from 23:00 called 07:30 for 09:00: the 8 h night before the call does not count → nothing off.
    expect(standbyCut('home', at('23:00'), at('09:00', 1), 'LIS', false, at('07:30', 1))).toBe(0);
    // Standby from 06:00 (in the period) keeps its first hour free, as before.
    expect(standbyCut('home', at('06:00'), at('14:00'), 'LIS', false)).toBe(60);
  });
  it('airport: beyond 4 h; standby + FDP ≤ 16 h', () => {
    expect(standbyCut('airport', at('06:00'), at('10:00'), 'LIS', false)).toBe(0);
    expect(standbyCut('airport', at('06:00'), at('12:30'), 'LIS', false)).toBe(150);
    expect(STANDBY.airportTotal).toBe(16 * 60);
  });
  it('the 18 h awake cap (woken an hour before standby)', () => {
    expect(standbyAwakeOk(at('06:00'), at('23:00'))).toBe(true);
    expect(standbyAwakeOk(at('06:00'), at('23:01'))).toBe(false);
    // guide example 6: standby 07:00, FDP to 01:00 → 19 h awake
    expect(standbyAwakeOk(at('07:00'), at('01:00', 1))).toBe(false);
  });
});

describe('time zones (CS FTL.1.235(b)(3)(i))', () => {
  it('local nights at home by max difference and hours since the first report', () => {
    expect(TZ_NIGHTS).toEqual([[2, 2, 3, 3], [2, 3, 3, 4], [2, 3, 4, 5]]);
    const rows: [number, number[]][] = [[5, [2, 2, 3, 3]], [6, [2, 2, 3, 3]], [8, [2, 3, 3, 4]], [9, [2, 3, 3, 4]], [11, [2, 3, 4, 5]], [12, [2, 3, 4, 5]]];
    for (const [d, want] of rows) expect([47, 48, 71.9, 72, 95.9, 96, 200].map((h) => tzNights(d, h))).toEqual([want[0], want[1], want[1], want[2], want[2], want[3], want[3]]);
    expect(tzNights(3.5, 100)).toBe(0);
    // guide example 7: 9 h behind, back after 80 h → 3 local nights
    expect(tzNights(9, 80)).toBe(3);
  });
  it('local days: whole 00:00–24:00 days at base', () => {
    const at = (h: string, day = 0) => T0 + day * 1440 + hm(h) - 60;
    expect(localDaysIn('LIS', at('20:00'), at('08:00', 3))).toBe(2);
    expect(localDaysIn('LIS', at('00:00', 1), at('00:00', 3))).toBe(2);
    expect(localDaysIn('LIS', at('00:01', 1), at('00:00', 3))).toBe(1);
  });
});

describe('v0.7.3 timeline rules', () => {
  // T0 is Monday 7 Jun 2027 00:00 UTC; LIS is UTC+1.
  it('ext7d: at most 2 planned extensions in any 7 days per crew member', () => {
    const e = { ext: true };
    expect(codes([duty(0, 7, 13, 0, true, e), duty(2, 7, 13, 0, true, e)])).not.toContain('ext7d:illegal');
    expect(codes([duty(0, 7, 13, 0, true, e), duty(2, 7, 13, 0, true, e), duty(4, 7, 13, 0, true, e)])).toContain('ext7d:illegal');
    // the first falls out of the 7 days
    expect(codes([duty(0, 7, 13, 0, true, e), duty(2, 7, 13, 0, true, e), duty(7, 8, 13, 0, true, e)])).not.toContain('ext7d:illegal');
  });
  it('lateEarly: a late finish then an early start at home needs a local night in between', () => {
    // 15:40–00:40 local (late finish), then a 05:30 local start the same night: illegal; the next morning: legal.
    const late = duty(0, 14 + 40 / 60, 9, 0, false, { late: true, from: 'LIS' });
    const early = (d: number) => duty(d, 4.5, 6, 0, true, { early: true, from: 'LIS', rest: 0 });
    expect(codes([{ ...late, rest: 0 }, early(1)])).toContain('lateEarly:illegal');
    // a local night is 8 h between 22:00 and 08:00: before a 05:30 start only the night before last counts
    expect(codes([{ ...late, rest: 0 }, early(2)])).toContain('lateEarly:illegal');
    expect(codes([{ ...late, rest: 0 }, early(3)])).not.toContain('lateEarly:illegal');
    // away from base the rule doesn't apply
    expect(codes([{ ...late, rest: 0 }, { ...early(1), from: 'FAO' }])).not.toContain('lateEarly:illegal');
  });
  it('nightSectors: consecutive night duties with more than 4 sectors', () => {
    const night = (d: number, sectors: number, fresh = false) => duty(d, 22, 8, 0, fresh, { night: true, sectors, rest: 0 });
    expect(codes([night(0, 4), night(1, 5, true)])).toContain('nightSectors:illegal');
    expect(codes([night(0, 4), night(1, 4, true)])).not.toContain('nightSectors:illegal');
    expect(codes([duty(0, 8, 8, 0, false, { rest: 0 }), night(1, 5, true)])).not.toContain('nightSectors:illegal');
  });
  it('twoDays: twice a month a recovery with 2 whole local days; the first month tracked never', () => {
    // June 2027 (month key 2027*12+5): a dense month with one 2-day break, then the first duty in July.
    const jun = 2027 * 12 + 5;
    const segs: Seg[] = [];
    for (let d = 0; d < 23; d++) if (d !== 10 && d !== 11 && d !== 12) segs.push(duty(d, 8, 9, 0, false, { rest: 0 }));
    segs.push(duty(24, 8, 9, 0, true, { rest: 0 }));
    const c = (td: Record<number, number>) => ctx({ twoDays: td, now: T0 });
    expect(codes(segs, c({ 0: jun - 1 }))).toContain('twoDays:illegal');
    expect(codes(segs, c({ 0: jun - 1, [jun]: 1 }))).not.toContain('twoDays:illegal');
    expect(codes(segs, c({ 0: jun }))).not.toContain('twoDays:illegal');
    // absent (old saves): not checked
    expect(codes(segs, ctx({ now: T0 }))).not.toContain('twoDays:illegal');
    // idle all June with the last logged work before the timeline window (workEnd): the free month counts
    const july = [duty(31, 8, 9, 0, true, { rest: 0 })];
    expect(codes(july, ctx({ twoDays: { 0: jun - 1 }, now: T0 }))).toContain('twoDays:illegal');
    expect(codes(july, ctx({ twoDays: { 0: jun - 1 }, now: T0, workEnd: T0 - 3 * 1440 }))).not.toContain('twoDays:illegal');
  });
  it('tzRest: local nights at home after a rotation 4+ h away; 3 between alternating directions', () => {
    // LIS → CUN (UTC−5: 6 h behind LIS in June), 3 days away, back on day 3: 3 local nights before the next duty.
    const out = duty(0, 10, 12, 0, false, { at: 'CUN', from: 'LIS', rest: 0 });
    const back = duty(3, 1, 11, 0, false, { at: 'LIS', from: 'CUN', rest: 0 });
    const next = (d: number) => duty(d, 9, 8, 0, true, { from: 'LIS' });
    expect(codes([out, back, next(5)])).toContain('tzRest:illegal');
    expect(codes([out, back, next(7)])).not.toContain('tzRest:illegal');
    // from the crew's state: just back from a 5-night rotation
    expect(codes([next(2)], ctx({ tzBack: { back: T0 + 1440, nights: 3, dir: -1 } }))).toContain('tzRest:illegal');
    // west (CUN, back within 48 h: 2 nights) then east (BKK, +6 h): 3 local nights between the two needed
    const back1 = duty(1, 18, 10, 0, false, { at: 'LIS', from: 'CUN', rest: 0 });
    const east = (d: number) => duty(d, 10, 10, 0, true, { at: 'BKK', from: 'LIS', rest: 0 });
    expect(evalSegs(ctx(), [out, back1, east(4)]).map((i) => i.text)).toContain('Changing from westbound to eastbound needs 3 local nights at home in between');
    expect(codes([out, back1, east(5)])).not.toContain('tzRest:illegal');
  });
  it('home standby counts 25 % towards the duty windows', () => {
    const sby = (d: number): Seg => ({ kind: 'sby', start: T0 + d * 1440 + 5 * 60, end: T0 + d * 1440 + 17 * 60, fdp: 0, maxFdp: 0, block: 0, sectors: 0, aug: false, disruptive: false, share: 0.25, rest: 720, at: 'LIS', from: 'LIS' });
    // 5 duties of 11 h + two 12 h standbys at 25 % (6 h) = 61 h > 60 h in 7 days; 10.6 h duties: 59 h (tight, not illegal)
    const week = (len: number) => [sby(0), sby(1), ...[2, 3, 4, 5].map((d) => duty(d, 6, len, 0, false, { rest: 0 })), duty(6, 6, len, 0, true, { rest: 0 })];
    expect(codes(week(11))).toContain('duty7d:illegal');
    expect(codes(week(10.6))).toContain('duty7d:tight');
    expect(codes(week(10.6))).not.toContain('duty7d:illegal');
  });
});
