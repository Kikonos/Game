import { describe, expect, it } from 'vitest';
import type { GameState } from '../../engine/core/types';
import type { RestPlan } from '../../engine/crew';
import { restLayout } from './RestTimeline';
import { restSeatWord, restTerm } from './RestLines';

const g = {
  flights: { f1: { id: 'f1', no: 'AW201', from: 'LIS', to: 'GRU', std: 600, sta: 600 + 600, status: 'scheduled' } },
  crew: { c1: { id: 'c1', first: 'Ana', last: 'Silva', role: 'CPT' }, c2: { id: 'c2', first: 'Rui', last: 'Reis', role: 'CC' }, c3: { id: 'c3', first: 'Eva', last: 'Costa', role: 'FO' }, c4: { id: 'c4', first: 'Luís', last: 'Melo', role: 'CPT' } },
} as unknown as GameState;

const plan: RestPlan = {
  ok: true, code: 'ok', why: null, augment: 1, cabinFdp: 700, cabinNeed: 120, band: '11:31–12:00', extraCabin: 0, blocked: {}, spareMin: 40,
  cruise: [{ flightId: 'f1', from: 640, to: 1160, cabinFrom: 705, cabinTo: 1130 }],
  pilots: [
    { seat: 'FO2', n: 1, crewIds: ['c3'], flightId: 'f1', start: 640, end: 780, need: 90, where: 'fcrc', cls: 1 },
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
      'Relief · FO Costa · 2:20 · bunk',
      'Pair A · FO · lands · 3:00 · bunk',
      'Pair A · Capt. Silva · lands · 2:50 · bunk',
      'Group A (4) · 3:20 · lower deck',
    ]);
    // 'lands' and the times are words on the row, never cut off (v0.7.3 fix: the FO's 'lands' hid behind an ellipsis).
    expect(lay.rows[1].when).toMatch(/^\d\d:\d\d–\d\d:\d\d UTC$/);
    expect(lay.rows[3].names).toEqual(['Rui Reis']);
    expect(lay.rows[2].landing).toBe(true);
    expect(lay.rows[3].title).toContain('Rui Reis');
  });
  it('v0.18.3 pilots as pairs: crew line, members and who is at the controls (take-off, each cruise stretch, landing)', () => {
    const lay = restLayout(g, plan)!;
    expect(lay.pairs!.line).toBe('1 CPT + 2 FO · pair A + relief FO');
    expect(lay.pairs!.members).toBe('Pair A: Capt. Silva + FO · relief: FO Costa');
    expect(lay.pairs!.controls).toBe('Take-off pair A · cruise A, Capt. Silva + FO Costa, FO + FO Costa, A · landing pair A');
    // A captain in the relief seat: 2 CPT + 1 FO.
    const p2: RestPlan = { ...plan, pilots: plan.pilots.map((t) => (t.seat === 'FO2' ? { ...t, crewIds: ['c4'] } : t)) };
    expect(restLayout(g, p2)!.pairs!.line).toBe('2 CPT + 1 FO · pair A + relief CPT');
    expect(restLayout(g, p2)!.rows[0].text).toBe('Relief · Capt. Melo (as FO) · 2:20 · bunk');
    // 4 pilots, bunks for 2: pair B rests first, then pair A (who land); 3 captains + 1 FO with a captain in FO 2.
    const p4: RestPlan = {
      ...plan, augment: 2,
      pilots: [
        { seat: 'CPT2', n: 1, crewIds: ['c4'], flightId: 'f1', start: 640, end: 860, need: 90, where: 'fcrc', cls: 1 },
        { seat: 'FO2', n: 1, crewIds: ['c1'], flightId: 'f1', start: 640, end: 860, need: 90, where: 'fcrc', cls: 1 },
        { seat: 'CPT', n: 1, crewIds: [], flightId: 'f1', start: 860, end: 1130, need: 120, where: 'fcrc', cls: 1, landing: true },
        { seat: 'FO', n: 1, crewIds: ['c3'], flightId: 'f1', start: 860, end: 1130, need: 120, where: 'fcrc', cls: 1, landing: true },
      ],
    };
    const l4 = restLayout(g, p4)!;
    expect(l4.pairs!.line).toBe('3 CPT + 1 FO · pairs A/B');
    expect(l4.pairs!.members).toBe('Pair A: CPT + FO Costa · Pair B: Capt. Melo + Capt. Silva (as FO)');
    expect(l4.pairs!.controls).toBe('Take-off pair A · cruise A, B, A · landing pair A');
    expect(l4.pairs!.blocks.map((b) => b.who)).toEqual(['A', 'B', 'A']);
    expect(l4.rows.map((r) => r.pair)).toEqual(['B', 'B', 'A', 'A', undefined]);
  });
  it('no legs → nothing to draw', () => {
    expect(restLayout(g, { ...plan, cruise: [] })).toBeNull();
  });
  it('facility words and terms', () => {
    expect(restTerm({ cls: 2, kind: 'jSeats', places: 4 })).toBe('jSeats');
    expect(restTerm({ cls: 3, kind: 'ySeats', places: 2 })).toBe('ySeats');
    expect(restTerm({ cls: 1, kind: 'ldmcr', places: 7 })).toBe('ldmcr');
    expect(restTerm(null)).toBe('crewRest');
    expect(restSeatWord({ fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 2, kind: 'jSeats', places: 4 } })).toBe('business seats');
    expect(restSeatWord({ fc: { cls: 2, kind: 'recliners', places: 2 }, cc: null })).toBe('recliner seats');
    expect(restSeatWord({ fc: { cls: 3, kind: 'ySeats', places: 2 }, cc: { cls: 3, kind: 'ySeats', places: 2 } })).toBe('economy seats');
    expect(restSeatWord({ fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: null })).toBeNull();
  });
});
