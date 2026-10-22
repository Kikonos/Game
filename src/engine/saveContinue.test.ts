// Save → reload → continue: a loaded game plays on exactly like the original (clock, queue, flights in the
// air, rosters, money), DESIGN.md §7.2. Both copies get the same player actions.

import { describe, expect, it } from 'vitest';
import { acceptOffer, feasibilityAll } from './contracts';
import { DAY } from './core/time';
import type { GameState } from './core/types';
import { createGame } from './newGame';
import { resolveDecision } from './ops';
import { deserialize, serialize } from './save';
import { advanceTo } from './sim';

const state = (g: GameState) => JSON.stringify((JSON.parse(serialize(g)) as { state: unknown }).state);

/** A small, deterministic player: signs the best workable offer for an idle aircraft, takes decision defaults. */
function play(g: GameState): void {
  for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
  const open = Object.values(g.offers)
    .filter((o) => o.status === 'open' && o.start >= g.now && g.now < o.expires)
    .sort((a, b) => b.estValue - a.estValue || (a.id < b.id ? -1 : 1));
  for (const o of open.slice(0, 3)) {
    const r = feasibilityAll(g, o.id).find((x) => (x.level === 'ok' || x.level === 'warn') && x.estMargin > 0);
    if (r && acceptOffer(g, o.id, [r.aircraftId]).ok) return;
  }
}

function run(g: GameState, until: number): void {
  while (g.now < until) {
    advanceTo(g, Math.min(until, g.now + 6 * 60), new Set());
    play(g);
  }
}

describe('save, reload, continue', () => {
  it('continues identically with flights in the air', () => {
    const g = createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 7 });
    run(g, g.started + 20 * DAY);
    // Step on until an aircraft is airborne (v0.8: up to 30 days; the first programme may start weeks out).
    for (let i = 0; i < 1500 && !Object.values(g.flights).some((f) => f.status === 'enroute' && f.aircraftId); i++) advanceTo(g, g.now + 30, new Set());
    const airborne = Object.values(g.flights).filter((f) => f.status === 'enroute' && f.aircraftId);
    expect(airborne.length).toBeGreaterThan(0);
    expect(Object.keys(g.contracts).length).toBeGreaterThan(0);

    const h = deserialize(serialize(g));
    expect(h.now).toBe(g.now);
    expect(state(h)).toBe(state(g));
    for (const f of airborne) {
      expect(h.flights[f.id].status).toBe('enroute');
      expect(h.fleet[f.aircraftId!].flightId).toBe(f.id);
    }
    expect(h.queue.length).toBeGreaterThan(0);

    const end = g.now + 25 * DAY;
    run(g, end);
    run(h, end);
    expect(h.now).toBe(g.now);
    expect(state(h)).toBe(state(g));
    for (const f of airborne) expect(h.flights[f.id]?.status).toBe(g.flights[f.id]?.status);
  }, 60_000);
});
