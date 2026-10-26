// v0.12 Visual B: the 'Welcome to the fleet' card opens once per delivery, never for the aircraft a new game starts with.
import { describe, expect, it } from 'vitest';
import { newGame } from '../../engine/contracts/testkit';
import { takeCueEvents } from '../../engine/core/cues';
import { DAY } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { acquireAircraft, devMarketOffer } from '../../engine/ops/market';
import { advanceTo } from '../../engine/sim';
import { deliveryCardFor } from './deliveryCard';

/** Plays on to `t` in steps, draining the cues like the store does; the aircraft whose card would open. */
function play(g: GameState, t: number, shown: Set<string>): string[] {
  const cards: string[] = [];
  for (let i = 0; i < 100_000 && g.now < t && !g.gameOver; i++) {
    advanceTo(g, Math.min(t, g.now + 6 * 60));
    for (const e of takeCueEvents()) {
      const id = deliveryCardFor(g, e, shown);
      if (id) { shown.add(id); cards.push(id); }
    }
  }
  return cards;
}

describe('delivery card', () => {
  it('never opens for the fleet a new game starts with', () => {
    takeCueEvents();
    const g = newGame(1);
    const shown = new Set<string>();
    for (const e of takeCueEvents()) expect(deliveryCardFor(g, e, shown)).toBeNull();
    for (const ac of Object.values(g.fleet)) expect(deliveryCardFor(g, { cue: 'delivered', ref: { kind: 'aircraft', id: ac.id } }, shown)).toBeNull();
    expect(play(g, g.now + 5 * DAY, shown)).toEqual([]);
  });

  it('opens once for a handover abroad, not again when the ferry lands home', () => {
    takeCueEvents();
    const g = newGame(2);
    g.company.cash = 60_000_000;
    const r = acquireAircraft(g, devMarketOffer(g, 'a320ceo', { kind: 'dryLeaseIn', site: 'SCL' }));
    if (!r.ok) throw new Error(r.error);
    const id = r.data!.aircraftId;
    const ac = g.fleet[id];
    const shown = new Set<string>();
    expect(play(g, (ac.delivery?.handover ?? g.now) + 1, shown)).toEqual([id]);
    // On to the ferry home and well after: no second card.
    expect(play(g, g.now + 12 * DAY, shown)).toEqual([]);
    expect(ac.delivery?.arrived).toBeDefined();
    // The same cue again (a duplicate) is already shown.
    expect(deliveryCardFor(g, { cue: 'delivered', ref: { kind: 'aircraft', id } }, shown)).toBeNull();
  });

  it('ignores other cues and aircraft that are gone', () => {
    const g = newGame(1);
    expect(deliveryCardFor(g, { cue: 'achievement', ref: { kind: 'aircraft', id: Object.keys(g.fleet)[0] } }, new Set())).toBeNull();
    expect(deliveryCardFor(g, { cue: 'delivered', ref: { kind: 'aircraft', id: 'nope' } }, new Set())).toBeNull();
  });
});
