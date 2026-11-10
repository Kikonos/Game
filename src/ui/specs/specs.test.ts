// v0.18 aircraft spec sheets: every type's seat map seats exactly its cabin, the range circles are geodesic, and every
// type in the game has its figures.
import { describe, expect, it } from 'vitest';
import { ACMI_TYPES_LIST } from '../../data/acmiTypes';
import { AIRCRAFT_BY_ID } from '../../data/aircraft';
import { cabinPresets } from '../../data/cabins';
import { LOPA, lopaOf } from '../../data/lopa';
import { amenity, TYPE_SPECS } from '../../data/specs';
import { ENGINES } from '../../data/variants';
import { haversine } from '../../engine/core/geo';
import { capPattern, seatMap, seatMapSvg } from './seatMap';
import { discExtentDeg, nmToDeg, rangeRing } from './rangeDiscs';
import { lineNumber } from './specLogic';

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

describe('seat map', () => {
  for (const t of ACMI_TYPES_LIST) {
    for (const c of cabinPresets(t.id)) {
      it(`${t.id} ${c.label}: seats equal the cabin`, () => {
        const m = seatMap(t.id, c);
        if (LOPA[t.id]?.noMap) {
          expect(m.ok).toBe(false);
          return;
        }
        expect(m.ok).toBe(true);
        if (!m.ok) return;
        expect(m.counts).toEqual({ J: c.j, W: c.w, Y: c.y });
        // Every seat drawn once, inside the cabin floor and clear of the other seats of its row.
        for (const d of m.decks) {
          expect(d.seats.length).toBe(d.counts.J + d.counts.W + d.counts.Y + d.counts.R);
          for (const s of d.seats) {
            expect(s.x).toBeGreaterThanOrEqual(0);
            expect(s.x + s.w).toBeLessThanOrEqual(d.width + 0.01);
            expect(s.y).toBeGreaterThanOrEqual(0);
            expect(s.y + s.h).toBeLessThanOrEqual(d.len + 0.01);
          }
          const ids = new Set(d.seats.map((s) => `${s.row}${s.letter}`));
          expect(ids.size).toBe(d.seats.length);
          expect(d.rows.some((r) => r.n === 13)).toBe(false);
        }
        // Realistic pitch: economy at 28 in or more; never tighter than any airline flies.
        expect(m.tight).toBe(false);
        if (c.y) expect(m.pitch.Y!).toBeGreaterThanOrEqual(c.layout === 'all-economy' ? 27 : 28);
        expect(seatMapSvg(m)).toContain('<svg');
      });
    }
  }

  it('the A330-200 at 12C/283Y of Euro Atlantic CS-TGD: 2-2-2 business, 2-4-2 economy at about 30 in, four door pairs', () => {
    const m = seatMap('a332', { j: 12, w: 0, y: 283, layout: 'two-class' });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.decks[0].abreast).toMatchObject({ J: '2-2-2', Y: '2-4-2' });
    expect(m.decks[0].doors.filter((d) => !d.ow).length).toBe(4);
    expect(m.pitch.Y).toBeGreaterThanOrEqual(30);
    expect(m.pitch.Y).toBeLessThanOrEqual(31.5);
  });

  it('the 777-200ER at 30C/24W/239Y of CS-TSW: 1-2-1, 2-4-2, 3-3-3 at 30 in, four door pairs', () => {
    const m = seatMap('b772', { j: 30, w: 24, y: 239, layout: 'three-class' });
    expect(m.ok && m.decks[0].abreast).toMatchObject({ J: '1-2-1', W: '2-4-2', Y: '3-3-3' });
    expect(m.ok && m.pitch.Y).toBeLessThanOrEqual(31);
    expect(m.ok && m.decks[0].doors.filter((d) => !d.ow).length).toBe(4);
  });

  it('the 767-300ER of CS-TSU / CS-TST: 1-2-1 business, 2-4-2 economy, 309 all-economy at about 30 in', () => {
    const a = seatMap('b763', { j: 16, w: 0, y: 251, layout: 'two-class' });
    const b = seatMap('b763', { j: 0, w: 0, y: 309, layout: 'all-economy' });
    expect(a.ok && a.decks[0].abreast).toMatchObject({ J: '1-2-1', Y: '2-4-2' });
    expect(b.ok && b.pitch.Y).toBeGreaterThanOrEqual(29);
  });

  it('doors and exits by type: A320 2 pairs + 2 overwing, A321neo Cabin Flex 3 + 2, A321ceo 4, 737-900ER 3 + 2, 777-300ER 5, A380 5 + 3 upper, 747 5 + 1 upper', () => {
    const doors = (id: string, variant?: string) => {
      const m = seatMap(id, cabinPresets(id)[0], { variant });
      if (!m.ok) return null;
      return m.decks.map((d) => [d.doors.filter((x) => !x.ow).length, d.doors.filter((x) => x.ow).length]);
    };
    expect(doors('a320ceo')).toEqual([[2, 2]]);
    expect(doors('a321neo')).toEqual([[3, 2]]);
    expect(doors('a321neo', 'classic')).toEqual([[4, 0]]);
    expect(doors('a321ceo')).toEqual([[4, 0]]);
    expect(doors('b738')).toEqual([[2, 2]]);
    expect(doors('b739')).toEqual([[3, 2]]);
    expect(doors('b77w')).toEqual([[5, 0]]);
    expect(doors('a346')).toEqual([[4, 1]]);
    expect(doors('a388')).toEqual([[5, 0], [3, 0]]);
    expect(doors('b744')).toEqual([[5, 0], [1, 0]]);
  });

  it('two-deck types put the decks side by side, the upper deck with its share of the seats', () => {
    const m = seatMap('a388', { j: 60, w: 0, y: 411, layout: 'two-class' });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.decks.map((d) => d.id)).toEqual(['main', 'upper']);
    expect(m.decks[1].counts.J).toBe(60);
    expect(m.decks[0].abreast.Y).toBe('3-4-3');
    expect(m.decks[1].abreast.Y).toBe('2-4-2');
  });

  it('crew rest recliners are drawn on top of the cabin; bunks as compartments', () => {
    const m = seatMap('a332', { j: 18, w: 0, y: 268, layout: 'two-class' }, { restSeats: 7, bunks: true });
    expect(m.ok && m.counts).toEqual({ J: 18, W: 0, Y: 268 });
    expect(m.ok && m.decks[0].counts.R).toBe(7);
    expect(m.ok && m.decks[0].rest.map((r) => r.where).sort()).toEqual(['lower', 'room']);
  });

  it('odd cabins still seat exactly (a short last row loses window seats)', () => {
    for (const [id, j, w, y] of [['a320ceo', 0, 0, 175], ['b77w', 42, 0, 361], ['a359', 33, 0, 287], ['b744', 25, 0, 401]] as const) {
      const m = seatMap(id, { j, w, y, layout: j ? 'two-class' : 'all-economy' });
      expect(m.ok && m.counts).toEqual({ J: j, W: w, Y: y });
    }
    expect(capPattern([3, 4, 3], 6)).toEqual([2, 2, 2]);
  });
});

describe('range discs', () => {
  it('the range circle is geodesic: every point the range away from the city', () => {
    for (const [lat, lon, nm] of [[38.77, -9.13, 2565], [51.47, -0.45, 6935], [1.36, 103.99, 8550], [-33.9, 151.2, 4000]]) {
      const ring = rangeRing(lat, lon, nm, 3);
      expect(ring.length).toBeGreaterThan(20);
      for (const [x, y] of ring) expect(Math.abs(haversine(lat, lon, y, x) / 1.852 - nm)).toBeLessThan(nm * 0.002 + 1);
    }
  });
  it('the disc shows more than the range (v0.19.5 zoomed to it), up to the whole world', () => {
    expect(discExtentDeg(2565)).toBeGreaterThan(nmToDeg(2565));
    expect(discExtentDeg(9000)).toBe(180);
  });
});

describe('data completeness', () => {
  for (const t of ACMI_TYPES_LIST) {
    it(`${t.id}: figures, engines, geometry and amenities`, () => {
      const sp = TYPE_SPECS[t.id];
      expect(sp, 'TYPE_SPECS').toBeDefined();
      expect(sp.mlwKg).toBeGreaterThan(40_000);
      expect(sp.fuelL).toBeGreaterThan(15_000);
      expect(sp.cargoM3).toBeGreaterThan(20);
      expect(sp.thrustKN[0]).toBeGreaterThan(80);
      const cat = AIRCRAFT_BY_ID[t.catalog ?? t.id];
      expect(cat, 'catalog').toBeDefined();
      // Landing weight below take-off weight.
      expect(sp.mlwKg).toBeLessThan(cat.mtow * 1000);
      expect(ENGINES[t.id], 'engines').toBeTruthy();
      expect(t.rangeNm).toBeGreaterThan(1000);
      expect(t.cruiseKt).toBeGreaterThan(400);
      expect(t.minRunwayM).toBeGreaterThan(1500);
      expect(lopaOf(t.id), 'cabin geometry').toBeDefined();
      for (const c of ['J', 'W', 'Y'] as const) expect(amenity(t.id, c, '3-3', 30, 'two-class').width).toBeGreaterThan(15);
      const ln = lineNumber(t.id, t.firstYear ?? 2010, 'x');
      expect(ln.n).toBeGreaterThan(0);
    });
  }
  it('line numbers follow real production (Euro Atlantic A330 MSN 1229 in 2011, 767 line 889 in 2002)', () => {
    expect(Math.abs(lineNumber('a333', 2011, 'a').n - 1300)).toBeLessThan(120);
    expect(Math.abs(lineNumber('b763', 2002, 'a').n - 900)).toBeLessThan(40);
  });
  it('every type with a seat map but the 777X (not in service)', () => {
    expect(ACMI_TYPES_LIST.filter((t) => LOPA[t.id]?.noMap).map((t) => t.id).sort()).toEqual(['b778', 'b779']);
    expect(sum(ACMI_TYPES_LIST.map((t) => (LOPA[t.id] ? 1 : 0)))).toBe(ACMI_TYPES_LIST.length);
  });
});
