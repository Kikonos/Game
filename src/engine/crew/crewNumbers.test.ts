// v0.10 crew numbers (RESEARCH §15): the minimum cabin crew is the greater of the type's certified floor and one per
// 50 seats per deck, for every type and every cabin preset; optional extra crew stop at the crew seats; crew beyond
// the seats take passenger seats; the 777-200LR is gone and older saves fly theirs as 777-200ERs.

import { describe, expect, it } from 'vitest';
import { ACMI_TYPES, ACMI_TYPES_LIST, type CrewFloor } from '../../data/acmiTypes';
import { cabinPresets } from '../../data/cabins';
import { BAL } from '../core/balance';
import { cabinCrewSeats, cabinMinimum, cockpitSeats, complement, crewInPaxSeats, upperDeckSeats } from '../core/perf';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { crewExtraFor, extraCabinMax } from './extraSeats';
import { fixtureContract, fixtureGame } from './fixtures';

const floorOf = (rows: CrewFloor, n: number): number => {
  if (!rows.length || n <= 0) return 0;
  return (rows.find(([s]) => n <= s) ?? rows[rows.length - 1])[1];
};

describe('minimum cabin crew (v0.10, RESEARCH §15)', () => {
  it('every type has crew data; tables ascend; the crew seats hold the minimum at the exit limit', () => {
    expect(ACMI_TYPES_LIST).toHaveLength(31);
    for (const t of ACMI_TYPES_LIST) {
      expect(t.crew, t.id).toBeDefined();
      for (const rows of [t.crew.floor, t.crew.upper?.floor ?? []]) {
        for (let i = 1; i < rows.length; i++) {
          expect(rows[i][0], t.id).toBeGreaterThan(rows[i - 1][0]);
          expect(rows[i][1], t.id).toBeGreaterThanOrEqual(rows[i - 1][1]);
        }
      }
      expect(cabinCrewSeats(t.id), t.id).toBeGreaterThanOrEqual(cabinMinimum(t.id, t.maxSeats));
      expect(cockpitSeats(t.id), t.id).toBeGreaterThanOrEqual(t.ulr || t.cockpitMin === 4 ? 4 : 3);
      // the cabin presets fit the exit limit
      for (const p of cabinPresets(t.id)) expect(p.j + p.w + p.y, `${t.id} ${p.label}`).toBeLessThanOrEqual(t.maxSeats);
    }
  });

  it('= max(certified floor, ceil(seats / 50)) per deck, for every type and every cabin preset', () => {
    for (const t of ACMI_TYPES_LIST) {
      for (const p of cabinPresets(t.id)) {
        const n = p.j + p.w + p.y;
        const up = upperDeckSeats(t.id, n);
        const main = n - up;
        let want = Math.max(floorOf(t.crew.floor, main), Math.ceil(main / 50));
        if (t.crew.upper && up > 0) want += Math.max(floorOf(t.crew.upper.floor, up), Math.ceil(up / 50));
        const got = cabinMinimum(t.id, n);
        expect(got, `${t.id} ${p.label}`).toBe(want);
        expect(got, `${t.id} ${p.label}`).toBeGreaterThanOrEqual(Math.ceil(n / 50));
        // the complement flies exactly that many cabin crew
        expect(complement(t.id, n).filter((r) => r === 'PUR' || r === 'CC')).toHaveLength(got);
      }
    }
  });

  it('the player\'s A340-200 (8 at 375, 9 above 400) and the TCDS numbers of the big types', () => {
    expect(cabinMinimum('a342', 375)).toBe(8);
    expect(cabinMinimum('a342', 300)).toBe(8);
    expect(cabinMinimum('a342', 420)).toBe(9);
    expect(cabinMinimum('a333', 440)).toBe(9);
    expect(cabinMinimum('b772', 400)).toBe(8);
    expect(cabinMinimum('b77w', 550)).toBe(11);
    expect(cabinMinimum('a35k', 480)).toBe(12);
    // per deck: an A380 never under 16 (main 10 + upper 6), a 747-400 never under 12 (main 11 + upper 1)
    expect(cabinMinimum('a388', 471)).toBe(16);
    expect(cabinMinimum('a388', 868)).toBe(18);
    expect(cabinMinimum('b744', 500)).toBe(13);
    // narrowbodies: the certified numbers equal one per 50 seats
    expect(cabinMinimum('a320ceo', 180)).toBe(4);
    expect(cabinMinimum('b738', 189)).toBe(4);
    expect(cabinMinimum('a321neo', 244)).toBe(5);
    // the 767 has no certified number: one per 50 seats
    expect(cabinMinimum('b763', 267)).toBe(6);
  });
});

describe('crew seats (v0.10)', () => {
  it('optional extra cabin crew stop at the crew seats; the client\'s required crew do not', () => {
    const g = fixtureGame();
    const ac = Object.keys(g.fleet)[0];
    const t = g.fleet[ac].typeId;
    const room = cabinCrewSeats(t) - cabinMinimum(t, g.fleet[ac].cabin.total);
    expect(room).toBeGreaterThanOrEqual(0);
    g.fleet[ac].crewExtra = { cabin: BAL.crewExtra.cabinMax, pilot: 0 };
    expect(crewExtraFor(g, ac, null).cabin).toBe(Math.min(BAL.crewExtra.cabinMax, room));
    expect(extraCabinMax(g, ac)).toBe(Math.min(BAL.crewExtra.cabinMax, room));
    const k = fixtureContract(g, { aircraftIds: [ac], start: g.now, end: g.now + 10 * DAY, pattern: { kind: 'legs', legs: [] } });
    k.requirements.extraCabin = room + 2;
    expect(crewExtraFor(g, ac, k.id).cabin).toBe(room + 2);
    expect(extraCabinMax(g, ac, room + 2)).toBe(room + 2);
  });

  it('crew beyond the crew seats (and pilots beyond the cockpit seats) take passenger seats', () => {
    const roles = complement('a320ceo', 180);
    expect(crewInPaxSeats('a320ceo', roles)).toBe(0);
    const over = [...roles, 'CC', 'CC', 'CC', 'CRP', 'CRP'] as typeof roles;
    // 4 + 3 cabin crew on 6 seats: 1; 4 pilots on 2 + 1 observer seats: 1
    expect(crewInPaxSeats('a320ceo', over)).toBe(2);
    expect(crewInPaxSeats('a35u', complement('a35u', 161, { augment: 2 }))).toBe(0);
  });
});

describe('777-200LR removed (v0.10)', () => {
  it('is not a type any more; an older save\'s 777-200LR airframe, market offer and texts become the 777-200ER', () => {
    expect(ACMI_TYPES.b77l).toBeUndefined();
    const file = JSON.parse(fixture('v08')) as { state: GameState };
    const s = file.state;
    const src = Object.values(s.fleet)[0];
    s.fleet.acLR = { ...structuredClone(src), id: 'acLR', reg: 'CS-TLR', typeId: 'b77l', status: 'available', crewExtra: undefined };
    s.messages.unshift({ ...structuredClone(s.messages[0]), id: 'mLR', title: 'A Boeing 777-200LR (B77L) is on the market' });
    if (s.market.aircraft[0]) s.market.aircraft.push({ ...structuredClone(s.market.aircraft[0]), id: 'moLR', typeId: 'b77l' });
    const g = deserialize(JSON.stringify(file));
    const text = serialize(g);
    expect(text).not.toMatch(/b77l|777-200LR|B77L/);
    expect(g.fleet.acLR.typeId).toBe('b772');
    expect(g.messages.find((m) => m.id === 'mLR')!.title).toBe('A Boeing 777-200ER (B772) is on the market');
    if (g.market.aircraft.some((o) => o.id === 'moLR')) expect(g.market.aircraft.find((o) => o.id === 'moLR')!.typeId).toBe('b772');
    // crew ratings are by family: the 777 crew still fly it
    expect(cabinMinimum('b772', g.fleet.acLR.cabin.total)).toBeGreaterThan(0);
    const end = g.now + 3 * DAY;
    advanceTo(g, end, new Set());
    expect(g.now).toBe(end);
  }, 120_000);
});
