// Final debug round: a route rotation another operator flies for us is paid at hand-over but booked in the statement
// when its sectors fly (as ticket cash is held until then), so the hand-over month shows no cost for flying months
// later. Cancelled before it flies, the rival's price comes back less its fee by notice, and the quote says so.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { createGame } from '../newGame';
import { advanceTo } from '../sim';
import { cancelRotation, devLaunchRoute, quoteCancelRotation, subcharterRotation } from '.';

const newGame = (seed = 13) => createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });
const line = (g: GameState) => g.finance.current.lines.subcharter ?? 0;

function handedOver() {
  const g = newGame();
  const ac = Object.values(g.fleet).sort((a, b) => b.cabin.total - a.cabin.total)[0];
  const id = devLaunchRoute(g, 'LIS-OXB', ac.id);
  const r = g.network!.routes[id];
  const rot = r.rotations.filter((x) => x.status === 'planned' && x.dep > g.now + 20 * DAY).sort((a, b) => a.dep - b.dep)[0];
  expect(rot).toBeTruthy();
  const cash0 = g.company.cash;
  const line0 = line(g);
  const cost = subcharterRotation(g, r, rot);
  expect(cost).toBeGreaterThan(0);
  return { g, r, rot, cost, cash0, line0 };
}

describe('a route rotation sub-chartered ahead', () => {
  it('is paid at hand-over and booked when its sectors fly', () => {
    const { g, rot, cost, cash0, line0 } = handedOver();
    expect(cash0 - g.company.cash).toBe(cost);
    expect(line(g)).toBe(line0);
    expect(rot.sectors.reduce((a, s) => a + (s.subPre ?? 0), 0)).toBe(cost);
    // Played past its flying: the price is in the statements of the months it flew.
    const end = rot.dep + 2 * DAY;
    let booked = 0;
    let m = g.finance.current;
    let before = line(g);
    while (g.now < end) {
      advanceTo(g, Math.min(end, g.now + DAY), new Set());
      if (g.finance.current !== m) {
        booked += (m.lines.subcharter ?? 0) - before;
        m = g.finance.current;
        before = 0;
      }
    }
    booked += line(g) - before;
    expect(rot.sectors.every((s) => !s.subPre)).toBe(true);
    expect(booked).toBeLessThanOrEqual(-cost);
  }, 60_000);

  it('cancelled before it flies: its price comes back less the fee, and the quote says so', () => {
    const { g, rot, cost } = handedOver();
    const q = quoteCancelRotation(g, rot.id);
    expect(q.ok).toBe(true);
    expect(q.subFee).toBe(Math.round(cost * 0.1));
    expect(q.subBack).toBe(cost - q.subFee!);
    const cash0 = g.company.cash;
    const line0 = line(g);
    expect(cancelRotation(g, rot.id)).toBe(true);
    // Cash: the price back less the fee, the passengers' refunds out; the statement keeps the fee alone.
    expect(g.company.cash - cash0 + q.refunds + q.cost).toBe(q.subBack);
    expect(line(g) - line0).toBe(-q.subFee!);
    expect(rot.sectors.every((s) => !s.subPre && !s.subCost)).toBe(true);
  });
});
