// v0.14.1 (CODE-01) replacing a crew member who sits in an extra seat (added above the complement): releaseCrew drops
// an emptied extra seat, and placeCrew wrote into the index it had held (a TypeError, the replaced crew member gone and
// nobody placed). The Duty dialog's Replace and Crew Control's call-out/fly-in both took this path.

import { describe, expect, it } from 'vitest';
import { setSafetyStrict } from '../core/safety';
import type { Duty, GameState } from '../core/types';
import { demoFlights } from '../dev';
import { advanceTo } from '../sim';
import { atomic } from './atomic';
import { fixtureGame } from './fixtures';
import { assignCrew } from './rosterActions';

function withExtraFo(): { g: GameState; d: Duty; extra: string; others: string[] } {
  const g = fixtureGame(5);
  demoFlights(g, undefined, 4, 'revenue');
  advanceTo(g, g.now + 60);
  const d = Object.values(g.duties).filter((x) => x.report > g.now + 6 * 60).sort((a, b) => a.report - b.report)[0];
  const p = g.pairings[d.pairingId];
  const fos = Object.values(g.crew).filter((c) => c.role === 'FO' && !p.slots.some((s) => s.crewId === c.id)).map((c) => c.id);
  for (const id of fos) {
    const r = assignCrew(g, d.id, id, 'FO', { force: true });
    if (r.ok) return { g, d, extra: id, others: fos.filter((x) => x !== id) };
  }
  throw new Error('no FO to add');
}

describe('v0.14.1 replacing a crew member in an extra seat', () => {
  it('the replacement takes the extra seat; nobody is lost', () => {
    const { g, d, extra, others } = withExtraFo();
    const p = g.pairings[d.pairingId];
    const n = p.slots.length;
    expect(p.slots.find((s) => s.crewId === extra)?.extra).toBe(true);
    let r: ReturnType<typeof assignCrew> | null = null;
    let by = '';
    for (const id of others) {
      r = assignCrew(g, d.id, id, 'FO', { replace: extra, force: true });
      if (r.ok) { by = id; break; }
    }
    expect(r?.ok).toBe(true);
    expect(p.slots.length).toBe(n);
    const seat = p.slots.find((s) => s.crewId === by)!;
    expect(seat.extra).toBe(true);
    expect(seat.locked).toBe(true);
    expect(p.slots.some((s) => s.crewId === extra)).toBe(false);
    if (r?.ok) expect(p.slots[r.data!.slot]).toBe(seat);
  });

  it('a crew change that throws half-way is undone (atomic)', () => {
    const { g, d, extra } = withExtraFo();
    const p = g.pairings[d.pairingId];
    const before = JSON.stringify(p.slots);
    const cash = g.cash;
    setSafetyStrict(false);
    const err = console.error;
    console.error = () => {};
    try {
      const r = atomic(g, 'test', (error) => ({ ok: false as const, error }), () => {
        g.pairings[d.pairingId].slots = g.pairings[d.pairingId].slots.filter((s) => s.crewId !== extra);
        g.cash -= 1000;
        throw new Error('boom');
      });
      expect(r.ok).toBe(false);
    } finally {
      setSafetyStrict(true);
      console.error = err;
    }
    expect(JSON.stringify(g.pairings[d.pairingId].slots)).toBe(before);
    expect(g.cash).toBe(cash);
  });
});
