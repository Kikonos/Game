// v0.12 Visual B: the hangar line-up is to scale (real lengths) and biggest first.
import { describe, expect, it } from 'vitest';
import { LENGTH_M, metresPerPx } from '../components/aircraft/sprites';
import { artViewBox } from '../components/AircraftArt';
import { hangarOrder, hangarScale } from './hangarLogic';

const ac = (id: string, typeId: string, reg = id.toUpperCase()) => ({ id, reg, typeId, variant: undefined as string | undefined, name: undefined as string | undefined });

describe('hangar line-up', () => {
  it('orders by real length, longest first (747-8 before A380 before 777-200 before A320)', () => {
    const order = hangarOrder([ac('a', 'a320ceo'), ac('b', 'a388'), ac('c', 'b748'), ac('d', 'b772'), ac('e', 'b738')]);
    expect(order.map((x) => x.typeId)).toEqual(['b748', 'a388', 'b772', 'b738', 'a320ceo']);
    for (let i = 1; i < order.length; i++) expect(order[i - 1].lengthM).toBeGreaterThanOrEqual(order[i].lengthM);
  });
  it('keeps one scale: each aircraft drawn as long as its real length times the hangar scale', () => {
    const k = hangarScale(1000);
    // AircraftArt at pxPerM: the sprite frame is vb.w · metresPerPx · k px wide; the aircraft (nose to tail) is lengthM · k.
    const drawn = (sprite: string) => artViewBox(sprite).w * metresPerPx(sprite) * k;
    expect(drawn('a320ceo')).toBeLessThan(drawn('b748'));
    expect(drawn('a320ceo')).toBeLessThan(drawn('a388'));
    // an A320 is about half a 747-8 (37.6 m vs 76.3 m)
    expect(LENGTH_M.a320ceo / LENGTH_M.b748).toBeCloseTo(0.49, 1);
  });
  it('sorts equal lengths by registration and a lone aircraft is still a line-up', () => {
    expect(hangarOrder([ac('x', 'a320ceo', 'CS-TQB'), ac('y', 'a320ceo', 'CS-TQA')]).map((x) => x.reg)).toEqual(['CS-TQA', 'CS-TQB']);
    expect(hangarOrder([ac('x', 'a332')])).toHaveLength(1);
  });
  it('picks a scale that fits three jumbos a row on an iPad and stays readable on a narrow screen', () => {
    expect(hangarScale(1050) * 84 * 3).toBeLessThan(1050);
    expect(hangarScale(300)).toBeGreaterThanOrEqual(2.8);
  });
  it('draws a small fleet larger (one scale for all of it) and a big one at the base scale', () => {
    const two = hangarScale(1050, [37.6, 37.6]);
    expect(two).toBeGreaterThan(hangarScale(1050));
    expect(37.6 * 1.12 * 2 * two).toBeLessThan(1050);
    const thirty = hangarScale(1050, Array.from({ length: 30 }, (_, i) => 38 + i));
    expect(thirty).toBeCloseTo(hangarScale(1050), 5);
    // a 747 beside an A320 still twice its length on screen
    const mix = hangarScale(1050, [76.3, 37.6]);
    expect(76.3 * mix / (37.6 * mix)).toBeCloseTo(2.03, 1);
  });
});
