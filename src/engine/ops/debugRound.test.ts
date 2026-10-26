// Debug round (26 Oct 2026) on the player's Blue Airlines save (16 Aug 2027, v0.10.2): BLU404 ACE–LHR is late into
// the Heathrow night curfew on 17 Aug and lands at Gatwick instead (operations' default).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { fixture } from '../fixtures/compatKit';
import type { GameState } from '../core/types';
import { deserialize } from '../save';
import { advanceTo } from '../sim';
import { OPS_LIVE } from './director';

const load = (): GameState => deserialize(fixture('v0102-blue'));
const byNo = (g: GameState, no: string) => Object.values(g.flights).filter((f) => f.no === no);
const msgs = (g: GameState, re: RegExp) => g.messages.filter((m) => re.test(m.title));
/** Plays on in 15-minute steps, as the game screen does. */
const run = (g: GameState, min: number) => {
  const end = g.now + min;
  while (g.now < end) advanceTo(g, Math.min(end, g.now + 15));
};

describe('debug round: Blue Airlines save', () => {
  // The Operations update on, as in the game (src/test/opsSetup.ts turns it off for the older tests).
  beforeAll(() => {
    OPS_LIVE.on = true;
  });
  afterAll(() => {
    OPS_LIVE.on = false;
  });
  it('a curfew diversion is settled at the gate: no second card, no passenger leg into the curfew', () => {
    const g = load();
    run(g, 34 * 60);
    const legs = byNo(g, 'BLU404');
    const div = legs.find((f) => f.div);
    expect(div?.to).toBe('LGW');
    expect(div?.ops).toBe('curfew');
    // The coaches took the passengers: no 'on the ground' card, no revenue continuation LGW–LHR.
    expect(msgs(g, /BLU404 on the ground/)).toEqual([]);
    expect(legs.filter((f) => f.from === 'LGW' && f.kind === 'revenue')).toEqual([]);
  }, 60_000);

  it('a gate decision applied at once is not asked again every half hour', () => {
    const g = load();
    run(g, 34 * 60);
    const div = byNo(g, 'BLU404').find((f) => f.div)!;
    expect(div.status).toBe('done');
    // As before the fix: a passenger leg on to Heathrow at 04:05 UTC with no crew at Gatwick (the diverted crew rest).
    const x = addFlight(g, { no: div.no, aircraftId: div.aircraftId, contractId: div.contractId, kind: 'revenue', from: 'LGW', to: 'LHR', std: div.sta + 110, sta: div.sta + 140, pax: 150 });
    x.contOf = div.id;
    div.contOf = x.id;
    const from = g.now;
    run(g, 12 * 60);
    const asked = g.messages.filter((m) => m.t >= from && /Crew short: BLU404 LGW–LHR/.test(m.title));
    // Before: 20 cards in 10 hours (the leg re-tried 30 min after each wait, its crew 'absent', asked again).
    expect(asked.length).toBeLessThanOrEqual(3);
  }, 60_000);
});
