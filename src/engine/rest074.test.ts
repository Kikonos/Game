// v0.7.4 crew rest: curtained economy seats on every aircraft (class 3), curtained business seats with a business
// cabin (class 2) that follow the CURRENT cabin, no bunks on the 767-300ER, bunks always as a pair, and the load
// migration of a v0.7.3-shaped save (bunks taken off a 767 with a message and its long duties re-planned).

import { describe, expect, it } from 'vitest';
import { ACMI_TYPES_LIST } from '../data/acmiTypes';
import { addAircraft, newGame, owned, run } from './contracts/testkit';
import { addFlight } from './core/entities';
import { DAY } from './core/time';
import type { GameState } from './core/types';
import { rerosterFrom } from './crew';
import { dutyNeed } from './crew/duties';
import { addCrew } from './crew/fixtures';
import { bunksFor, effectiveRest, fittedRest, longestDay, migrateRest, restOf, restPlan, rollRestFor } from './crew/restPlan';
import { bookRefit, restRefitOptions } from './ops/cabin';
import { devMarketOffer } from './ops/market';
import { deserialize, serialize } from './save';
import { settle } from './sim';

const paired = (r: { fc: { cls: number } | null; cc: { cls: number } | null }) => (r.fc?.cls === 1) === (r.cc?.cls === 1);

describe('seat rest on every aircraft (v0.7.4)', () => {
  it('a narrowbody rests its crew in curtained economy seats (class 3); the longest day line is short', () => {
    const g = newGame(5);
    const ac = owned(g);
    expect(restOf(g, ac.id)).toEqual({ fc: { cls: 3, kind: 'ySeats', places: 2 }, cc: { cls: 3, kind: 'ySeats', places: 2 } });
    // 13 h with 2 pilots; up to 15 h with 4 pilots on class 3 seats (no 9 h sector on an A320: no long-sector bonus)
    expect(longestDay(g, restOf(g, ac.id), ac.typeId).text).toBe('Longest day: 13 h · up to 15 h');
    expect(longestDay(g, restOf(g, ac.id), ac.typeId).detail).toMatch(/14 h as a planned extension.*Augmented crew approval/);
    // the seats are not a fitted facility: nothing stored, nothing lost from the cabin
    expect(ac.rest).toEqual({ fc: null, cc: null });
    expect(ac.cabin.total).toBe(180);
  });

  it('a narrowbody can fly a 3-pilot day on economy seats where the cruise allows the 90/120 min rest', () => {
    const g = newGame(5);
    g.company.approvals.push('augmented');
    const lr = addAircraft(g, 'a321neo');
    const day = Math.floor(g.now / DAY) * DAY + 3 * DAY;
    // an evening report, two 6 h legs: over the no-rest limit, within 14 h with 3 pilots
    const chain = { from: 'LIS', std: day + 20 * 60, legs: [{ std: day + 20 * 60, sta: day + 26 * 60, from: 'LIS', to: 'KEF' }, { std: day + 26 * 60 + 50, sta: day + 32 * 60 + 30, from: 'KEF', to: 'LIS' }] };
    const n = dutyNeed(g, lr.typeId, restOf(g, lr.id), chain);
    expect(n.mode).toBe('aug1');
    expect(n.plan?.ok).toBe(true);
    expect(n.text).toMatch(/^Economy seats \(class 3\) → 3 pilots, 14 h limit ✓ · \d+ economy seats blocked on the long legs/);
    // a day with only short legs: no rest possible (the cruise is too short)
    const short = { from: 'LIS', std: day + 20 * 60, legs: [0, 1, 2].map((i) => ({ std: day + 20 * 60 + i * 290, sta: day + 20 * 60 + i * 290 + 240, from: 'LIS', to: 'LIS' })) };
    expect(dutyNeed(g, lr.typeId, restOf(g, lr.id), { ...short, legs: short.legs.map((l) => ({ ...l, sta: l.std + 250 })) }).mode).not.toBe('aug1');
  });

  it('a two-class refit turns business-seat rest (class 2) on; back to all economy turns it off', () => {
    const g = newGame(6);
    const ac = owned(g);
    const r = bookRefit(g, ac.id, '12J/156Y', 'LIS', g.now + 2 * DAY);
    if (!r.ok) throw new Error(r.error);
    expect(g.maintenance[r.data!.maintId].end - g.maintenance[r.data!.maintId].start).toBe(2 * DAY);
    run(g, g.maintenance[r.data!.maintId].end + 60);
    expect(ac.cabin.label).toBe('12J/156Y');
    expect(restOf(g, ac.id).cc).toMatchObject({ cls: 2, kind: 'jSeats' });
    expect(restOf(g, ac.id).fc).toMatchObject({ cls: 2, kind: 'jSeats', places: 2 });
    expect(g.messages.some((m) => /Crew rest now in business seats \(class 2\)/.test(m.body))).toBe(true);
    // the seat total still counts every seat
    expect(ac.cabin.total).toBe(168);
    const back = bookRefit(g, ac.id, '180Y', 'LIS', g.now + DAY);
    if (!back.ok) throw new Error(back.error);
    run(g, g.maintenance[back.data!.maintId].end + 60);
    expect(restOf(g, ac.id).cc).toMatchObject({ cls: 3, kind: 'ySeats' });
  });

  it('effective rest: fitted bunks or recliners win a tie over seats; seats fill a side with nothing fitted', () => {
    const cab = { j: 18 };
    expect(effectiveRest('a332', cab, bunksFor('a332'))).toEqual(bunksFor('a332'));
    expect(effectiveRest('a332', cab, { fc: null, cc: null }).cc).toMatchObject({ cls: 2, kind: 'jSeats' });
    expect(effectiveRest('a332', { j: 0 }, { fc: { cls: 2, kind: 'recliners', places: 2 }, cc: { cls: 2, kind: 'recliners', places: 5 } }).cc?.kind).toBe('recliners');
    expect(effectiveRest('a332', cab, { fc: { cls: 2, kind: 'recliners', places: 2 }, cc: null }).cc?.kind).toBe('jSeats');
  });
});

describe('bunks as a pair; never on the 767 (v0.7.4)', () => {
  it('the market, the start fleet and fittedRest never hold one kind of bunk alone; the 767 has none', () => {
    const g = newGame(9);
    for (const ac of Object.values(g.fleet)) expect(paired(ac.rest ?? migrateRest(ac))).toBe(true);
    for (const t of ACMI_TYPES_LIST.filter((x) => x.body === 'wide')) {
      for (let i = 0; i < 25; i++) {
        const id = devMarketOffer(g, t.id);
        const o = g.market.aircraft.find((x) => x.id === id)!;
        expect(paired(o.rest!), t.id).toBe(true);
        if (t.id === 'b763') expect(o.rest).toEqual({ fc: null, cc: null });
        g.market.aircraft = g.market.aircraft.filter((x) => x.id !== id);
      }
      for (let i = 0; i < 50; i++) expect(paired(rollRestFor(`x${i}`, t.id, t.cabins[0].j))).toBe(true);
    }
    // pilots' bunks only → the cabin crew bunks are added; cabin crew bunks only → the pilots' room
    expect(fittedRest('a332', { fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 2, kind: 'jSeats', places: 5 } })).toEqual(bunksFor('a332'));
    expect(fittedRest('b772', { fc: null, cc: { cls: 1, kind: 'ccrc', places: 8 } })).toEqual(bunksFor('b772'));
    expect(fittedRest('b763', bunksFor('b763'), true)).toEqual({ fc: null, cc: null });
    // the bunk refit is one option for both crews (an A330 without bunks); none for a 767
    const a = addAircraft(g, 'a332');
    a.rest = { fc: null, cc: null };
    expect(restRefitOptions(g, a.id).filter((o) => o.cls === 1).map((o) => [o.id, o.side])).toEqual([['fcrc', 'both']]);
    const b = addAircraft(g, 'b763');
    b.cabin = { j: 0, w: 0, y: 309, total: 309, label: '309Y', layout: 'all-economy' };
    expect(restRefitOptions(g, b.id).map((o) => o.id)).toEqual(['recliners']);
  });
});

/** A v0.7.3-shaped game: a 767 the game gave bunks (and an A330 with pilot bunks only), a 12:30 LIS–GRU flight on the 767 two days out, rostered with 3 pilots in bunks. */
function v073Save(): { text: string; reg: string; flightId: string } {
  const g = newGame(12);
  g.company.approvals.push('widebody', 'augmented');
  const b = addAircraft(g, 'b763');
  b.rest = { fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 1, kind: 'ldmcr', places: 6 } };
  delete b.restV;
  const a = addAircraft(g, 'a332');
  a.rest = { fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 2, kind: 'jSeats', places: 5 } };
  delete a.restV;
  for (const ac of Object.values(g.fleet)) delete ac.restV;
  addCrew(g, { CPT: 6, FO: 8, PUR: 4, CC: 30 }, 'B757/767');
  const std = Math.ceil((g.now + 2 * DAY) / 60) * 60;
  const f = addFlight(g, { no: 'AW801', aircraftId: b.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'GRU', std, sta: std + 12 * 60 + 30, pax: 200 });
  addFlight(g, { no: 'AW802', aircraftId: b.id, contractId: null, kind: 'revenue', from: 'GRU', to: 'LIS', std: std + DAY + 12 * 60 + 30, sta: std + DAY + 25 * 60, pax: 200 });
  rerosterFrom(g, b.id, g.now);
  settle(g);
  return { text: serialize(g), reg: b.reg, flightId: f.id };
}

describe('v0.7.4 load: a v0.7.3 save', () => {
  it('a 767 the game gave bunks loses them with an inbox note; its long duty is re-planned for business seats and stays legal; bunks paired everywhere', () => {
    const { text, reg, flightId } = v073Save();
    const before = JSON.parse(text).state;
    const d0 = before.duties[before.flights[flightId].dutyId];
    expect(d0.augment).toBeGreaterThan(0);
    const g = deserialize(text);
    const b = Object.values(g.fleet).find((x) => x.reg === reg)!;
    expect(b.rest).toEqual({ fc: null, cc: null });
    expect(b.restV).toBe(2);
    expect(restOf(g, b.id).fc).toMatchObject({ cls: 2, kind: 'jSeats' });
    const msg = g.messages.find((m) => m.title === `${reg}: no crew bunks (B763)`);
    expect(msg?.body).toMatch(/never has crew bunks/);
    expect(msg?.body).toMatch(/re-rostered/);
    for (const ac of Object.values(g.fleet)) expect(paired(ac.rest!), ac.typeId).toBe(true);
    const a = Object.values(g.fleet).find((x) => x.typeId === 'a332')!;
    expect(a.rest).toEqual(bunksFor('a332'));
    // idempotent: a second load changes nothing more and posts no second note
    const again = deserialize(serialize(g));
    expect(again.messages.filter((m) => m.title === `${reg}: no crew bunks (B763)`).length).toBe(1);
    // re-planned at the first settle, legal with the business seats, and flown legally
    settle(g);
    const f = g.flights[flightId];
    const d = g.duties[f.dutyId!];
    expect(d.augment).toBeGreaterThan(0);
    expect(d.legality).not.toBe('illegal');
    expect(restPlan(g, d.id)?.ok).toBe(true);
    expect(restPlan(g, d.id)?.pilots[0].where).toBe('jSeats');
    run(g, f.sta + 120);
    expect(g.stats.illegalFlown ?? 0).toBe(0);
  }, 60_000);
});

export type { GameState };
