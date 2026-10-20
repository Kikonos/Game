// Crew audit over a played game: every departure is flown by crew who are at its airport, with its operating
// crew written on the flight, and nobody is on a ticket while operating (review findings #1, #17, #18).

import { describe, expect, it } from 'vitest';
import { acceptOffer, feasibilityAll } from './contracts';
import { DAY } from './core/time';
import type { GameState } from './core/types';
import { createGame } from './newGame';
import { resolveDecision } from './ops';
import { advanceTo } from './sim';

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

function audit(seed: number, days: number): string[] {
  const g = createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });
  const bad: string[] = [];
  const seen = new Set<string>();
  const end = g.started + days * DAY;
  let nextPlay = g.now;
  while (g.now < end && !g.gameOver) {
    if (g.now >= nextPlay) {
      play(g);
      nextPlay = g.now + 6 * 60;
    }
    // Crew positions just before the step (departures in the step are checked against them).
    const loc = new Map(Object.values(g.crew).map((c) => [c.id, c.loc]));
    advanceTo(g, g.now + 15, new Set());
    for (const f of Object.values(g.flights)) {
      if (!f.aircraftId || f.status !== 'enroute' || seen.has(f.id)) continue;
      seen.add(f.id);
      if (!f.crewIds.length) bad.push(`${f.no} ${f.from}-${f.to} departed without crew`);
      for (const id of f.crewIds) if (loc.get(id) !== f.from && g.crew[id]?.loc !== f.from) bad.push(`${f.no} ${f.from}-${f.to}: ${id} at ${g.crew[id]?.loc}`);
      for (const t of Object.values(g.flights)) {
        if (t.kind !== 'deadhead' || t.status !== 'scheduled' || t.std > g.now || t.sta <= (f.atd ?? g.now)) continue;
        for (const id of f.crewIds) if (t.crewIds.includes(id) && g.crew[id]?.loc === t.from) bad.push(`${id} on ticket ${t.from}-${t.to} while operating ${f.no}`);
      }
    }
  }
  bad.push(`departures ${seen.size}`);
  return bad;
}

describe('crew audit', () => {
  it('flies every departure with its crew at the departure airport (seeds 7 and 3, 50 days)', () => {
    for (const seed of [7, 3]) {
      const out = audit(seed, 50);
      expect(Number(out.pop()!.split(' ')[1])).toBeGreaterThan(60);
      expect(out).toEqual([]);
    }
  }, 120_000);
});
