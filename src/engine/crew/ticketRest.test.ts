// Debug round (26 Oct 2026): the rest after a ticket on its own counts the time zones like the rest after a duty
// (14 h away after 4 or more): crew ticketed Lisbon–San Juan (13:25 door to door) were rostered on a duty from San
// Juan 13:45 after landing (seed 1, January).

import { describe, expect, it } from 'vitest';
import { fromUTC } from '../core/time';
import { createGame } from '../newGame';
import { posSeg } from './timeline';

describe('rest after a ticket', () => {
  it('is 14 h away after crossing 4+ time zones, 10 h (or the ticket) otherwise', () => {
    const g = createGame({ name: 'Tz Air', code: 'TZ', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 3 });
    const c = Object.values(g.crew)[0];
    const std = fromUTC(2028, 1, 17, 15, 0);
    expect(posSeg({ from: 'LIS', to: 'SJU', std, sta: std + 8 * 60 }, c).rest).toBe(14 * 60);
    expect(posSeg({ from: 'LIS', to: 'MAD', std, sta: std + 75 }, c).rest).toBe(10 * 60);
    expect(posSeg({ from: 'MAD', to: 'LIS', std, sta: std + 75 }, c).rest).toBe(12 * 60);
  });
});
