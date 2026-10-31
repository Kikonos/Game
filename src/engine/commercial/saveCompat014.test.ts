// v0.14 save compatibility: an older save (no g.com) loads with the empty record and plays into the tender season;
// a v0.14 state (a bid, a trip, a crisis) survives serialise / deserialise unchanged. SAVE_VERSION stays 1.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { deserialize, serialize } from '../save';
import { fixture } from '../fixtures/compatKit';
import { newGame } from '../contracts/testkit';
import { com } from './state';
import { bidQuote, issueTender, placeBid } from './tenders';
import { bookTrip } from './trips';
import { startCrisis } from './crises';
import { clientByName } from './state';
import { advanceTo } from '../sim';

describe('v0.14 load', () => {
  it('a v0.8 save has no commercial record; it loads with the empty one and plays on', () => {
    const text = fixture('v08');
    const file = JSON.parse(text) as { state: GameState };
    expect(file.state.com).toBeUndefined();
    const g = deserialize(text);
    expect(g.com).toEqual({ tenders: [], trips: [], crises: [] });
    advanceTo(g, g.now + 20 * DAY);
    expect(g.gameOver).toBeNull();
  });

  it('a bid, a trip and a crisis round-trip through the save', () => {
    const g = newGame(51);
    const t = issueTender(g) ?? issueTender(g)!;
    const q = bidQuote(g, t.id)!;
    placeBid(g, t.id, { rate: q.budget, mgh: q.mgh, aircraftId: q.aircraft[0].id, crew: 'ours', start: q.start, end: q.end });
    expect(bookTrip(g, 'ceo', { fairId: 'itb' }).ok).toBe(true);
    startCrisis(g, 'strike', clientByName(g, 'Eurowings')!.id);
    const h = deserialize(serialize(g));
    expect(h.com).toEqual(g.com);
    expect(com(h).tenders[0].bid?.rate).toBe(q.budget);
  });
});
