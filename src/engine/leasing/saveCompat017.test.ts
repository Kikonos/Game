// v0.17 lane `deals` (UPDATE-0.17.md §P.2, §P.13): a save with a request open, a deal at the credit check and a
// transition in progress plays on exactly as the straight game; an older save loads with no new card.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { fixture } from '../fixtures/compatKit';
import { problems } from '../problems';
import type { GameState } from '../core/types';
import { dealsOpen, signLease, signLoi } from './deals';
import { sendRfp } from './rfp';
import { newGame, v17Offer } from './deals017.helpers';

const runDays = (g: GameState, d: number) => {
  const end = g.now + d * DAY;
  while (g.now < end) advanceTo(g, Math.min(end, g.now + DAY));
};
const state = (g: GameState) => JSON.stringify(JSON.parse(serialize(g)).state);

function setUp(): GameState {
  const g = newGame(71);
  g.company.cash = 30_000_000;
  sendRfp(g, { typeId: 'a320ceo', band: 'mid', months: 36, count: 1, from: g.now + 120 * DAY, flex: true });
  const a = v17Offer(g, 'a320ceo', 'carlyle');
  signLoi(g, a.id, { autoSign: true });
  const b = v17Offer(g, 'a320ceo', 'aircastle');
  signLoi(g, b.id, { autoSign: true });
  // One straight to its lease (a transition running), one left at the credit check.
  const d = dealsOpen(g)[0];
  d.stage = 'approved';
  d.signBy = g.now + 7 * DAY;
  signLease(g, d.id);
  return g;
}

describe('v0.17 save compatibility (deals)', () => {
  it('a deal at the credit check and a transition in progress: save, load, play on — identical', () => {
    const straight = setUp();
    runDays(straight, 5);
    const saved = serialize(straight);
    runDays(straight, 40);
    const loaded = deserialize(saved);
    runDays(loaded, 40);
    expect(state(loaded)).toBe(state(straight));
    expect(straight.leasing!.deals.some((x) => x.stage === 'signed')).toBe(true);
  });

  it('an older save: leasing defaults, the families on the AOC, no leasing card, plays a week', () => {
    const g = deserialize(fixture('v0162-blu2003'));
    expect(g.leasing).toBeDefined();
    expect(problems(g).filter((c) => ['leaseConditions', 'leaseSign', 'inductionDelay', 'variationNeeded', 'spotReturn'].includes(c.subject.kind))).toEqual([]);
    runDays(g, 7);
    expect(g.leasing!.credit).toBeDefined();
    expect(problems(g).some((c) => c.subject.kind === 'variationNeeded')).toBe(false);
  });
});
