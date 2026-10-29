// v0.12 player request: the offer's flights show on each candidate's timeline as ghosts; only a programme without flights
// yet keeps the job block.
import { describe, expect, it } from 'vitest';
import type { ContractOffer } from '../../engine/core/types';
import { blockMinutes } from '../../engine/core/perf';
import { offerGhosts } from './offerPortalLogic';

const legsOffer = (legs: { from: string; to: string; dep: number; flightNo: string }[]) => ({ pattern: { kind: 'legs', legs } }) as unknown as Pick<ContractOffer, 'pattern'>;

describe('v0.12 offer ghosts', () => {
  it('one ghost per revenue leg at the client time, with its real block time, plus the positioning legs', () => {
    const o = legsOffer([{ from: 'BVC', to: 'ZRH', dep: 20_000, flightNo: 'XX2' }, { from: 'ZRH', to: 'BVC', dep: 10_000, flightNo: 'XX1' }]);
    const gs = offerGhosts(o, 'a320ceo', { positionIn: [{ from: 'MAN', to: 'ZRH', std: 9_000, sta: 9_105 }], positionOut: [{ from: 'ZRH', to: 'LIS', std: 21_000, sta: 21_170 }] });
    expect(gs.map((x) => x.kind)).toEqual(['pos', 'rev', 'rev', 'pos']);
    const rev = gs.filter((x) => x.kind === 'rev');
    expect(rev[0].start).toBe(10_000);
    expect(rev[0].end - rev[0].start).toBe(blockMinutes('a320ceo', 'ZRH', 'BVC'));
    expect(rev[0].label).toContain('XX1');
  });
  it('a base programme (no flights yet) has no ghosts: the portal keeps the job block', () => {
    const base = { pattern: { kind: 'base', base: 'HAM', dests: ['PMI'], from: 0, to: 1, targetBH: 100, waves: [360] } } as unknown as Pick<ContractOffer, 'pattern'>;
    expect(offerGhosts(base, 'a320ceo')).toEqual([]);
  });
});
