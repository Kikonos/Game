// FTL rules (RESEARCH §5.1 F1, F3, F8–F10; DESIGN §5.2): tables, acclimatisation, rest, windows, recovery.

import { describe, expect, it } from 'vitest';
import { fromUTC } from '../core/time';
import { acclimState, AUG_FDP, CABIN_REST, cabinFdpCap, cabinInflightRest, DISCRETION, evalSegs, FDP_BANDS, isDisruptive, LIMITS, longestWorkBlock, maxFdp, minRest, nightsIn, referenceTime, type Seg, type TimelineCtx } from './rules';

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
  it('is 14 h away after an augmented FDP or a ≥ 4 h time shift', () => {
    expect(minRest({ dutyMin: 9 * 60, atHome: false, augmented: true, tzShift: 0 })).toBe(14 * 60);
    expect(minRest({ dutyMin: 9 * 60, atHome: false, augmented: false, tzShift: 4 })).toBe(14 * 60);
    expect(minRest({ dutyMin: 9 * 60, atHome: false, augmented: false, tzShift: 3.5 })).toBe(10 * 60);
    expect(minRest({ dutyMin: 16 * 60, atHome: false, augmented: true, tzShift: 0 })).toBe(16 * 60);
    // at home the augmented rule does not apply
    expect(minRest({ dutyMin: 9 * 60, atHome: true, augmented: true, tzShift: 8 })).toBe(12 * 60);
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
      [1020, 180, 205, null], [1050, 205, null, null], [1080, 230, null, null], [1110, 265, null, null],
    ]);
  });
  it('cabinInflightRest picks the row; null when the class does not allow it', () => {
    expect(cabinInflightRest(hm('14:00'), 3)).toBe(90);
    expect(cabinInflightRest(hm('15:10'), 2)).toBe(140);
    expect(cabinInflightRest(hm('16:15'), 3)).toBeNull();
    expect(cabinInflightRest(hm('18:15'), 1)).toBe(265);
    expect(cabinInflightRest(hm('18:45'), 1)).toBeNull();
  });
  it('an augmented FDP never exceeds what the cabin crew may reach (their report is earlier)', () => {
    expect([cabinFdpCap(1), cabinFdpCap(2), cabinFdpCap(3)]).toEqual([hm('18:30'), hm('17:00'), hm('16:00')]);
    // 4 pilots, class 3, one long sector: 15:00 + 1:00 = 16:00 for pilots, capped to 15:45 with a 15 min cabin report.
    const m = (restClass: 1 | 2 | 3, cabinEarly: number) => maxFdp({ reportLocal: hm('08:00'), sectors: 1, acclimatised: true, augment: 2, restClass, longestBlock: 11 * 60, cabinEarly });
    expect(m(3, 0)).toBe(hm('16:00'));
    expect(m(3, 15)).toBe(hm('15:45'));
    expect(cabinInflightRest(m(3, 15) + 15, 3)).not.toBeNull();
    expect(m(1, 15)).toBe(hm('18:00'));
    expect(cabinInflightRest(m(1, 15) + 15, 1)).not.toBeNull();
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
