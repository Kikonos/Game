// v0.7 cabin reconfiguration (UPDATE-0.7.md §F7): layouts, refit stations and booking, the cabin rules of offers.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { flightsOf } from '../core/entities';
import { cabinMinimum, isPilot } from '../core/perf';
import { demoFlights } from '../dev';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { acceptOffer, feasibility } from '../contracts';
import { addAircraft, legsOffer, newGame, owned, run } from '../contracts/testkit';
import { cancelCheck } from './maintenance';
import { bookRefit, bookRestRefit, bookRestSeats, cabinOptions, REST_SEATS, refitQuote, refitSlots, refitStations, restRefitOptions, restRefitQuote, restSeatsQuote } from './cabin';
import { leased } from '../contracts/testkit';

const line = (g: GameState, cat: 'refit') => [g.finance.current, ...g.finance.history].reduce((s, st) => s + (st.lines[cat] ?? 0), 0);

describe('cabin layouts', () => {
  it('every type keeps its presets and gains a VIP layout (A320 24J/90Y, A321 28J/110Y, A330-200 36J/150Y, 777-200ER 40J/180Y)', () => {
    const vip = (t: string) => cabinOptions(t).find((p) => p.layout === 'vip')!.label;
    expect(vip('a320ceo')).toBe('24J/90Y');
    expect(vip('a321ceo')).toBe('28J/110Y');
    expect(vip('a332')).toBe('36J/150Y');
    expect(vip('b772')).toBe('40J/180Y');
    expect(cabinOptions('a320ceo').map((p) => p.label)).toEqual(['180Y', '12J/156Y', '24J/90Y']);
    // A VIP A320 still needs 3 cabin crew by the seats.
    expect(cabinMinimum(114)).toBe(3);
  });
});

describe('refits', () => {
  it('stations: our own hangar at home base only (v0.7.2)', () => {
    const g = newGame(3);
    const nb = refitStations(g, owned(g).id);
    expect(nb).toEqual([{ code: 'LIS', name: `${g.company.name} hangar, Lisbon`, ferryBlock: 0 }]);
    const wb = addAircraft(g, 'a332');
    expect(refitStations(g, wb.id).map((s) => s.code)).toEqual(['LIS']);
    const q = refitQuote(g, wb.id, '36J/150Y', 'VNO', g.now + 10 * DAY);
    expect(q.ok).toBe(false);
    expect(q.why).toBe('Cabin work is done in our own hangar at home base');
    expect(refitQuote(g, wb.id, '18J/282Y', 'LIS', g.now + 10 * DAY).why).toBe('Already 18J/282Y');
    expect(refitQuote(g, wb.id, '36J/150Y', 'LIS', g.now - 2 * 60).why).toMatch(/^Hangar slots from /);
  });

  it('quote: days and cost by layout and body, seats and crew minimum, what it opens and closes, reinstatement on a lease', () => {
    const g = newGame(3);
    const ac = leased(g);
    const q = refitQuote(g, ac.id, '24J/90Y', 'LIS', g.now + 10 * DAY);
    expect(q).toMatchObject({ ok: true, days: 21, cost: 1_200_000, seatsFrom: 180, seatsTo: 114, cabinMinFrom: 4, cabinMinTo: 3, reinstateAtReturn: 120_000, ferryIn: [] });
    expect(q.opens).toContain('VIP and state work');
    expect(q.closes).toEqual(['troop rotations (174+)', 'pilgrimage (180+)']);
    expect(q.end - q.start).toBe(21 * DAY);
    expect(refitQuote(g, ac.id, '12J/156Y', 'LIS', g.now + 10 * DAY)).toMatchObject({ days: 7, cost: 250_000 });
    expect(refitQuote(g, addAircraft(g, 'b772').id, '40J/180Y', 'LIS', g.now + 10 * DAY)).toMatchObject({ days: 35, cost: 3_000_000 });
    expect(refitQuote(g, owned(g).id, '24J/90Y', 'LIS', g.now + 10 * DAY).reinstateAtReturn).toBeNull();
  });

  it('booked away from base: ferries in, posts the refit once at the start, changes the cabin at the end and re-rosters for the new complement', () => {
    const g = newGame(5);
    const ac = owned(g);
    ac.at = 'HAM';
    const start = g.now + 10 * DAY;
    const r = bookRefit(g, ac.id, '24J/90Y', 'LIS', start);
    if (!r.ok) throw new Error(r.error);
    const m = g.maintenance[r.data!.maintId];
    expect(m).toMatchObject({ kind: 'refit', at: 'LIS', start, end: start + 21 * DAY, cost: 1_200_000, refit: { cabin: { label: '24J/90Y', layout: 'vip', total: 114 } } });
    expect(m.ferryIds?.length).toBeGreaterThan(0);
    expect(g.flights[m.ferryIds![m.ferryIds!.length - 1]]).toMatchObject({ kind: 'ferry', purpose: 'refit', to: 'LIS' });
    expect(g.messages[0].title).toBe(`Refit booked: ${ac.reg} to 24J/90Y`);
    run(g, start + 60);
    expect(m.status).toBe('inWork');
    expect(line(g, 'refit')).toBe(-1_200_000);
    run(g, m.end + 60);
    expect(m.status).toBe('done');
    expect(line(g, 'refit')).toBe(-1_200_000);
    expect(ac.cabin).toMatchObject({ label: '24J/90Y', layout: 'vip', total: 114 });
    expect(ac.at).toBe('LIS');
    expect(g.stats.refits).toBe(1);
    expect(g.messages.some((x) => x.title === `${ac.reg} refitted: 24J/90Y VIP` && /Cabin crew minimum 3 \(was 4\)/.test(x.body))).toBe(true);
    // New flying is crewed for 114 seats: 3 cabin crew at the minimum (was 4).
    demoFlights(g, ['FAO'], 1, 'revenue');
    run(g, g.now + 60);
    const f = flightsOf(g, ac.id).find((x) => x.status === 'scheduled' && x.kind === 'revenue' && x.dutyId)!;
    const p = g.pairings[g.duties[f.dutyId!].pairingId];
    expect(p.slots.filter((x) => !isPilot(x.role) && !x.above && !x.extra).length).toBe(3);
  });

  it('a refit that would shrink the cabin below signed work after it is refused and names the contract', () => {
    const g = newGame(3);
    const ac = owned(g);
    const t = g.now + 50 * DAY;
    const o = legsOffer(g, [['LIS', 'FAO', t], ['FAO', 'LIS', t + DAY]], 174);
    o.title = 'Troop rotation to Mogadishu';
    const s = acceptOffer(g, o.id, [ac.id]);
    if (!s.ok) throw new Error(s.error);
    const q = refitQuote(g, ac.id, '12J/156Y', 'LIS', g.now + 10 * DAY);
    expect(q.ok).toBe(false);
    expect(q.breaks).toEqual(['Troop rotation to Mogadishu needs 174+ seats (refit gives 168)']);
    expect(q.why).toBe('Troop rotation to Mogadishu needs 174+ seats (refit gives 168)');
    expect(bookRefit(g, ac.id, '24J/90Y', 'LIS', g.now + 10 * DAY).ok).toBe(false);
    // After the last leg the same refit is fine.
    expect(refitQuote(g, ac.id, '12J/156Y', 'LIS', t + 3 * DAY)).toMatchObject({ ok: true, breaks: [] });
  });

  it('cancelled before the start: nothing paid, the ferry removed; in work it cannot be cancelled', () => {
    const g = newGame(6);
    const ac = owned(g);
    ac.at = 'MAD';
    const r = bookRefit(g, ac.id, '12J/156Y', 'LIS', g.now + 10 * DAY);
    if (!r.ok) throw new Error(r.error);
    const m = g.maintenance[r.data!.maintId];
    const ferries = [...m.ferryIds!];
    expect(ferries.length).toBeGreaterThan(0);
    expect(cancelCheck(g, m.id).ok).toBe(true);
    expect(m.status).toBe('cancelled');
    for (const id of ferries) expect(g.flights[id]).toBeUndefined();
    expect(line(g, 'refit')).toBe(0);
    ac.at = 'LIS';
    const r2 = bookRefit(g, ac.id, '12J/156Y', 'LIS', g.now + 8 * DAY);
    if (!r2.ok) throw new Error(r2.error);
    run(g, g.now + 8 * DAY + 60);
    expect(cancelCheck(g, r2.data!.maintId)).toEqual({ ok: false, error: 'The check is already in work' });
    expect(BAL.refit.leadDays).toBe(0);
  });
});

describe('the cabin rules in feasibility', () => {
  it('a VIP job on a 180Y A320: layout "no" with the cheapest refit as the tip and a Plan refit action; a planned refit before the start counts', () => {
    const g = newGame(8);
    const ac = owned(g);
    const t = g.now + 40 * DAY;
    const o = legsOffer(g, [['LIS', 'NCE', t], ['NCE', 'LIS', t + 3 * DAY]], 80);
    o.requirements.layouts = ['vip'];
    const rep = feasibility(g, o.id, ac.id);
    const c = rep.checks.find((x) => x.id === 'layout')!;
    expect(c).toMatchObject({ level: 'no', label: `Needs a VIP cabin; ${ac.reg} is 180Y`, action: { kind: 'refit', layout: 'vip' } });
    expect(c.detail).toBe('Refit to 24J/90Y at Lisbon: 21 days, $1.20M');
    expect(bookRefit(g, ac.id, '24J/90Y', 'LIS', g.now + 10 * DAY).ok).toBe(true);
    const after = feasibility(g, o.id, ac.id).checks.find((x) => x.id === 'layout')!;
    expect(after.level).toBe('ok');
    expect(after.label).toMatch(/^Cabin 24J\/90Y after the refit /);
  });

  it('premium seats: 12J/156Y meets 12+, 180Y does not; a troop rotation (174+) fails seats on a two-class A320', () => {
    const g = newGame(9);
    const ac = owned(g);
    const t = g.now + 40 * DAY;
    const o = legsOffer(g, [['LIS', 'MAD', t], ['MAD', 'LIS', t + DAY]], 120);
    o.requirements.layouts = ['two-class', 'three-class', 'vip'];
    o.requirements.minPremium = 12;
    expect(feasibility(g, o.id, ac.id).checks.find((x) => x.id === 'layout')!.action).toEqual({ kind: 'refit', layout: 'two-class' });
    ac.cabin = { j: 12, w: 0, y: 156, total: 168, label: '12J/156Y', layout: 'two-class' };
    expect(feasibility(g, o.id, ac.id).checks.find((x) => x.id === 'layout')!.level).toBe('ok');
    const troop = legsOffer(g, [['LIS', 'BKO', t]], 174);
    expect(feasibility(g, troop.id, ac.id).checks.find((x) => x.id === 'seats')).toMatchObject({ level: 'no', label: '168 seats: the client needs at least 174' });
  });
});

describe('v0.7.2 refits start straight away, at home base', () => {
  it('the first slot starts today when the aircraft is free; a signed job pushes it back and busyWhy names it', () => {
    const g = newGame(3);
    const ac = owned(g);
    const r = refitSlots(g, ac.id, '12J/156Y');
    expect(r.slots.length).toBe(6);
    expect(r.slots[0].start).toBeLessThanOrEqual(g.now + 90);
    expect(r.slots[0].end - r.slots[0].start).toBe(7 * DAY);
    expect(r.busyUntil).toBeNull();
    for (let i = 1; i < r.slots.length; i++) expect(r.slots[i].start).toBeGreaterThan(r.slots[i - 1].start);
    const t = g.now + DAY;
    const o = legsOffer(g, [['LIS', 'FAO', t], ['FAO', 'LIS', t + 3 * DAY]], 150);
    o.title = 'TUI summer programme Lisbon–Faro';
    const s = acceptOffer(g, o.id, [ac.id]);
    if (!s.ok) throw new Error(s.error);
    const r2 = refitSlots(g, ac.id, '12J/156Y');
    expect(r2.slots[0].start).toBeGreaterThan(t + 3 * DAY);
    expect(r2.busyUntil).toBe(r2.slots[0].start);
    expect(r2.busyWhy).toMatch(/^Busy until .+: flies TUI summer programme Lisbon–Faro$/);
    expect(refitQuote(g, ac.id, '12J/156Y', 'LIS', r2.slots[0].start).ok).toBe(true);
  });

  it('no slot in 26 weeks: busyWhy names the signed work the new cabin cannot serve, not the first refusal', () => {
    const g = newGame(3);
    const ac = owned(g);
    const t = g.now + DAY;
    // Away at Faro for the whole horizon, on a job that needs more seats than 12J/156Y has.
    const o = legsOffer(g, [['LIS', 'FAO', t], ['FAO', 'LIS', t + 200 * DAY]], 150);
    const s = acceptOffer(g, o.id, [ac.id]);
    if (!s.ok) throw new Error(s.error);
    g.contracts[s.data!.contractId].requirements.minSeats = 175;
    const r = refitSlots(g, ac.id, '12J/156Y');
    expect(r.slots.length).toBe(0);
    expect(r.busyWhy).toMatch(/^The new cabin won't serve signed work: /);
  });

  it('v0.7.3 crew rest refits: options per type, what each opens; home refits change the facilities at the end', () => {
    const g = newGame(4);
    g.company.approvals.push('augmented');
    // narrowbodies: only the A321LR and 757 can take recliners
    expect(restRefitOptions(g, owned(g).id)).toEqual([]);
    const lr = addAircraft(g, 'a321neo');
    expect(restRefitOptions(g, lr.id).map((o) => [o.id, o.cls, o.days, o.cost, o.seats])).toEqual([['recliners', 3, 3, 100_000, -3]]);
    // an A330-200 with no rest: curtained business seats, recliners, the lower-deck module, a pilots' compartment with a C-check
    const wb = addAircraft(g, 'a332');
    expect(wb.rest).toEqual({ fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 1, kind: 'ldmcr', places: 7 } });
    expect(restRefitOptions(g, wb.id)).toEqual([]);
    wb.rest = { fc: null, cc: null };
    const opts = restRefitOptions(g, wb.id);
    expect(opts.map((o) => [o.id, o.where, o.cls, o.seats])).toEqual([['curtainJ', 'home', 2, 0], ['recliners', 'home', 3, -9], ['ldmcr', 'home', 1, 0], ['fcrc', 'cCheck', 1, 0]]);
    expect(opts[0].opens).toBe('Opens: 15 h days with 3 pilots (was 13 h); cabin crew rest in business seats (2:00 on a 15 h day)');
    expect(restSeatsQuote(g, owned(g).id, true, g.now + DAY).ok).toBe(false);
    // book the curtain (1 day, $15K): at the end business seats are class 2 rest for both sides
    const slots = refitSlots(g, wb.id, 'rest:curtainJ');
    expect(slots.slots[0].end - slots.slots[0].start).toBe(DAY);
    const q = restRefitQuote(g, wb.id, 'curtainJ', slots.slots[0].start);
    expect(q).toMatchObject({ ok: true, days: 1, cost: 15_000, station: 'LIS' });
    const r = bookRestRefit(g, wb.id, 'curtainJ', slots.slots[0].start);
    if (!r.ok) throw new Error(r.error);
    expect(g.maintenance[r.data!.maintId].restFit).toBe('curtainJ');
    run(g, g.maintenance[r.data!.maintId].end + 60);
    expect(wb.rest).toEqual({ fc: { cls: 2, kind: 'jSeats', places: 2 }, cc: { cls: 2, kind: 'jSeats', places: 5 } });
    expect(line(g, 'refit')).toBe(-15_000);
    expect(g.stats.restRefits).toBe(1);
    expect(g.messages.some((m) => /lower-deck|curtain/i.test(m.title))).toBe(true);
    // now the module would free the business seats
    const ld = restRefitOptions(g, wb.id).find((o) => o.id === 'ldmcr')!;
    expect(ld.opens).toBe('Opens: cabin crew rest in bunks (1:45 instead of 2:00 on a 15 h day); 5 business seats back on sale');
    // recliners on a 767 cost 8 seats; the v0.7.2 wrappers fit and remove them
    const b767 = addAircraft(g, 'b763');
    b767.rest = { fc: null, cc: null };
    const rq = restSeatsQuote(g, b767.id, true, refitSlots(g, b767.id, REST_SEATS).slots[0].start);
    expect(rq).toMatchObject({ ok: true, days: 4, cost: 220_000, seatsTo: b767.cabin.total - 8 });
    const rb = bookRestSeats(g, b767.id, true, rq.start);
    if (!rb.ok) throw new Error(rb.error);
    run(g, g.maintenance[rb.data!.maintId].end + 60);
    expect(b767.rest).toEqual({ fc: { cls: 3, kind: 'recliners', places: 2 }, cc: { cls: 3, kind: 'recliners', places: 4 } });
    expect(b767.cabin.total).toBe(rq.seatsTo);
    expect(restRefitOptions(g, b767.id).map((o) => o.id)).toContain('removeRecliners');
  });
});
