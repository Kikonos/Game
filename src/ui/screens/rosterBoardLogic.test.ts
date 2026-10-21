import { describe, expect, it } from 'vitest';
import { DAY } from '../../engine/core/time';
import type { CrewMember, Role } from '../../engine/core/types';
import type { CalBlock, DropTarget } from '../../engine/crew';
import {
  blockCands, boardItems, boardLayout, dayCodes, dayWidth, dayWindow, edgeSpeed, fitText, GROUP_H, itemAt, LEFT_W, matchBoard, moraleTone, NO_BOARD_FILTER,
  ROW_H, verdictText, visibleRange, weekLabels, workCode,
} from './rosterBoardLogic';

const crew = (id: string, role: Role, base = 'LIS', ratings = ['A320'], last = id): CrewMember =>
  ({ id, role, base, loc: base, ratings, first: 'Ana', last } as unknown as CrewMember);

const fl = (no: string, from: string, to: string, type: 'operating' | 'positioning' | 'ferry' = 'operating') => ({ id: no, no, from, to, std: 0, sta: 60, type });
const blk = (p: Partial<CalBlock>): CalBlock => ({ kind: 'duty', start: 0, end: 60, label: 'Duty', detail: '', ...p });

describe('roster board groups', () => {
  const list = [
    crew('a', 'CC', 'LIS', ['A320'], 'Zeta'), crew('b', 'CPT', 'LIS', ['A320'], 'Alves'), crew('c', 'CPT', 'HAM', ['A320'], 'Berg'),
    crew('d', 'FO', 'LIS', ['A330/340'], 'Cruz'), crew('e', 'CPT', 'LIS', ['A320'], 'Abreu'),
  ];
  it('groups by base › rank › type, home base first, surnames sorted', () => {
    const items = boardItems(list, NO_BOARD_FILTER, 'LIS');
    const heads = items.filter((x) => x.kind === 'group').map((x) => x.kind === 'group' && x.label);
    expect(heads).toEqual(['LIS · Captains · A320 (2)', 'LIS · First officers · A330 (1)', 'LIS · Cabin crew · A320 (1)', 'HAM · Captains · A320 (1)']);
    expect(items.slice(1, 3).map((x) => x.kind === 'crew' && x.id)).toEqual(['e', 'b']);
  });
  it('filters base, rank group, role, type and search', () => {
    expect(list.filter((c) => matchBoard(c, { ...NO_BOARD_FILTER, rank: 'pilots' })).map((c) => c.id)).toEqual(['b', 'c', 'd', 'e']);
    expect(list.filter((c) => matchBoard(c, { ...NO_BOARD_FILTER, rank: 'cabin' })).map((c) => c.id)).toEqual(['a']);
    expect(list.filter((c) => matchBoard(c, { ...NO_BOARD_FILTER, base: 'HAM' })).map((c) => c.id)).toEqual(['c']);
    expect(list.filter((c) => matchBoard(c, { ...NO_BOARD_FILTER, family: 'A330/340' })).map((c) => c.id)).toEqual(['d']);
    expect(list.filter((c) => matchBoard(c, { ...NO_BOARD_FILTER, q: 'ber' })).map((c) => c.id)).toEqual(['c']);
  });
});

describe('roster board layout', () => {
  const items = boardItems(Array.from({ length: 120 }, (_, i) => crew(`c${i}`, i % 2 ? 'CC' : 'CPT', i % 3 ? 'LIS' : 'HAM')), NO_BOARD_FILTER, 'LIS');
  const { tops, total } = boardLayout(items);
  it('offsets rows and group headers', () => {
    expect(tops[0]).toBe(0);
    expect(tops[1]).toBe(GROUP_H);
    expect(total).toBe(120 * ROW_H + 4 * GROUP_H);
    expect(boardLayout(items, 44).total).toBe(120 * ROW_H + 4 * 44);
  });
  it('finds the item under y', () => {
    expect(itemAt(tops, total, -1)).toBe(-1);
    expect(itemAt(tops, total, 0)).toBe(0);
    expect(itemAt(tops, total, GROUP_H + 1)).toBe(1);
    expect(itemAt(tops, total, total - 1)).toBe(items.length - 1);
    expect(itemAt(tops, total, total)).toBe(-1);
  });
  it('visible window: overscan and snapping keep re-renders rare', () => {
    const [a, b] = visibleRange(tops, total, 0, 600);
    expect(a).toBe(0);
    expect(b % 4).toBe(0);
    expect(b).toBeGreaterThanOrEqual(itemAt(tops, total, 600) + 6);
    // A small scroll stays in the same window.
    expect(visibleRange(tops, total, 1000, 600)).toEqual(visibleRange(tops, total, 1010, 600));
    const [c, d] = visibleRange(tops, total, total - 300, 600);
    expect(d).toBe(items.length);
    expect(c).toBeGreaterThan(0);
  });
});

describe('roster board days and text', () => {
  it('day widths: a week or a month in view, legible minimums', () => {
    expect(dayWidth('week', LEFT_W + 7 * 120)).toBe(120);
    expect(dayWidth('month', LEFT_W + 31 * 28)).toBe(28);
    expect(dayWidth('month', 400)).toBe(26);
    expect(dayWidth('week', 400)).toBe(96);
  });
  it('day window with overscan, snapped to 2 days, clamped', () => {
    expect(dayWindow(0, LEFT_W + 700, 100)).toEqual([0, 10]);
    expect(dayWindow(1000, LEFT_W + 700, 100)).toEqual([8, 20]);
    expect(dayWindow(10_000, LEFT_W + 700, 100, 49)).toEqual([49, 49]);
  });
  it('text only when it fits whole, longest first', () => {
    const duty = blk({ flights: [fl('NB2341', 'HAM', 'PMI'), fl('NB2342', 'PMI', 'HAM')] });
    expect(blockCands(duty)).toEqual(['NB2341 HAM–PMI–HAM', 'NB2341 HAM–PMI', 'HAM–PMI–HAM', 'NB2341 PMI', 'PMI']);
    const w = (s: string) => s.length * 7;
    expect(fitText(blockCands(duty), 200, w)).toBe('NB2341 HAM–PMI–HAM');
    expect(fitText(blockCands(duty), 100, w)).toBe('HAM–PMI–HAM');
    expect(fitText(blockCands(duty), 40, w)).toBe('PMI');
    expect(fitText(blockCands(duty), 20, w)).toBe('');
    expect(blockCands(blk({ kind: 'deadhead', flights: [fl('TP1', 'LIS', 'HAM')] }))[0]).toBe('DH LIS–HAM');
    expect(blockCands(blk({ kind: 'training', label: 'Conversion A330' }))).toEqual(['Conversion A330', 'CONV']);
    expect(blockCands(blk({ kind: 'off', label: 'Day off' }))).toEqual(['OFF']);
    expect(blockCands(blk({ kind: 'off', label: 'Free' }))).toEqual([]);
    expect(blockCands(blk({ kind: 'leave', label: 'Left' }))).toEqual(['Left']);
  });
  it('month codes: first destination of a duty, travel codes, one per day (duty first)', () => {
    expect(workCode(blk({ flights: [fl('X1', 'LIS', 'PMI'), fl('X2', 'PMI', 'LIS')] }))).toBe('PMI');
    expect(workCode(blk({ flights: [fl('F1', 'LIS', 'OPO', 'ferry')] }))).toBe('FRY');
    expect(workCode(blk({ kind: 'positioning' }))).toBe('POS');
    expect(workCode(blk({ kind: 'off' }))).toBe('');
    const from = 0;
    const codes = dayCodes([
      blk({ kind: 'deadhead', start: 60, end: 120, flights: [fl('TP1', 'LIS', 'HAM')] }),
      blk({ start: 300, end: 900, flights: [fl('X1', 'HAM', 'PMI')] }),
      blk({ start: DAY + 60, end: DAY + 600, flights: [fl('X3', 'LIS', 'AGP')] }),
      blk({ start: 60 * DAY, end: 60 * DAY + 60, flights: [fl('X9', 'LIS', 'FAO')] }),
    ], from, 49);
    expect(codes).toEqual([{ day: 0, code: 'PMI', key: 'operating', i: 1 }, { day: 1, code: 'AGP', key: 'operating', i: 2 }]);
  });
});

describe('week labels', () => {
  const w = (s: string) => s.length * 7;
  it('a short duty labels itself in the free lane after it, with a 44 px hit area', () => {
    // 120 px/day: a 3 h duty is 15 px wide; its day (120 px) takes 'NB2341 HAM–PMI' (108 px), shifted left to fit.
    const duty = blk({ start: 6 * 60, end: 9 * 60, flights: [fl('NB2341', 'HAM', 'PMI'), fl('NB2342', 'PMI', 'HAM')] });
    const [l] = weekLabels([duty], 0, 120, w);
    expect(l.text).toBe('NB2341 HAM–PMI');
    expect(l.lx).toBeCloseTo(12);
    expect(l.hw).toBeGreaterThanOrEqual(44);
    // A wider day takes the flight number too.
    expect(weekLabels([duty], 0, 200, w)[0].text).toBe('NB2341 HAM–PMI–HAM');
  });
  it('labels never overlap the next block; deadheads get DH and the route', () => {
    const dh = blk({ kind: 'deadhead', start: 60, end: 180, flights: [fl('TP1', 'LIS', 'FCO')] });
    const duty = blk({ start: 300, end: 600, flights: [fl('AWQ121', 'FCO', 'LIS')] });
    const ls = weekLabels([dh, duty], 0, DAY, w); // 1 px per minute
    expect(ls[0].text).toBe('DH LIS–FCO');
    expect(ls[0].lx + ls[0].lw).toBeLessThanOrEqual(300);
    expect(ls[1].text).toBe('AWQ121 FCO–LIS');
    expect(ls[1].hx).toBeGreaterThanOrEqual(ls[0].hx + ls[0].hw - 0.01);
  });
  it('days off and rest get no label', () => {
    expect(weekLabels([blk({ kind: 'off', label: 'Day off', start: 0, end: DAY }), blk({ kind: 'rest', start: 0, end: 600 })], 0, 120, w)).toEqual([]);
  });
});

describe('drag verdicts', () => {
  const t = (p: Partial<DropTarget>): DropTarget => ({ crewId: 'x', level: 'legal', kind: 'assign', reason: 'Legal · ticket $250', ticket: 250, lateChange: false, ...p });
  it('labels the bubble', () => {
    expect(verdictText(t({}))).toBe('✓ Legal · ticket $250');
    expect(verdictText(t({ level: 'illegal', reason: 'Rest before next duty 11:30 < 12:00' }))).toBe('✗ Rest before next duty 11:30 < 12:00');
    expect(verdictText(t({ level: 'ineligible', kind: 'none', reason: 'Not rated A330', lateChange: true }))).toBe('✗ Not rated A330');
    expect(verdictText(t({ kind: 'swap', reason: 'Swap with NB2345 HAM–PMI (both legal)', lateChange: true }))).toBe('Swap with NB2345 HAM–PMI (both legal) · Late change: morale −2');
    expect(verdictText(undefined)).toBe('');
  });
  it('auto-scroll speed near the edges only', () => {
    expect(edgeSpeed(300, 100, 700)).toBe(0);
    expect(edgeSpeed(100, 100, 700)).toBe(-600);
    expect(edgeSpeed(124, 100, 700)).toBe(-300);
    expect(edgeSpeed(700, 100, 700)).toBe(600);
  });
  it('morale tones', () => {
    expect([moraleTone(72), moraleTone(60), moraleTone(59), moraleTone(40), moraleTone(39)]).toEqual(['good', 'good', 'warn', 'warn', 'bad']);
  });
});
