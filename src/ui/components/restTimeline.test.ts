import { describe, expect, it } from 'vitest';
import type { GameState } from '../../engine/core/types';
import type { RestPlan } from '../../engine/crew';
import { restLayout } from './RestTimeline';
import { restSeatWord, restTerm } from './RestLines';

const g = {
  flights: { f1: { id: 'f1', no: 'AW201', from: 'LIS', to: 'GRU', std: 600, sta: 600 + 600, status: 'scheduled' } },
  crew: { c1: { id: 'c1', first: 'Ana', last: 'Silva' }, c2: { id: 'c2', first: 'Rui', last: 'Reis' }, c3: { id: 'c3', first: 'Eva', last: 'Costa' } },
} as unknown as GameState;

const plan: RestPlan = {
  ok: true, code: 'ok', why: null, augment: 1, cabinFdp: 700, cabinNeed: 120, band: '11:31–12:00', extraCabin: 0, blocked: {}, spareMin: 40,
  cruise: [{ flightId: 'f1', from: 640, to: 1160, cabinFrom: 705, cabinTo: 1130 }],
  pilots: [
    { seat: 'CRP', n: 1, crewIds: ['c3'], flightId: 'f1', start: 640, end: 780, need: 90, where: 'fcrc', cls: 1 },
    { seat: 'FO', n: 1, crewIds: [], flightId: 'f1', start: 780, end: 960, need: 120, where: 'fcrc', cls: 1, landing: true },
    { seat: 'CPT', n: 1, crewIds: ['c1'], flightId: 'f1', start: 960, end: 1130, need: 120, where: 'fcrc', cls: 1, landing: true },
  ],
  cabin: [{ group: 0, n: 4, crewIds: ['c2'], flightId: 'f1', start: 705, end: 905, need: 120, where: 'ldmcr', cls: 1 }],
};

describe('v0.7.3 rest timeline layout', () => {
  it('names pilots (seat while unrostered), groups cabin crew, x in % of take-off → landing', () => {
    const lay = restLayout(g, plan)!;
    expect(lay.legs).toHaveLength(1);
    expect(lay.legs[0].x0).toBe(0);
    expect(lay.legs[0].x1).toBe(100);
    expect(lay.legs[0].c0).toBeCloseTo((40 / 600) * 100);
    expect(lay.rows.map((r) => r.text)).toEqual([
      'CRP Costa 2:20 · bunk',
      'FO 3:00 · bunk · lands',
      'Capt. Silva 2:50 · bunk · lands',
      'Group A (4) 3:20 · lower deck',
    ]);
    expect(lay.rows[2].landing).toBe(true);
    expect(lay.rows[3].title).toContain('Rui Reis');
  });
  it('no legs → nothing to draw', () => {
    expect(restLayout(g, { ...plan, cruise: [] })).toBeNull();
  });
  it('facility words and terms', () => {
    expect(restTerm({ cls: 2, kind: 'jSeats', places: 4 })).toBe('restClass2');
    expect(restTerm({ cls: 1, kind: 'ldmcr', places: 7 })).toBe('ldmcr');
    expect(restTerm(null)).toBe('crewRest');
    expect(restSeatWord({ fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 2, kind: 'jSeats', places: 4 } })).toBe('business seats');
    expect(restSeatWord({ fc: { cls: 3, kind: 'recliners', places: 2 }, cc: null })).toBe('recliner seats');
    expect(restSeatWord({ fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: null })).toBeNull();
  });
});
