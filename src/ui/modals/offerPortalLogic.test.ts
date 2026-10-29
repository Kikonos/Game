// v0.12 offer portal: flights shown one by one, a block only for a programme's days without flights yet, red
// outlines on the trips in the way, and sub-leasing them from the offer flow (player request).

import { describe, expect, it } from 'vitest';
import { flightsOf } from '../../engine/core/entities';
import { DAY } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { acceptOffer, feasibility, generateOffer } from '../../engine/contracts';
import { legsOffer, newGame, owned } from '../../engine/contracts/testkit';
import { subcharter } from '../../engine/ops';
import { SUB_LEAD } from '../../engine/ops/subcharter';
import { subleaseTrip } from '../../engine/ops/sublease';
import { clashTrips, portalBlocks, portalWidth, PORTAL_PX_DAY, subleaseGroups } from './offerPortalLogic';
import { portalWindow } from './OfferPortal';

/** A signed charter of `n` same-day LIS–FAO–LIS rotations, a day apart, on the owned A320; its revenue legs by time. */
function job(g: GameState, n = 4, start = g.now + 5 * DAY) {
  const ac = owned(g);
  const legs: [string, string, number][] = [];
  for (let i = 0; i < n; i++) legs.push(['LIS', 'FAO', start + i * DAY], ['FAO', 'LIS', start + i * DAY + 4 * 60]);
  const o = legsOffer(g, legs, 150);
  const r = acceptOffer(g, o.id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  const c = g.contracts[r.data!.contractId];
  const fl = flightsOf(g, ac.id).filter((f) => f.contractId === c.id && f.kind === 'revenue').sort((a, b) => a.std - b.std);
  return { ac, c, fl, start };
}

describe('offer portal: flights, not a duration block', () => {
  it('draws every scheduled flight of a contract as its own block, at a scale where a flight reads as one', () => {
    const g = newGame(26);
    const { ac, c, fl, start } = job(g, 4);
    const o = legsOffer(g, [['LIS', 'PMI', start + 2 * DAY]]);
    const [from, to] = portalWindow(o, g.now);
    const blocks = portalBlocks(g, ac.id, from, to);
    const mine = blocks.filter((b) => b.kind === 'flight' && b.flightId && g.flights[b.flightId].contractId === c.id);
    expect(mine.map((b) => b.flightId)).toEqual(fl.map((f) => f.id));
    expect(blocks.some((b) => b.kind === 'pill' || b.kind === 'cont')).toBe(false);
    // A day is at least 120 px: a 1 h leg is 5 px wide and never runs into the next one.
    expect(portalWidth(from, to, 600)).toBeGreaterThanOrEqual(((to - from) / DAY) * PORTAL_PX_DAY);
    expect(portalWidth(g.now, g.now + 2 * DAY, 600)).toBe(600);
  });

  it("keeps one block for a base programme's days that have no flights yet, and shows the generated days as flights", () => {
    const g = newGame(11);
    const o = generateOffer(g, 'seasonBase', { wide: false, start: g.now + 5 * DAY, days: 120 })!;
    const ac = Object.values(g.fleet).find((a) => feasibility(g, o.id, a.id).level !== 'no')!;
    expect(acceptOffer(g, o.id, [ac.id]).ok).toBe(true);
    const c = Object.values(g.contracts).find((k) => k.offerId === o.id)!;
    expect(c.generatedUntil).toBeLessThan(c.end);
    const blocks = portalBlocks(g, ac.id, g.now, g.now + 40 * DAY);
    const cont = blocks.filter((b) => b.kind === 'cont');
    expect(cont.length).toBe(1);
    expect(cont[0].refs).toEqual([{ kind: 'contract', id: c.id }]);
    expect(cont[0].start).toBeGreaterThanOrEqual(c.generatedUntil - DAY);
    const flights = blocks.filter((b) => b.kind === 'flight');
    expect(flights.length).toBeGreaterThan(0);
    expect(flights.every((b) => b.start < cont[0].start)).toBe(true);
  });
});

describe('offer portal: the trips in the way', () => {
  it('outlines only the legs of the trips that clash with the new job, and lists each trip once', () => {
    const g = newGame(26);
    const { ac, fl, start } = job(g, 4);
    // The new job flies on day 2 of the charter, over its second rotation.
    const o = legsOffer(g, [['LIS', 'PMI', start + DAY + 60], ['PMI', 'LIS', start + DAY + 5 * 60]]);
    const r = feasibility(g, o.id, ac.id);
    expect(r.checks.find((x) => x.id === 'availability')!.level).toBe('no');
    const trips = clashTrips(g, r);
    expect(trips.length).toBe(1);
    expect(trips[0].legIds).toEqual([fl[2].id, fl[3].id]);
    expect(trips[0].label).toBe('LIS–FAO–LIS');
    expect(trips[0].move.ok).toBe(true);
    expect(trips[0].sub.ok).toBe(true);
    const [from, to] = portalWindow(o, g.now);
    const blocks = portalBlocks(g, ac.id, from, to, r);
    const clash = blocks.filter((b) => b.clash).map((b) => b.flightId);
    expect(clash).toEqual([fl[2].id, fl[3].id]);
  });

  it("marks a base programme's days without flights as the block in the way (nothing to move or sub-lease yet)", () => {
    const g = newGame(11);
    const o = generateOffer(g, 'seasonBase', { wide: false, start: g.now + 5 * DAY, days: 120 })!;
    const ac = Object.values(g.fleet).find((a) => feasibility(g, o.id, a.id).level !== 'no')!;
    expect(acceptOffer(g, o.id, [ac.id]).ok).toBe(true);
    const c = Object.values(g.contracts).find((k) => k.offerId === o.id)!;
    const late = legsOffer(g, [['LIS', 'FAO', c.generatedUntil + 20 * DAY]]);
    const r = feasibility(g, late.id, ac.id);
    expect(r.conflicts.programmes).toContain(c.id);
    expect(clashTrips(g, r).length).toBe(0);
    const [from, to] = portalWindow(late, g.now);
    expect(portalBlocks(g, ac.id, from, to, r).find((b) => b.kind === 'cont')?.clash).toBe(true);
  });

  it('sub-leasing the clashing trip makes the offer flyable; the rival’s price goes to the sub-charter ledger line', () => {
    const g = newGame(26);
    const { ac, c, start } = job(g, 4);
    const o = legsOffer(g, [['LIS', 'PMI', start + DAY + 60], ['PMI', 'LIS', start + DAY + 5 * 60]]);
    const r = feasibility(g, o.id, ac.id);
    const groups = subleaseGroups(clashTrips(g, r));
    expect(groups.length).toBe(1);
    expect(groups[0].contractId).toBe(c.id);
    const best = subleaseTrip(g, groups[0].trips[0].flightId).best!;
    const cash = g.company.cash;
    const line = g.finance.current.lines.subcharter ?? 0;
    const res = subcharter(g, groups[0].flightIds, best.cost, best.rivalId);
    expect(res.ok).toBe(true);
    expect(g.finance.current.lines.subcharter).toBe(line - best.cost);
    expect(g.company.cash).toBe(cash - best.cost);
    for (const id of groups[0].flightIds) expect(g.flights[id].operatedBy).toBe(best.rivalId);
    const after = feasibility(g, o.id, ac.id);
    expect(after.checks.find((x) => x.id === 'availability')!.level).toBe('ok');
    expect(clashTrips(g, after).length).toBe(0);
    expect(acceptOffer(g, o.id, [ac.id]).ok).toBe(true);
  });
});

describe('why a trip cannot be sub-leased', () => {
  it('says so plainly: too close, already handed over, a ferry or empty leg, under way, no operator', () => {
    const g = newGame(26);
    const { ac, fl } = job(g, 3);
    const leg = fl[0];
    expect(subleaseTrip(g, leg.id).ok).toBe(true);
    // Too close: the first revenue leg leaves within 6 h.
    const now = g.now;
    g.now = leg.std - SUB_LEAD + 30;
    expect(subleaseTrip(g, leg.id).reason).toMatch(/^LIS–FAO leaves in .+: another operator needs at least 6 h to take a trip over$/);
    g.now = now;
    // No operator flies for us: every rival is out of business.
    const rivals = g.rivals;
    g.rivals = [];
    expect(subleaseTrip(g, leg.id)).toMatchObject({ ok: false, reason: 'No other operator flies this type for this client' });
    g.rivals = rivals;
    // Every operator fully booked.
    const loads = g.rivals.map((x) => x.load);
    for (const x of g.rivals) x.load = 0.99;
    expect(subleaseTrip(g, leg.id).reason).toMatch(/^No operator has an aircraft free \(.+: no aircraft free until/);
    g.rivals.forEach((x, i) => (x.load = loads[i]));
    // Handed over already.
    const v = subleaseTrip(g, leg.id);
    expect(subcharter(g, v.flightIds, v.best!.cost, v.best!.rivalId).ok).toBe(true);
    expect(subleaseTrip(g, leg.id).reason).toMatch(/already flies it for us$/);
    // Under way: the next trip's first leg is in the air.
    const next = fl[2];
    next.status = 'enroute';
    expect(subleaseTrip(g, fl[3].id).reason).toMatch(/^This trip is under way: LIS–FAO left at/);
    expect(subleaseTrip(g, next.id).reason).toBe('This leg is in the air');
    // A ferry and an empty positioning leg of ours have no client.
    const ferry = { ...fl[4], id: 'fx', kind: 'ferry' as const, contractId: null };
    g.flights.fx = ferry;
    expect(subleaseTrip(g, 'fx').reason).toMatch(/^A ferry flight has no client/);
    g.flights.fx = { ...ferry, kind: 'positioning' };
    expect(subleaseTrip(g, 'fx').reason).toMatch(/^An empty positioning leg/);
    expect(subleaseTrip(g, 'nope').reason).toBe('Flight not found');
    expect(ac.id).toBeTruthy();
  });
});
