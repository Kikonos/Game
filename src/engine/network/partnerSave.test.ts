// v0.25 fix: a route partner keeps its own payment terms through a save and load, so the loaded game plays the same.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import { createGame } from '../newGame';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { devLaunchRoute } from '.';
import { seedRisk } from '../contracts/payRisk';
import type { Client, GameState } from '../core/types';

const run = (g: GameState, days: number) => {
  const end = g.now + days * DAY;
  while (g.now < end) advanceTo(g, Math.min(end, g.now + DAY), new Set());
};

describe('v0.25 route partner payment terms', () => {
  it('a partner client is made with its risk tier and keeps 0.85 / [5, 25] after a save and load', () => {
    const g = createGame({ name: 'Test Air', code: 'TA', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'MLA', seed: 5 });
    devLaunchRoute(g, 'MLA-BEN');
    const p = g.clients.cnBM;
    expect(p).toBeDefined();
    expect(p.risk).toBe('high');
    const back = deserialize(serialize(g)).clients.cnBM;
    expect(back.payReliability).toBe(0.85);
    expect(back.lateDays).toEqual([5, 25]);
  });

  it('an older save keeps the partner terms on load (only the tier is added)', () => {
    const c = { id: 'cnBM', name: 'Medsky Airways', kind: 'airline', country: 'LY', payReliability: 0.85, lateDays: [5, 25] } as unknown as Client;
    seedRisk(c);
    expect(c.risk).toBe('high');
    expect(c.payReliability).toBe(0.85);
    expect(c.lateDays).toEqual([5, 25]);
  });

  it('a saved and loaded copy plays the same as the original over 40 days', () => {
    const g = createGame({ name: 'Test Air', code: 'TA', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'MLA', seed: 5 });
    devLaunchRoute(g, 'MLA-BEN');
    run(g, 6);
    const copy = deserialize(serialize(g));
    run(g, 40);
    run(copy, 40);
    expect(copy.rng).toBe(g.rng);
    expect(copy.company.cash).toBe(g.company.cash);
  }, 120_000);
});
