// Leftover-breach round (27 Oct 2026), invariant seed 1 (365 d): a duty's legs retimed out of order (a return leg moved
// ahead of its outbound, the aircraft elsewhere): the duty kept both, its first listed leg was not the first flown, and
// its crew 'flew' out of Innsbruck while in London (the gate checks the crew's place at a duty's first leg). A duty whose
// legs no longer run in order, airport to airport, is taken apart before any of them flies and the legs planned afresh.

import { describe, expect, it } from 'vitest';
import { addFlight, retimeFlight } from '../core/entities';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import { settle } from '../sim';
import { buildDuties } from './duties';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { autoRoster } from './roster';

describe('a duty whose legs no longer run in order', () => {
  it('is taken apart before they fly: no duty holds legs out of order or not joined airport to airport', () => {
    const g = fixtureGame(31);
    const acId = Object.keys(g.fleet)[0];
    const ac = g.fleet[acId];
    ac.at = 'LIS';
    const std = Math.floor(g.now / DAY) * DAY + 3 * DAY + 9 * 60;
    const b = blockMinutes(ac.typeId, 'LIS', 'FNC');
    const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [acId], start: std - DAY, end: std + 2 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false } });
    const out = addFlight(g, { no: 'AW930', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'LIS', to: 'FNC', std, sta: std + b, pax: 170 });
    const back = addFlight(g, { no: 'AW931', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'FNC', to: 'LIS', std: std + b + 50, sta: std + 2 * b + 50, pax: 160 });
    buildDuties(g, acId, g.now, g.now + 5 * DAY);
    for (const id of addCrew(g, { CPT: 2, FO: 2, PUR: 1, CC: 3 })) g.crew[id].off = [];
    autoRoster(g);
    const d0 = g.flights[out.id].dutyId!;
    expect(g.duties[d0].flightIds).toEqual([out.id, back.id]);
    // The outbound slips 8 h; the return is retimed earlier than its outbound now lands.
    retimeFlight(g, g.flights[out.id], std + 8 * 60, std + 8 * 60 + b);
    retimeFlight(g, g.flights[back.id], std + 3 * 60, std + 3 * 60 + b);
    settle(g);
    for (const d of Object.values(g.duties)) {
      if (d.done) continue;
      const fl = d.flightIds.map((id) => g.flights[id]).filter(Boolean);
      for (let i = 1; i < fl.length; i++) {
        expect(fl[i].std, `${d.id}: ${fl[i].no} after ${fl[i - 1].no}`).toBeGreaterThanOrEqual(fl[i - 1].sta);
        expect(fl[i].from, `${d.id}: ${fl[i].no} from where ${fl[i - 1].no} lands`).toBe(fl[i - 1].to);
      }
    }
  });
});

