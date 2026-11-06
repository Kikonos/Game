// v0.17 lane `deals` test helpers (not a test file): a new game and a v0.17 lease offer from a named lessor.

import { LESSOR_BY_ID } from '../../data/lessors';
import { devMarketOffer } from '../ops/market';
import { createGame } from '../newGame';
import type { AircraftOffer, GameState, LessorId } from '../core/types';
import { BAL } from '../core/balance';

export const newGame = (seed = 3) => createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });

/** A lease offer on the market as a v0.17 lessor call from `lessor` (terms as rolled, v0.17 fields set). */
export function v17Offer(g: GameState, typeId = 'a320ceo', lessor: LessorId = 'carlyle', patch: Partial<AircraftOffer> = {}): AircraftOffer {
  const id = devMarketOffer(g, typeId, { kind: 'dryLeaseIn' });
  const o = g.market.aircraft.find((x) => x.id === id)!;
  Object.assign(o, {
    source: 'call', lessorId: lessor, lessor: LESSOR_BY_ID[lessor].name, minFH: BAL.v017.terms.minFH.narrow, halfLifeShare: 0.5, expires: g.now + 20 * 1440,
    ...patch,
  });
  return o;
}
