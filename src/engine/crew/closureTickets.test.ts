// v0.12.1 (review): the rule that keeps crew tickets out of closed airports looked only two days ahead (slotAfter), so
// a closure of 3 to 10 days had the dropped ticket home bought again inside it (S1027, Goma closed to 6 Nov: António
// Almeida's GOM–LIS 01:00 dropped and bought again on the same seat).

import { describe, expect, it } from 'vitest';
import { newGame } from '../contracts/testkit';
import { TPL_BY_ID } from '../../data/worldEvents';
import { addDeadhead } from '../core/entities';
import { DAY } from '../core/time';
import type { Duty } from '../core/types';
import { closedAirport, closedUntil, startEvent } from '../ops/world';
import { crewIx, dhBlock } from './timeline';

describe('a ticket home through a long closure (v0.12.1 review)', () => {
  it('is bought again after the reopening, never inside the closure', () => {
    const g = newGame(3);
    const ix = crewIx(g);
    const c = Object.values(g.crew).find((x) => !(ix.pairingsOf.get(x.id) ?? []).length && x.status !== 'onDuty')!;
    expect(c).toBeTruthy();
    c.loc = 'MAD';
    const std = Math.ceil((g.now + 6 * 60) / 60) * 60;
    addDeadhead(g, { crewIds: [c.id], from: 'MAD', to: c.base, std, sta: std + dhBlock('MAD', c.base), cost: 0 });
    const e = startEvent(g, { ...TPL_BY_ID.airspaceIraq, id: 'madClosed', kind: 'strike', at: 'MAD', country: 'ES', zoneId: undefined, closeP: 0, airportDays: [6, 6], days: [6, 6], title: 'Strike closes Madrid', body: '' });
    expect(closedUntil(e) - g.now).toBeGreaterThan(2 * DAY);
    const mine = Object.values(g.flights).filter((f) => f.kind === 'deadhead' && f.status === 'scheduled' && f.crewIds.includes(c.id));
    for (const f of mine) expect(closedAirport(g, f.from, f.std) || closedAirport(g, f.to, f.sta)).toBeNull();
    expect(mine.some((f) => f.from === 'MAD' && f.std >= closedUntil(e))).toBe(true);
  });

  // v0.12.1 (review) S1118 at load: 'duty du1rmr lists missing ticket f1sig': a dropped ticket another duty listed too.
  it('leaves no duty listing a ticket it dropped', () => {
    const g = newGame(3);
    const ix = crewIx(g);
    const c = Object.values(g.crew).find((x) => !(ix.pairingsOf.get(x.id) ?? []).length && x.status !== 'onDuty')!;
    c.loc = 'MAD';
    const std = Math.ceil((g.now + 6 * 60) / 60) * 60;
    const t = addDeadhead(g, { crewIds: [c.id], from: 'MAD', to: c.base, std, sta: std + dhBlock('MAD', c.base), cost: 0 });
    // Another trip's duty lists the same booking (two trips' crew on one ticket).
    const d = { id: 'duX', pairingId: 'pX', report: std + DAY, release: std + DAY + 600, flightIds: [], deadheadIds: [t.id], sectors: 0, fdp: 0, maxFdp: 0, augment: 0, restAt: 'MAD', legality: 'legal', ev: 0, flightsEv: 0 } as Duty;
    g.duties[d.id] = d;
    startEvent(g, { ...TPL_BY_ID.airspaceIraq, id: 'madClosed', kind: 'strike', at: 'MAD', country: 'ES', zoneId: undefined, closeP: 0, airportDays: [6, 6], days: [6, 6], title: 'Strike closes Madrid', body: '' });
    expect(g.flights[t.id]).toBeUndefined();
    for (const x of Object.values(g.duties)) expect(x.deadheadIds.every((id) => g.flights[id])).toBe(true);
  });
});

