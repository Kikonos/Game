// v0.12 player request: the offer's flights show on each candidate's timeline as ghosts; only a programme without flights
// yet keeps the job block. Code review: the ghosts are the legs acceptance would book (programmeOf), not a hand-made copy.
import { describe, expect, it } from 'vitest';
import type { ContractOffer } from '../../engine/core/types';
import { programmeOf } from '../../engine/contracts/plan';
import { legsOffer, newGame } from '../../engine/contracts/testkit';
import { DAY, HOUR, dayStart } from '../../engine/core/time';
import { offerGhosts } from './offerPortalLogic';

describe('v0.12 offer ghosts', () => {
  it('match the legs acceptance books (turns, fuel stops, empty legs between legs), plus every positioning leg', () => {
    const g = newGame();
    const t = dayStart(g.now) + 10 * DAY + 8 * HOUR;
    // A→B then C→D: an empty B→C leg in between; a 20-minute client turn gets shifted to the type's minimum.
    const o = legsOffer(g, [['LIS', 'OPO', t], ['FAO', 'MAD', t + 2 * HOUR], ['MAD', 'LIS', t + 3 * HOUR + 20]]);
    const prog = programmeOf(o, 'a320ceo');
    const booked = prog.trips.flatMap((tr) => tr.legs).map((l) => [l.std, l.sta, l.kind === 'positioning' ? 'pos' : 'rev']);
    const ghosts = offerGhosts(o, 'a320ceo', { positionIn: [], positionOut: [], positionAll: [{ from: 'MAN', to: 'LIS', std: t - 4 * HOUR, sta: t - HOUR }, { from: 'LIS', to: 'MAN', std: t + 9 * HOUR, sta: t + 12 * HOUR }] });
    const fromProg = ghosts.filter((x) => x.key.startsWith('g')).map((x) => [x.start, x.end, x.kind]);
    expect(fromProg).toEqual(booked);
    expect(ghosts.some((x) => x.kind === 'pos' && x.label.includes('OPO–FAO'))).toBe(true);
    expect(ghosts.filter((x) => x.key.startsWith('p'))).toHaveLength(2);
  });
  it('a base programme (no flights yet) has only its positioning: the portal keeps the job block', () => {
    const base = { pattern: { kind: 'base', base: 'HAM', dests: ['PMI'], from: 0, to: 1, targetBH: 100, waves: [360] }, requirements: {} } as unknown as Pick<ContractOffer, 'pattern' | 'requirements'>;
    expect(offerGhosts(base, 'a320ceo')).toEqual([]);
    expect(offerGhosts(base, 'a320ceo', { positionIn: [{ from: 'LIS', to: 'HAM', std: 10, sta: 200 }], positionOut: [] })).toHaveLength(1);
  });
});
