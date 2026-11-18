// v0.25 r2 passenger letters: rare, text only, a thank-you names a crew member who was aboard, a complaint only after a
// leg 3 h or more late, at most one in 10 days, and no draws from the game RNG.
import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import type { Aircraft, Flight, GameState } from '../core/types';
import { createGame } from '../newGame';
import { passengerLetter } from './letters';

const livery = { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' as const };
const game = () => createGame({ name: 'Blue Airlines', code: 'BL', livery, base: 'LIS', seed: 3 });

function leg(g: GameState, no: string, lateMin: number): Flight {
  const std = g.now - 180 - lateMin;
  return {
    id: `f-${no}`, no, aircraftId: 'a1', contractId: null, kind: 'revenue', from: 'LIS', to: 'FNC',
    std, sta: std + 100, block: 100, crewIds: Object.values(g.crew).slice(0, 6).map((c) => c.id), dutyId: null, status: 'done',
    ata: g.now, delay: 0, schedStd: std,
  } as unknown as Flight;
}

/** Many legs on many days: the letters that came in. */
function run(g: GameState, lateMin: number, days: number) {
  const ac = { cabin: { total: 180 } } as unknown as Aircraft;
  const before = g.messages.length;
  const start = g.now;
  for (let d = 0; d < days; d++) {
    g.now = start + d * DAY;
    for (let i = 0; i < 8; i++) {
      const f = leg(g, `BL${100 + i}`, 0);
      f.std -= lateMin;
      f.schedStd = f.std;
      f.sta = f.std + 100;
      f.ata = f.sta + lateMin;
      passengerLetter(g, f, ac);
    }
  }
  return g.messages.slice(0, g.messages.length - before);
}

describe('v0.25 r2 passenger letters', () => {
  it('thank-you letters are rare, name someone aboard, and never come closer than 10 days apart', () => {
    const g = game();
    expect(Object.values(g.crew).length).toBeGreaterThan(5);
    const rng = JSON.stringify(g.rng);
    const got = run(g, 0, 400);
    expect(got.length).toBeGreaterThan(2);
    expect(got.length).toBeLessThanOrEqual(41);
    for (const m of got) {
      expect(m.title).toMatch(/^Thank-you letter: BL1\d\d$/);
      if (m.ref) expect(Object.values(g.crew).slice(0, 6).map((c) => c.id)).toContain(m.ref.id);
    }
    const ts = got.map((m) => m.t).sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeGreaterThanOrEqual(10 * DAY);
    expect(JSON.stringify(g.rng)).toBe(rng);
  });

  it('a complaint only after a leg 3 hours late, and it says how late', () => {
    const g = game();
    expect(run(g, 120, 200).filter((m) => m.title.startsWith('Passenger complaint'))).toEqual([]);
    const late = run(game(), 200, 60);
    expect(late.length).toBeGreaterThan(0);
    expect(late[0].title).toMatch(/^Passenger complaint: BL1\d\d$/);
    expect(late[0].body).toContain('3h 20m late');
  });
});
