// v0.25 (ops-wait-before-maint-away) a long wait at an outstation before a check or paint shop away from base is spent
// at home: home first, then on to the shop. LZ-UFQ sat at Warsaw from 10 Mar to 11 Apr 2027 before its paint shop at
// Budapest (seed 5 SOF).

import { describe, expect, it } from 'vitest';
import { flightsOf, removeFlights } from '../core/entities';
import { DAY } from '../core/time';
import type { Aircraft, GameState } from '../core/types';
import { scheduleCheck } from '../ops/maintenance';
import { relinkPositioning } from './schedule';
import { AWAY_GAP } from './plan';
import { newGame, owned } from './testkit';

function atMadrid(seed: number): { g: GameState; ac: Aircraft } {
  const g = newGame(seed);
  const ac = owned(g);
  for (const f of Object.values(g.flights)) if (f.aircraftId === ac.id) f.status = 'cancelled';
  for (const m of Object.values(g.maintenance)) if (m.aircraftId === ac.id) m.status = 'cancelled';
  ac.at = 'MAD';
  return { g, ac };
}
const legs = (g: GameState, ac: Aircraft) => flightsOf(g, ac.id).filter((f) => f.status === 'scheduled').sort((a, b) => a.std - b.std);

describe('v0.25 home before a check away from base', () => {
  it('a check a month away at another outstation: the ferry goes home first, then on to the shop', () => {
    const { g, ac } = atMadrid(3);
    const r = scheduleCheck(g, ac.id, 'A', g.now + 30 * DAY, 'FRA');
    if (!r.ok) throw new Error(r.error);
    const m = g.maintenance[r.data!.maintId];
    const fl = legs(g, ac);
    expect(fl[0].from).toBe('MAD');
    expect(fl.some((f) => f.to === 'LIS')).toBe(true);
    expect(fl[fl.length - 1].to).toBe('FRA');
    expect(m.ferryIds).toEqual(fl.map((f) => f.id));
    // No stretch of AWAY_GAP or more on the ground away from base before the check.
    let at = g.now;
    for (const f of fl) {
      if (f.from !== g.company.homeBase) expect(f.std - at).toBeLessThan(AWAY_GAP);
      at = f.sta;
    }
    expect(m.start - at).toBeLessThan(AWAY_GAP);
  });

  it('a check in a few days stays a direct ferry', () => {
    const { g, ac } = atMadrid(3);
    const r = scheduleCheck(g, ac.id, 'A', g.now + 3 * DAY, 'FRA');
    if (!r.ok) throw new Error(r.error);
    expect(legs(g, ac).every((f) => f.to !== 'LIS')).toBe(true);
  });

  it('re-planned as empty legs (no ferry), the move to a check away also goes home first', () => {
    const { g, ac } = atMadrid(3);
    const r = scheduleCheck(g, ac.id, 'A', g.now + 30 * DAY, 'FRA');
    if (!r.ok) throw new Error(r.error);
    removeFlights(g, legs(g, ac).map((f) => f.id));
    g.maintenance[r.data!.maintId].ferryIds = [];
    relinkPositioning(g, ac.id);
    const fl = legs(g, ac);
    expect(fl.length).toBeGreaterThan(1);
    expect(fl[0].from).toBe('MAD');
    expect(fl[0].std - g.now).toBeLessThan(AWAY_GAP);
    expect(fl.some((f) => f.to === 'LIS')).toBe(true);
    expect(fl[fl.length - 1].to).toBe('FRA');
    // Planned again, nothing changes.
    expect(relinkPositioning(g, ac.id)).toEqual([]);
  });
});
