// v0.12 Visual B: a deadhead ticket's boarding pass seat comes from the ids (same pass every time).
import { describe, expect, it } from 'vitest';
import { hashId, passName, seatFor, wideLeg } from './boardingPass';

describe('boarding pass', () => {
  it('gives the same seat for the same ticket, leg and passenger', () => {
    expect(seatFor('f123', 0, 0, false)).toBe(seatFor('f123', 0, 0, false));
    expect(seatFor('f123', 1, 2, true)).toBe(seatFor('f123', 1, 2, true));
    expect(hashId('abc')).toBe(hashId('abc'));
    expect(hashId('abc')).not.toBe(hashId('abd'));
  });
  it('reads like a real seat: a row and a letter (no I on a widebody)', () => {
    for (let t = 0; t < 200; t++) {
      for (let i = 0; i < 12; i++) {
        expect(seatFor(`t${t}`, t % 3, i, false)).toMatch(/^[1-4]\d[A-F]$/);
        expect(seatFor(`t${t}`, t % 3, i, true)).toMatch(/^[3-6]\d[A-HJK]$/);
      }
    }
  });
  it('seats the crew on one ticket side by side, all different', () => {
    const seats = Array.from({ length: 8 }, (_, i) => seatFor('dh-77', 0, i, false));
    expect(new Set(seats).size).toBe(8);
    expect(new Set(seats.slice(0, 6).map((s) => s.slice(0, -1))).size).toBe(1);
  });
  it('prints the name surname first and knows a long leg', () => {
    expect(passName('Pedro', 'Gomes')).toBe('GOMES/PEDRO');
    expect(wideLeg('LIS', 'GRU')).toBe(true);
    expect(wideLeg('LIS', 'MAD')).toBe(false);
  });
});
