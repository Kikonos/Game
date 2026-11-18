// v0.25 (hunter save m42, from the player's game played on): FR2045 landed 2 minutes late, so the Dublin crew's 12:00
// airline ticket to Nantes left them 9:58 of rest for 10:00. All five came off V7892 NTE–PRG, nobody could replace them
// and the flight was cancelled ($30K). Pinned: crew short only of the rest before their ticket out move to the route's
// next departure after their rest, and the first leg waits for them (crew/roster.ts laterOut); the crew keep the flight.

import { describe, expect, it } from 'vitest';
import type { GameState } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { resolveDecision } from '../ops';
import { deserialize } from '../save';
import { advanceTo } from '../sim';

const CREW = ['c134', 'c13m', 'c14s', 'ct', 'c1tp'];

function playTo(g: GameState, t: number): void {
  while (g.now < t) {
    for (const d of [...g.decisions]) if (d.expires <= g.now + 60) resolveDecision(g, d.id, d.defaultOption);
    advanceTo(g, Math.min(t, g.now + 15), new Set());
  }
}

describe('V7892: a ticket out a 2-minute late landing made too early', () => {
  it('moves to the next departure and the crew keep the flight', () => {
    const g = deserialize(fixture('v0242-v7892'));
    const v = () => Object.values(g.flights).find((f) => f.no === 'V7892' && f.from === 'NTE')!;
    // (7 Sep 21:24: the Volotea extra rotation is accepted at 23:09; FR2045 lands at 00:32, its duty releases at 01:02)
    playTo(g, g.now + 200);
    const std0 = v().std;
    const out0 = Object.values(g.flights).find((f) => f.kind === 'deadhead' && f.from === 'DUB' && f.to === 'NTE' && CREW.every((id) => f.crewIds.includes(id)))!;
    const outStd0 = out0.std;
    playTo(g, g.now + 60);
    const f = v();
    expect(f.status).not.toBe('cancelled');
    for (const id of CREW) expect(f.crewIds).toContain(id);
    const out = Object.values(g.flights).find((x) => x.kind === 'deadhead' && x.from === 'DUB' && x.to === 'NTE' && x.status === 'scheduled' && CREW.every((id) => x.crewIds.includes(id)))!;
    expect(out.std).toBeGreaterThan(outStd0);
    // The wait is no longer than the rest slip (3 h) and the ticket lands before the report.
    expect(f.std - std0).toBeLessThanOrEqual(3 * 60);
    expect(out.sta).toBeLessThanOrEqual(g.duties[f.dutyId!].report);
  });
});
