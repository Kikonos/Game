// v0.12.1 graded runway performance and real nonstop routes: a short take-off runway costs range in proportion to
// how short it is, a high one counts as shorter, the arrival end never cuts the range, fuel stops lie on the way;
// every type flies the charter routes it really flies (or flew) nonstop both ways.

import { describe, expect, it } from 'vitest';
import { ACMI_TYPES } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE, AIRPORTS } from '../../data/airports';
import { COUNTRIES } from '../../data/countries';
import { standardOffsetHours } from '../../data/timezones';
import { airportsWithin } from '../contracts/offers';
import { distanceNm } from './geo';
import { altitudeFactor, fullLength, maxSectorNm, planSector, rangeFromNm, runwayFit, usableRangeNm } from './perf';

const nonstop = (t: string, a: string, b: string) => {
  const p = planSector(t, a, b);
  return p.ok && p.techStops.length === 0;
};

describe('v0.12.1 runway performance', () => {
  it('Montego Bay–Amsterdam: the A330-200 flies it nonstop both ways (MBJ 2,662 m is 1.4% short: about 80 nm less)', () => {
    expect(runwayFit('a332', 'MBJ')).toBe('limited');
    const lost = usableRangeNm('a332') - rangeFromNm('a332', 'MBJ');
    expect(lost).toBeGreaterThan(0);
    expect(lost / usableRangeNm('a332')).toBeLessThan(0.03);
    expect(planSector('a332', 'MBJ', 'AMS')).toMatchObject({ ok: true, techStops: [] });
    expect(planSector('a332', 'AMS', 'MBJ')).toMatchObject({ ok: true, techStops: [] });
  });

  it('the loss grows smoothly with the shortfall: small for a few percent, most of a narrowbody range at the floor', () => {
    const t = ACMI_TYPES.a320ceo;
    // An airport whose runway we vary: the loss is monotone and graded.
    const loss = (share: number) => {
      const a = AIRPORT_BY_CODE.FAO;
      const keep = a.runwayM;
      a.runwayM = Math.round(t.minRunwayM * share);
      try {
        return 1 - rangeFromNm(t.id, 'FAO') / usableRangeNm(t.id);
      } finally {
        a.runwayM = keep;
      }
    };
    expect(loss(1)).toBe(0);
    expect(loss(0.98)).toBeGreaterThan(0);
    expect(loss(0.98)).toBeLessThan(0.06);
    expect(loss(0.9)).toBeGreaterThan(loss(0.98));
    expect(loss(0.8)).toBeGreaterThan(loss(0.9));
    expect(loss(0.71)).toBeGreaterThan(0.6);
  });

  it('only the take-off end limits: landing on a short runway costs nothing, taking off from it does', () => {
    // Dili (1,850 m) on a 767: in nonstop from Dubai, back with a stop.
    expect(runwayFit('b763', 'DIL')).toBe('limited');
    expect(maxSectorNm('b763', 'DXB', 'DIL')).toBe(usableRangeNm('b763'));
    expect(maxSectorNm('b763', 'DIL', 'DXB')).toBeLessThan(usableRangeNm('b763'));
    expect(nonstop('b763', 'DXB', 'DIL')).toBe(true);
    expect(nonstop('b763', 'DIL', 'DXB')).toBe(false);
  });

  it('hot and high: the altitude lengthens the take-off (Bogotá, Addis, La Paz, Cusco, Leh), landing is no bar', () => {
    expect(altitudeFactor(0)).toBe(1);
    expect(altitudeFactor(1000)).toBeGreaterThan(1.2);
    expect(altitudeFactor(1000)).toBeLessThan(1.3);
    expect(altitudeFactor(2230)).toBeGreaterThan(1.55);
    expect(altitudeFactor(2230)).toBeLessThan(1.75);
    // Bogotá's 3,800 m is a short runway for an A330 at 2,548 m up, but Madrid is still nonstop (Avianca).
    expect(runwayFit('a332', 'BOG')).toBe('limited');
    expect(nonstop('a332', 'BOG', 'MAD')).toBe(true);
    // A 767 can leave La Paz (4,061 m) only for short hops; Cusco takes A320s, an A330 only light.
    expect(rangeFromNm('b763', 'LPB')).toBeLessThan(0.6 * usableRangeNm('b763'));
    expect(nonstop('b763', 'LPB', 'VVI')).toBe(true);
    expect(nonstop('a320ceo', 'CUZ', 'LIM')).toBe(true);
    expect(nonstop('a320ceo', 'IXL', 'DEL')).toBe(true);
    // A diversion field needs its length, not the altitude allowance.
    expect(fullLength('b744', 'JNB')).toBe(true);
    expect(runwayFit('b744', 'JNB')).toBe('limited');
  });

  it('fuel stops lie on the way: never further from the destination than the start, no short hop when a midway stop fits', () => {
    for (const [t, a, b] of [['a320ceo', 'AMS', 'MBJ'], ['a320ceo', 'MBJ', 'AMS'], ['a321ceo', 'AMS', 'CUR'], ['b738', 'LGW', 'CUN'], ['b772', 'LIS', 'HKG'], ['a320ceo', 'LIS', 'GRU']] as const) {
      const p = planSector(t, a, b);
      expect(p.ok, `${t} ${a}-${b}`).toBe(true);
      expect(p.techStops.length, `${t} ${a}-${b}`).toBeGreaterThan(0);
      let left = distanceNm(a, b);
      for (const s of p.techStops) {
        expect(distanceNm(s, b), `${t} ${a}-${b} via ${s}`).toBeLessThan(left + 150);
        left = distanceNm(s, b);
      }
      // A sensible detour, and no leg under a sixth of the trip when the legs could be even.
      const legs = p.legs.map((l) => distanceNm(l.from, l.to));
      expect(legs.reduce((x, y) => x + y, 0) / distanceNm(a, b), `${t} ${a}-${b}`).toBeLessThan(1.15);
      expect(Math.min(...legs) / distanceNm(a, b), `${t} ${a}-${b} ${p.techStops}`).toBeGreaterThan(1 / 6);
    }
    // The A320 across the North Atlantic stops at the stepping stones (Gander, St. John's, Keflavík, the Azores…).
    const p = planSector('a320ceo', 'AMS', 'MBJ');
    expect(p.techStops.every((s) => ['YYT', 'YQX', 'YYR', 'KEF', 'PDL', 'TER', 'SNN', 'BDA', 'YHZ', 'BOS'].includes(s)), p.techStops.join()).toBe(true);
  });
});

/** Real nonstop routes each type flies or flew in charter, ACMI or airline service. */
const REAL: [string, string, string, string][] = [
  ['a320ceo', 'LGW', 'LPA', 'UK–Canaries'],
  ['a320ceo', 'MAN', 'HRG', 'UK–Red Sea'],
  ['a320neo', 'AMS', 'SID', 'Netherlands–Cape Verde'],
  ['b738', 'AMS', 'LPA', 'Transavia'],
  ['b738', 'AMS', 'SID', 'Transavia and TUI to Sal'],
  ['b738', 'MAN', 'SID', 'TUI to Sal'],
  ['b738', 'AMS', 'HRG', 'Red Sea'],
  ['a321ceo', 'MAN', 'TFS', 'UK–Canaries'],
  ['a321ceo', 'ARN', 'LPA', 'Scandinavia–Canaries'],
  ['a321neo', 'LIS', 'EWR', 'TAP A321LR'],
  ['a321neo', 'DUB', 'BOS', 'Aer Lingus A321LR'],
  ['b752', 'LGW', 'BJL', 'UK–Gambia'],
  ['b752', 'MAN', 'SID', 'UK–Cape Verde'],
  ['b763', 'AMS', 'CUR', 'Arkefly / TUI'],
  ['b763', 'AMS', 'AUA', 'Arkefly / TUI'],
  ['b763', 'FRA', 'CUN', 'Condor'],
  ['b763', 'MAN', 'MBJ', 'Thomson'],
  ['b763', 'FRA', 'WDH', 'Condor'],
  ['a332', 'MBJ', 'AMS', 'the GetJet case'],
  ['a332', 'AMS', 'PBM', 'Paramaribo'],
  ['a332', 'AMS', 'CUR', 'Curaçao'],
  ['a332', 'AMS', 'SXM', 'KLM'],
  ['a332', 'LGW', 'MBJ', 'UK–Jamaica'],
  ['a332', 'CDG', 'RUN', 'Corsair / Air Austral'],
  ['a332', 'LHR', 'ASI', 'the Falklands airbridge'],
  ['a332', 'SCL', 'IPC', 'Easter Island'],
  ['a332', 'CPH', 'GOH', 'Air Greenland'],
  ['a333', 'AMS', 'CUR', 'KLM'],
  ['a333', 'AMS', 'BON', 'KLM'],
  ['a333', 'LGW', 'MBJ', 'UK–Jamaica'],
  ['b772', 'AMS', 'CUR', 'KLM'],
  ['b772', 'LGW', 'MRU', 'British Airways'],
  ['b744', 'LHR', 'JNB', 'British Airways'],
  ['b744', 'CGK', 'JED', 'Hajj'],
  ['b744', 'AMS', 'SXM', 'KLM'],
  ['b788', 'CDG', 'RUN', 'Air Austral'],
  ['b789', 'LGW', 'CUN', 'TUI'],
  ['b789', 'MAN', 'PUJ', 'TUI'],
  ['b789', 'SCL', 'IPC', 'LATAM'],
  ['a359', 'CDG', 'RUN', 'Air France / Corsair'],
  ['a343', 'CDG', 'RUN', 'Corsair'],
];

describe('v0.12.1 real nonstop routes, both ways', () => {
  for (const [t, a, b, why] of REAL) {
    it(`${t} ${a}–${b} (${why})`, () => {
      expect(nonstop(t, a, b), `${a}→${b}`).toBe(true);
      expect(nonstop(t, b, a), `${b}→${a}`).toBe(true);
    });
  }

  it('and the ones that really need a stop', () => {
    for (const [t, a, b] of [['a320ceo', 'AMS', 'MBJ'], ['a320ceo', 'AMS', 'CUR'], ['a321ceo', 'AMS', 'CUR'], ['b738', 'LGW', 'CUN'], ['a321ceo', 'HEL', 'LPA'], ['a332', 'LHR', 'MPN']] as const) {
      const p = planSector(t, a, b);
      expect(p.ok, `${t} ${a}-${b}`).toBe(true);
      expect(p.techStops.length, `${t} ${a}-${b}`).toBeGreaterThan(0);
    }
  });
});

describe('v0.12.1 new airports', () => {
  const NEW = ['CUR', 'BON', 'SXM', 'PBM', 'IPC', 'IGU', 'SAI', 'SKD', 'VDO', 'RUN', 'LYR', 'MPN', 'ASI', 'HLE', 'ROR', 'AQJ', 'UBN', 'SPN', 'TBU', 'CXI'];

  it('are on the map with a country, a time zone and a runway', () => {
    for (const c of NEW) {
      const a = AIRPORT_BY_CODE[c];
      expect(a, c).toBeTruthy();
      expect(a.runwayM, c).toBeGreaterThan(1800);
      expect(COUNTRIES[a.country]?.name, c).toBeTruthy();
    }
    expect(AIRPORT_BY_CODE.IPC.runwayM).toBe(3318);
    expect(AIRPORT_BY_CODE.REP).toBeUndefined();
    expect(standardOffsetHours('CXI', 'KI', -157.35)).toBe(14);
    expect(standardOffsetHours('IPC', 'CL', -109.42)).toBe(-6);
    expect(standardOffsetHours('PBM', 'SR', -55.19)).toBe(-3);
  });

  it('short strips stay narrowbody only', () => {
    for (const c of ['HLE', 'CXI', 'GPS', 'NLK', 'ZQN']) {
      expect(runwayFit('a332', c), c).toBe('no');
      expect(runwayFit('a320ceo', c), c).not.toBe('no');
    }
    // Widebodies do land at Sint Maarten (2,300 m), weight-limited on the way out.
    expect(runwayFit('b744', 'SXM')).toBe('limited');
  });

  it('remote places stay out of the usual offer pools (rare, late-game draws only)', () => {
    const remote = AIRPORTS.filter((a) => a.remote).map((a) => a.code);
    expect(remote).toEqual(expect.arrayContaining(['IPC', 'LYR', 'MPN', 'ASI', 'HLE', 'TBU', 'CXI', 'ROR']));
    expect(airportsWithin('LHR', 0, 20000, () => true).some((a) => a.remote)).toBe(false);
    expect(airportsWithin('LHR', 0, 20000, () => true, true).some((a) => a.code === 'ASI')).toBe(true);
    // Mainstream charter places are not remote.
    for (const c of ['CUR', 'BON', 'SXM', 'PBM', 'RUN', 'AQJ', 'SAI']) expect(AIRPORT_BY_CODE[c].remote, c).toBeUndefined();
  });
});
