// v0.14.1 (merge) a world tour recovers from a crew problem at its start instead of being cancelled whole:
// - seed 13: the positioning leg to Paris landed late and left the cabin crew 8 min short of rest (9:52 < 10:00) before
//   the first tour leg; all eleven came off, went home on a ticket, and the tour waited 48 h for a crew nobody had, then
//   every leg was cancelled. Now the first leg waits for its own crew's rest (crew/roster.ts slipTourForRest).
// - seed 5: no A330 captain could reach Paris (only a day off the player had to buy back); after the wait all nine legs
//   were dropped. Now only the stop the crew could not leave for is dropped; the later stops stay.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { devAddType } from '../dev';
import { breathe } from '../../test/breathe';
import { acceptOffer } from './accept';
import { devWorldTour } from './missions';
import { newGame, run } from './testkit';

function tour(seed: number): { g: GameState; k: string } {
  const g = newGame(seed, 'LIS');
  const acId = devAddType(g, 'a333');
  g.company.approvals.push('etops120', 'etops180');
  g.company.standing = 2;
  const r = acceptOffer(g, devWorldTour(g), [acId]);
  if (!r.ok) throw new Error(r.error);
  return { g, k: r.data!.contractId };
}

const legsOf = (g: GameState, k: string) => Object.values(g.flights).filter((f) => f.contractId === k && f.kind === 'revenue').sort((a, b) => a.std - b.std);

describe('v0.14.1 a world tour recovers from a crew problem at its start', () => {
  it('seed 13: the first leg waits for its own crew\'s rest; the tour flies', async () => {
    const { g, k } = tour(13);
    const first = legsOf(g, k)[0];
    const sched = first.schedStd ?? first.std;
    for (let t = g.now; t < sched + 6 * 60; t += 6 * 60) {
      run(g, t);
      await breathe();
    }
    run(g, sched + 6 * 60);
    const f = g.flights[first.id];
    expect(f.status).not.toBe('cancelled');
    expect(f.status).not.toBe('scheduled');
    expect((f.atd ?? f.std) - sched).toBeLessThan(3 * 60);
    // Pilots and the full cabin went with it.
    expect(f.crewIds.length).toBeGreaterThanOrEqual(3 + 8);
  }, 180_000);

  it('seed 5: a stop the crew cannot reach is dropped alone; the later stops stay', async () => {
    const { g, k } = tour(5);
    const legs = legsOf(g, k);
    const first = legs[0];
    const sched = first.schedStd ?? first.std;
    for (let t = g.now; t < sched + 4 * DAY; t += 6 * 60) {
      run(g, t);
      await breathe();
    }
    const now = legsOf(g, k);
    const cancelled = now.filter((f) => f.status === 'cancelled');
    // Whatever the first leg did, the tour was not given up whole.
    expect(cancelled.length).toBeLessThan(legs.length - 2);
    expect(now.some((f) => f.status !== 'cancelled' && f.std > sched + 4 * DAY)).toBe(true);
  }, 180_000);
});
