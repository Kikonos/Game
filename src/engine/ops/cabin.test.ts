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
import { bookRefit, loadRefits, restAfterRefit, bookRestSeats, cabinOptions, REST_SEATS, refitQuote, refitSlots, refitStations, refitTerms, restRefitOptions, restSeatsQuote, twoClassInstead } from './cabin';
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
    expect(cabinMinimum('a320ceo', 114)).toBe(3);
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
    // v0.7.4 VIP is the full retrofit with new premium seats; the standard layouts are a quick 48 h reconfiguration.
    // v0.12.1 priced by the seats fitted: 24 × $30K + $120K engineering, 5 days + 1 per 6 seats (was 21 days, $1.6M flat).
    expect(q).toMatchObject({ ok: true, kind: 'full', days: 9, cost: 840_000, seatsFrom: 180, seatsTo: 114, cabinMinFrom: 4, cabinMinTo: 3, reinstateAtReturn: 30_000, ferryIn: [] });
    expect(q.opens).toContain('VIP and state work');
    // the business seats bring class 2 crew rest with them (economy seats were class 3)
    expect(q.opens).toContain('crew rest in business seats (class 2)');
    expect(q.closes).toEqual(['troop rotations (150+)', 'pilgrimage (180+)']);
    expect(q.end - q.start).toBe(9 * DAY);
    expect(q.parts).toEqual(['24 business seats × $30K = $720K', 'Engineering, LOPA and approval $120K', '5 days + 4 (1 per 6 seats)']);
    expect(refitQuote(g, ac.id, '12J/156Y', 'LIS', g.now + 10 * DAY)).toMatchObject({ kind: 'quick', days: 2, cost: 40_000 });
    // v0.12.1 a widebody: 40 lie-flat seats × $85K + $300K, 10 days + 1 per 4 seats (was 28 days, $4M flat).
    expect(refitQuote(g, addAircraft(g, 'b772').id, '40J/180Y', 'LIS', g.now + 10 * DAY)).toMatchObject({ kind: 'full', days: 20, cost: 3_700_000 });
    expect(refitQuote(g, addAircraft(g, 'b772').id, '400Y', 'LIS', g.now + 10 * DAY)).toMatchObject({ kind: 'quick', days: 2, cost: 80_000 });
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
    expect(m).toMatchObject({ kind: 'refit', at: 'LIS', start, end: start + 9 * DAY, cost: 840_000, refit: { cabin: { label: '24J/90Y', layout: 'vip', total: 114 } } });
    expect(m.ferryIds?.length).toBeGreaterThan(0);
    expect(g.flights[m.ferryIds![m.ferryIds!.length - 1]]).toMatchObject({ kind: 'ferry', purpose: 'refit', to: 'LIS' });
    expect(g.messages[0].title).toBe(`Refit booked: ${ac.reg} to 24J/90Y`);
    run(g, start + 60);
    expect(m.status).toBe('inWork');
    expect(line(g, 'refit')).toBe(-840_000);
    run(g, m.end + 60);
    expect(m.status).toBe('done');
    expect(line(g, 'refit')).toBe(-840_000);
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

describe('v0.12.1 the premium retrofit by seats (round E: "1 million something and 21 days for a few premium seats")', () => {
  it('scales with the seats fitted (narrow recliners, wide lie-flats); the two-class option is named when the need allows it', () => {
    expect(refitTerms('a320ceo', 'vip', { j: 24, w: 0 })).toMatchObject({ days: 9, cost: 840_000, kind: 'full' });
    expect(refitTerms('a320ceo', 'vip', { j: 12, w: 0 })).toMatchObject({ days: 7, cost: 480_000 });
    expect(refitTerms('a321ceo', 'vip', { j: 28, w: 0 })).toMatchObject({ days: 10, cost: 960_000 });
    expect(refitTerms('a332', 'vip', { j: 36, w: 0 })).toMatchObject({ days: 19, cost: 3_360_000 });
    // The quick layouts are unchanged.
    expect(refitTerms('a320ceo', 'two-class')).toMatchObject({ days: 2, cost: 40_000, kind: 'quick' });
    // European business (middle seat blocked, no new seats): offered for a need of up to 12 premium seats, never for VIP work.
    expect(twoClassInstead('a320ceo')).toEqual({ label: '12J/156Y', days: 2, cost: 40_000 });
    expect(twoClassInstead('a320ceo', { minPremium: 12 })).not.toBeNull();
    expect(twoClassInstead('a320ceo', { minPremium: 24 })).toBeNull();
    expect(twoClassInstead('a320ceo', { layouts: ['vip'] })).toBeNull();
  });

  it('load: a VIP refit booked at the old flat price is re-priced; one in work ends sooner and the difference comes back once', () => {
    const g = newGame(12);
    const ac = owned(g);
    const start = g.now + 5 * DAY;
    const r = bookRefit(g, ac.id, '24J/90Y', 'LIS', start);
    if (!r.ok) throw new Error(r.error);
    const m = g.maintenance[r.data!.maintId];
    // As an older version booked it.
    m.cost = 1_600_000;
    m.end = m.start + 21 * DAY;
    loadRefits(g);
    expect(m.cost).toBe(840_000);
    expect(m.end - m.start).toBe(9 * DAY);
    expect(g.messages[0].title).toBe(`${ac.reg} refit re-priced: $840K, 9 days`);
    // In work, paid at the old price: refunded on the refit line, out of the hangar 12 days sooner.
    m.cost = 1_600_000;
    m.end = m.start + 21 * DAY;
    run(g, start + 60);
    expect(m.status).toBe('inWork');
    expect(line(g, 'refit')).toBe(-1_600_000);
    const cash = g.company.cash;
    loadRefits(g);
    expect(g.company.cash).toBe(cash + 760_000);
    expect(line(g, 'refit')).toBe(-840_000);
    expect(m.end - m.start).toBe(9 * DAY);
    loadRefits(g);
    expect(g.company.cash).toBe(cash + 760_000);
    run(g, m.start + 9 * DAY + 60);
    expect(m.status).toBe('done');
    expect(ac.cabin.label).toBe('24J/90Y');
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
    expect(c.detail).toBe('Refit to 24J/90Y in our hangar: 9 days, $840K');
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
    expect(feasibility(g, troop.id, ac.id).checks.find((x) => x.id === 'seats')).toMatchObject({ level: 'no', label: '168 seats: the client needs 174' });
  });
});

describe('v0.7.2 refits start straight away, at home base', () => {
  it('the first slot starts today when the aircraft is free; a signed job pushes it back and busyWhy names it', () => {
    const g = newGame(3);
    const ac = owned(g);
    const r = refitSlots(g, ac.id, '12J/156Y');
    expect(r.slots.length).toBe(6);
    expect(r.slots[0].start).toBeLessThanOrEqual(g.now + 90);
    expect(r.slots[0].end - r.slots[0].start).toBe(2 * DAY);
    expect(r.busyUntil).toBeNull();
    for (let i = 1; i < r.slots.length; i++) expect(r.slots[i].start).toBeGreaterThan(r.slots[i - 1].start);
    const t = g.now + DAY;
    // (v0.7.4 a 2-day reconfiguration fits between trips that leave a gap at home, so the job turns round in a day)
    const o = legsOffer(g, [['LIS', 'FAO', t], ['FAO', 'LIS', t + DAY]], 150);
    o.title = 'TUI summer programme Lisbon–Faro';
    const s = acceptOffer(g, o.id, [ac.id]);
    if (!s.ok) throw new Error(s.error);
    const r2 = refitSlots(g, ac.id, '12J/156Y');
    expect(r2.slots[0].start).toBeGreaterThan(t + DAY);
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

  it('v0.7.3/v0.7.4 crew rest refits: seats need none; recliners (class 2) on cabins without business seats; bunks only as a pair', () => {
    const g = newGame(4);
    g.company.approvals.push('augmented');
    // an A320: curtained economy seats come with the cabin; no refit to offer
    expect(restRefitOptions(g, owned(g).id)).toEqual([]);
    // the A321LR (all economy) can take class 2 recliners
    const lr = addAircraft(g, 'a321neo');
    expect(restRefitOptions(g, lr.id).map((o) => [o.id, o.cls, o.days, o.cost, o.seats])).toEqual([['recliners', 2, 3, 100_000, -3]]);
    // an A330-200 with bunks: nothing to add
    const wb = addAircraft(g, 'a332');
    expect(wb.rest).toEqual({ fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 1, kind: 'ldmcr', places: 7 } });
    expect(restRefitOptions(g, wb.id)).toEqual([]);
    // without bunks, two-class: the business seats are class 2 already; only the bunks (both crews) with a C-check
    wb.rest = { fc: null, cc: null };
    expect(restRefitOptions(g, wb.id).map((o) => [o.id, o.where, o.cls, o.side])).toEqual([['fcrc', 'cCheck', 1, 'both']]);
    expect(restAfterRefit(wb, 'fcrc').fitted).toEqual({ fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 1, kind: 'ldmcr', places: 7 } });
    // an old lower-deck module booking fits both kinds of bunks too
    expect(restAfterRefit(wb, 'ldmcr').fitted).toEqual(restAfterRefit(wb, 'fcrc').fitted);
    // all economy: recliners offered as well
    wb.cabin = { j: 0, w: 0, y: 330, total: 330, label: '330Y', layout: 'all-economy' };
    const opts = restRefitOptions(g, wb.id);
    expect(opts.map((o) => [o.id, o.where, o.cls, o.seats])).toEqual([['recliners', 'home', 2, -9], ['fcrc', 'cCheck', 1, 0]]);
    expect(opts[0].opens).toMatch(/^Opens: 15 h days with 3 pilots \(was 14 h\)/);
    // recliners on a 767 (all economy) cost 8 seats; the v0.7.2 wrappers fit and remove them
    const b767 = addAircraft(g, 'b763');
    expect(b767.rest).toEqual({ fc: null, cc: null });
    // 16J/251Y: business seats are class 2; the 767 never takes bunks
    expect(restRefitOptions(g, b767.id)).toEqual([]);
    b767.cabin = { j: 0, w: 0, y: 309, total: 309, label: '309Y', layout: 'all-economy' };
    const rq = restSeatsQuote(g, b767.id, true, refitSlots(g, b767.id, REST_SEATS).slots[0].start);
    expect(rq).toMatchObject({ ok: true, days: 4, cost: 220_000, seatsTo: b767.cabin.total - 8 });
    const rb = bookRestSeats(g, b767.id, true, rq.start);
    if (!rb.ok) throw new Error(rb.error);
    run(g, g.maintenance[rb.data!.maintId].end + 60);
    expect(b767.rest).toEqual({ fc: { cls: 2, kind: 'recliners', places: 2 }, cc: { cls: 2, kind: 'recliners', places: 4 } });
    expect(b767.cabin.total).toBe(rq.seatsTo);
    expect(g.stats.restRefits).toBe(1);
    expect(restRefitOptions(g, b767.id).map((o) => o.id)).toEqual(['removeRecliners']);
  });
});

describe('v0.12.1 cabin wording', () => {
  it('D17 "needs an all-economy cabin", "a two-class cabin"', async () => {
    const { cabinBreak } = await import('./cabin');
    const c = { total: 180, j: 12, w: 0, y: 168, layout: 'two-class', label: '12J 168Y' } as never;
    const req = { minSeats: 150, layout: 'all-economy' } as never;
    expect(cabinBreak(c, req)).toMatch(/^needs an all-economy cabin/);
    const c2 = { total: 180, j: 0, w: 0, y: 180, layout: 'all-economy', label: '180Y' } as never;
    expect(cabinBreak(c2, { minSeats: 150, layout: 'two-class' } as never)).toMatch(/^needs a two-class cabin/);
  });
});
