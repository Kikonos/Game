import { describe, expect, it } from 'vitest';
import type { CalBlock, CalFlight } from '../../engine/crew/calendar';
import { endAt, monthGrid, monthTotals, stationOf, type GridOpts } from './personLogic';

const H = 60;
const D = 24 * H;
// A month of 30 days whose 1st is a Wednesday (day index 100), base LIS at UTC.
const K1 = 100;
const opts = (over: Partial<GridOpts> = {}): GridOpts => ({
  k1st: K1, nDays: 30, wd1st: 2, base: 'LIS', now: (K1 + 9) * D + 12 * H,
  midnight: (k) => k * D, dayOf: (t) => Math.floor(t / D), dateOf: (k) => ((k - K1 + 31) % 31) + 1, ...over,
});
const day = (n: number, h = 0) => (K1 + n - 1) * D + h * H;
let fid = 0;
const fl = (from: string, to: string, std: number, sta: number, type: CalFlight['type'] = 'operating'): CalFlight => ({ id: `f${fid++}`, no: `BLU${fid}`, from, to, std, sta, type });
const duty = (start: number, end: number, flights: CalFlight[], extra: Partial<CalBlock> = {}): CalBlock => ({ kind: 'duty', start, end, label: 'Duty', detail: 'd', flights, dutyId: `d${start}`, legality: 'legal', ...extra });
const blk = (kind: CalBlock['kind'], start: number, end: number, extra: Partial<CalBlock> = {}): CalBlock => ({ kind, start, end, label: kind === 'off' ? 'Day off' : kind, detail: kind, ...extra });

describe('stations', () => {
  it('names the far end of a turnaround and the arrival of a one-way duty', () => {
    expect(stationOf({ flights: [fl('LIS', 'CDG', 0, 1), fl('CDG', 'LIS', 2, 3)] })).toBe('CDG');
    expect(stationOf({ flights: [fl('LIS', 'OPO', 0, 1), fl('OPO', 'FAO', 2, 3), fl('FAO', 'LIS', 4, 5)] })).toBe('OPO');
    expect(stationOf({ flights: [fl('LIS', 'SEA', 0, 1)] })).toBe('SEA');
    expect(endAt({ flights: [fl('LIS', 'SEA', 0, 1)] })).toBe('SEA');
    expect(stationOf({ flights: [], at: 'DXB' })).toBe('DXB');
  });
});

describe('monthGrid', () => {
  it('lays out Monday-first weeks with the days of the months around', () => {
    const g = monthGrid([], opts());
    expect(g.weeks.length).toBe(5);
    expect(g.cells[0].k).toBe(K1 - 2);
    expect(g.cells[0].inMonth).toBe(false);
    expect(g.cells[2].date).toBe(1);
    expect(g.cells.find((c) => c.today)?.date).toBe(10);
    expect(g.cells.filter((c) => c.past && c.inMonth).length).toBe(9);
  });

  it('draws a layover trip as one span with a plane and the station on each flying day', () => {
    // Out on the 1st to SEA, rest there, back to LIS on the 3rd landing on the 4th.
    const out = duty(day(1, 9), day(1, 21), [fl('LIS', 'SEA', day(1, 10), day(1, 20))]);
    const rest = blk('rest', day(1, 21), day(3, 8), { at: 'SEA' });
    const back = duty(day(3, 8), day(4, 3), [fl('SEA', 'LIS', day(3, 9), day(4, 2))]);
    const g = monthGrid([out, rest, back], opts());
    const span = g.weeks[0].find((x) => x.type === 'span');
    expect(span && span.type === 'span' && [span.col, span.len, span.kind]).toEqual([2, 4, 'trip']);
    const cells = span && span.type === 'span' ? span.cells : [];
    expect(cells.map((c) => [c.icon, c.code])).toEqual([['plane', 'SEA'], [null, ''], ['plane', 'LIS'], [null, '']]);
    expect(g.owners.get(cells[0].owner!)!.blocks.length).toBe(2);
  });

  it('keeps a same-day turnaround to one tile and names the far station', () => {
    const t = duty(day(2, 6), day(2, 16), [fl('LIS', 'FNC', day(2, 7), day(2, 9)), fl('FNC', 'LIS', day(2, 10), day(2, 12))]);
    const c = monthGrid([t], opts()).cells.find((x) => x.date === 2 && x.inMonth)!;
    expect([c.kind, c.icon, c.code]).toEqual(['trip', 'plane', 'FNC']);
  });

  it('marks riding as a passenger, days off at home (XX) and away, standby and reserve', () => {
    const dh = blk('deadhead', day(5, 8), day(5, 12), { flights: [fl('LIS', 'MAD', day(5, 9), day(5, 11), 'deadhead' as CalFlight['type'])] });
    const g = monthGrid([
      dh,
      blk('off', day(6), day(7), { at: 'MAD' }),
      blk('off', day(8), day(9)),
      blk('standby', day(11, 5), day(11, 17), { sby: 'home', shift: 'E' }),
      blk('standby', day(12, 6), day(12, 18), { sby: 'airport' }),
      blk('standby', day(13, 6), day(13, 18), { sby: 'reserve' }),
      blk('off', day(14), day(15), { label: 'Free' }),
    ], opts());
    const at = (n: number) => g.cells.find((x) => x.inMonth && x.date === n)!;
    expect([at(5).icon, at(5).code]).toEqual(['pax', 'MAD']);
    expect([at(6).kind, at(6).icon, at(6).code]).toEqual(['offAway', 'bed', 'MAD']);
    expect([at(8).kind, at(8).icon, at(8).code]).toEqual(['off', 'house', 'XX']);
    expect([at(11).kind, at(11).code]).toEqual(['sby', 'SBY E']);
    expect([at(12).kind, at(12).icon]).toEqual(['asby', 'tower']);
    expect(at(13).kind).toBe('res');
    expect(at(14).kind).toBe('free');
  });

  it('breaks a trip at a day off away, and a leave window spans its days with a word on the first', () => {
    const a = duty(day(15, 8), day(15, 14), [fl('LIS', 'SGN', day(15, 9), day(15, 13))]);
    const off = blk('off', day(16), day(17), { at: 'SGN' });
    const b = duty(day(17, 8), day(17, 14), [fl('SGN', 'LIS', day(17, 9), day(17, 13))]);
    const leave = blk('leave', day(20), day(25));
    const g = monthGrid([a, off, b, leave], opts());
    const at = (n: number) => g.cells.find((x) => x.inMonth && x.date === n)!;
    expect(at(15).owner).not.toBe(at(17).owner);
    expect(at(16).kind).toBe('offAway');
    expect([at(20).kind, at(20).icon, at(20).code]).toEqual(['leave', 'palm', 'LEAVE']);
    expect([at(21).icon, at(24).kind, at(25).kind]).toEqual([null, 'leave', 'free']);
  });

  it('lets a sick call take the days of the trip it replaces, and splits spans at week ends', () => {
    const t = duty(day(4, 8), day(6, 20), [fl('LIS', 'JFK', day(4, 9), day(4, 17)), fl('JFK', 'LIS', day(6, 9), day(6, 19))]);
    const sick = blk('sick', day(5, 0), day(6, 23));
    const g = monthGrid([t, sick], opts());
    const at = (n: number) => g.cells.find((x) => x.inMonth && x.date === n)!;
    expect([at(4).kind, at(5).kind, at(6).kind]).toEqual(['trip', 'sick', 'sick']);
    // The 1st is a Wednesday: the 5th (Sun) ends week 0, the 6th starts week 1.
    const w0 = g.weeks[0].find((x) => x.type === 'span' && x.kind === 'sick');
    const w1 = g.weeks[1].find((x) => x.type === 'span' && x.kind === 'sick');
    expect(w0 && w0.type === 'span' && [w0.contL, w0.contR]).toEqual([false, true]);
    expect(w1 && w1.type === 'span' && [w1.contL, w1.contR]).toEqual([true, false]);
  });

  it('flags an airport standby on a flying day, a planned extension and the worst legality', () => {
    const t = duty(day(9, 10), day(9, 22), [fl('LIS', 'LHR', day(9, 11), day(9, 13)), fl('LHR', 'LIS', day(9, 14), day(9, 16))], { legality: 'tight' });
    const g = monthGrid([blk('standby', day(9, 5), day(9, 10), { sby: 'airport' }), t], opts({ ext: () => true }));
    const c = g.cells.find((x) => x.inMonth && x.date === 9)!;
    expect([c.kind, c.badge, c.legality]).toEqual(['trip', 'A', 'tight']);
    const g2 = monthGrid([t], opts({ ext: () => true }));
    expect(g2.cells.find((x) => x.inMonth && x.date === 9)!.badge).toBe('+1');
  });

  it('draws days before the kept log as no record', () => {
    const g = monthGrid([blk('off', day(1), day(2))], opts({ keptFrom: K1 + 3 }));
    const at = (n: number) => g.cells.find((x) => x.inMonth && x.date === n)!;
    expect(at(1).kind).toBe('off');
    expect(at(2).kind).toBe('none');
    expect(at(4).kind).toBe('free');
  });
});

describe('monthTotals', () => {
  it('adds block and duty time of the month, flown and planned, from flights or the log', () => {
    const now = day(10, 12);
    const flown = duty(day(3, 8), day(3, 18), [fl('LIS', 'CDG', day(3, 9), day(3, 11)), fl('CDG', 'LIS', day(3, 12), day(3, 14))]);
    const planned = duty(day(20, 8), day(20, 14), [fl('LIS', 'MAD', day(20, 9), day(20, 10) + 15)]);
    const logged = duty(day(2, 6), day(2, 12), []);
    const t = monthTotals([flown, planned, logged, duty(day(31, 8), day(31, 12), [fl('LIS', 'OPO', day(31, 9), day(31, 10))])], day(1), day(31), now, (s) => (s === day(2, 6) ? { block: 150, sectors: 2 } : undefined));
    expect(t.duties).toBe(3);
    expect(t.block).toBe(4 * H + 75 + 150);
    expect(t.blockFlown).toBe(4 * H + 150);
    expect(t.duty).toBe(10 * H + 6 * H + 6 * H);
    expect(t.sectors).toBe(5);
  });
});
