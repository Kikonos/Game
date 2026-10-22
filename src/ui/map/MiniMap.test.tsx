import { describe, expect, it } from 'vitest';
import { buildMiniMap } from './MiniMap';

const crew = [{ id: 'c1', name: 'A', at: 'LIS' }, { id: 'c2', name: 'B', at: 'LIS' }, { id: 'c3', name: 'C', at: 'CMN' }];

describe('buildMiniMap', () => {
  it('draws the leg the crew would take, with its label and times', () => {
    const b = buildMiniMap({ crew, to: 'CMN', path: [{ from: 'LIS', to: 'CMN', no: 'TP 1909', dep: 600, arr: 700 }], departure: 1080 }, 322, 145)!;
    expect(b.legs).toHaveLength(1);
    expect(b.legs[0].label).toBe('TP 1909');
    expect(b.none).toHaveLength(0);
    expect(b.aps.find((a) => a.code === 'LIS')?.crew).toBe(2);
    expect(b.aps.find((a) => a.code === 'CMN')?.dep).toBe(true);
  });
  it('with no flight at all, runs a gap line from each crew airport (not the departure itself) with one note', () => {
    const b = buildMiniMap({ crew, to: 'CMN', path: [], departure: 1080 }, 322, 145)!;
    expect(b.legs).toHaveLength(0);
    expect(b.none).toHaveLength(1);
    expect(b.none[0].note).toBe(true);
    const b2 = buildMiniMap({ crew: [...crew, { id: 'c4', name: 'D', at: 'OPO' }], to: 'VCE', path: [], departure: 1080 }, 322, 145)!;
    expect(b2.none).toHaveLength(3);
    expect(b2.none.filter((l) => l.note)).toHaveLength(1);
  });
});
