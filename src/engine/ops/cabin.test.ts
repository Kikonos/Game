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
import { bookRefit, cabinOptions, refitQuote, refitStations } from './cabin';
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
  it('stations: widebodies only where the shop takes them; nearest first', () => {
    const g = newGame(3);
    const nb = refitStations(g, owned(g).id);
    expect(nb[0]).toMatchObject({ code: 'LIS', ferryBlock: 0 });
    expect(nb.map((s) => s.code)).toContain('VNO');
    const wb = addAircraft(g, 'a332');
    expect(refitStations(g, wb.id).map((s) => s.code)).not.toContain('VNO');
    const q = refitQuote(g, wb.id, '36J/150Y', 'VNO', g.now + 10 * DAY);
    expect(q.ok).toBe(false);
    expect(q.why).toBe('FL Technics at Vilnius takes narrowbodies only');
    expect(refitQuote(g, wb.id, '18J/282Y', 'LIS', g.now + 10 * DAY).why).toBe('Already 18J/282Y');
    expect(refitQuote(g, wb.id, '36J/150Y', 'LIS', g.now + 2 * DAY).why).toMatch(/^Hangar slots from /);
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
    const start = g.now + 10 * DAY;
    const r = bookRefit(g, ac.id, '24J/90Y', 'HAM', start);
    if (!r.ok) throw new Error(r.error);
    const m = g.maintenance[r.data!.maintId];
    expect(m).toMatchObject({ kind: 'refit', at: 'HAM', start, end: start + 21 * DAY, cost: 1_200_000, refit: { cabin: { label: '24J/90Y', layout: 'vip', total: 114 } } });
    expect(m.ferryIds?.length).toBeGreaterThan(0);
    for (const id of m.ferryIds!) expect(g.flights[id]).toMatchObject({ kind: 'ferry', purpose: 'refit', to: 'HAM' });
    expect(g.messages[0].title).toBe(`Refit booked: ${ac.reg} to 24J/90Y`);
    run(g, start + 60);
    expect(m.status).toBe('inWork');
    expect(line(g, 'refit')).toBe(-1_200_000);
    run(g, m.end + 60);
    expect(m.status).toBe('done');
    expect(line(g, 'refit')).toBe(-1_200_000);
    expect(ac.cabin).toMatchObject({ label: '24J/90Y', layout: 'vip', total: 114 });
    expect(ac.at).toBe('HAM');
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
    const r = bookRefit(g, ac.id, '12J/156Y', 'MAD', g.now + 10 * DAY);
    if (!r.ok) throw new Error(r.error);
    const m = g.maintenance[r.data!.maintId];
    const ferries = [...m.ferryIds!];
    expect(ferries.length).toBeGreaterThan(0);
    expect(cancelCheck(g, m.id).ok).toBe(true);
    expect(m.status).toBe('cancelled');
    for (const id of ferries) expect(g.flights[id]).toBeUndefined();
    expect(line(g, 'refit')).toBe(0);
    const r2 = bookRefit(g, ac.id, '12J/156Y', 'LIS', g.now + 8 * DAY);
    if (!r2.ok) throw new Error(r2.error);
    run(g, g.now + 8 * DAY + 60);
    expect(cancelCheck(g, r2.data!.maintId)).toEqual({ ok: false, error: 'The check is already in work' });
    expect(BAL.refit.leadDays).toBe(7);
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
