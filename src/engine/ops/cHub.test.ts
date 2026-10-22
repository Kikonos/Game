// v0.7.2 C-checks at real MRO hubs (UPDATE-0.7.2.md §7): hubs by family, ferries out and home, the pilots'
// airline tickets, retiming and cancelling, and old-save C-checks booked at base.

import { describe, expect, it } from 'vitest';
import { C_HUBS } from '../../data/mro';
import { flightsOf, nextId } from '../core/entities';
import { DAY } from '../core/time';
import { schedule } from '../core/queue';
import { evalSegs } from '../crew/rules';
import { ctxOf, segsOf } from '../crew/timeline';
import { newGame, owned, run } from '../contracts/testkit';
import { bookCCheck, cCheckOptions, cCheckSlots, checkLogistics } from './cHub';
import { cancelCheck, checkAirportOk, scheduleCheck } from './maintenance';

describe('C-check hubs', () => {
  it('every family has 1–2 real hubs with a price level; C-checks only at the family hubs', () => {
    for (const hubs of Object.values(C_HUBS)) {
      expect(hubs.length).toBeGreaterThanOrEqual(1);
      expect(hubs.length).toBeLessThanOrEqual(2);
      for (const h of hubs) expect(h.price).toBeGreaterThan(0.7);
    }
    const g = newGame(3);
    const ac = owned(g);
    expect(checkAirportOk(g, 'C', 'LIS', ac.id)).toBe(false);
    expect(checkAirportOk(g, 'C', 'SOF', ac.id)).toBe(true);
    expect(checkAirportOk(g, 'C', 'MIA', ac.id)).toBe(false);
    expect(scheduleCheck(g, ac.id, 'C', g.now + 20 * DAY, 'LIS').ok).toBe(false);
    expect(checkAirportOk(g, 'A', 'LIS', ac.id)).toBe(true);
  });

  it('options per hub, cheapest first, with ferry times, crew and check costs; slots hold the whole window', () => {
    const g = newGame(3);
    const ac = owned(g);
    const opts = cCheckOptions(g, ac.id);
    expect(opts.map((o) => o.hub.code).sort()).toEqual(['MLA', 'SOF']);
    expect(opts[0].ok).toBe(true);
    expect(opts[0].total).toBeLessThanOrEqual(opts[1].total);
    const o = opts.find((x) => x.hub.code === 'SOF')!;
    expect(o.ferryOut[0].from).toBe('LIS');
    expect(o.ferryOut[o.ferryOut.length - 1].to).toBe('SOF');
    expect(o.ferryHome[0].std).toBe(o.end + 180);
    expect(o.ferryHome[o.ferryHome.length - 1].to).toBe('LIS');
    expect(o.crewCost).toBeGreaterThan(0);
    expect(o.ferryCost).toBeGreaterThan(0);
    expect(o.total).toBe(o.checkCost + o.ferryCost + o.crewCost);
    const slots = cCheckSlots(g, ac.id, 'SOF', 3);
    expect(slots.length).toBe(3);
    expect(slots[1] - slots[0]).toBe(7 * DAY);
  });

  it('booking: ferry out and home (purpose check), the check at the hub price, pilots crewed with airline tickets, all legal', () => {
    const g = newGame(3);
    const ac = owned(g);
    const start = cCheckSlots(g, ac.id, 'SOF', 1)[0] + 3 * DAY;
    const r = bookCCheck(g, ac.id, 'SOF', start);
    if (!r.ok) throw new Error(r.error);
    const m = g.maintenance[r.data!.maintId];
    expect(m).toMatchObject({ kind: 'C', at: 'SOF', hub: { code: 'SOF', name: 'Lufthansa Technik Sofia', price: 0.85 } });
    const lg = checkLogistics(g, m.id)!;
    expect(lg.ferryOut.length).toBeGreaterThan(0);
    expect(lg.ferryHome.length).toBeGreaterThan(0);
    for (const f of [...lg.ferryOut, ...lg.ferryHome]) expect(f).toMatchObject({ kind: 'ferry', purpose: 'check' });
    expect(lg.ferryHome[0].std).toBe(m.end + 180);
    expect(g.messages[0].title).toBe(`C-check booked: ${ac.reg} at Lufthansa Technik Sofia`);
    // Roster the ferries: both are crewed (the ferry home once inside the roster horizon); tickets home after the
    // ferry out and back out before the ferry home.
    const crewed = (f: (typeof lg.ferryOut)[number]) => !!f.dutyId && (g.pairings[g.duties[f.dutyId]?.pairingId]?.slots ?? []).filter((x) => x.crewId).length >= 2;
    run(g, g.now + 60);
    expect(lg.ferryOut.every(crewed)).toBe(true);
    expect(checkLogistics(g, m.id)!.tickets.some((t) => t.from === 'SOF' && t.to === 'LIS')).toBe(true);
    const pilots = g.pairings[g.duties[lg.ferryOut[0].dutyId!].pairingId].slots.map((x) => x.crewId!);
    run(g, lg.ferryHome[0].std - 2 * DAY);
    expect(pilots.every((id) => g.crew[id].loc === 'LIS')).toBe(true);
    expect(lg.ferryHome.every((f) => crewed(g.flights[f.id]))).toBe(true);
    expect(checkLogistics(g, m.id)!.tickets.some((t) => t.from === 'LIS' && t.to === 'SOF')).toBe(true);
    for (const c of Object.values(g.crew)) expect(evalSegs(ctxOf(g, c), segsOf(g, c)).filter((i) => i.level === 'illegal')).toEqual([]);
  });

  it('a moved check retimes the ferry home; cancelling removes both ferries', () => {
    const g = newGame(3);
    const ac = owned(g);
    const r = bookCCheck(g, ac.id, 'SOF', cCheckSlots(g, ac.id, 'SOF', 1)[0]);
    if (!r.ok) throw new Error(r.error);
    const m = g.maintenance[r.data!.maintId];
    const ids = [...m.ferryIds!, ...m.homeIds!];
    expect(cancelCheck(g, m.id).ok).toBe(true);
    for (const id of ids) expect(g.flights[id]).toBeUndefined();
    const r2 = bookCCheck(g, ac.id, 'SOF', cCheckSlots(g, ac.id, 'SOF', 1)[0]);
    if (!r2.ok) throw new Error(r2.error);
    const m2 = g.maintenance[r2.data!.maintId];
    // The aircraft is late in: the check starts later and the ferry home moves with it.
    run(g, m2.start - 60);
    const home = g.flights[m2.homeIds![0]];
    expect(home.std).toBeGreaterThanOrEqual(m2.end + 180);
  });

  it('old saves: a C-check already booked at base still runs and completes', () => {
    const g = newGame(3);
    const ac = owned(g);
    const start = g.now + 5 * DAY;
    const id = nextId(g, 'mx');
    g.maintenance[id] = { id, aircraftId: ac.id, kind: 'C', at: 'LIS', start, end: start + 14 * DAY, cost: 600_000, status: 'planned', planned: true, ev: 0 };
    // queue its start as an old save's queue would hold it
    schedule(g, start, 'maint.start', id, 0);
    run(g, start + 15 * DAY);
    expect(g.maintenance[id].status).toBe('done');
    expect(ac.maint.lastC).toBeGreaterThan(start);
    expect(flightsOf(g, ac.id).filter((f) => f.purpose === 'check')).toEqual([]);
  });
});

describe('v0.7.3 crew rest compartment with the C-check', () => {
  it('adds its days and cost to the check, moves the ferry home and fits the bunks at the end', async () => {
    const { addAircraft } = await import('../contracts/testkit');
    const { addRestToCCheck, restRefitOptions } = await import('./cabin');
    const { BAL } = await import('../core/balance');
    const g = newGame(3);
    const ac = addAircraft(g, 'a332');
    ac.rest = { fc: { cls: 2, kind: 'jSeats', places: 2 }, cc: { cls: 2, kind: 'jSeats', places: 5 } };
    const opt = restRefitOptions(g, ac.id).find((o) => o.id === 'fcrc')!;
    expect(opt).toMatchObject({ where: 'cCheck', days: 10, cost: 1_900_000, ok: true });
    expect(opt.opens).toBe('Opens: 16 h days with 3 pilots (was 15 h); 2 business seats back on sale');
    const hub = C_HUBS['A330/340'][0].code;
    const plain = cCheckOptions(g, ac.id).find((o) => o.hub.code === hub)!;
    const fit = cCheckOptions(g, ac.id, undefined, 'fcrc').find((o) => o.hub.code === hub)!;
    expect(fit.checkCost - plain.checkCost).toBe(1_900_000);
    const start = cCheckSlots(g, ac.id, hub, 1, 'fcrc')[0];
    const r = bookCCheck(g, ac.id, hub, start, { restFit: 'fcrc' });
    if (!r.ok) throw new Error(r.error);
    const m = g.maintenance[r.data!.maintId];
    const days = Math.round((m.end - m.start) / DAY);
    expect(m.restFit).toBe('fcrc');
    expect(g.flights[m.homeIds![0]].std).toBe(m.end + BAL.v072.cHub.homeAfterMin);
    // taken off and put back on: the check shrinks and grows by 10 days
    expect(addRestToCCheck(g, m.id, null).ok).toBe(true);
    expect(Math.round((m.end - m.start) / DAY)).toBe(days - 10);
    expect(addRestToCCheck(g, m.id, 'fcrc').ok).toBe(true);
    expect(g.flights[m.homeIds![0]].std).toBe(m.end + BAL.v072.cHub.homeAfterMin);
    // (no A330 crew in this game to fly the ferry out: end the check where it stands)
    const { onMaintEnd } = await import('./maintenance');
    m.status = 'inWork';
    onMaintEnd(g, { t: m.end, seq: 0, type: 'maint.end', id: m.id, v: m.ev } as never);
    expect(m.status).toBe('done');
    expect(ac.rest!.fc).toEqual({ cls: 1, kind: 'fcrc', places: 2 });
    expect(ac.rest!.cc).toEqual({ cls: 2, kind: 'jSeats', places: 5 });
  });
});
